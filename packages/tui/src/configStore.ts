/**
 * Phase 26: minimal TOML-like config store (security review fix F5).
 *
 * The /config slash command lets the user write key=value pairs into
 * ~/.my-agent/config.toml. Naive `${k} = ${v}` concatenation lets the user
 * inject extra sections via newlines in the value (e.g. `value = "x\n[evil]
 * x = 1"`). To defang this, the store:
 *
 *   1. Restricts `key` to a known allow-list (model, provider, budget,
 *      defaultMode, theme, telemetry).
 *   2. Rejects values containing \n, \r, control chars, or `"""`.
 *   3. Uses a simple key=value parser (read) + ASCII concatenation (write),
 *      with ONE key per physical line. No TOML arrays/tables.
 *
 * For a real production store use a library like `smol-toml`. For the TUI
 * `/config` surface this minimal implementation is sufficient.
 */
import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { join, dirname, sep } from "node:path";
import { homedir } from "node:os";

/** The allowed config keys. Anything else → rejected. */
export const CONFIG_KEY_ALLOWLIST: Set<string> = new Set([
  "model",
  "provider",
  "budget",
  "defaultMode",
  "theme",
  "telemetry",
  "compactKeep",
  "maxTokens",
]);

/** The config file path. */
export function configPath(): string {
  return join(homedir(), ".my-agent", "config.toml");
}

/** A config record. */
export interface ConfigRecord {
  [key: string]: string;
}

/** Validate a key. Returns null on success, an error message on failure. */
export function validateKey(key: string): string | null {
  if (!key || !CONFIG_KEY_ALLOWLIST.has(key)) {
    return `unknown config key: "${key}" (allowed: ${[...CONFIG_KEY_ALLOWLIST].join(", ")})`;
  }
  return null;
}

const TRIPLE_QUOTE = String.fromCharCode(34) + String.fromCharCode(34) + String.fromCharCode(34);

/** Validate a value. Returns null on success, an error message on failure. */
export function validateValue(value: string): string | null {
  if (value.length > 1024) return "config value too long (max 1024 chars)";
  // Reject newlines, carriage returns, control chars, and triple-quote.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return "config value contains forbidden characters (no newlines, controls, or triple-quote)";
  }
  if (value.indexOf(TRIPLE_QUOTE) >= 0) {
    return "config value contains forbidden characters (no newlines, controls, or triple-quote)";
  }
  return null;
}


/** Read all key=value pairs from config.toml. */
export async function readConfig(filePath = configPath()): Promise<ConfigRecord> {
  const out: ConfigRecord = {};
  let txt = "";
  try {
    txt = await readFile(filePath, "utf8");
  } catch {
    return out;
  }
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!m) continue; // ignore non-key lines (no section headers supported)
    const key = m[1]!;
    let val = m[2]!.trim();
    // Strip a single surrounding pair of " or '.
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (!CONFIG_KEY_ALLOWLIST.has(key)) continue; // silently skip unknown keys on read
    out[key] = val;
  }
  return out;
}

/** Write a single key=value pair (replaces existing same-key line). */
export async function writeConfig(key: string, value: string, filePath = configPath()): Promise<void> {
  const keyErr = validateKey(key);
  if (keyErr) throw new Error(keyErr);
  const valErr = validateValue(value);
  if (valErr) throw new Error(valErr);

  // Re-read current state and rewrite the entire file (idempotent).
  const existing = await readConfig(filePath);
  existing[key] = value;
  // Strict per-line format: `key = "value"\n`. No section headers, no multi-line strings.
  // Quote the value so spaces and most punctuation are preserved.
  const safeValue = quoteForToml(value);
  const lines = Object.entries(existing).sort(([a], [b]) => a.localeCompare(b));
  const body = "# mya runtime config — written by /config\n" + lines.map(([k, v]) => `${k} = ${safeValue(v)}`).join("\n") + "\n";
  // Contain: must write to ~/.my-agent/ only (no symlinks escape).
  // C1 fix: mkdir FIRST so fresh installs work (realpath on non-existent dir returns null).
  // H1 fix: strict path-component containment (root + path.sep) — startsWith alone is unsafe.
  // F5-1 fix: also reject config.toml if it's a pre-existing symlink
  // (writeFile would follow it and clobber the symlink target).
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const realDir = await realpath(dir);
  const root = homedir();
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (!realDir || !(realDir === root || realDir.startsWith(rootWithSep))) {
    throw new Error(`refusing to write config outside $HOME: ${filePath}`);
  }
  // Reject symlink at the config file itself (i.e. ~/.my-agent/config.toml being
  // a symlink to somewhere else).
  const fileLs = await lstat(filePath).catch(() => null);
  if (fileLs && fileLs.isSymbolicLink()) {
    throw new Error(`refusing to write through a symlink: ${filePath}`);
  }
  await writeFile(filePath, body, "utf8");
}

/** Quote a value for safe inclusion in the .toml file. Internal-only helper. */
function quoteForToml(v: string): (v: string) => string {
  return (s) => {
    if (s === "true" || s === "false") return s;
    // Escape backslash + double-quote, wrap in double-quote.
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  };
}
