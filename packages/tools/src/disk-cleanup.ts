/**
 * @my-agent/tools — Disk cleanup tool.
 * J4: scans for old logs/cache and suggests deletes.
 * Source: §07 Tools, PLAN-FEATURES J4.
 */
import type { ToolImpl } from "./registry.js";
import type { ToolResult } from "@my-agent/core";
import { readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

const SCAN_DIRS = [
  join(homedir(), ".mya", "sessions"),
  join(homedir(), ".mya", "logs"),
  join(homedir(), ".mya", "cache"),
  "/tmp/mya-browser-*",
];

const MAX_AGE_MS = 7 * 24 * 60 * 60_000; // 7 days

export const diskCleanupTool: ToolImpl = {
  meta: {
    name: "disk_cleanup",
    description: "Scan for old logs/cache files and optionally delete them. Returns size savings.",
    args: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["scan", "clean"], description: "scan=list only, clean=delete" },
        maxAgeDays: { type: "number", description: "Max age in days (default 7)" },
      },
    },
    requiredMode: "WorkspaceWrite",
  },
  async run(args): Promise<ToolResult> {
    const a = args as { action?: string; maxAgeDays?: number };
    const action = a.action ?? "scan";
    const maxAge = (a.maxAgeDays ?? 7) * 24 * 60 * 60_000;
    const now = nowWallclock();
    const stale: Array<{ path: string; sizeBytes: number; ageDays: number }> = [];
    let totalSize = 0;

    for (const dir of SCAN_DIRS.filter((d) => !d.includes("*"))) {
      if (!existsSync(dir)) continue;
      try {
        for (const entry of readdirSync(dir)) {
          const fullPath = join(dir, entry);
          try {
            const stat = statSync(fullPath);
            const age = now - stat.mtimeMs;
            if (age > maxAge) {
              const sizeBytes = stat.isFile() ? stat.size : this.dirSize(fullPath);
              stale.push({ path: fullPath, sizeBytes, ageDays: Math.round(age / 86_400_000) });
              totalSize += sizeBytes;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    if (action === "clean") {
      let deleted = 0;
      for (const item of stale) {
        try { rmSync(item.path, { recursive: true, force: true }); deleted++; } catch { /* skip */ }
      }
      return {
        callId: "disk_cleanup", ok: true,
        output: { action: "clean", deleted, totalSizeBytes: totalSize, savedMB: Math.round(totalSize / 1024 / 1024) },
      };
    }

    return {
      callId: "disk_cleanup", ok: true,
      output: {
        action: "scan",
        staleFiles: stale.length,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024),
        items: stale.slice(0, 20).map((s) => ({ path: s.path, sizeMB: Math.round(s.sizeBytes / 1024 / 1024), ageDays: s.ageDays })),
      },
    };
  },
};

// Helper not on ToolImpl — inline as utility
function dirSize(dir: string): number {
  let size = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const stat = statSync(join(dir, entry));
      size += stat.isFile() ? stat.size : dirSize(join(dir, entry));
    }
  } catch { /* skip */ }
  return size;
}
// Attach helper
(diskCleanupTool as unknown as { _dirSize?: (d: string) => number })._dirSize = dirSize;
