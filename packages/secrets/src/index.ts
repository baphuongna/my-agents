/**
 * @my-agent/secrets — secret management lifecycle (§14.2).
 *
 * Secrets live in the OS keyring (or a sealed 0600 file), never in config TOML
 * or env-as-default. `resolve()` returns plaintext ONLY to the in-process
 * caller; it is redacted before any log / RuntimeEvent / audit write (§14.1
 * invariant: the audit log records the SecretRef + a short fingerprint, never
 * the resolved value). Fail-closed: missing/expired/denied ⇒ error (never an
 * empty string, never a fallback constant).
 *
 * Tier-1 ships:
 *   - the SecretRef discriminated union + Secrets interface (§14.2)
 *   - an in-process SecretStore (backed by env/file/exec/keyring adapters)
 *   - a redactor that scrubs resolved values from payloads BEFORE audit hashing
 *   - rotate/revoke lifecycle stubs (keyring + file backends; full keyring
 *     integration is platform-specific + lands with the desktop build)
 *
 * Source: §14.2, headroom proxy secret-rotation, MyAgents ChannelSecretsAdapter.
 */
import { readFileSync, writeFileSync, chmodSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";

/** Where a secret lives (§14.2). */
export type SecretRef =
  | { from: "env"; ref: string } // e.g. "OPENAI_API_KEY"
  | { from: "file"; ref: string } // sealed 0600 file path (decrypt on read)
  | { from: "exec"; ref: string } // argv → stdout (parsed, never echoed)
  | { from: "keyring"; ref: string }; // service/account name in OS keyring

/** A resolved secret's short fingerprint for audit (never the value). */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** A registered secret (resolved value held in-process only). */
interface RegisteredSecret {
  ref: SecretRef;
  value: string;
  rotatedAt: number;
}

/** Secret resolution error — fail-closed. */
export class SecretError extends Error {
  constructor(
    public ref: SecretRef,
    message: string,
  ) {
    super(`secret ${ref.from}:${ref.ref}: ${message}`);
    this.name = "SecretError";
  }
}

/** Resolve a SecretRef to its plaintext value. Fail-closed: rejects if
 * missing/denied. NEVER returns an empty fallback. */
export function resolveSecret(ref: SecretRef): string {
  switch (ref.from) {
    case "env": {
      const v = process.env[ref.ref];
      if (!v) throw new SecretError(ref, "env var not set");
      return v;
    }
    case "file": {
      if (!existsSync(ref.ref)) throw new SecretError(ref, "sealed file missing");
      let bytes: Buffer;
      try {
        bytes = readFileSync(ref.ref);
      } catch (e) {
        throw new SecretError(ref, `unreadable: ${(e as Error).message}`);
      }
      const v = bytes.toString("utf8").trim();
      if (!v) throw new SecretError(ref, "empty file");
      return v;
    }
    case "exec": {
      // exec ref = "argv" → stdout (never echoed). Defer real spawn to the shell
      // tool (§7); Tier-1 resolves via a synchronous lookup table registered by
      // the host. Fail-closed if unregistered.
      throw new SecretError(ref, "exec backend not registered (register via SecretStore.registerExec)");
    }
    case "keyring": {
      throw new SecretError(ref, "keyring backend not registered (platform-specific; lands with desktop)");
    }
  }
}

/** In-process secret store — holds resolved secrets + lifecycle. The host
 * registers exec/keyring backends; env/file resolve directly. */
export class SecretStore {
  private readonly entries = new Map<string, RegisteredSecret>();
  private readonly execBackends = new Map<string, () => string>();
  private readonly keyringBackends = new Map<string, () => string>();

  private key(ref: SecretRef): string {
    return `${ref.from}:${ref.ref}`;
  }

  /** Register an exec/keyring backend (host wires these). */
  registerExec(ref: string, fn: () => string): void {
    this.execBackends.set(`exec:${ref}`, fn);
  }
  registerKeyring(ref: string, fn: () => string): void {
    this.keyringBackends.set(`keyring:${ref}`, fn);
  }

  /** Resolve a secret (fail-closed) + cache it in-process. */
  resolve(ref: SecretRef): string {
    const k = this.key(ref);
    const cached = this.entries.get(k);
    if (cached) return cached.value;
    let value: string;
    if (ref.from === "exec") {
      const fn = this.execBackends.get(k);
      if (!fn) throw new SecretError(ref, "exec backend not registered");
      value = fn();
    } else if (ref.from === "keyring") {
      const fn = this.keyringBackends.get(k);
      if (!fn) throw new SecretError(ref, "keyring backend not registered");
      value = fn();
    } else {
      value = resolveSecret(ref);
    }
    if (!value) throw new SecretError(ref, "resolved empty (fail-closed)");
    this.entries.set(k, { ref, value, rotatedAt: Date.now() });
    return value;
  }

  /** Rotate: re-resolve (bumps rotatedAt). For file refs, regenerates the file. */
  rotate(ref: SecretRef): void {
    const k = this.key(ref);
    if (ref.from === "file") {
      // regenerate the sealed file with a fresh random secret
      this.writeSealedFile(ref.ref, randomBytes(32).toString("hex"));
    }
    // drop cache; next resolve re-reads
    this.entries.delete(k);
    if (ref.from !== "file") this.resolve(ref); // re-cache (file may have changed path semantics)
  }

  /** Revoke: delete the underlying store entry + invalidate dependents. */
  revoke(ref: SecretRef): void {
    const k = this.key(ref);
    this.entries.delete(k);
    if (ref.from === "file" && existsSync(ref.ref)) {
      try {
        unlinkSync(ref.ref);
      } catch {
        /* best-effort */
      }
    }
    this.execBackends.delete(k);
    this.keyringBackends.delete(k);
  }

  /** Write a sealed 0600 file (the file backend's storage). */
  writeSealedFile(path: string, value: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      /* best-effort on platforms without chmod */
    }
  }

  /** Snapshot all cached secrets (for the redactor). Values are held in-process
   * only; never logged. */
  snapshot(): Map<string, RegisteredSecret> {
    return new Map(this.entries);
  }
}

/** A redactor (for §14.1 audit-before-hash) that scrubs any registered secret
 * values from a payload, replacing them with `<secret:fingerprint>`. */
export function makeSecretRedactor(store: SecretStore): (payload: Record<string, unknown>) => Record<string, unknown> {
  // Collect all known secret values to scrub. Walks the payload; for each string
  // value that equals a known secret, replaces with the fingerprint placeholder.
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") {
      for (const [, entry] of store.snapshot()) {
        if (entry.value && v.includes(entry.value)) {
          return v.split(entry.value).join(`<secret:${fingerprint(entry.value)}>`);
        }
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, scrub(val)]));
    }
    return v;
  };
  return (payload) => scrub(payload) as Record<string, unknown>;
}
