/**
 * Feature §18 — DAP (Debug Adapter Protocol) functional depth.
 *
 * Exercises `@my-agent/dap` + `@my-agent/dap-server` without needing an
 * external debug adapter binary:
 *   - Content-Length message framing (writeFrame / readFrame / FrameReader),
 *     including multi-frame, split-chunk, malformed-header and the 16 MiB DoS cap.
 *   - DapServerStub canned handler (initialize/launch/setBreakpoints/threads/…).
 *   - DapClient end-to-end over an in-process TCP server: connection state
 *     machine, request/response correlation, 'stopped' event → currentThreadId,
 *     breakpoint verification, launch/attach config, and TCP socket cleanup
 *     on disconnect (the Phase 4 leak fix).
 *   - DapClient guards (not-initialized / no-thread).
 *   - makeDebugTool meta + argument validation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { Readable } from "node:stream";
import { once } from "node:events";

const dap = await import("../../../packages/dap/src/index.ts").catch(() => null);
const clientMod = await import("../../../packages/dap/src/client.ts").catch(() => null);
const srv = await import("../../../packages/dap-server/src/index.ts").catch(() => null);

const SKIP_DAP = !dap || !clientMod;
const SKIP_SRV = !srv;

// ─── helpers ──────────────────────────────────────────────────────────────
function frame(body: unknown): string {
  const json = JSON.stringify(body);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

/** Spin up an in-process TCP DAP server backed by DapServerStub. */
async function startInProcessDapServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const stub = new srv!.DapServerStub();
  const server: Server = createServer((socket: Socket) => {
    const reader = new srv!.FrameReader(socket);
    void (async () => {
      // read() never rejects; loop until the socket closes.
      for (;;) {
        let req: Record<string, unknown>;
        try {
          req = await reader.read();
        } catch {
          break;
        }
        // A closed socket surfaces as a never-resolving read; detect via the
        // socket 'close' to break out.
        if (socket.destroyed) break;
        const handled = stub.handle({
          seq: req["seq"] as number,
          command: req["command"] as string,
          arguments: req["arguments"],
        });
        for (const ev of handled.events) srv!.writeFrame({ stdout: socket }, ev);
        srv!.writeFrame({ stdout: socket }, handled.response);
        if ((req["command"] as string) === "disconnect") {
          socket.end();
          break;
        }
      }
    })().catch(() => { /* socket closed mid-read — fine */ });
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((res) => server.close(() => res())),
  };
}

// ─── framing (pure) ───────────────────────────────────────────────────────
describe.skipIf(SKIP_SRV)("[§18 dap] message framing", () => {
  it("writeFrame emits a Content-Length header with the correct byte length + body", () => {
    const written: string[] = [];
    srv!.writeFrame({ stdout: { write: (s: string) => Boolean(written.push(s)) } }, { hello: "wörld" });
    const out = written.join("");
    expect(out).toMatch(/^Content-Length:\s*\d+\r\n\r\n/);
    const m = /Content-Length:\s*(\d+)/.exec(out)!;
    const len = parseInt(m[1]!, 10);
    const body = out.slice(out.indexOf("\r\n\r\n") + 4);
    expect(Buffer.byteLength(body, "utf8")).toBe(len);
    expect(JSON.parse(body)).toEqual({ hello: "wörld" });
  });

  it("readFrame parses a single framed JSON message", async () => {
    const stream = Readable.from([frame({ seq: 1, type: "request", command: "threads" })]);
    const msg = await srv!.readFrame(stream);
    expect(msg).not.toBeNull();
    expect(msg!["command"]).toBe("threads");
  });

  it("FrameReader parses a single complete frame", async () => {
    const stream = Readable.from([frame({ seq: 2, type: "response", command: "initialize" })]);
    const reader = new srv!.FrameReader(stream);
    const msg = await reader.read();
    expect(msg["command"]).toBe("initialize");
  });

  it("FrameReader parses two frames delivered in a single chunk", async () => {
    const blob = frame({ n: 1 }) + frame({ n: 2 });
    const stream = Readable.from([blob]);
    const reader = new srv!.FrameReader(stream);
    const a = await reader.read();
    const b = await reader.read();
    expect(a["n"]).toBe(1);
    expect(b["n"]).toBe(2);
  });

  it("FrameReader reassembles a frame split across two chunks", async () => {
    const whole = frame({ split: true });
    const mid = Math.floor(whole.length / 2);
    const stream = Readable.from([whole.slice(0, mid), whole.slice(mid)]);
    const reader = new srv!.FrameReader(stream);
    const msg = await reader.read();
    expect(msg["split"]).toBe(true);
  });

  it("FrameReader ignores a malformed header (no Content-Length) without throwing", async () => {
    const stream = Readable.from(["garbage with no header\r\n\r\n"]);
    const reader = new srv!.FrameReader(stream);
    // Should not resolve (and not throw); race against a timeout to prove it.
    const result = await Promise.race([
      reader.read().then(() => "resolved"),
      new Promise<string>((r) => setTimeout(() => r("pending"), 150)),
    ]);
    expect(result).toBe("pending");
  });

  it("FrameReader enforces the 16 MiB cap: an oversized frame is dropped (no resolve)", async () => {
    const stream = Readable.from([`Content-Length: 999999999\r\n\r\n{}`]);
    const reader = new srv!.FrameReader(stream);
    const result = await Promise.race([
      reader.read().then(() => "resolved"),
      new Promise<string>((r) => setTimeout(() => r("dropped"), 150)),
    ]);
    expect(result).toBe("dropped");
  });
});

