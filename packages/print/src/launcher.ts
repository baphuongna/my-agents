/**
 * mya Session Launcher — simple, cross-platform, full pi TUI.
 *
 * No tmux, no background, no WS chat. Just:
 *   Launcher → select → pi InteractiveMode (FULL TUI) → /quit → launcher
 *   Pi saves conversation to JSONL → resume from launcher next time.
 *
 * Works on Linux, macOS, Windows (no tmux dependency).
 * Session history persists via pi's native JSONL save.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  selBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clear: "\x1b[2J\x1b[H",
  home: "\x1b[H",
  clrEol: "\x1b[K",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

interface Sess {
  id: string;
  label: string;
  detail: string;
  type: "saved" | "new";
  arg?: string;
}

function fmt(ts: number): string {
  if (!ts) return "-";
  const d = nowWallclock() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

/** Load saved sessions from pi's session dir: ~/.mya/agent/sessions/ */
function loadSaved(): Sess[] {
  const dir = join(homedir(), ".mya", "agent", "sessions");
  if (!existsSync(dir)) return [];
  const out: Sess[] = [];
  try {
    for (const cwd of readdirSync(dir)) {
      const full = join(dir, cwd);
      if (!statSync(full).isDirectory()) continue;
      for (const f of readdirSync(full)) {
        if (!f.endsWith(".jsonl")) continue;
        const fp = join(full, f);
        try {
          const lines = readFileSync(fp, "utf8").split("\n").filter(Boolean);
          const hdr = JSON.parse(lines[0] ?? "{}") as { id?: string; name?: string };
          let n = 0; let first = ""; let ts = 0;
          for (const l of lines) {
            try {
              const e = JSON.parse(l) as { type?: string; message?: { role?: string; content?: Array<{ text?: string }> }; timestamp?: number };
              if (e.type === "message") {
                n++;
                if (e.message?.role === "user" && !first) first = (e.message.content?.[0]?.text ?? "").slice(0, 50);
                if (e.timestamp) ts = e.timestamp;
              }
            } catch { /* */ }
          }
          out.push({
            id: hdr.id ?? f,
            label: hdr.name ?? first ?? f.slice(11, 30),
            detail: `${n} msgs | ${fmt(ts)}`,
            type: "saved",
            arg: fp,
          });
        } catch { /* */ }
      }
    }
  } catch { /* */ }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

function buildLines(sessions: Sess[], sel: number, filter: string): string[] {
  const o: string[] = [];
  o.push("");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("- Session Launcher")}`);
  o.push(`  ${A.dim2("-".repeat(50))}`);
  o.push("");
  o.push(`  ${A.dim2("filter:")} ${filter ? A.accent(filter + "_") : A.dim2("(type to search)")}`);
  o.push("");
  const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
  if (f.length === 0) o.push(`  ${A.muted("No sessions found.")}`);
  for (let i = 0; i < f.length; i++) {
    const s = f[i]!;
    const is = i === sel;
    const txt = `${is ? "> " : "  "}${is ? A.bold(A.accent(s.label)) : s.label}  ${A.dim2(s.detail)}`;
    o.push(is ? `  ${A.selBg(txt.slice(2))}` : txt);
  }
  o.push("");
  o.push(`  ${A.dim2("-".repeat(50))}`);
  o.push(`  ${A.dim2("up/down nav | Enter open | n new | q quit")}`);
  o.push(`  ${A.dim2("in pi: /quit or Ctrl+D or Ctrl+Q to return")}`);
  return o;
}

/** Launch pi InteractiveMode (FULL TUI) in foreground. */
function launchPi(sessionPath?: string): Promise<void> {
  // Loading screen
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(`\n  ${A.bold(A.accent("mya"))}\n`);
  process.stdout.write(`  ${A.muted("Loading pi InteractiveMode...")}\n\n`);
  process.stdout.write(`  ${A.dim2("Dynamic-loading pi (lazy import)...")}\n`);

  return new Promise((resolve) => {
    const args = ["--model", "MiniMax-M3"];
    if (sessionPath) {
      args.push("--session", sessionPath);
    }
    const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

interface Choice {
  type: "new" | "saved";
  arg?: string;
}

function showLauncher(sessions: Sess[]): Promise<Choice | undefined> {
  return new Promise((resolve) => {
    let sel = 0; let filter = ""; let first = true;
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);

    const render = () => {
      const lines = buildLines(sessions, sel, filter);
      let out = first ? A.clear : A.home;
      first = false;
      for (const l of lines) out += l + A.clrEol + "\n";
      out += A.clrEol;
      process.stdout.write(out);
    };
    render();

    const cleanup = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.clear + A.showCursor);
    };

    const onData = (data: Buffer) => {
      const k = data.toString();
      if (k === "\x03" || k === "\x04") { cleanup(); resolve(undefined); return; }
      if (k === "\x1b[A") { sel = Math.max(0, sel - 1); render(); }
      else if (k === "\x1b[B") {
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        sel = Math.min(f.length - 1, sel + 1); render();
      }
      else if (k === "\r" || k === "\n") {
        cleanup();
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        resolve(f[sel] as Choice);
      }
      else if (k === "n" && !filter) { cleanup(); resolve({ type: "new" }); }
      else if (k === "\x1b") { filter = ""; sel = 0; render(); }
      else if (k === "\x7f" || k === "\b") { filter = filter.slice(0, -1); sel = 0; render(); }
      else if (k === "q" && !filter) { cleanup(); resolve(undefined); }
      else if (k.length === 1 && k >= " " && k !== "q" && k !== "n") { filter += k; sel = 0; render(); }
    };
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: "Start fresh conversation", type: "new" },
      ...loadSaved(),
    ];

    const result = await showLauncher(sessions);
    if (result === undefined) return;

    if (result.type === "saved" && result.arg) {
      await launchPi(result.arg);
    } else {
      await launchPi();
    }
  }
}
