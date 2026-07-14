import { describe, it, expect } from "vitest";
import { DapServerStub, writeFrame, readFrame, FrameReader } from "./index.js";

describe("DapServerStub", () => {
  it("responds to initialize request", () => {
    const server = new DapServerStub();
    const { response } = server.handle({ seq: 1, command: "initialize", arguments: {} });
    const r = response as { success: boolean; command: string; body?: unknown };
    expect(r.success).toBe(true);
    expect(r.command).toBe("initialize");
    expect(r.body).toBeDefined();
  });

  it("emits stopped event on launch", () => {
    const server = new DapServerStub();
    const { events } = server.handle({ seq: 2, command: "launch", arguments: {} });
    expect(events.length).toBeGreaterThan(0);
    const stopped = events.find(
      (e: unknown) => (e as { event?: string }).event === "stopped",
    );
    expect(stopped).toBeDefined();
  });

  it("responds to threads request", () => {
    const server = new DapServerStub();
    server.handle({ seq: 1, command: "launch", arguments: {} });
    const { response } = server.handle({ seq: 3, command: "threads", arguments: {} });
    const r = response as { success: boolean; body?: { threads?: unknown[] } };
    expect(r.success).toBe(true);
    expect(r.body?.threads).toBeDefined();
  });

  it("responds to stackTrace request", () => {
    const server = new DapServerStub();
    server.handle({ seq: 1, command: "launch", arguments: {} });
    const { response } = server.handle({ seq: 4, command: "stackTrace", arguments: {} });
    const r = response as { success: boolean; body?: { stackFrames?: unknown[] } };
    expect(r.success).toBe(true);
    expect(r.body?.stackFrames).toBeDefined();
  });

  it("responds to disconnect", () => {
    const server = new DapServerStub();
    const { response } = server.handle({ seq: 5, command: "disconnect", arguments: {} });
    const r = response as { success: boolean };
    expect(r.success).toBe(true);
  });
});

describe("writeFrame / readFrame", () => {
  it("writes a Content-Length framed message", () => {
    const chunks: Buffer[] = [];
    const mockProc = {
      stdout: {
        write(chunk: Buffer | string) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        },
      },
    };
    const message = { type: "request", command: "test", seq: 1 };
    writeFrame(mockProc as never, message);

    const framed = Buffer.concat(chunks).toString();
    expect(framed).toContain("Content-Length:");
    expect(framed).toContain("\"command\":\"test\"");
  });

  it("reads a Content-Length framed message from a stream", async () => {
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    const message = { type: "request", command: "test", seq: 1 };
    writeFrame({ stdout: stream } as never, message);
    const result = await readFrame(stream as never);
    expect(result).toMatchObject(message);
  });
});

describe("FrameReader", () => {
  it("can be constructed", async () => {
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    const reader = new FrameReader(stream as never);
    expect(reader).toBeDefined();
    expect(typeof reader.read).toBe("function");
    stream.destroy();
  });
});
