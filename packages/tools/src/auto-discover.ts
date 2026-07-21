/**
 * @my-agent/tools — A3 AST-discovered tool registry (boot-time scan).
 * Source: §07 Tools, PLAN-FEATURES A3.
 * Note: boot-time discovery (not hot loop) — TS is within Rust-gate exception.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import type { ToolImpl } from "./registry.js";

/** Scan a directory for tool exports (simple regex-based, boot-time only). */
export function autoDiscoverTools(dir: string): string[] {
  const discovered: string[] = [];
  if (!existsSync(dir)) return discovered;
  try {
    for (const file of readdirSync(dir)) {
      if (extname(file) !== ".ts" && extname(file) !== ".js") continue;
      const content = readFileSync(join(dir, file), "utf8");
      // Match: export const xxxTool: ToolImpl  OR  toolRegistry.register(...)
      const matches = content.matchAll(/export\s+const\s+(\w+Tool)\s*[:=]/g);
      for (const m of matches) {
        if (m[1]) discovered.push(m[1]);
      }
    }
  } catch { /* dir read error */ }
  return discovered;
}

/** Scan MYA_TOOLS_DIR env var for custom tools. */
export function scanCustomToolDir(): string[] {
  const toolsDir = process.env.MYA_TOOLS_DIR;
  if (!toolsDir) return [];
  return autoDiscoverTools(toolsDir);
}
