/**
 * ls tool (§7). Lists directory contents — ported from pi's ls tool into the
 * mya ToolImpl model (`.meta.name` + `.run()`).
 *
 * Behaviour (pi parity): entries sorted alphabetically (case-insensitive),
 * includes dotfiles, directories marked with a `type: "dir"`, symlinks with
 * `type: "symlink"`. Output is capped at `limit` (default 500) entries.
 *
 * Enhancement over pi: optional `binary` detection per file (sniffs the first
 * 8 KB for NUL bytes) so callers can distinguish text from binary files without
 * a separate read. Disabled by default; enable with `detectBinary: true`.
 *
 * Source: §7 Tool System; vendored/pi/dist/core/tools/ls.js.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Mode, ToolResult, TurnContext } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "./registry.js";

const READONLY: Mode = "ReadOnly";

/** Bytes sniffed to decide whether a file is binary. */
const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * Decide whether `content` looks binary: presence of a NUL byte, or a high
 * ratio of non-text control bytes in the sniff window. Pure + exported so it is
 * unit-testable without touching the filesystem.
 */
export function looksBinary(content: Uint8Array): boolean {
  if (content.length === 0) return false;
  let control = 0;
  const window = Math.min(content.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < window; i++) {
    const b = content[i]!;
    if (b === 0) return true; // NUL byte → definitely binary
    // Count non-text control bytes (excluding \t \n \r).
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  // >30% control bytes in the sniff window → treat as binary.
  return control / window > 0.3;
}

/** Resolve a (possibly relative) path against the turn workspace. */
function resolvePath(ctx: TurnContext | undefined, path: string): string {
  return resolve(ctx?.workspace ?? process.cwd(), path);
}

export interface LsEntry {
  name: string;
  type: "dir" | "file" | "symlink" | "other";
  size?: number;
  binary?: boolean;
}

export const lsTool: ToolImpl = {
  meta: {
    name: "ls",
    args: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list (default: current directory)" },
        limit: { type: "number", description: "Maximum entries to return (default: 500)" },
        detectBinary: {
          type: "boolean",
          description: "Sniff each file for binary content (NUL-byte heuristic). Default: false.",
        },
      },
    },
    requiredMode: READONLY,
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args)) return err("ls", "invalid args");
    const targetPath = typeof args.path === "string" ? args.path : ".";
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 500;
    const detectBinary = args.detectBinary === true;
    const abs = resolvePath(ctx, targetPath);
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      const items: LsEntry[] = [];
      for (const entry of entries) {
        if (items.length >= limit) break;
        let type: LsEntry["type"] = "other";
        let size: number | undefined;
        let binary: boolean | undefined;
        try {
          if (entry.isDirectory()) {
            type = "dir";
          } else if (entry.isSymbolicLink()) {
            type = "symlink";
          } else {
            type = "file";
          }
          if (type === "file") {
            const full = join(abs, entry.name);
            const s = await stat(full);
            size = s.size;
            if (detectBinary) {
              // Sniff only the leading bytes to keep this cheap.
              const handle = await readFile(full);
              binary = looksBinary(handle.subarray(0, BINARY_SNIFF_BYTES));
            }
          }
        } catch {
          // Stat/read failure → still list the name with type "other".
          type = "other";
        }
        items.push({
          name: entry.name,
          type,
          ...(size !== undefined ? { size } : {}),
          ...(binary !== undefined ? { binary } : {}),
        });
      }
      // Case-insensitive alphabetical sort (pi parity).
      items.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return ok("ls", {
        path: targetPath,
        entries: items,
        count: items.length,
        truncated: entries.length > items.length,
      });
    } catch (e) {
      return err("ls", e instanceof Error ? e.message : String(e));
    }
  },
};
