/**
 * find tool (§7). Recursive file search by glob pattern — ported from pi's
 * find tool into the mya ToolImpl model (`.meta.name` + `.run()`).
 *
 * Behaviour (pi parity):
 *  - `pattern` is a glob (`*` → `[^/]*`, `**` → `.*`, `?` → `[^/]`)
 *  - matches against the path RELATIVE to the search root
 *  - skips `.git` and `node_modules` subtrees (heavy / not interesting)
 *  - includes hidden files (dotfiles) by default — set `includeHidden: false`
 *    to exclude names starting with `.`
 *  - results capped at `limit` (default 200), sorted alphabetically
 *
 * Unlike pi (which shells out to `fd`), this is a pure-Node recursive walk so
 * it has no external binary dependency and is deterministic across platforms.
 *
 * Source: §7 Tool System; vendored/pi/dist/core/tools/find.js.
 */
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Mode, ToolResult, TurnContext } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "./registry.js";

const READONLY: Mode = "ReadOnly";

/** Maximum directories visited (guard against pathological/deep trees). */
const MAX_VISITED = 10_000;

/** Convert a glob pattern to a RegExp. Exported for unit testing. */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

/** Resolve a (possibly relative) path against the turn workspace. */
function resolvePath(ctx: TurnContext | undefined, path: string): string {
  return resolve(ctx?.workspace ?? process.cwd(), path);
}

export const findTool: ToolImpl = {
  meta: {
    name: "find",
    args: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root directory to search from (default: current directory)" },
        pattern: { type: "string", description: "Glob pattern to match filenames/paths (e.g. *.ts, **/*.json)" },
        type: {
          type: "string",
          enum: ["file", "dir", "any"],
          description: "Filter by entry type (default: any)",
        },
        limit: { type: "number", description: "Maximum results (default: 200)" },
        includeHidden: {
          type: "boolean",
          description: "Include dotfiles/dot-directories. Default: true (pi parity).",
        },
      },
    },
    requiredMode: READONLY,
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args)) return err("find", "invalid args");
    const targetPath = typeof args.path === "string" ? args.path : ".";
    const pattern = typeof args.pattern === "string" ? args.pattern : "*";
    const typeFilter = typeof args.type === "string" ? args.type : "any";
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 200;
    const includeHidden = args.includeHidden !== false; // default true
    const rootAbs = resolvePath(ctx, targetPath);
    try {
      const regex = globToRegex(pattern);
      const results: string[] = [];
      const seen = new Set<string>();
      let visited = 0;

      async function walk(dir: string, depth: number): Promise<void> {
        if (results.length >= limit || depth > 10 || visited >= MAX_VISITED) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return; // permission error / vanished dir → skip subtree
        }
        for (const entry of entries) {
          if (++visited >= MAX_VISITED || results.length >= limit) return;
          // Prune heavy / noise subtrees (pi parity with .gitignore intent).
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          // Hidden-file filter (opt-out).
          if (!includeHidden && entry.name.startsWith(".")) continue;
          const fullPath = join(dir, entry.name);
          const relPath = relative(rootAbs, fullPath);
          if (seen.has(relPath)) continue;
          seen.add(relPath);
          const isDir = entry.isDirectory();
          const isSymlink = entry.isSymbolicLink();
          const matchesType =
            typeFilter === "any" ||
            (typeFilter === "dir" && isDir) ||
            (typeFilter === "file" && !isDir && !isSymlink);
          if (regex.test(relPath) && matchesType) {
            results.push(relPath);
          }
          if (isDir) {
            await walk(fullPath, depth + 1);
          }
        }
      }
      await walk(rootAbs, 0);
      results.sort();
      return ok("find", {
        path: targetPath,
        pattern,
        results: results.slice(0, limit),
        count: results.length,
      });
    } catch (e) {
      return err("find", e instanceof Error ? e.message : String(e));
    }
  },
};
