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
import { nativeGlob, nativeGrep } from "@my-agent/natives";
import { ok, err, isRecord, type ToolImpl } from "./registry.js";
import { resolveInsideWorkspace, resolveExistingInsideWorkspace } from "./path-safety.js";
import { formatHashed, fileFingerprint, isValidAnchor, replaceByHash } from "./hashline.js";
import { nowWallclock } from "@my-agent/core";

/** F1 fix: contain a tool's path inside the ctx workspace. Returns the safe
 * absolute path, or an error result on escape. `mode:"write"` is lexical-only;
 * `mode:"read"` canonicalizes (symlink-escape aware). */
function contain(ctx: { workspace?: string }, path: string, mode: "write" | "read"):
  | { ok: true; abs: string }
  | { ok: false; err: ReturnType<typeof err> } {
  const ws = ctx.workspace ?? process.cwd();
  const r = mode === "write" ? resolveInsideWorkspace(path, ws) : resolveExistingInsideWorkspace(path, ws);
  return r.ok ? { ok: true, abs: r.abs } : { ok: false, err: err("path", r.reason + ": " + r.detail) };
}

/** F8 fix: strip secret-looking env vars before passing to a child process. */
function filterSecretEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}
const SECRET_ENV_RE = /(?:^|_)(SECRET|TOKEN|API_KEY|APIKEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY)(?:_|$)/i;

const READONLY: Mode = "ReadOnly";
const WORKSPACE: Mode = "WorkspaceWrite";
const SHELL: Mode = "DangerFullAccess";

// ─── read ───────────────────────────────────────────────────────────────────
export const readTool: ToolImpl = {
  meta: {
    name: "read",
    args: {
      type: "object",
      properties: {
        path: { type: "string" },
        hashed: { type: "boolean", description: "return HASH│content per line (hashline anchors for replace)" },
      },
      required: ["path"],
    },
    requiredMode: READONLY,
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string") return err("read", "path required");
    const c = contain(ctx, args.path, "read");
    if (!c.ok) return c.err;
    try {
      let content = await readFile(c.abs, "utf8");
      // Size cap (the read-tool contract: 2000 lines / 50KB — see AGENTS.md).
      const MAX_READ_BYTES = 50 * 1024;
      if (Buffer.byteLength(content) > MAX_READ_BYTES) {
        content = content.slice(0, MAX_READ_BYTES) + "\n…[truncated: >50KB]";
      }
      const hashed = isRecord(args) && args.hashed === true;
      return ok("read", {
        path: args.path,
        content: hashed ? formatHashed(content) : content,
        fingerprint: fileFingerprint(content),
        hashed,
      });
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
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string" || typeof args.content !== "string")
      return err("write", "path + content required");
    const c = contain(ctx, args.path, "write");
    if (!c.ok) return c.err;
    try {
      await writeFile(c.abs, args.content, "utf8");
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
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string")
      return err("edit", "path required");
    const c = contain(ctx, args.path, "write");
    if (!c.ok) return c.err;
    if (typeof args.oldText !== "string" || typeof args.newText !== "string")
      return err("edit", "oldText + newText required");
    try {
      const original = await readFile(c.abs, "utf8");
      if (!original.includes(args.oldText))
        return err("edit", "oldText not found in file");
      if (args.oldText === args.newText) return err("edit", "no-op (oldText === newText)");
      // hashline-grade safety: refuse if oldText appears >1 time (ambiguous).
      const first = original.indexOf(args.oldText);
      const second = original.indexOf(args.oldText, first + 1);
      if (second !== -1) return err("edit", "oldText is ambiguous (appears >1 time)");
      const updated = original.replace(args.oldText, args.newText);
      await writeFile(c.abs, updated, "utf8");
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
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.command !== "string")
      return err("bash", "command required");
    const cwd = isRecord(args) && typeof args.cwd === "string" ? args.cwd : (ctx?.workspace ?? process.cwd());
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 120_000;
    // F8 fix: filter secret-looking env vars before passing to the child (a
    // command shouldn't inherit OPENAI_API_KEY / *_SECRET / *_TOKEN etc.).
    const env = filterSecretEnv(process.env);
    return new Promise((resolve) => {
      const start = nowWallclock();
      const child = spawn("/bin/bash", ["-c", args.command as string], {
        cwd,
        env,
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
          durationMs: nowWallclock() - start,
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
    // Tier 4: prefer the Rust native glob (hot loop); fall back to JS walk.
    try {
      const matches = nativeGlob(args.pattern, cwd, { maxResults: 1000 });
      return ok("glob", { matches });
    } catch {
      // fall through to JS walk
    }
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
    // Tier 4: prefer the Rust native grep (hot loop); fall back to JS walk.
    try {
      const hits = nativeGrep(args.pattern, cwd, { maxResults: 200, caseInsensitive: true });
      return ok("grep", { hits: hits.map(h => ({ path: h.path, line: h.line, text: h.text.trim() })) });
    } catch {
      // fall through to JS walk
    }
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

// ─── replace (hashline: hash-anchored range replace + stale detection) ────
export const replaceTool: ToolImpl = {
  meta: {
    name: "replace",
    args: {
      type: "object",
      properties: {
        path: { type: "string" },
        startHash: { type: "string", description: "3-char HASH anchor of the first line to replace" },
        endHash: { type: "string", description: "3-char HASH anchor of the last line (inclusive); === startHash for single line" },
        contentLines: { type: "array", items: { type: "string" }, description: "replacement lines (without HASH│ prefix)" },
      },
      required: ["path", "startHash", "endHash", "contentLines"],
    },
    requiredMode: WORKSPACE,
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.path !== "string") return err("replace", "path required");
    if (typeof args.startHash !== "string" || typeof args.endHash !== "string")
      return err("replace", "startHash + endHash required");
    if (!isValidAnchor(args.startHash) || !isValidAnchor(args.endHash))
      return err("replace", `anchors must be 3-char base64 (A-Za-z0-9-_); got start="${args.startHash}" end="${args.endHash}"`);
    if (!Array.isArray(args.contentLines) || !args.contentLines.every((l) => typeof l === "string"))
      return err("replace", "contentLines must be a string array");
    const c = contain(ctx, args.path, "write");
    if (!c.ok) return c.err;
    try {
      const current = await readFile(c.abs, "utf8");
      // Stale detection: recompute hashes on CURRENT content; anchor must match.
      const res = replaceByHash(current, args.startHash, args.endHash, args.contentLines);
      if (!res.ok || !res.content)
        return err("replace", res.error ?? "replace failed");
      await writeFile(c.abs, res.content, "utf8");
      return ok("replace", {
        path: args.path,
        replacedLines: res.replacedCount,
        fingerprint: fileFingerprint(res.content),
      });
    } catch (e) {
      return err("replace", e instanceof Error ? e.message : String(e));
    }
  },
};

/** All built-in tools, ready to register. */
export const builtinTools: ToolImpl[] = [
  readTool,
  writeTool,
  editTool,
  replaceTool,
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
