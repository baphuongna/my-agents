/**
 * mya --bg — background session runner.
 *
 * Creates an agent + TCP RPC server on a random localhost port.
 * Writes a session manifest so the launcher can discover + connect.
 *
 * Cross-platform: TCP works on Linux, macOS, Windows (no tmux needed).
 *
 * Lifecycle:
 *   mya --bg → createAgent() + startTcpRpcServer() → write manifest → run forever
 *   Launcher → connect to localhost:PORT → send prompts, receive events
 *   Launcher disconnects → session keeps running (TCP server stays up)
 *   mya --bg-kill <id> → kill background session by ID
 */
import { createAgent } from "@my-agent/agent";
import { startTcpRpcServer } from "@my-agent/rpc";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { nowWallclock } from "@my-agent/core";
import { secretStore, auditLog, skillStore, wallet } from "./shared-instances.js";

const BG_DIR = join(homedir(), ".mya", "sessions", "bg");

export interface BgManifest {
  id: string;
  pid: number;
  port: number;
  startedAt: number;
  model: string;
  status: "running" | "exited";
}

function manifestPath(id: string): string {
  return join(BG_DIR, `${id}.json`);
}

/** Write manifest for a background session. */
function writeManifest(m: BgManifest): void {
  mkdirSync(BG_DIR, { recursive: true });
  writeFileSync(manifestPath(m.id), JSON.stringify(m, null, 2) + "\n", "utf8");
}

/** Read all background session manifests. */
export function listBgSessions(): BgManifest[] {
  if (!existsSync(BG_DIR)) return [];
  const out: BgManifest[] = [];
  for (const f of readdirSync(BG_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const m = JSON.parse(readFileSync(join(BG_DIR, f), "utf8")) as BgManifest;
      // Check if process is alive
      try { process.kill(m.pid, 0); m.status = "running"; }
      catch { m.status = "exited"; }
      out.push(m);
    } catch { /* skip malformed */ }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Kill a background session by ID. */
export function killBgSession(id: string): boolean {
  try {
    const m = JSON.parse(readFileSync(manifestPath(id), "utf8")) as BgManifest;
    process.kill(m.pid, "SIGTERM");
    rmSync(manifestPath(id), { force: true });
    return true;
  } catch { return false; }
}

/** Run the background session: agent + TCP RPC server + manifest. */
export async function runBgSession(opts: { id?: string; model?: string } = {}): Promise<void> {
  const id = opts.id ?? `bg_${nowWallclock().toString(36)}`;
  const model = opts.model ?? process.env["MYA_MODEL"] ?? "auto";

  // Create agent with shared instances from pi-main.ts
  const agent = createAgent({
    model,
    memoryDir: join(homedir(), ".my-agent", "memory"),
    auditLog,
    secretStore,
    skillStore,
    wallet,
  });

  let controller = new AbortController();

  // Start TCP RPC server on a random port
  const { port, stop } = await startTcpRpcServer({
    prompt: (text, onEvent) => {
      controller = new AbortController();
      return agent.run(text, onEvent as never, { signal: controller.signal });
    },
    cancel: () => controller.abort(),
    status: () => ({ ok: true, id, model }),
  });

  // Write manifest
  writeManifest({
    id,
    pid: process.pid,
    port,
    startedAt: nowWallclock(),
    model,
    status: "running",
  });

  // Cleanup on exit
  const cleanup = () => {
    try { rmSync(manifestPath(id), { force: true }); } catch { /* */ }
    void stop();
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("exit", cleanup);

  // Keep alive
  process.stderr.write(`[mya] background session ${id} listening on 127.0.0.1:${port}\n`);
}

/** Spawn a background session as a detached child process. Returns the manifest. */
export async function spawnBgSession(opts: { model?: string; sessionPath?: string } = {}): Promise<BgManifest | null> {
  const id = `bg_${nowWallclock().toString(36)}`;
  const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
  const args = ["--bg", "--bg-id", id];
  if (opts.model) args.push("--model", opts.model);

  const child = spawn(process.execPath, [entry, ...args], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
  });
  child.unref();

  // Wait for manifest (async — yields to event loop)
  const manifest = await waitForManifest(id, 10_000);
  return manifest;
}

/** Wait for a manifest file to appear (async — does NOT block event loop). */
async function waitForManifest(id: string, timeoutMs: number): Promise<BgManifest | null> {
  const deadline = nowWallclock() + timeoutMs;
  while (nowWallclock() < deadline) {
    try {
      const m = JSON.parse(readFileSync(manifestPath(id), "utf8")) as BgManifest;
      if (m.port > 0) return m;
    } catch { /* not ready yet */ }
    // Yield to event loop (NOT busy-wait — that would freeze the UI)
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  return null;
}
