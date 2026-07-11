/**
 * ProjectTrust (§14.3) — per-project-root trust gate. Before a root is trusted,
 * ONLY context-files + global `-e` extensions load (no dotenv, no auto-approve,
 * no MCP auto-mount). Trust promotion requires EXPLICIT operator action.
 *
 * SECURITY (review CRITICAL-1/HIGH-1): trust state lives in a USER-OWNED dir
 * (~/.my-agent/trust/<sha256(realpath(root))>.json, 0600) — NEVER inside the
 * project root. A project committing {"level":"privileged"} to its own
 * .my-agent/trust.json has NO effect (the grant must come from the operator's
 * environment, recorded where the project cannot write). The project's file is
 * ignored entirely — the project is untrusted input, not a trust authority.
 *
 * Source: §14.3; pi trust-manager.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { nowWallclock } from "@my-agent/core";

export type TrustLevel = "untrusted" | "trusted" | "privileged";

export interface ProjectTrust {
  /** Canonical (realpath) project root. */
  root: string;
  level: TrustLevel;
  defaultProjectTrust: "ask" | "always" | "never";
  trustedAt?: number;
  source: "persisted" | "default" | "session";
}

/** The user-owned trust store root (MY_AGENT_TRUST_DIR override for tests). */
function trustStoreRoot(): string {
  return process.env.MY_AGENT_TRUST_DIR ?? join(homedir(), ".my-agent", "trust");
}

/** The trust-record path for a canonical root (sha256-keyed, user-owned). */
function trustFileFor(canonicalRoot: string): string {
  const key = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 32);
  return join(trustStoreRoot(), `${key}.json`);
}

/** Canonicalize a root (realpath) for stable keying + symlink defense. */
function canonical(root: string): string {
  try { return realpathSync(root); } catch { return root; }
}

/** Load the trust record for a root. Reads ONLY from the user-owned store;
 * the project's own files are never consulted for the level (review CRITICAL-1). */
export function loadTrust(root: string, defaultProjectTrust: "ask" | "always" | "never" = "ask"): ProjectTrust {
  const canon = canonical(root);
  const file = trustFileFor(canon);
  if (existsSync(file) && !lstatSync(file).isSymbolicLink()) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectTrust>;
      return {
        root: canon,
        level: raw.level === "trusted" || raw.level === "privileged" ? raw.level : "untrusted",
        defaultProjectTrust: raw.defaultProjectTrust ?? defaultProjectTrust,
        trustedAt: raw.trustedAt,
        source: "persisted",
      };
    } catch {
      // corrupt user-owned record → fail-safe to untrusted
    }
  }
  return { root: canon, level: "untrusted", defaultProjectTrust, source: "default" };
}

/** Persist a trust record to the USER-OWNED store (0600; never inside project). */
export function saveTrust(t: ProjectTrust): void {
  const dir = trustStoreRoot();
  mkdirSync(dir, { recursive: true });
  const file = trustFileFor(canonical(t.root));
  writeFileSync(file, JSON.stringify({ level: t.level, defaultProjectTrust: t.defaultProjectTrust, trustedAt: t.trustedAt }, null, 2), { mode: 0o600 });
}

/** Promote a root's trust level (explicit operator action). Persists to the
 * user-owned store (NOT the project). durable=false → session-only (in-memory). */
export function promoteTrust(root: string, level: TrustLevel, defaultProjectTrust: "ask" | "always" | "never" = "ask", durable = true): ProjectTrust {
  const t: ProjectTrust = { root: canonical(root), level, defaultProjectTrust, trustedAt: nowWallclock(), source: durable ? "persisted" : "session" };
  if (durable) saveTrust(t);
  return t;
}

/** §14.3 gate: before trust, only SAFE context loads (no dotenv/auto-approve/MCP). */
export function safeContextOnly(t: ProjectTrust): boolean {
  return t.level === "untrusted";
}

/** §7 gate: may auto-approve (no per-call human prompt) at this trust level? */
export function canAutoApprove(t: ProjectTrust): boolean {
  return t.level === "privileged";
}

/** First-run decision: should we prompt the operator? (defaultProjectTrust from
 * a USER-OWNED config, not the project.) */
export function shouldPromptFirstRun(t: ProjectTrust): boolean {
  return t.defaultProjectTrust === "ask" && t.level === "untrusted";
}
