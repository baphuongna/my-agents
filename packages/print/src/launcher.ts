/**
 * mya Session Launcher — cross-platform multi-session TUI.
 *
 * Uses TCP-based background sessions (no tmux dependency):
 *   - Background sessions run `mya --bg` (agent + TCP RPC server)
 *   - Launcher connects via TCP for live chat
 *   - Ctrl+Q disconnects → session KEEPS RUNNING
 *   - Works on Linux, macOS, AND Windows
 */
import { createConnection, type Socket } from "node:net";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";
import { listBgSessions, killBgSession, spawnBgSession, type BgManifest } from "./bg-runner.js";

// ── ANSI ───────────────────────────────────────────────────────────────────
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
  icon: string;
  type: "bg" | "saved" | "channel" | "new";
  port?: number;
  arg?: string;
}

function fmt(ts: number): string {
  if (!ts) return "—";
  const d = nowWallclock() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

function loadBg(): Sess[] {
  return listBgSessions()
    .filter((m) => m.status === "running" && m.port > 0)
    .map((m: BgManifest) => ({
      id: m.id,
      label: m.id.replace(/^bg_/, ""),
      detail: `:${m.port} · ${fmt(m.startedAt)}`,
      icon: "🟢",
      type: "bg" as const,
      port: m.port,
    }));
}

function loadSaved(): Sess[] {
  const dir = join(homedir(), ".mya", "sessions");
  if (!existsSync(dir)) return [];
  const out: Sess[] = [];
  try {
    for (const cwd of readdirSync(dir)) {
      const full = join(dir, cwd);
      if (!statSync(full).isDirectory() || cwd === "bg") continue;
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
              if (e.type === "message") { n++; if (e.message?.role === "user" && !first) first = (e.message.content?.[0]?.text ?? "").slice(0, 40); if (e.timestamp) ts = e.timestamp; }
            } catch { /* */ }
          }
          out.push({ id: hdr.id ?? f, label: hdr.name ?? first ?? f.slice(0, 30), detail: `${n} msgs · ${fmt(ts)}`, icon: "💬", type: "saved", arg: fp });
        } catch { /* */ }
      }
    }
  } catch { /* */ }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

