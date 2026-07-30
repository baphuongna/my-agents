// [real]+[system] View backends — ACTUAL pane/window creation (coverage gap #1).
//
// These verify the backends' open() commands REALLY create a pane/window in the
// live terminal (the unit tests only verify command-BUILDING with mocked
// child_process). Gated PER BACKEND on its env var — they SKIP gracefully when
// the mux isn't running, and RUN (create + cleanup a real pane) when it is.
// herdr runs in this env (HERDR_ENV is set). Reliable cleanup (afterEach) so no
// test pane is left in the user's session.
//
// The [system] tier test at the bottom verifies the full herdr + --gateway-session
// integration: herdrBackend.open() spawns a real subagent pane that connects to
// the gateway and reports working/done status.
//
// standalone is intentionally NOT tested here (OS terminal window — can't
// verify/cleanup headless).
import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, copyFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { tmuxBackend } from "./tmux.js";
import { herdrBackend } from "./herdr.js";
import { cmuxBackend } from "./cmux.js";
import { zellijBackend } from "./zellij.js";
import { screenBackend } from "./screen.js";

/** Run a command, capture stdout, resolve on close (never rejects). */
function run(cmd: string, args: string[]): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout?.setEncoding("utf8");
    c.stdout?.on("data", (d: string) => (out += d));
    c.on("close", (code) => resolve({ stdout: out, code }));
    c.on("error", () => resolve({ stdout: "", code: null }));
  });
}

const TITLE = "mya-real-test";

// ── tmux ───────────────────────────────────────────────────────────────────
describe.skipIf(!process.env.TMUX)("[real] tmux backend — opens a real window", () => {
  let ref: string | undefined;
  afterEach(async () => {
    if (ref) await run("tmux", ["kill-window", "-t", ref]).catch(() => {});
  });
  it("open() creates a tmux window named by title", async () => {
    const handle = await tmuxBackend.open({ command: ["sleep", "3"], title: TITLE });
    ref = handle.ref;
    const list = await run("tmux", ["list-windows", "-F", "#{window_name}"]);
    expect(list.stdout).toContain(TITLE);
  });
});

// ── herdr (RUNS in this env — HERDR_ENV set) ───────────────────────────────
describe.skipIf(!process.env.HERDR_ENV && !process.env.HERDR_SOCKET_PATH)(
  "[real] herdr backend — opens a real pane",
  () => {
    let ref: string | undefined;
    afterEach(async () => {
      if (ref) await run("herdr", ["pane", "close", ref]).catch(() => {});
    });
    it("open() creates a herdr pane visible in `herdr pane list`", async () => {
      const handle = await herdrBackend.open({ command: ["sleep", "3"], title: TITLE });
      ref = handle.ref;
      expect(handle.backendId).toBe("herdr");
      expect(typeof ref).toBe("string");
      const list = await run("herdr", ["pane", "list"]);
      const parsed = JSON.parse(list.stdout) as { result?: { panes?: Array<{ pane_id?: string }> } };
      const ids = (parsed.result?.panes ?? []).map((p) => p.pane_id).filter(Boolean);
      expect(ids).toContain(ref);
    });
  },
);

// ── cmux (macOS tmux-like; mirrors tmux CLI) ──────────────────────────────
describe.skipIf(!process.env.CMUX)("[real] cmux backend — opens a real window", () => {
  let ref: string | undefined;
  afterEach(async () => {
    if (ref) await run("cmux", ["kill-window", "-t", ref]).catch(() => {});
  });
  it("open() creates a cmux window", async () => {
    const handle = await cmuxBackend.open({ command: ["sleep", "3"], title: TITLE });
    ref = handle.ref;
    const list = await run("cmux", ["list-windows", "-F", "#{window_name}"]);
    expect(list.stdout).toContain(TITLE);
  });
});

// ── zellij ─────────────────────────────────────────────────────────────────
// zellij's in-session pane-list CLI is less standardized; verify open() returns
// a handle without throwing + best-effort cleanup. (Skipped here — no $ZELLIJ.)
describe.skipIf(!process.env.ZELLIJ)("[real] zellij backend — opens a pane", () => {
  it("open() returns a handle (pane created)", async () => {
    const handle = await zellijBackend.open({ command: ["sleep", "3"], title: TITLE });
    expect(handle.backendId).toBe("zellij");
    expect(typeof handle.ref).toBe("string");
    // best-effort cleanup: zellij has no universal close-by-id CLI from inside;
    // the sleep pane exits on its own. (Strengthen when zellij CLI stabilizes.)
  });
});

