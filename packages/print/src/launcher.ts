/**
 * mya Session Launcher — multi-session TUI using raw ANSI (no pi-tui dependency).
 *
 * Shows all sessions (saved JSONL + active channel sessions).
 * Selecting a session spawns pi as a child process with that session.
 * When pi exits, control returns to the launcher.
 *
 * Architecture:
 *   mya → launcher TUI → select session → spawn("mya", ["--session", path])
 *                                        → child runs pi InteractiveMode
 *                                        → child exits → launcher resumes
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";

// ── ANSI helpers ───────────────────────────────────────────────────────────
const ESC = "\x1b[";
const ansi = {
  reset: "\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  warning: (s: string) => `\x1b[38;2;181;187;104m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  selectedBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clear: `${ESC}2J${ESC}H`,
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
};

// ── Session types ──────────────────────────────────────────────────────────
interface LauncherSession {
  id: string;
  label: string;
  detail: string;
  icon: string;
  type: "saved" | "channel" | "new";
  sessionArg?: string;
}

function formatTime(ts: number): string {
  if (!ts) return "—";
  const diff = nowWallclock() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Load saved sessions from ~/.mya/sessions/ (pi session JSONL files). */
function loadSavedSessions(): LauncherSession[] {
  const sessionsDir = join(homedir(), ".mya", "sessions");
  if (!existsSync(sessionsDir)) return [];
  const result: LauncherSession[] = [];

  try {
    for (const cwdDir of readdirSync(sessionsDir)) {
      const fullDir = join(sessionsDir, cwdDir);
      if (!statSync(fullDir).isDirectory()) continue;
      for (const file of readdirSync(fullDir)) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = join(fullDir, file);
        try {
          const content = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
          const header = JSON.parse(content[0] ?? "{}") as { id?: string; name?: string };
          let msgCount = 0;
          let firstText = "";
          let lastTs = 0;
          for (const line of content) {
            try {
              const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: Array<{ text?: string }>; usage?: { cost?: { total?: number } } }; timestamp?: number };
              if (entry.type === "message") {
                msgCount++;
                if (entry.message?.role === "user" && !firstText) {
                  firstText = (entry.message.content?.[0]?.text ?? "").slice(0, 50);
                }
                if (entry.timestamp) lastTs = entry.timestamp;
              }
            } catch { /* skip */ }
          }
          result.push({
            id: header.id ?? file,
            label: header.name ?? firstText ?? file.slice(0, 30),
            detail: `${msgCount} msgs · ${formatTime(lastTs)}`,
            icon: "💬",
            type: "saved",
            sessionArg: filePath,
          });
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* dir read failed */ }

  return result.sort((a, b) => b.id.localeCompare(a.id));
}

/** Load active channel sessions from the gateway (if running). */
async function loadChannelSessions(): Promise<LauncherSession[]> {
  try {
    const res = await fetch("http://127.0.0.1:3000/channel/sessions", { signal: AbortSignal.timeout(500) });
    if (!res.ok) return [];
    const sessions = (await res.json()) as Array<{ channelId: string; userId: string; sessionId: string; lastActivity: number; history: unknown[] }>;
    return sessions.map((s) => ({
      id: s.sessionId,
      label: `${s.channelId}:${s.userId}`,
      detail: `${s.history.length} msgs · ${formatTime(s.lastActivity)}`,
      icon: s.channelId === "telegram" ? "📱" : s.channelId === "discord" ? "🎮" : "🌐",
      type: "channel" as const,
      sessionArg: s.sessionId,
    }));
  } catch {
    return [];
  }
}