function buildLines(sessions: Sess[], sel: number, filter: string): string[] {
  const o: string[] = [];
  const bgCount = sessions.filter((s) => s.type === "bg").length;
  o.push("");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("— Session Launcher")}${bgCount > 0 ? A.green(`  ${bgCount} running`) : ""}`);
  o.push(`  ${A.dim2("─".repeat(50))}`);
  o.push("");
  o.push(`  ${A.dim2("filter:")} ${filter ? A.accent(filter + "█") : A.dim2("(type to search)")}`);
  o.push("");
  const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
  if (f.length === 0) o.push(`  ${A.muted("No sessions found.")}`);
  for (let i = 0; i < f.length; i++) {
    const s = f[i]!;
    const is = i === sel;
    const txt = `${s.icon} ${is ? A.bold(A.accent(s.label)) : s.label}  ${A.dim2(s.detail)}`;
    o.push(is ? `  ${A.selBg(txt)}` : `  ${txt}`);
  }
  o.push("");
  o.push(`  ${A.dim2("─".repeat(50))}`);
  o.push(`  ${A.dim2("↑↓ nav · Enter open · n new(bg) · x kill · Ctrl+Q detach · q quit")}`);
  return o;
}

/** Connect to a background session via TCP and render a simple chat. */
function attachTcp(port: number): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(A.clear + A.showCursor);
    process.stdout.write(`  ${A.bold(A.accent("mya"))} ${A.muted(`— attached to :${port} (Ctrl+Q to detach)`)}\n\n`);

    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    let socket: Socket;
    let inputBuf = "";
    let rpcId = 1;
    let responseBuf = "";

    try {
      socket = createConnection({ host: "127.0.0.1", port }, () => {
        process.stdout.write(A.green("  ✓ connected\n\n  > "));
      });
    } catch {
      process.stdout.write(A.muted("  ✗ connection failed\n"));
      if (isTTY) process.stdin.setRawMode(false);
      setTimeout(() => resolve(), 1000);
      return;
    }

    // Read TCP responses
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => {
      responseBuf += data;
      let nl: number;
      while ((nl = responseBuf.indexOf("\n")) >= 0) {
        const line = responseBuf.slice(0, nl).trim();
        responseBuf = responseBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { method?: string; params?: unknown; result?: unknown };
          if (msg.method === "event") {
            // Render streaming event (simplified — just show text)
            const ev = msg.params as { kind?: string; text?: string; stage?: string };
            if (ev?.text) process.stdout.write(ev.text);
            else if (ev?.kind === "Completed" || ev?.stage === "completed") process.stdout.write("\n\n  > ");
          } else if (msg.result) {
            // Response to prompt/cancel/status
            process.stdout.write("\n\n  > ");
          }
        } catch { /* malformed */ }
      }
    });

    socket.on("error", () => {
      process.stdout.write(A.muted("\n  ✗ connection lost\n"));
      cleanup();
    });
    socket.on("close", () => {
      cleanup();
    });

    const cleanup = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      try { socket.destroy(); } catch { /* */ }
    };

    const onData = (data: Buffer) => {
      const k = data.toString();
      // Ctrl+Q = detach
      if (k === "\x11") { cleanup(); process.stdout.write(A.clear); resolve(); return; }
      // Ctrl+C = detach (not kill)
      if (k === "\x03") { cleanup(); process.stdout.write(A.clear); resolve(); return; }
      // Enter = send prompt
      if (k === "\r" || k === "\n") {
        if (inputBuf.trim()) {
          const req = JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "prompt", params: { text: inputBuf } }) + "\n";
          socket.write(req);
          process.stdout.write("\n  ... \n");
        }
        inputBuf = "";
        return;
      }
      // Backspace
      if (k === "\x7f" || k === "\b") {
        if (inputBuf.length > 0) { inputBuf = inputBuf.slice(0, -1); process.stdout.write("\b \b"); }
        return;
      }
      // Regular char
      if (k.length === 1 && k >= " ") { inputBuf += k; process.stdout.write(k); }
    };

    process.stdin.on("data", onData);
  });
}

export function runSessionLauncher(): Promise<{ action: "open"; session?: Sess } | { action: "new" } | { action: "kill"; session: Sess } | { action: "quit" }> {
  return new Promise((resolve) => {
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: "Start fresh (background)", icon: "✨", type: "new" },
      ...loadBg(),
      ...loadSaved(),
    ];
    let sel = 0;
    let filter = "";
    let first = true;
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
      if (k === "\x03" || k === "\x04") { cleanup(); resolve({ action: "quit" }); return; }
      if (k === "\x1b[A") { sel = Math.max(0, sel - 1); render(); }
      else if (k === "\x1b[B") { const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions; sel = Math.min(f.length - 1, sel + 1); render(); }
      else if (k === "\r" || k === "\n") { cleanup(); const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions; resolve({ action: "open", session: f[sel] }); }
      else if (k === "n" && !filter) { cleanup(); resolve({ action: "new" }); }
      else if (k === "x" && !filter) {
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        const s = f[sel];
        if (s?.type === "bg" && s.id) killBgSession(s.id);
        sessions.splice(sessions.indexOf(s!), 1);
        sel = Math.min(sel, sessions.length - 1);
        render();
      }
      else if (k === "\x1b") { filter = ""; sel = 0; render(); }
      else if (k === "\x7f" || k === "\b") { filter = filter.slice(0, -1); sel = 0; render(); }
      else if (k === "q" && !filter) { cleanup(); resolve({ action: "quit" }); }
      else if (k.length === 1 && k >= " " && k !== "q" && k !== "n" && k !== "x") { filter += k; sel = 0; render(); }
    };
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const result = await runSessionLauncher();
    if (result.action === "quit") return;

    if (result.action === "new") {
      // Spawn background session, then attach
      const m = spawnBgSession({});
      if (m?.port && m.port > 0) {
        await attachTcp(m.port);
      } else if (m?.port === 0) {
        // Manifest not ready yet — wait and retry
        process.stderr.write("[mya] waiting for session to start...\n");
        // Read manifest again after delay
        const { readFileSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            const updated = JSON.parse(readFileSync(join(homedir(), ".mya", "sessions", "bg", `${m.id}.json`), "utf8")) as BgManifest;
            if (updated.port > 0) { await attachTcp(updated.port); break; }
          } catch { /* */ }
        }
      }
    } else if (result.action === "open" && result.session) {
      const s = result.session;
      if (s.type === "bg" && s.port) {
        await attachTcp(s.port);
      } else if (s.type === "saved" && s.arg) {
        // Start a new bg session from saved JSONL context (future: load history)
        const m = spawnBgSession({});
        if (m?.port && m.port > 0) await attachTcp(m.port);
      }
    }
  }
}
