/**
 * Phase 19: 25 slash commands for the mya TUI.
 *
 * Pi-style category organization:
 *   session  — /help /quit /clear /status /cost /resume /fork
 *   model    — /model /model-selector
 *   tools    — /tools /skill-selector /tool-selector
 *   permissions — /permissions
 *   memory   — /memory /memory-search /memory-clear
 *   config   — /config /config env /config show
 *   compact  — /compact /compact <n>
 *   export   — /export /import
 *   mcp      — /mcp list /mcp show /mcp reload
 *   skills   — /skills list /skills show /skills reload
 *   tree     — /tree
 *   session  — /quit (also)
 *
 * Each command is `(args, ctx) => string | Promise<string> | InkSelector | null`.
 * Returning a string → printed to transcript as info.
 * Returning InkSelector → replaced by the selector UI.
 * Throwing → error printed.
 *
 * Source: pi-coding-agent/dist/modes/interactive/commands + claw-code/rusty-claude-cli.
 */
import React from "react";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { containPath, containExistingPath, defaultReadRoots } from "./pathGuard.js";
import { readConfig, writeConfig, validateKey, validateValue } from "./configStore.js";

/** The context exposed to every command — gives them access to live state. */
export interface InkCommandContext {
  /** The current session's stable config + session handle. */
  session: {
    cwd: string;
    /** Injected at runtime by runInkTui(). */
    setModel: (m: string) => void;
    getModel: () => string;
    getProvider: () => string;
    getSpent: () => number;
    getBudget: () => number;
    getMemoryFacts: () => number;
    getTools: () => Array<{ name: string; description?: string }>;
    getSkills: () => Array<{ name: string; description?: string }>;
    getMcpServers: () => Array<{ name: string; status: string }>;
    /** Open a model/skill/tool selector (returns the chosen value). */
    openSelector: (kind: "model" | "skill" | "tool", opts?: { multi?: boolean }) => Promise<string | string[] | null>;
    /** Clear the transcript. */
    clearTranscript: () => void;
    /** Get the rendered transcript as plain text (for /export). */
    exportTranscript: () => string;
    /** Compact the session: drop older history entries beyond `keep`. */
    compact: (keep: number) => Promise<number>;
    /** Resume from a JSON file. */
    importFrom: (path: string) => Promise<number>;
    /** Save a value to ~/.my-agent/config.toml. */
    setConfig: (key: string, value: string) => Promise<void>;
    /** Read a value from the same file. */
    getConfig: (key: string) => Promise<string | undefined>;
    /** Show all config values. */
    listConfig: () => Promise<Record<string, string>>;
    /** /permissions — set the current mode. */
    setMode: (mode: "read-only" | "workspace-write" | "danger-full-access" | "prompt") => void;
    /** Active mode getter. */
    getMode: () => string;
    /** Show a file/dir tree at cwd. */
    tree: (path: string) => Promise<string>;
  };
}

/** A selector payload — when returned, the runner swaps UI to it. */
export interface InkSelector {
  kind: "model" | "skill" | "tool";
  multi?: boolean;
}

/** A slash command shape. */
export interface SlashCommand {
  name: string;
  description: string;
  category: string;
  /** Optional keyboard hint shown in the autocomplete list. */
  kbd?: string;
  /** The handler. Returns null → fall through (forward to agent). */
  run: (args: string, ctx: InkCommandContext) => Promise<string | InkSelector | null> | string | InkSelector | null;
}

