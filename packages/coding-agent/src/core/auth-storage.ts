/**
 * CredentialStore implementation backed by auth.json.
 * Provider auth orchestration belongs to ModelRuntime and pi-ai Models.
 */

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../config.ts";
import { normalizePath } from "../utils/paths.ts";
import { resolveConfigValue } from "./resolve-config-value.ts";

type AuthStorageData = Record<string, Credential>;

type LockResult<T> = {
	result: T;
	next?: string;
};

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

export interface AuthStorageBackend {
	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
	withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
	private authPath: string;

	constructor(authPath: string = join(getAgentDir(), "auth.json")) {
		this.authPath = normalizePath(authPath);
	}

	private ensureParentDir(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	private ensureFileExists(): void {
		if (!existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
			chmodSync(this.authPath, 0o600);
		}
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire auth storage lock");
	}

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => void) | undefined;
		try {
			release = this.acquireLockSyncWithRetry(this.authPath);
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = fn(current);
			if (next !== undefined) {
				writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
				chmodSync(this.authPath, 0o600);
			}
			return result;
		} finally {
			if (release) {
				release();
			}
		}
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => Promise<void>) | undefined;
		let lockCompromised = false;
		let lockCompromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (lockCompromised) {
				throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
			}
		};

		try {
			release = await lockfile.lock(this.authPath, {
				retries: {
					retries: 10,
					factor: 2,
					minTimeout: 100,
					maxTimeout: 10000,
					randomize: true,
				},
				stale: 30000,
				onCompromised: (err) => {
					lockCompromised = true;
					lockCompromisedError = err;
				},
			});

			throwIfCompromised();
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = await fn(current);
			throwIfCompromised();
			if (next !== undefined) {
				writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
				chmodSync(this.authPath, 0o600);
			}
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors when lock is compromised.
				}
			}
		}
	}
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
	private value: string | undefined;

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		const { result, next } = fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		const { result, next } = await fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}
}

/**
 * Credential storage backed by a JSON file.
 */
export class AuthStorage implements CredentialStore {
	private data: AuthStorageData = {};
	private storage: AuthStorageBackend;
	// mya fork: runtime API-key overrides (mirror RuntimeCredentials semantics in 0.80.10)
	private runtimeOverrides: Map<string, string> = new Map();

	private constructor(storage: AuthStorageBackend) {
		this.storage = storage;
		this.reload();
	}

	static create(authPath?: string): AuthStorage {
		return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")));
	}

	static fromStorage(storage: AuthStorageBackend): AuthStorage {
		return new AuthStorage(storage);
	}

	static inMemory(data: AuthStorageData = {}): AuthStorage {
		const storage = new InMemoryAuthStorageBackend();
		storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
		return AuthStorage.fromStorage(storage);
	}

	private parseStorageData(content: string | undefined): AuthStorageData {
		if (!content) {
			return {};
		}
		return JSON.parse(content) as AuthStorageData;
	}

	/**
	 * Reload credentials from storage.
	 */
	reload(): void {
		let content: string | undefined;
		try {
			this.storage.withLock((current) => {
				content = current;
				return { result: undefined };
			});
			this.data = this.parseStorageData(content);
		} catch {
			// Preserve the last valid in-memory snapshot.
		}
	}

	async read(provider: string): Promise<Credential | undefined> {
		const credential = this.data[provider];
		if (credential?.type !== "api_key") return credential;
		if (credential.key === undefined) return credential;
		return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
	}

	async modify(
		provider: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.storage.withLockAsync(async (content) => {
			const currentData = this.parseStorageData(content);
			const next = await fn(currentData[provider]);
			if (next === undefined) {
				this.data = currentData;
				return { result: currentData[provider] };
			}

			const merged: AuthStorageData = { ...currentData, [provider]: next };
			this.data = merged;
			return { result: next, next: JSON.stringify(merged, null, 2) };
		});
	}

