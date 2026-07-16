/**
 * @my-agent/core/roles — Role registry + config loading.
 *
 * A "role" is a lightweight overlay applied to a session:
 *   - system prompt append (personality/instructions)
 *   - tool whitelist/blacklist (what the role can do)
 *   - optional model preference
 *   - memory scope (global = shared brain, session = current-task private)
 *
 * Config files: ~/.mya/roles/*.json
 *
 * Pattern (from pi-crew role-tools.ts + Claude Code agent types):
 *   Roles are NOT separate agents with isolated state.
 *   They share one brain (memory.db) but differ in prompt + tools.
 *   Current-task memories are session-scoped to prevent context leak
 *   between parallel roles.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RoleConfig {
  /** Unique role name (kebab-case). */
  name: string;
  /** Human-readable description shown in UI. */
  description: string;
  /** Text appended to system prompt when this role is active. */
  promptAppend?: string;
  /** Tool whitelist — only these tools are available. */
  toolsAllowed?: string[];
  /** Tool blacklist — these tools are removed from the default set. */
  toolsDenied?: string[];
  /** Optional model preference (e.g. "MiniMax-M3", "claude-sonnet-4-6"). */
  modelPrefer?: string;
  /** Optional thinking level preference. */
  thinkingLevel?: "low" | "medium" | "high";
  /**
   * Memory scope for auto-capture in this role.
   * - "global": captured memories are visible to all roles (default, shared brain)
   * - "role": captured memories are tagged with this role name (private)
   */
  memoryScope?: "global" | "role";
}

export interface RoleRegistry {
  /** Get a role by name (or undefined if not found). */
  get(name: string): RoleConfig | undefined;
  /** Get the default role. */
  getDefault(): RoleConfig;
  /** List all registered roles. */
  list(): RoleConfig[];
  /** Check if a role exists. */
  has(name: string): boolean;
}

// ── Default role ──────────────────────────────────────────────────────────

export const DEFAULT_ROLE: RoleConfig = {
  name: "default",
  description: "General-purpose assistant",
};

// ── Config loading ────────────────────────────────────────────────────────

/** Get the roles config directory (~/.mya/roles/). */
export function getRolesDir(): string {
  return join(homedir(), ".mya", "roles");
}

/**
 * Load all role configs from ~/.mya/roles/*.json.
 * If the directory doesn't exist, creates it with a default.json.
 * Invalid JSON files are skipped (best-effort, logged to stderr).
 */
export function loadRoles(dir?: string): RoleRegistry {
  const rolesDir = dir ?? getRolesDir();
  const roles = new Map<string, RoleConfig>();
  roles.set("default", DEFAULT_ROLE);

  if (!existsSync(rolesDir)) {
    try {
      mkdirSync(rolesDir, { recursive: true });
      writeFileSync(
        join(rolesDir, "default.json"),
        JSON.stringify(DEFAULT_ROLE, null, 2) + "\n",
      );
    } catch { /* best-effort */ }
    return createRegistry(roles);
  }

  let entries: string[] = [];
  try {
    // Sort alphabetically for deterministic load order (collision winner is predictable).
    entries = readdirSync(rolesDir).filter((f) => f.endsWith(".json")).sort();
  } catch { /* dir not readable */ }

  for (const file of entries) {
    try {
      const content = readFileSync(join(rolesDir, file), "utf8");
      const parsed = JSON.parse(content) as unknown;
      if (!isValidRoleConfig(parsed)) {
        process.stderr.write(`[roles] skipping ${file}: invalid format\n`);
        continue;
      }
      // Detect name collision: a role with this name was already loaded from
      // an earlier (alphabetically smaller) file. First file wins; skip the
      // duplicate with a warning instead of silently overwriting.
      if (roles.has(parsed.name)) {
        process.stderr.write(`[roles] skipping ${file}: name "${parsed.name}" already defined by another file\n`);
        continue;
      }
      roles.set(parsed.name, parsed);
    } catch (e) {
      process.stderr.write(`[roles] skipping ${file}: ${(e as Error).message}\n`);
    }
  }

  return createRegistry(roles);
}

function isValidRoleConfig(obj: unknown): obj is RoleConfig {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (typeof r["name"] !== "string" || !r["name"]) return false;
  if (typeof r["description"] !== "string") return false;
  return true;
}

function createRegistry(roles: Map<string, RoleConfig>): RoleRegistry {
  return {
    get: (name: string) => roles.get(name),
    getDefault: () => roles.get("default") ?? DEFAULT_ROLE,
    list: () => [...roles.values()].sort((a, b) => a.name.localeCompare(b.name)),
    has: (name: string) => roles.has(name),
  };
}

/**
 * Apply a role's tool filter to a list of available tools.
 * Returns the filtered tool list.
 */
export function filterToolsForRole(
  tools: string[],
  role: RoleConfig,
): string[] {
  let result = [...tools];

  if (role.toolsDenied && role.toolsDenied.length > 0) {
    const denied = new Set(role.toolsDenied);
    result = result.filter((t) => !denied.has(t));
  }

  if (role.toolsAllowed && role.toolsAllowed.length > 0) {
    const allowed = new Set(role.toolsAllowed);
    result = result.filter((t) => allowed.has(t));
  }

  return result;
}