/** The full 25-command table. */
export const SLASH_COMMANDS: SlashCommand[] = [
  // ─── session ────────────────────────────────────────────────────────
  {
    name: "help",
    description: "list available slash commands",
    category: "session",
    run: () => "available commands:\n" + SLASH_COMMANDS.map((c) => `  /${c.name.padEnd(20)}  ${c.description}`).join("\n"),
  },
  {
    name: "quit",
    description: "exit the session",
    category: "session",
    run: () => {
      process.exit(0);
    },
  },
  {
    name: "clear",
    description: "clear the transcript (--confirm skips the prompt)",
    category: "session",
    run: (_args, ctx) => {
      ctx.session.clearTranscript();
      return "(transcript cleared)";
    },
  },
  {
    name: "status",
    description: "show session status (provider/model/cost/mode)",
    category: "session",
    run: (_args, ctx) => {
      const s = ctx.session;
      return [
        `provider: ${s.getProvider()}`,
        `model:    ${s.getModel()}`,
        `mode:     ${s.getMode()}`,
        `spent:    $${s.getSpent().toFixed(4)} / $${s.getBudget().toFixed(2)}`,
        `cwd:      ${s.cwd}`,
        `facts:    ${s.getMemoryFacts()}`,
      ].join("\n");
    },
  },
  {
    name: "cost",
    description: "show running cost / budget",
    category: "session",
    run: (_args, ctx) => {
      const s = ctx.session;
      const spent = s.getSpent();
      const budget = s.getBudget();
      return budget > 0
        ? `cost: $${spent.toFixed(4)} / $${budget.toFixed(2)} (${((spent / budget) * 100).toFixed(1)}%)`
        : `cost: $${spent.toFixed(4)} (no budget cap)`;
    },
  },
  {
    name: "resume",
    description: "resume the previous session (no args → recent list)",
    category: "session",
    run: () => "(resume: not yet implemented — see /memory for fact list)",
  },
  {
    name: "fork",
    description: "fork the current session into a new one",
    category: "session",
    run: () => "(fork: not yet implemented)",
  },

  // ─── model ───────────────────────────────────────────────────────────
  {
    name: "model",
    description: "show or switch the active model",
    category: "model",
    run: (args, ctx) => {
      args = (args ?? "").trim();
      if (!args) return `current model: ${ctx.session.getModel()}`;
      ctx.session.setModel(args);
      return `switched model → ${args}`;
    },
  },
  {
    name: "model-selector",
    description: "interactive model picker (↑/↓ + Enter)",
    category: "model",
    run: async (_args, ctx) => {
      const picked = await ctx.session.openSelector("model");
      if (!picked) return "(no model selected)";
      ctx.session.setModel(String(picked));
      return `switched model → ${picked}`;
    },
  },

  // ─── tools ───────────────────────────────────────────────────────────
  {
    name: "tools",
    description: "list registered tools (read/write/edit/...)",
    category: "tools",
    run: (_args, ctx) => {
      const ts = ctx.session.getTools();
      return ts.length === 0
        ? "(no tools registered)"
        : ts.map((t) => `  ${t.name.padEnd(12)} ${t.description ?? ""}`).join("\n");
    },
  },
  {
    name: "skill-selector",
    description: "interactive skill picker (fuzzy)",
    category: "tools",
    run: async (_args, ctx) => {
      const picked = await ctx.session.openSelector("skill");
      return picked ? `selected skill → ${picked}` : "(no skill selected)";
    },
  },
  {
    name: "tool-selector",
    description: "multi-select tools to enable (Enter to confirm)",
    category: "tools",
    run: async (_args, ctx) => {
      const picked = await ctx.session.openSelector("tool", { multi: true });
      const arr = Array.isArray(picked) ? picked : picked ? [picked] : [];
      return arr.length === 0 ? "(no tools selected)" : `selected tools: ${arr.join(", ")}`;
    },
  },

  // ─── permissions ─────────────────────────────────────────────────────
  {
    name: "permissions",
    description: "show or switch permission mode (read-only|workspace-write|danger-full-access|prompt)",
    category: "permissions",
    run: (args, ctx) => {
      args = (args ?? "").trim();
      const valid = ["read-only", "workspace-write", "danger-full-access", "prompt"];
      if (!args) return `current mode: ${ctx.session.getMode()}`;
      if (!valid.includes(args)) return `unknown mode: ${args} — valid: ${valid.join(", ")}`;
      ctx.session.setMode(args as never);
      return `mode switched → ${args}`;
    },
  },

  // ─── memory ─────────────────────────────────────────────────────────
  {
    name: "memory",
    description: "show facts in memory",
    category: "memory",
    run: (_args, ctx) => `facts in memory: ${ctx.session.getMemoryFacts()}`,
  },
  {
    name: "memory-search",
    description: "search facts by query (regex-aware)",
    category: "memory",
    kbd: "<query>",
    run: () => "(memory-search: not yet wired — future)",
  },
  {
    name: "memory-clear",
    description: "drop all facts (soft-delete + archive)",
    category: "memory",
    run: () => "(memory-clear: not yet wired — future)",
  },

  // ─── config ──────────────────────────────────────────────────────────
  {
    name: "config",
    description: "show or set ~/.my-agent/config.toml values",
    category: "config",
    kbd: "show | <key> <value>",
    run: async (args, ctx) => {
      args = (args ?? "").trim();
      const tokens = args.split(/\s+/);
      if (!args || tokens[0] === "show" || tokens[0] === "list") {
        const all = await readConfig();
        return Object.entries(all).map(([k, v]) => `  ${k.padEnd(20)}  ${v}`).join("\n") || "(empty)";
      }
      if (tokens.length === 1) {
        const keyErr = validateKey(tokens[0]!);
        if (keyErr) return keyErr;
        const all = await readConfig();
        const v = all[tokens[0]!];
        return v === undefined ? `not set: ${tokens[0]}` : `${tokens[0]} = ${v}`;
      }
      if (tokens.length >= 2) {
        const key = tokens[0]!;
        const value = tokens.slice(1).join(" ");
        // F5 fix: validate key (allow-list) + value (no newlines/controls).
        const keyErr = validateKey(key);
        if (keyErr) return keyErr;
        const valErr = validateValue(value);
        if (valErr) return valErr;
        await writeConfig(key, value);
        return `${key} = ${value}`;
      }
      return "usage: /config show | <key> | <key> <value>";
    },
  },

  // ─── compact ─────────────────────────────────────────────────────────
  {
    name: "compact",
    description: "truncate older messages (--keep <n>)",
    category: "compact",
    kbd: "[--keep N]",
    run: async (args, ctx) => {
      const keepMatch = args?.match(/--keep\s+(\d+)/);
      const keep = keepMatch ? Number(keepMatch[1]) : 20;
      const removed = await ctx.session.compact(keep);
      return `compacted: removed ${removed} entries (keeping ${keep})`;
    },
  },

  // ─── export / import ────────────────────────────────────────────────
  {
    name: "export",
    description: "export the current transcript to a markdown file",
    category: "export",
    kbd: "<file>",
    run: async (args, ctx) => {
      args = (args ?? "").trim();
      const target = args || "transcript.md";
      // F3 fix: contain the resolved path inside the session cwd.
      const fullPath = await containPath(target, ctx.session.cwd);
      if (!fullPath) return `refused: "${target}" escapes session cwd`;
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, ctx.session.exportTranscript(), "utf8");
      return `exported → ${fullPath}`;
    },
  },
  {
    name: "import",
    description: "replay a transcript file",
    category: "export",
    kbd: "<file>",
    run: async (args, ctx) => {
      args = (args ?? "").trim();
      if (!args) return "usage: /import <file>";
      const raw = args.startsWith("/") ? args : join(ctx.session.cwd, args);
      // F4 fix: contain reads to cwd + ~/.my-agent only.
      const fullPath = await containExistingPath(raw, defaultReadRoots(ctx.session.cwd));
      if (!fullPath) return `refused: "${raw}" is outside cwd and ~/.my-agent`;
      const n = await ctx.session.importFrom(fullPath);
      return `imported ${n} entries from ${fullPath}`;
    },
  },

  // ─── mcp ─────────────────────────────────────────────────────────────
  {
    name: "mcp",
    description: "list/show/reload MCP servers (--list|--show <n>|--reload)",
    category: "mcp",
    kbd: "--list | --show <name> | --reload",
    run: (args, ctx) => {
      args = (args ?? "").trim();
      const servers = ctx.session.getMcpServers();
      if (args === "--list" || args === "list" || !args) {
        return servers.length === 0
          ? "(no MCP servers registered)"
          : servers.map((s) => `  ${s.name.padEnd(20)}  ${s.status}`).join("\n");
      }
      if (args === "--reload" || args === "reload") {
        return "(mcp reload: not yet wired — future)";
      }
      const showMatch = args.match(/^--?show\s+(.+)$/);
      if (showMatch) {
        const name = showMatch[1]!;
        const s = servers.find((x) => x.name === name);
        return s ? `${s.name}: ${s.status}` : `unknown server: ${name}`;
      }
      return "usage: /mcp --list | --show <name> | --reload";
    },
  },

  // ─── skills ──────────────────────────────────────────────────────────
  {
    name: "skills",
    description: "list/show/reload skills (--list|--show <name>|--reload)",
    category: "skills",
    kbd: "--list | --show <name> | --reload",
    run: (args, ctx) => {
      args = (args ?? "").trim();
      const skills = ctx.session.getSkills();
      if (args === "--list" || args === "list" || !args) {
        return skills.length === 0
          ? "(no skills loaded)"
          : skills.map((s) => `  ${s.name.padEnd(20)}  ${s.description ?? ""}`).join("\n");
      }
      if (args === "--reload" || args === "reload") {
        return "(skills reload: not yet wired — future)";
      }
      const showMatch = args.match(/^--?show\s+(.+)$/);
      if (showMatch) {
        const name = showMatch[1]!;
        const s = skills.find((x) => x.name === name);
        return s ? `${s.name}: ${s.description ?? ""}` : `unknown skill: ${name}`;
      }
      return "usage: /skills --list | --show <name> | --reload";
    },
  },

  // ─── tree ────────────────────────────────────────────────────────────
  {
    name: "tree",
    description: "show a directory tree at the current working dir",
    category: "tree",
    kbd: "[<path>]",
    run: async (args, ctx) => {
      args = (args ?? "").trim();
      const target = args || ".";
      return await ctx.session.tree(target);
    },
  },
];

/** Lookup a command by name (case-insensitive). */
export function findCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

/** Fuzzy-ish filter (substring, case-insensitive) for the autocomplete overlay. */
export function filterCommands(query: string, limit = 8): SlashCommand[] {
  const q = query.toLowerCase();
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of SLASH_COMMANDS) {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) starts.push(c);
    else if (n.includes(q) || c.description.toLowerCase().includes(q)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, limit);
}