	async delete(provider: string): Promise<void> {
		await this.storage.withLockAsync(async (content) => {
			const currentData = this.parseStorageData(content);
			delete currentData[provider];
			this.data = currentData;
			return { result: undefined, next: JSON.stringify(currentData, null, 2) };
		});
	}

	/** List credential metadata without resolving configured key values. */
	async list(): Promise<readonly CredentialInfo[]> {
		return Object.entries(this.data).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	// ══════════════════════════════════════════════════════════════════════════════
	// mya fork: backward-compat shims for pre-0.80.10 test/internal callers
	// (upstream 0.80.10 replaced these with read/modify/delete/list + RuntimeCredentials).
	// These delegate to the new CredentialStore API. Marked for removal once
	// callers and tests migrate.
	// ══════════════════════════════════════════════════════════════════════════════

	/** Shim for old `getApiKey(provider)`: returns the api_key string or undefined.
	 * Synchronous for the cached in-memory case; older tests called without await. */
	getApiKey(provider: string): string | undefined {
		// mya fork: runtime override takes priority over stored credential
		const override = this.runtimeOverrides.get(provider);
		if (override !== undefined) return override;
		const c = this.data[provider];
		if (!c || c.type !== "api_key") return undefined;
		if (c.key === undefined) return undefined;
		// Resolve $VAR / !cmd references via resolveConfigValue (sync wrapper)
		return resolveConfigValue(c.key, c.env);
	}

	/** Shim for old `getAuthStatus(provider)`: returns { configured, source }. Sync. */
	getAuthStatus(provider: string): { configured: boolean; source?: string } {
		const c = this.data[provider];
		if (!c) return { configured: false };
		const source = c.type === "api_key" ? (c.env ? "env" : "stored") : "stored";
		return { configured: true, source };
	}

	/** Shim for old `set(provider, credential)`: write via modify(). */
	async set(provider: string, credential: Credential): Promise<void> {
		await this.modify(provider, async () => credential);
	}

	/** Shim for old `has(provider)`: sync — checks in-memory data. */
	has(provider: string): boolean {
		return this.data[provider] !== undefined;
	}

	/** Shim for old `get(provider)`: sync — returns cached credential. */
	get(provider: string): Credential | undefined {
		return this.data[provider];
	}

	/** Shim for old `remove(provider)`: alias for delete(). */
	async remove(provider: string): Promise<void> {
		return this.delete(provider);
	}

	/** Shim for old `getProviderEnv(provider)`: sync — returns credential.env if api_key. */
	getProviderEnv(provider: string): Record<string, string> | undefined {
		const c = this.data[provider];
		if (c?.type !== "api_key") return undefined;
		return c.env;
	}

	/** Shim for old `drainErrors()`: AuthStorage doesn't buffer errors in 0.80.10 — return []. */
	drainErrors(): Array<{ scope: string; error: Error }> {
		return [];
	}

	/** Shim for old `setRuntimeApiKey(provider, apiKey)`: mirror RuntimeCredentials semantics
	 * (in-memory override, doesn't touch disk-stored credential). */
	async setRuntimeApiKey(provider: string, apiKey: string): Promise<void> {
		this.runtimeOverrides.set(provider, apiKey);
	}

	/** Shim for old `removeRuntimeApiKey(provider)`. */
	async removeRuntimeApiKey(provider: string): Promise<void> {
		this.runtimeOverrides.delete(provider);
	}
}

/**
 * One-off synchronous read of a stored credential from an auth.json file,
 * without instantiating a store or resolving configured key values.
 */
export function readStoredCredential(
	providerId: string,
	authPath: string = join(getAgentDir(), "auth.json"),
): Credential | undefined {
	try {
		const data = JSON.parse(readFileSync(normalizePath(authPath), "utf-8")) as AuthStorageData;
		return data[providerId];
	} catch {
		return undefined;
	}
}
