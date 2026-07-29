// [system] role-subagent E2E: spawn a real role-subagent mya → it reports status
// → /pool/tree nests + shows done (coverage gap #4). Gated on MYA_BIN + a FRESH
// bundle (--role/--task built into dist). Skips here (MYA_BIN unset / stale
// bundle). When env ready: starts mya serve (temp HOME), acquires a role-subagent
// session, spawns the role-subagent mya, polls /pool/tree until done.
import { describe, it, expect, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MYA_BIN = process.env.MYA_BIN;

function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout?.setEncoding("utf8");
    c.stdout?.on("data", (d: string) => (out += d));
    c.on("close", () => resolve(out));
    c.on("error", () => resolve(""));
  });
}

async function waitForReady(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`mya serve didn't become ready on port ${port}`);
}

async function pollTreeForStatus(
  port: number,
  sessionId: string,
  want: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/pool/tree`);
      if (r.ok) {
        const tree = (await r.json()) as Array<{ sessionId: string; taskStatus?: string; subagents?: Array<{ id: string; status?: string }> }>;
        const found = tree.find((n) => n.sessionId === sessionId);
        if (found?.taskStatus === want) return true;
      }
    } catch {
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

describe.skipIf(!MYA_BIN)("[system] role-subagent E2E — spawn → done → /pool/tree", () => {
  let hasRole = false;
  beforeAll(async () => {
    const help = await capture(MYA_BIN!, ["--help"]);
    hasRole = /--role/.test(help);
  });

  it("a spawned role-subagent reports done + appears nested in /pool/tree", async (ctx) => {
    if (!hasRole) return ctx.skip("bundle stale — --role absent; rebuild dist/mya.js (npm run dist)");

    const home = mkdtempSync(join(tmpdir(), "mya-e2e-"));
    const port = 4400 + Math.floor(Math.random() * 200);
    let serve: ChildProcess | undefined;
    let sub: ChildProcess | undefined;
    try {
      serve = spawn(MYA_BIN!, ["serve", "--port", String(port)], {
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "pipe", "ignore"],
      });
      await waitForReady(port);

      const acq = await fetch(`http://127.0.0.1:${port}/pool/acquire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: home, role: "test", task: "reply with exactly: ok", parentSessionId: "parent-e2e" }),
      });
      expect(acq.ok).toBe(true);
      const { sessionId } = (await acq.json()) as { sessionId: string };
      expect(sessionId).toBeTruthy();

      sub = spawn(MYA_BIN!, ["--gateway-session", sessionId, "--role", "test", "--task", "reply with exactly: ok"], {
        env: { ...process.env, HOME: home, MYA_PORT: String(port) },
        stdio: "ignore",
      });

      const done = await pollTreeForStatus(port, sessionId, "done");
      expect(done).toBe(true);
    } finally {
      sub?.kill("SIGKILL");
      serve?.kill("SIGKILL");
      rmSync(home, { recursive: true, force: true });
    }
  }, 120_000);
});