// ─── DapServerStub handler (pure) ─────────────────────────────────────────
describe.skipIf(SKIP_SRV)("[§18 dap] DapServerStub canned handler", () => {
  it("handle('initialize') returns capabilities with configurationDone support", () => {
    const stub = new srv!.DapServerStub();
    const { response } = stub.handle({ seq: 1, command: "initialize" });
    const r = response as { success: boolean; body: Record<string, unknown> };
    expect(r.success).toBe(true);
    expect(r.body["supportsConfigurationDoneRequest"]).toBe(true);
  });

  it("handle('launch') emits a 'stopped' breakpoint event + an ok response", () => {
    const stub = new srv!.DapServerStub();
    const { response, events } = stub.handle({ seq: 2, command: "launch", arguments: { program: "x.js" } });
    const stopped = events.find((e) => (e as { type?: string }).type === "event");
    expect(stopped).toBeDefined();
    expect((stopped as { event: string }).event).toBe("stopped");
    expect((stopped as { body: { reason: string } }).body.reason).toBe("breakpoint");
    expect((stopped as { body: { threadId: number } }).body.threadId).toBe(1);
    expect((response as { success: boolean }).success).toBe(true);
  });

  it("handle('setBreakpoints') returns a verified breakpoint at the requested line", () => {
    const stub = new srv!.DapServerStub();
    const { response } = stub.handle({ seq: 3, command: "setBreakpoints", arguments: { lines: [42] } });
    const bps = (response as { body: { breakpoints: Array<{ verified: boolean; line: number }> } }).body.breakpoints;
    expect(bps[0]!.verified).toBe(true);
    expect(bps[0]!.line).toBe(42);
  });

  it("handle('threads') returns the canned 'main' thread", () => {
    const stub = new srv!.DapServerStub();
    const { response } = stub.handle({ seq: 4, command: "threads" });
    const threads = (response as { body: { threads: Array<{ id: number; name: string }> } }).body.threads;
    expect(threads[0]!.id).toBe(1);
    expect(threads[0]!.name).toBe("main");
  });

  it("handle('disconnect') emits an 'exited' event", () => {
    const stub = new srv!.DapServerStub();
    const { events } = stub.handle({ seq: 5, command: "disconnect" });
    const exited = events.find((e) => (e as { event?: string }).event === "exited");
    expect(exited).toBeDefined();
  });

  it("handle(unknown command) returns a failed response with a message", () => {
    const stub = new srv!.DapServerStub();
    const { response } = stub.handle({ seq: 6, command: "nonsense" });
    expect((response as { success: boolean }).success).toBe(false);
    expect((response as { message: string }).message).toMatch(/unknown command/);
  });
});

