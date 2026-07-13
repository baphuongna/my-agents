/**
 * @my-agent/acp — stdio transport tests for the external-agent bridge.
 *
 * Each mock external agent is `node -e <script>` speaking the JSON-RPC framing:
 *   → task/start   ← task/progress   ← task/done
 */
import { describe, it, expect } from "vitest";
import { AcpBridge } from "./index.js";
import type { AcpDelegateEvent } from "./index.js";

/** Collect every event from a delegate generator into an array. */
async function drain(gen: AsyncIterable<AcpDelegateEvent>): Promise<AcpDelegateEvent[]> {
  const out: AcpDelegateEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

/** A mock agent that emits one progress line then a done line, then exits. */
const happyAgent = `
let buf = "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "task/start") {
      send({ jsonrpc: "2.0", method: "task/progress", params: { text: "working on it" } });
      send({ jsonrpc: "2.0", method: "task/done", params: { result: "completed: " + (msg.params && msg.params.goal) } });
      process.exit(0);
    }
  }
});
`;

/** A mock agent that stays alive (keep-alive timer) until killed. */
const longLivedAgent = `
let buf = "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "task/start") {
      send({ jsonrpc: "2.0", method: "task/progress", params: { text: "thinking" } });
    }
  }
});
// Keep the process alive so it does not exit on its own.
setInterval(() => {}, 1000);
`;

/** A mock agent that crashes immediately (non-zero exit, stderr noise). */
const crashingAgent = `
process.stderr.write("kaboom");
process.exit(1);
`;

/** Wait until pred() is true, polling every intervalMs, up to timeoutMs. */
async function waitFor(pred: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return pred();
}

describe("AcpBridge stdio transport", () => {
  it("spawnExternal performs the ACP handshake and tracks the session", async () => {
    const bridge = new AcpBridge();
    const node = await bridge.spawnExternal(null, process.execPath, ["-e", happyAgent]);
    try {
      expect(node.status).toBe("running");
      expect(node.externalAgent).toBe(`external:${process.execPath}`);
      expect(bridge.hasExternalSession(node.id)).toBe(true);
      expect(typeof bridge.sessionPid(node.id)).toBe("number");
    } finally {
      bridge.terminate(node.id);
    }
  });

  it("delegate sends a task and streams progress + done", async () => {
    const bridge = new AcpBridge();
    const node = await bridge.spawnExternal(null, process.execPath, ["-e", happyAgent]);
    try {
      const events = await drain(
        bridge.delegate({ sessionId: node.id, goal: "build the thing" }),
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("progress");
      const done = events.find((e) => e.type === "done");
      expect(done && done.type === "done" ? done.result : undefined).toBe(
        "completed: build the thing",
      );
      const progress = events.find((e) => e.type === "progress");
      expect(progress && progress.type === "progress" ? progress.text : undefined).toBe(
        "working on it",
      );
      // done must be the terminal event.
      expect(types[types.length - 1]).toBe("done");
    } finally {
      bridge.terminate(node.id);
    }
  });

  it("terminate kills the external agent and removes the session", async () => {
    const bridge = new AcpBridge();
    const node = await bridge.spawnExternal(null, process.execPath, ["-e", longLivedAgent]);
    expect(bridge.hasExternalSession(node.id)).toBe(true);
    const pid = bridge.sessionPid(node.id);
    expect(typeof pid).toBe("number");

    bridge.terminate(node.id);

    // Session is dropped synchronously.
    expect(bridge.hasExternalSession(node.id)).toBe(false);
    // Lineage reflects termination.
    const got = bridge.get(node.id);
    expect(got?.status).toBe("terminated");
    expect(got?.terminatedAt).toBeDefined();
    // The OS process actually dies within a brief window.
    if (pid !== undefined) {
      const dead = await waitFor(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      expect(dead).toBe(true);
    }
  });

  it("delegate yields an error event when the external agent crashes", async () => {
    const bridge = new AcpBridge();
    const node = await bridge.spawnExternal(null, process.execPath, ["-e", crashingAgent]);
    try {
      const events = await drain(
        bridge.delegate({ sessionId: node.id, goal: "anything" }),
      );
      const err = events.find((e) => e.type === "error");
      expect(err).toBeDefined();
      expect(err && err.type === "error" ? err.error : "").toContain("exit code 1");
    } finally {
      bridge.terminate(node.id);
    }
  });

  it("delegate rejects for an unknown session", async () => {
    const bridge = new AcpBridge();
    await expect(async () => {
      for await (const _ev of bridge.delegate({ sessionId: "nope", goal: "x" })) {
        void _ev;
      }
    }).rejects.toThrow(/unknown session/);
  });

  it("delegate reports an error if the agent exits without task/done", async () => {
    // Agent that reads task/start then exits cleanly without replying.
    const silentAgent = `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  if (buf.indexOf("\\n") >= 0) process.exit(0);
});
`;
    const bridge = new AcpBridge();
    const node = await bridge.spawnExternal(null, process.execPath, ["-e", silentAgent]);
    try {
      const events = await drain(
        bridge.delegate({ sessionId: node.id, goal: "say nothing" }),
      );
      const err = events.find((e) => e.type === "error");
      expect(err).toBeDefined();
    } finally {
      bridge.terminate(node.id);
    }
  });
});