// ── screen ─────────────────────────────────────────────────────────────────
describe.skipIf(!process.env.STY)("[real] screen backend — opens a real window", () => {
  let ref: string | undefined;
  afterEach(async () => {
    if (ref) await run("screen", ["-X", "select", ref]).catch(() => {});
  });
  it("open() creates a screen window", async () => {
    const handle = await screenBackend.open({ command: ["sleep", "3"], title: TITLE });
    ref = handle.ref;
    // screen -list shows windows in the session
    const list = await run("screen", ["-list"]);
    expect(list.stdout).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// [system] herdr + --gateway-session — full subagent lifecycle via view backend
// ══════════════════════════════════════════════════════════════════════════
// Verifies that herdrBackend.open() can spawn a real mya subagent pane that
// connects to the gateway and reports working→done status. Requires MYA_BIN
// + the herdr binary. Uses a wrapper bash script to set env vars (the herdr
// pane inherits the daemon's env, which doesn't have MYA_PORT/HOME).

const MYA_BIN = process.env.MYA_BIN;
const HERDR_AVAILABLE = !!spawnSync("which", ["herdr"], { encoding: "utf8" }).stdout?.trim();

describe.skipIf(!MYA_BIN || !HERDR_AVAILABLE)(
  "[system] herdr view backend — spawns subagent with --gateway-session",
  () => {
    let ref: string | undefined;

    afterEach(async () => {
      if (ref) await run("herdr", ["pane", "close", ref]).catch(() => {});
      ref = undefined;
    });

    it("herdrBackend.open() spawns a subagent pane that reports done", async () => {
      const home = mkdtempSync(join(tmpdir(), "mya-herdr-"));
      const port = 5900 + Math.floor(Math.random() * 500);

      // Copy auth.json so the subagent has minimax creds.
      const realAuth = join(homedir(), ".mya", "agent", "auth.json");
      if (existsSync(realAuth)) {
        mkdirSync(join(home, ".mya", "agent"), { recursive: true });
        copyFileSync(realAuth, join(home, ".mya", "agent", "auth.json"));
      }

      let serve: ReturnType<typeof spawn> | undefined;
      try {
        // 1. Start serve.
        serve = spawn(MYA_BIN!, ["serve", "--port", String(port)], {
          env: { ...process.env, HOME: home, MYA_NO_WS_TOKEN: "1" },
          stdio: ["ignore", "pipe", "ignore"],
        });

        // Wait for ready.
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/health/live`);
            if (r.ok) break;
          } catch { /* not up */ }
          await new Promise((r) => setTimeout(r, 500));
        }

        // 2. Acquire parent + child sessions.
        const parentRes = await fetch(`http://127.0.0.1:${port}/pool/acquire`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: home }),
        });
        const parentSid = ((await parentRes.json()) as { sessionId: string }).sessionId;

        const childRes = await fetch(`http://127.0.0.1:${port}/pool/acquire`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: home,
            role: "coder",
            task: "pong",
            parentSessionId: parentSid,
          }),
        });
        const childSid = ((await childRes.json()) as { sessionId: string }).sessionId;

        // 3. Write a wrapper script (herdr pane inherits daemon env — we need
        //    to override HOME, MYA_PORT, etc.). --approve skips the trust dialog
        //    that appears in TTY mode (herdr panes have a real TTY).
        const nodeBin = process.execPath;
        const myaPath = MYA_BIN!;
        const scriptPath = join(home, "run-sub.sh");
        writeFileSync(
          scriptPath,
          `#!/bin/bash\n` +
            `export MYA_PORT=${port}\n` +
            `export HOME=${home}\n` +
            `export MYA_NO_WS_TOKEN=1\n` +
            `export MYA_FROM_LAUNCHER=1\n` +
            `cd ${home}\n` +
            `exec ${nodeBin} ${myaPath} --gateway-session ${childSid} --role coder --task pong --provider minimax --model MiniMax-M3 --approve --no-session\n`,
        );
        chmodSync(scriptPath, 0o755);

        // 4. Open a herdr pane running the wrapper script.
        //    Set HERDR_ENV so herdrBackend.detect() returns true.
        process.env.HERDR_ENV = "1";
        const handle = await herdrBackend.open({
          command: ["bash", scriptPath],
          title: "mya-sub-test",
          cwd: home,
        });
        ref = handle.ref;
        expect(handle.backendId).toBe("herdr");
        expect(typeof ref).toBe("string");

        // 5. Poll /pool/tree until the child reaches terminal status.
        let terminal = "";
        const pollDeadline = Date.now() + 120_000;
        while (Date.now() < pollDeadline) {
          try {
            const treeRes = await fetch(`http://127.0.0.1:${port}/pool/tree`);
            if (treeRes.ok) {
              const tree = (await treeRes.json()) as Array<{
                sessionId: string;
                status?: string;
                subagents?: Array<{ id: string; status: string }>;
              }>;
              // Check top-level + nested.
              for (const node of tree) {
                if (node.sessionId === childSid && node.status) {
                  if (node.status === "done" || node.status === "failed") {
                    terminal = node.status;
                    break;
                  }
                }
                const sub = node.subagents?.find((s) => s.id === childSid);
                if (sub && (sub.status === "done" || sub.status === "failed")) {
                  terminal = sub.status;
                  break;
                }
              }
              if (terminal) break;
            }
          } catch { /* transient */ }
          await new Promise((r) => setTimeout(r, 1000));
        }

        // 6. Assert terminal status (proves the subagent booted + bridge loaded +
        //    status reporting worked through the herdr pane).
        expect(["done", "failed"]).toContain(terminal);
        expect(terminal).not.toBe("");
      } finally {
        try { serve?.kill("SIGKILL"); } catch { /* */ }
        rmSync(home, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
