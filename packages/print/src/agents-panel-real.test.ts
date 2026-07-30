// [real]+[system] 'mya agents' dispatch + live panel + real /pool/tree rendering.
//
// Two test tiers:
// 1. [real] 'mya agents' binary polls a mock /pool/tree (existing — verifies the
//    binary's refresh loop works without needing a real gateway).
// 2. [system] Real serve → set statuses via POST → GET /pool/tree → render with
//    renderAgentsPanel() → verify glyphs (✓ done, ✗ failed, ● working).
//    This tests the full pipeline: gateway HTTP → SessionMetaStore → /pool/tree
//    → agents-panel rendering, using REAL gateway data.
//
// Gated on MYA_BIN + a FRESH bundle with the 'agents' subcommand.
import { describe, it, expect, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAgentsPanel, type PanelState } from "./agents-panel.js";
import type { AgentTreeNode } from "./mya-bridge.js";

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

function safeKill(cp: ChildProcess | undefined): void {
  try {
    cp?.kill("SIGKILL");
  } catch {
    /* already exited */
  }
}

// ══════════════════════════════════════════════════════════════════════════
// [real] Binary polls mock /pool/tree (existing test — kept for coverage)
// ══════════════════════════════════════════════════════════════════════════

describe.skipIf(!MYA_BIN)("[real] 'mya agents' — live panel polls /pool/tree", () => {
  let hasAgentsSub = false;
  beforeAll(async () => {
    const help = await capture(MYA_BIN!, ["--help"]);
    hasAgentsSub = /\bagents\b/.test(help);
  });

  it("the panel's refresh loop GETs /pool/tree from the gateway", async (ctx) => {
    if (!hasAgentsSub) {
      ctx.skip();
      return;
    }

    let treeHits = 0;
    const server: Server = createServer((req, res) => {
      if (req.url === "/pool/tree") {
        treeHits++;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([]));
      } else if (req.url === "/health/live") {
        res.end('{"state":"ready","ok":true}');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    let child: ChildProcess | undefined;
    try {
      child = spawn(MYA_BIN!, ["agents"], {
        env: { ...process.env, MYA_PORT: String(port), MYA_FROM_LAUNCHER: "1" },
        stdio: ["ignore", "ignore", "ignore"],
      });
      // Let the refresh loop poll a few times (refresh interval ~2s).
      await new Promise((r) => setTimeout(r, 5000));
      expect(treeHits).toBeGreaterThan(0);
    } finally {
      safeKill(child);
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15_000);
});

// ══════════════════════════════════════════════════════════════════════════
// [system] Real /pool/tree data → renderAgentsPanel glyph verification
// ══════════════════════════════════════════════════════════════════════════

describe.skipIf(!MYA_BIN)("[system] agents panel — real /pool/tree glyph rendering", () => {
  let bundleReady = false;
  beforeAll(async () => {
    const help = await capture(MYA_BIN!, ["--help"]);
    bundleReady = /\bagents\b/.test(help);
  });

  it("renderAgentsPanel produces ✓/✗/● glyphs from real /pool/tree data", async () => {
    if (!bundleReady) return;

    const home = mkdtempSync(join(tmpdir(), "mya-panel-"));
    const port = 5700 + Math.floor(Math.random() * 500);
    let serve: ChildProcess | undefined;

    try {
      serve = spawn(MYA_BIN!, ["serve", "--port", String(port)], {
        env: { ...process.env, HOME: home, MYA_NO_WS_TOKEN: "1" },
        stdio: ["ignore", "pipe", "ignore"],
      });
      await waitForReady(port);

      // Acquire 3 sessions: one each for working/done/failed.
      const sessions: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`http://127.0.0.1:${port}/pool/acquire`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: home,
            role: i === 0 ? "coder" : i === 1 ? "reviewer" : "researcher",
            task: `task-${i}`,
          }),
        });
        expect(r.ok).toBe(true);
        const { sessionId } = (await r.json()) as { sessionId: string };
        sessions.push(sessionId);
      }

      // POST statuses: working, done, failed.
      const statuses = ["working", "done", "failed"] as const;
      for (let i = 0; i < 3; i++) {
        const r = await fetch(
          `http://127.0.0.1:${port}/pool/session/${encodeURIComponent(sessions[i]!)}/status`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: statuses[i] }),
          },
        );
        expect(r.ok).toBe(true);
      }

      // GET /pool/tree — real gateway data.
      const treeRes = await fetch(`http://127.0.0.1:${port}/pool/tree`);
      expect(treeRes.ok).toBe(true);
      const tree = (await treeRes.json()) as AgentTreeNode[];

      // Verify the tree has our 3 sessions with correct statuses.
      const s0 = tree.find((n) => n.sessionId === sessions[0]);
      const s1 = tree.find((n) => n.sessionId === sessions[1]);
      const s2 = tree.find((n) => n.sessionId === sessions[2]);
      expect(s0?.status).toBe("working");
      expect(s1?.status).toBe("done");
      expect(s2?.status).toBe("failed");

      // Render the panel from REAL data + verify glyphs.
      const state: PanelState = { sel: 0, quit: false };
      const lines = renderAgentsPanel(tree, state);
      const raw = lines.join("\n");

      // ✓ = done, ✗ = failed, ● = working (blue)
      expect(raw).toContain("✓");
      expect(raw).toContain("✗");
      expect(raw).toContain("●");

      // Verify role labels appear in the rendered output.
      expect(raw).toContain("coder");
      expect(raw).toContain("reviewer");
      expect(raw).toContain("researcher");
    } finally {
      safeKill(serve);
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
