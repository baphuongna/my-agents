/**
 * @my-agent/desktop — desktop shell contract (§25.3).
 *
 * The native shell (Tauri/Electron) wraps the web UI + tray/overlay/notification.
 * This package holds the testable §25.3 contracts independent of the GUI runtime:
 *   - deep-link URI scheme `myagent://` validation
 *   - typed IPC channel (no nodeIntegration — the renderer invoke/event surface)
 *   - updater signing: sigstore + content-hash before apply
 *   - sidecar lifecycle: gates on §13 readiness before the shell is "ready"
 *
 * Source: §25.3 Desktop app; MyAgents src-tauri, openhuman.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// ─── deep-link URI scheme (§25.3 myagent://) ──────────────────────────────────

/** A parsed deep-link. */
export interface DeepLink {
  scheme: "myagent";
  host: string; // the "action" (open / approve / install)
  params: Record<string, string>;
}

export type DeepLinkResult = { ok: true; link: DeepLink } | { ok: false; reason: string };

/** Allowed deep-link actions + their required params. */
const DEEP_LINK_ACTIONS: Record<string, string[]> = {
  open: ["sessionId"],
  approve: ["sessionId", "callId"],
  install: ["package"],
  focus: [],
};

/** Validate a `myagent://` deep-link URI. Rejects unknown schemes/hosts +
 * missing required params (defends against malformed/malicious links). */
export function validateDeepLink(uri: string): DeepLinkResult {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: "malformed URI" };
  }
  if (parsed.protocol !== "myagent:") {
    return { ok: false, reason: `wrong scheme: ${parsed.protocol}` };
  }
  const host = parsed.hostname.toLowerCase();
  const required = DEEP_LINK_ACTIONS[host];
  if (!required) {
    return { ok: false, reason: `unknown action: ${host}` };
  }
  const params: Record<string, string> = {};
  for (const [k, v] of parsed.searchParams) params[k] = v;
  for (const r of required) {
    if (!(r in params)) {
      return { ok: false, reason: `missing required param: ${r}` };
    }
  }
  return { ok: true, link: { scheme: "myagent", host, params } };
}

// ─── typed IPC (§25.3 no nodeIntegration) ─────────────────────────────────────

/** A typed IPC channel contract. The shell's native side registers handlers;
 * the web renderer calls invoke() / listens on event(). No arbitrary eval. */
export class DesktopIpc {
  private readonly handlers = new Map<string, (args: unknown) => Promise<unknown>>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  /** The native side registers a handler for an invoke channel. */
  handle(channel: string, fn: (args: unknown) => Promise<unknown>): void {
    this.handlers.set(channel, fn);
  }

  /** The renderer invokes a channel (typed RPC). Rejects if unregistered. */
  async invoke(channel: string, args: unknown): Promise<unknown> {
    const fn = this.handlers.get(channel);
    if (!fn) throw new Error(`ipc: no handler for channel "${channel}"`);
    return fn(args);
  }

  /** The native side emits an event to the renderer. */
  emit(event: string, payload: unknown): void {
    const set = this.listeners.get(event);
    if (set) for (const fn of set) fn(payload);
  }

  /** The renderer listens for an event. Returns an unsub. */
  on(event: string, fn: (payload: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn);
    this.listeners.set(event, set);
    return () => set.delete(fn);
  }
}

// ─── updater signing (§25.3 sigstore + content-hash before apply) ─────────────

export interface UpdateDeclaration {
  version: string;
  /** Path to the downloaded update artifact. */
  artifactPath: string;
  /** Expected SHA-256 (pinned in the release manifest). */
  contentHash: string;
  /** sigstore bundle present? */
  sigstore: boolean;
}

export type UpdateVerifyResult =
  | { ok: true; version: string }
  | { ok: false; reason: "file-missing" | "hash-mismatch" | "sigstore-required"; detail: string };

/** Verify an update BEFORE applying (§25.3: sigstore + content-hash). Mirrors
 * the §14b native policy. Real sigstore verification happens at release time;
 * here we assert sigstore:true + content-hash match. */
export function verifyUpdate(decl: UpdateDeclaration): UpdateVerifyResult {
  if (!existsSync(decl.artifactPath)) {
    return { ok: false, reason: "file-missing", detail: `artifact not found: ${decl.artifactPath}` };
  }
  if (!decl.sigstore) {
    return { ok: false, reason: "sigstore-required", detail: "update must be sigstore-signed (§25.3)" };
  }
  const bytes = readFileSync(decl.artifactPath);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== decl.contentHash.toLowerCase()) {
    return { ok: false, reason: "hash-mismatch", detail: `expected ${decl.contentHash}, got ${actual}` };
  }
  return { ok: true, version: decl.version };
}

// ─── sidecar lifecycle (§25.3 gates on §13 readiness) ─────────────────────────

export type SidecarState = "booting" | "ready" | "degraded" | "stopped";

/** A sidecar lifecycle that gates the shell's "ready" state on the §13 readiness
 * probe. The tray/window activates only after readiness() is ok. */
export class SidecarLifecycle {
  state: SidecarState = "booting";
  constructor(private readonly readiness: { readiness: () => { ok: boolean; detail?: string } }) {}

  /** Poll readiness until ok (or timeout). Resolves with the state. */
  async waitForReady(opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<SidecarState> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = this.readiness.readiness();
      if (r.ok) {
        this.state = "ready";
        return "ready";
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    this.state = "degraded";
    return "degraded";
  }

  stop(): void {
    this.state = "stopped";
  }
}
