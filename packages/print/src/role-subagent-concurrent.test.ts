// [system] role-subagent concurrent E2E — spawn N subagents simultaneously,
// verify each independently reaches done/failed and appears as a nested child
// in /pool/tree.
//
// Gated on MYA_BIN + a FRESH bundle (npm run bundle). Uses minimax provider
// (auth.json has minimax creds, not google).
import { describe, it, expect, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const MYA_BIN = process.env.MYA_BIN;
const NUM_SUBAGENTS = 3;

// ── helpers (duplicated from role-subagent-system.test.ts for isolation) ──

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

interface TreeNode {
  sessionId: string;
  status?: string;
  subagents?: Array<{ id: string; status: string; role?: string; task?: string; depth: number }>;
}

async function fetchTree(port: number): Promise<TreeNode[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/pool/tree`);
    if (!r.ok) return [];
    return (await r.json()) as TreeNode[];
  } catch {
    return [];
  }
}

async function acquireSession(
  port: number,
  body: Record<string, unknown>,
): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${port}/pool/acquire`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`acquire failed (${r.status})`);
  return ((await r.json()) as { sessionId: string }).sessionId;
}

/** Find a subagent's status in the tree by scanning top-level nodes + nested. */
function findStatus(tree: TreeNode[], id: string): string | undefined {
  for (const node of tree) {
    if (node.sessionId === id) return node.status;
    const sub = node.subagents?.find((s) => s.id === id);
    if (sub) return sub.status;
  }
  return undefined;
}

/**
 * Poll /pool/tree until ALL specified sessionIds reach a terminal status.
 * Returns a map: sessionId → terminal status ("" on timeout).
 */
async function pollAllForTerminal(
  port: number,
  ids: string[],
  timeoutMs = 180_000,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && result.size < ids.length) {
    const tree = await fetchTree(port);
    for (const id of ids) {
      if (result.has(id)) continue;
      const status = findStatus(tree, id);
      if (status === "done" || status === "failed") {
        result.set(id, status);
      }
    }
    if (result.size < ids.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Fill remaining (timed out) with "".
  for (const id of ids) {
    if (!result.has(id)) result.set(id, "");
  }
  return result;
}

function setupTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mya-conc-"));
  const realAuth = join(homedir(), ".mya", "agent", "auth.json");
  if (existsSync(realAuth)) {
    mkdirSync(join(home, ".mya", "agent"), { recursive: true });
    copyFileSync(realAuth, join(home, ".mya", "agent", "auth.json"));
  }
  return home;
}

function safeKill(cp: ChildProcess | undefined): void {
  try {
    cp?.kill("SIGKILL");
  } catch {
    /* already exited */
  }
}

// ── tests ────────────────────────────────────────────────────────────────

describe.skipIf(!MYA_BIN)("[system] concurrent role-subagents — independent status + nesting", () => {
  let bundleReady = false;

  beforeAll(async () => {
    const help = await capture(MYA_BIN!, ["--help"]);
    bundleReady = /--provider/.test(help);
  });

  it(`${NUM_SUBAGENTS} concurrent subagents each reach terminal status + nest under parent`, async () => {
    if (!bundleReady) return;

    const home = setupTempHome();
    const port = 5200 + Math.floor(Math.random() * 500);
    let serve: ChildProcess | undefined;
    const subs: ChildProcess[] = [];

    try {
      serve = spawn(MYA_BIN!, ["serve", "--port", String(port)], {
        env: { ...process.env, HOME: home, MYA_NO_WS_TOKEN: "1" },
        stdio: ["ignore", "pipe", "ignore"],
      });
      await waitForReady(port);

      // 1. Acquire a parent session.
      const parentSid = await acquireSession(port, { cwd: home });

      // 2. Acquire NUM_SUBAGENTS child sessions + spawn their binaries concurrently.
      const childIds: string[] = [];
      const tasks = ["say one", "say two", "say three"];

      for (let i = 0; i < NUM_SUBAGENTS; i++) {
        const childSid = await acquireSession(port, {
          cwd: home,
          role: "coder",
          task: tasks[i]!,
          parentSessionId: parentSid,
        });
        childIds.push(childSid);

        const sub = spawn(
          MYA_BIN!,
          [
            "--gateway-session", childSid,
            "--role", "coder",
            "--task", tasks[i]!,
            "--provider", "minimax",
            "--model", "MiniMax-M3",
            "--no-session",
          ],
          {
            env: {
              ...process.env,
              HOME: home,
              MYA_PORT: String(port),
              MYA_NO_WS_TOKEN: "1",
              MYA_FROM_LAUNCHER: "1",
            },
            stdio: "ignore",
          },
        );
        subs.push(sub);
      }

      // 3. Poll until ALL children reach terminal status.
      const results = await pollAllForTerminal(port, childIds, 180_000);

      // 4. Assert every child reached a terminal status (done|failed).
      for (const [sid, status] of results) {
        expect(
          ["done", "failed"].includes(status),
          `child ${sid} should reach terminal status, got "${status}"`,
        ).toBe(true);
        expect(status).not.toBe("");
      }

      // 5. Verify ALL children appear as nested subagents of the parent.
      const tree = await fetchTree(port);
      const parent = tree.find((n) => n.sessionId === parentSid);
      expect(parent, "parent session should be in /pool/tree").toBeDefined();
      const nested = parent?.subagents ?? [];
      expect(nested.length).toBeGreaterThanOrEqual(NUM_SUBAGENTS);

      for (let i = 0; i < NUM_SUBAGENTS; i++) {
        const sid = childIds[i]!;
        const entry = nested.find((s) => s.id === sid);
        expect(entry, `child ${sid} should be nested under parent`).toBeDefined();
        expect(entry?.role).toBe("coder");
        expect(entry?.task).toBe(tasks[i]);
        expect(entry?.depth).toBe(1);
        expect(["done", "failed"]).toContain(entry?.status);
      }
    } finally {
      for (const s of subs) safeKill(s);
      safeKill(serve);
      rmSync(home, { recursive: true, force: true });
    }
  }, 300_000);
});
