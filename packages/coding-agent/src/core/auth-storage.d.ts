/**
 * CredentialStore implementation backed by auth.json.
 * Provider auth orchestration belongs to ModelRuntime and pi-ai Models.
 */
import type { Credential, CredentialInfo, CredentialStore } from "@my-agent/pi-ai";
type AuthStorageData = Record<string, Credential>;
type LockResult<T> = {
    result: T;
    next?: string;
};
export interface AuthStorageBackend {
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
    withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}
export declare class FileAuthStorageBackend implements AuthStorageBackend {
    private authPath;
    constructor(authPath?: string);
    private ensureParentDir;
    private ensureFileExists;
    private acquireLockSyncWithRetry;
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
    withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}
export declare class InMemoryAuthStorageBackend implements AuthStorageBackend {
    private value;
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
    withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}
/**
 * Credential storage backed by a JSON file.
 */
export declare class AuthStorage implements CredentialStore {
    private data;
    private storage;
    private runtimeOverrides;
    private constructor();
    static create(authPath?: string): AuthStorage;
    static fromStorage(storage: AuthStorageBackend): AuthStorage;
    static inMemory(data?: AuthStorageData): AuthStorage;
    private parseStorageData;
    /**
     * Reload credentials from storage.
     */
    reload(): void;
    read(provider: string): Promise<Credential | undefined>;
    modify(provider: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
    delete(provider: string): Promise<void>;
    /** List credential metadata without resolving configured key values. */
    list(): Promise<readonly CredentialInfo[]>;
    /** Shim for old `getApiKey(provider)`: returns the api_key string or undefined.
     * Synchronous for the cached in-memory case; older tests called without await. */
    getApiKey(provider: string): string | undefined;
    /** Shim for old `getAuthStatus(provider)`: returns { configured, source }. Sync. */
    getAuthStatus(provider: string): {
        configured: boolean;
        source?: string;
    };
    /** Shim for old `set(provider, credential)`: write via modify(). */
    set(provider: string, credential: Credential): Promise<void>;
    /** Shim for old `has(provider)`: sync — checks in-memory data. */
    has(provider: string): boolean;
    /** Shim for old `get(provider)`: sync — returns cached credential. */
    get(provider: string): Credential | undefined;
    /** Shim for old `remove(provider)`: alias for delete(). */
    remove(provider: string): Promise<void>;
    /** Shim for old `getProviderEnv(provider)`: sync — returns credential.env if api_key. */
    getProviderEnv(provider: string): Record<string, string> | undefined;
    /** Shim for old `drainErrors()`: AuthStorage doesn't buffer errors in 0.80.10 — return []. */
    drainErrors(): Array<{
        scope: string;
        error: Error;
    }>;
    /** Shim for old `setRuntimeApiKey(provider, apiKey)`: mirror RuntimeCredentials semantics
     * (in-memory override, doesn't touch disk-stored credential). */
    setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
    /** Shim for old `removeRuntimeApiKey(provider)`. */
    removeRuntimeApiKey(provider: string): Promise<void>;
}
/**
 * One-off synchronous read of a stored credential from an auth.json file,
 * without instantiating a store or resolving configured key values.
 */
export declare function readStoredCredential(providerId: string, authPath?: string): Credential | undefined;
export {};
//# sourceMappingURL=auth-storage.d.ts.map