/** Render the launcher screen. */
function render(sessions: LauncherSession[], selected: number, filter: string): void {
  const W = process.stdout.columns ?? 80;
  const lines: string[] = [];

  lines.push("");
  lines.push(`  ${ansi.bold(ansi.accent("mya"))} ${ansi.muted("— Session Launcher")}`);
  lines.push(`  ${ansi.dim2("─".repeat(Math.min(W - 4, 60)))}`);
  lines.push("");

  // Filter
  const filterDisplay = filter ? ansi.accent(filter + "█") : ansi.dim2("(type to search)");
  lines.push(`  ${ansi.dim2("filter:")} ${filterDisplay}`);
  lines.push("");

  // Filter sessions
  const filtered = filter
    ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase()))
    : sessions;

  if (filtered.length === 0) {
    lines.push(`  ${ansi.muted("No sessions found.")}`);
  }

  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i]!;
    const isSel = i === selected;
    const icon = s.icon;
    const label = isSel ? ansi.bold(ansi.accent(s.label)) : s.label;
    const detail = ansi.dim2(s.detail);
    const prefix = isSel ? `${ansi.accent("→")} ` : "  ";
    const line = `${prefix}${icon} ${label}  ${detail}`;
    lines.push(isSel ? `  ${ansi.selectedBg(line.slice(2))}` : line);
  }

  lines.push("");
  lines.push(`  ${ansi.dim2("─".repeat(Math.min(W - 4, 60)))}`);
  lines.push(`  ${ansi.dim2("↑↓ navigate · Enter open · n new · / filter · Esc clear · q quit")}`);

  // Render
  process.stdout.write(ansi.clear + ansi.hideCursor);
  process.stdout.write(lines.join("\n") + "\n");
  process.stdout.write(ansi.showCursor);
}

/**
 * Run the launcher interaction loop. Returns the user's choice.
 */
export function runSessionLauncher(): Promise<{ sessionPath?: string; isNew?: boolean } | undefined> {
  return new Promise(async (resolve) => {
    const saved = loadSavedSessions();
    const channels = await loadChannelSessions();
    const sessions: LauncherSession[] = [
      { id: "new", label: "New session", detail: "Start a fresh conversation", icon: "✨", type: "new" },
      ...channels,
      ...saved,
    ];

    let selected = 0;
    let filter = "";

    // Enter raw mode
    const wasRaw = process.stdin.isTTY;
    if (wasRaw) process.stdin.setRawMode(true);
    process.stdin.resume();

    const render2 = () => render(sessions, selected, filter);
    render2();

    const onData = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x1b[A") { // Up
        selected = Math.max(0, selected - 1);
        render2();
      } else if (key === "\x1b[B") { // Down
        const filtered = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        selected = Math.min(filtered.length - 1, selected + 1);
        render2();
      } else if (key === "\r" || key === "\n") { // Enter
        cleanup();
        const filtered = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        const chosen = filtered[selected];
        if (chosen?.type === "new") resolve({ isNew: true });
        else resolve({ sessionPath: chosen?.sessionArg });
      } else if (key === "q" && !filter) { // Quit
        cleanup();
        resolve(undefined);
      } else if (key === "n" && !filter) { // New
        cleanup();
        resolve({ isNew: true });
      } else if (key === "\x1b") { // Esc
        filter = "";
        selected = 0;
        render2();
      } else if (key === "\x7f" || key === "\b") { // Backspace
        filter = filter.slice(0, -1);
        selected = 0;
        render2();
      } else if (key.length === 1 && key >= " " && key !== "q" && key !== "n") {
        filter += key;
        selected = 0;
        render2();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      if (wasRaw) process.stdin.setRawMode(false);
      process.stdout.write(ansi.clear);
    };

    process.stdin.on("data", onData);
  });
}

/**
 * Launch pi with a specific session (or new session).
 * Uses child_process.spawn with stdio inherit.
 */
export function launchSession(sessionPath?: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ["--model", "MiniMax-M3"];
    if (sessionPath) args.push("--session", sessionPath);
    // MYA_FROM_LAUNCHER=1 env var skips launcher (no --no-launcher flag — pi doesn't know it)

    const child = spawn(process.execPath, [
      process.argv[1] ?? process.cwd() + "/dist/mya.js",
      ...args,
    ], {
      stdio: "inherit",
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", MYA_FROM_LAUNCHER: "1" },
    });

    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

/**
 * Main launcher loop: show launcher → select → launch pi → return to launcher.
 */
export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const result = await runSessionLauncher();
    if (result === undefined) return; // quit

    if (result.isNew) {
      await launchSession();
    } else if (result.sessionPath) {
      await launchSession(result.sessionPath);
    } else {
      await launchSession();
    }
  }
}
