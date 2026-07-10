/**
 * Built-in tools (§7). Tier 1: node fs/child_process directly (natives are
 * stubs; Tier 2 swaps hot paths — glob/grep — to the Rust napi search crate).
 *
 * Modes: read/glob/grep = ReadOnly; write/edit = WorkspaceWrite;
 * bash = DangerFullAccess (escalates to human approval per §7).
 *
 * Shell posture (R30 pi model): bash runs the user's /bin/bash -c directly —
 * NO sandbox. The §7 permission gate is the only control.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Mode, ToolResult } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "./registry.js";

const READONLY: Mode = "ReadOnly";
const WORKSPACE: Mode = "WorkspaceWrite";
const SHELL: Mode = "DangerFullAccess";

// ─── read ───────────────────────────────────────────────────────────────────
export const readTool: ToolImpl = {
  meta: {
    name: "read",
    args: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    requiredMode: READONLY,
  },
  async run(args): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string") return err("read", "path required");
    try {
      const content = await readFile(args.path, "utf8");
      return ok("read", { path: args.path, content });
    } catch (e) {
      return err("read", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── write ──────────────────────────────────────────────────────────────────
export const writeTool: ToolImpl = {
  meta: {
    name: "write",
    args: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    requiredMode: WORKSPACE,
  },
  async run(args): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string" || typeof args.content !== "string")
      return err("write", "path + content required");
    try {
      await writeFile(args.path, args.content, "utf8");
      return ok("write", { path: args.path, bytes: args.content.length });
    } catch (e) {
      return err("write", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── edit (exact-text replacement) ──────────────────────────────────────────
export const editTool: ToolImpl = {
  meta: {
    name: "edit",
    args: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
    requiredMode: WORKSPACE,
  },
  async run(args): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string")
      return err("edit", "path required");
    if (typeof args.oldText !== "string" || typeof args.newText !== "string")
      return err("edit", "oldText + newText required");
    try {
      const original = await readFile(args.path, "utf8");
      if (!original.includes(args.oldText))
        return err("edit", "oldText not found in file");
      if (args.oldText === args.newText) return err("edit", "no-op (oldText === newText)");
      // hashline-grade safety: refuse if oldText appears >1 time (ambiguous).
      const first = original.indexOf(args.oldText);
      const second = original.indexOf(args.oldText, first + 1);
      if (second !== -1) return err("edit", "oldText is ambiguous (appears >1 time)");
      const updated = original.replace(args.oldText, args.newText);
      await writeFile(args.path, updated, "utf8");
      return ok("edit", { path: args.path, replaced: 1 });
    } catch (e) {
      return err("edit", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── bash (DangerFullAccess — escalates to human approval) ───────────────────
export const bashTool: ToolImpl = {
  meta: {
    name: "bash",
    args: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
    requiredMode: SHELL,
  },
  async run(args): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.command !== "string")
      return err("bash", "command required");
    const cwd = isRecord(args) && typeof args.cwd === "string" ? args.cwd : process.cwd();
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 120_000;
    return new Promise((resolve) => {
      const start = Date.now();
      const child = spawn("/bin/bash", ["-c", args.command as string], {
        cwd,
        env: process.env,
      });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve(err("bash", e.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(ok("bash", {
          stdout,
          stderr,
          exitCode: code ?? -1,
          durationMs: Date.now() - start,
        }));
      });
    });
  },
};

// ─── glob (recursive file find — Tier 1: node fs walk) ──────────────────────
export const globTool: ToolImpl = {
  meta: {
    name: "glob",
    args: {
      type: "object",
      properties: { pattern: { type: "string" }, cwd: { type: "string" } },
      required: ["pattern"],
    },
    requiredMode: READONLY,
  },
  async run(args): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.pattern !== "string")
      return err("glob", "pattern required");
    const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
    const re = globToRegex(args.pattern);
    const matches: string[] = [];
    const limit = 1000;
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 8 || matches.length >= limit) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const ent of entries) {
        if (ent.name.startsWith(".git") || ent.name === "node_modules") continue;
        const full = join(dir, ent.name);
        const rel = relative(cwd, full);
        if (ent.isFile() && re.test(rel)) matches.push(rel);
        if (ent.isDirectory()) await walk(full, depth + 1);
      }
    }
    await walk(cwd, 0);
    return ok("glob", { matches });
  },
};

// ─── grep (content search — Tier 1: node regex) ─────────────────────────────
export const grepTool: ToolImpl = {
  meta: {
    name: "grep",
    args: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        cwd: { type: "string" },
        glob: { type: "string" },
      },
      required: ["pattern"],
    },
    requiredMode: READONLY,
  },
  async run(args): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.pattern !== "string")
      return err("grep", "pattern required");
    const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
    const re = new RegExp(args.pattern, "i");
    const hits: { path: string; line: number; text: string }[] = [];
    const limit = 200;
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 8 || hits.length >= limit) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const ent of entries) {
        if (ent.name.startsWith(".git") || ent.name === "node_modules") continue;
        const full = join(dir, ent.name);
        if (ent.isFile()) {
          try {
            const content = await readFile(full, "utf8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && hits.length < limit; i++) {
              if (re.test(lines[i]!)) hits.push({ path: relative(cwd, full), line: i + 1, text: lines[i]!.trim() });
            }
          } catch { /* skip binary/unreadable */ }
        } else if (ent.isDirectory()) await walk(full, depth + 1);
      }
    }
    await walk(cwd, 0);
    return ok("grep", { hits });
  },
};

/** All built-in tools, ready to register. */
export const builtinTools: ToolImpl[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
];

function globToRegex(pattern: string): RegExp {
  // Minimal glob → regex: * → [^/]*, ** → .*, ? → [^/]
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}
