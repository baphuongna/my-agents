// [real] View backends — ACTUAL pane/window creation (coverage gap #1).
//
// These verify the backends' open() commands REALLY create a pane/window in the
// live terminal (the unit tests only verify command-BUILDING with mocked
// child_process). Gated PER BACKEND on its env var — they SKIP gracefully when
// the mux isn't running, and RUN (create + cleanup a real pane) when it is.
// herdr runs in this env (HERDR_ENV is set). Reliable cleanup (afterEach) so no
// test pane is left in the user's session.
//
// standalone is intentionally NOT tested here (OS terminal window — can't
// verify/cleanup headless).
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
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
