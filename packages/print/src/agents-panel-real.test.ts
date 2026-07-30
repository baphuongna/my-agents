// [real] 'mya agents' dispatch + live panel connects to the gateway (gap #3).
//
// runAgentsPanel() guards setRawMode on isTTY, so even headless (no TTY) it
// runs the refresh loop and GETs /pool/tree. This test spawns `mya agents`
// against a mock gateway + verifies the panel's refresh loop polls /pool/tree.
// Gated on MYA_BIN + a bundle that has the 'agents' subcommand — skips here
// (MYA_BIN unset / stale bundle without the subcommand).
import { describe, it, expect, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";

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

describe.skipIf(!MYA_BIN)("[real] 'mya agents' — live panel polls /pool/tree", () => {
  let hasAgentsSub = false;
  beforeAll(async () => {
    const help = await capture(MYA_BIN!, ["--help"]);
    hasAgentsSub = /\bagents\b/.test(help);
  });

  it("the panel's refresh loop GETs /pool/tree from the gateway", async (ctx) => {
    if (!hasAgentsSub) { ctx.skip(); return; } // bundle stale — 'mya agents' absent; rebuild dist/mya.js

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
      child?.kill("SIGKILL");
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15_000);
});
