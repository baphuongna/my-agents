/**
 * ProjectTrust (§14.3) — per-project-root trust gate. Before a root is trusted,
 * ONLY context-files + global `-e` extensions load (no dotenv, no auto-approve,
 * no MCP auto-mount). Trust promotion requires explicit operator action.
 *
 * Persisted to `<root>/.my-agent/trust.json`. Source: §14.3; pi trust-manager.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { nowWallclock } from "@my-agent/core";

export type TrustLevel = "untrusted" | "trusted" | "privileged";

export interface ProjectTrust {
  root: string;
  level: TrustLevel;
  defaultProjectTrust: "ask" | "always" | "never";
  trustedAt?: number;
  source: "persisted" | "default" | "session";
}

const TRUST_FILE = ".my-agent/trust.json";

/** Load the trust record for a root (default = untrusted if absent). */
export function loadTrust(root: string, defaultProjectTrust: "ask" | "always" | "never" = "ask"): ProjectTrust {
  const file = join(root, TRUST_FILE);
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectTrust>;
      return {
        root,
        level: raw.level === "trusted" || raw.level === "privileged" ? raw.level : "untrusted",
        defaultProjectTrust: raw.defaultProjectTrust ?? defaultProjectTrust,
        trustedAt: raw.trustedAt,
        source: "persisted",
      };
    } catch {
      // corrupt trust file → fail-safe to untrusted
    }
  }
  return { root, level: "untrusted", defaultProjectTrust, source: "default" };
}

/** Persist a trust record (writes trust.json). */
export function saveTrust(t: ProjectTrust): void {
  const file = join(t.root, TRUST_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ level: t.level, defaultProjectTrust: t.defaultProjectTrust, trustedAt: t.trustedAt }, null, 2), "utf8");
}

/** Promote a root's trust level (explicit operator action). Persists if durable. */
export function promoteTrust(root: string, level: TrustLevel, defaultProjectTrust: "ask" | "always" | "never" = "ask", durable = true): ProjectTrust {
  const t: ProjectTrust = { root, level, defaultProjectTrust, trustedAt: nowWallclock(), source: durable ? "persisted" : "session" };
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

/** First-run decision: should we prompt the operator, or auto-assume? */
export function shouldPromptFirstRun(t: ProjectTrust): boolean {
  return t.defaultProjectTrust === "ask" && t.level === "untrusted";
}