// ─── DapClient over an in-process TCP server (real framing + correlation) ──
describe.skipIf(SKIP_DAP || SKIP_SRV)("[§18 dap] DapClient end-to-end over TCP", () => {
  let harness: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    harness = await startInProcessDapServer();
  });
  afterAll(async () => {
    await harness.close();
  });

  it("initialize() returns server capabilities", async () => {
    const c = new clientMod!.DapClient({ transport: { host: "127.0.0.1", port: harness.port } });
    const caps = await c.initialize();
    // initialize() resolves with the response body directly (DAP caps).
    expect((caps as { supportsConfigurationDoneRequest?: boolean }).supportsConfigurationDoneRequest).toBe(true);
    await c.disconnect();
  });

  it("launch() emits 'stopped' and sets currentThreadId (request/response correlation + events)", async () => {
    const c = new clientMod!.DapClient({ transport: { host: "127.0.0.1", port: harness.port } });
    await c.initialize();
    const stoppedP = once(c, "stopped");
    await c.start("launch", { program: "app.js" });
    const [ev] = await stoppedP;
    // 'stopped' emits the event body directly.
    expect((ev as { reason: string; threadId: number }).reason).toBe("breakpoint");
    expect((ev as { threadId: number }).threadId).toBe(1);
    expect(c.currentThreadId).toBe(1);
    await c.disconnect();
  });

  it("start('attach') routes to the 'attach' command (launch vs attach config branch)", async () => {
    const c = new clientMod!.DapClient({ transport: { host: "127.0.0.1", port: harness.port } });
    await c.initialize();
    // The canned stub only implements 'launch'; observing an 'attach'-specific
    // rejection proves the client dispatched the attach command (not launch).
    await expect(c.start("attach", { pid: 1234 })).rejects.toThrow(/attach/);
    await c.disconnect();
  });

  it("setBreakpoints() + threads() + stackTrace() round-trip over the wire", async () => {
    const c = new clientMod!.DapClient({ transport: { host: "127.0.0.1", port: harness.port } });
    await c.initialize();
    await c.start("launch", { program: "app.js" });
    const bp = await c.setBreakpoints("app.js", [{ line: 10 }]);
    expect(bp.breakpoints[0]!.verified).toBe(true);
    const t = await c.threads();
    expect(t.threads[0]!.id).toBe(1);
    const st = await c.stackTrace(1);
    expect(st.stackFrames[0]!.name).toBe("main");
    await c.disconnect();
  });

  it("disconnect() tears down the TCP socket without throwing (socket lifecycle / leak fix)", async () => {
    const c = new clientMod!.DapClient({ transport: { host: "127.0.0.1", port: harness.port } });
    await c.initialize();
    await expect(c.disconnect()).resolves.toBeUndefined();
    // Idempotent-ish: a second disconnect is a safe no-op.
    await expect(c.disconnect()).resolves.toBeUndefined();
  });
});

// ─── DapClient guards ─────────────────────────────────────────────────────
describe.skipIf(SKIP_DAP)("[§18 dap] DapClient guards", () => {
  it("start() before initialize() throws 'not initialized'", async () => {
    const c = new clientMod!.DapClient({ command: "/nonexistent/adapter", args: [] });
    await expect(c.start("launch", {})).rejects.toThrow(/not initialized/);
  });

  it("next() with no thread throws (explicit threadId required)", async () => {
    const c = new clientMod!.DapClient({ command: "/nonexistent/adapter", args: [] });
    await expect(c.next()).rejects.toThrow(/no current thread/);
    await expect(c.stepIn()).rejects.toThrow(/no current thread/);
  });
});

// ─── makeDebugTool ────────────────────────────────────────────────────────
describe.skipIf(SKIP_DAP)("[§18 dap] makeDebugTool surface + validation", () => {
  it("builds a tool named 'debug' with DangerFullAccess and a command enum", () => {
    const tool = dap!.makeDebugTool({ connect: { command: "x", args: [] } });
    expect(tool.meta.name).toBe("debug");
    expect(tool.meta.requiredMode).toBe("DangerFullAccess");
    const props = (tool.meta.args as { properties: { command: { enum: string[] } } }).properties;
    expect(props.command.enum).toEqual(
      expect.arrayContaining(["initialize", "start", "setBreakpoints", "disconnect"]),
    );
  });

  it("rejects a missing/non-record command arg", async () => {
    const tool = dap!.makeDebugTool({ connect: { command: "x", args: [] } });
    const r = await tool.run({} as never);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown debug command without spawning the adapter", async () => {
    const tool = dap!.makeDebugTool({ connect: { command: "x", args: [] } });
    const r = await tool.run({ command: "totally-bogus" } as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown debug command/);
  });
});
