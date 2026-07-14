/**
 * @my-agent/workflows — rhai-runner tests (Gap 4).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { evalRhai } from "./rhai-runner.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeWorkspace(): string {
  const dir = join(tmpdir(), `rhai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const workspaces: string[] = [];

afterEach(() => {
  while (workspaces.length) {
    const dir = workspaces.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("evalRhai (Gap 4 — embedded scripting MVP)", () => {
  it("runs a simple JS expression and returns the result", async () => {
    const { value } = await evalRhai("return 1 + 2 * 3", {});
    expect(value).toBe(7);
  });

  it("read_file reads a workspace-scoped file", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    writeFileSync(join(ws, "hello.txt"), "world");
    const { value } = await evalRhai(
      "const txt = await read_file('hello.txt'); return txt;",
      {},
      { workspace: ws },
    );
    expect(value).toBe("world");
  });

  it("write_file writes within workspace and rejects path traversal", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    // Valid write
    await evalRhai(
      "await write_file('out.txt', 'hello'); return 'ok';",
      {},
      { workspace: ws },
    );
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(ws, "out.txt"), "utf8")).toBe("hello");

    // Traversal attempt — should produce an error event
    const { events } = await evalRhai(
      "await write_file('../../../etc/evil.txt', 'pwned'); return 'done';",
      {},
      { workspace: ws },
    );
    expect(events.some((e) => e.kind === "error")).toBe(true);
  });

  it("http_get fetches a URL and returns the body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("body-content", { status: 200 }),
    );
    const { value } = await evalRhai(
      "const body = await http_get('https://example.com/api'); return body;",
      {},
    );
    expect(value).toBe("body-content");
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/api");
    fetchSpy.mockRestore();
  });

  it("log emits log events at info/warn/error levels", async () => {
    const { events } = await evalRhai(
      "log('info', 'starting'); log('warn', 'careful'); log('error', 'oops'); return null;",
      {},
    );
    const logs = events.filter((e) => e.kind === "log");
    expect(logs).toHaveLength(3);
    expect(logs[0]!.level).toBe("info");
    expect(logs[0]!.message).toBe("starting");
    expect(logs[1]!.level).toBe("warn");
    expect(logs[2]!.level).toBe("error");
  });

  it("emit_event emits structured events with kind + payload", async () => {
    const { events } = await evalRhai(
      "emit_event('step.done', { result: 42 }); return null;",
      {},
    );
    const custom = events.filter((e) => e.kind === "step.done");
    expect(custom).toHaveLength(1);
    expect(custom[0]!.payload).toEqual({ result: 42 });
  });

  it("handles script errors without crashing the process", async () => {
    const { value, events } = await evalRhai(
      "throw new Error('script boom');",
      {},
    );
    expect(value).toBeUndefined();
    expect(events.some((e) => e.kind === "error" && e.message?.includes("script boom"))).toBe(true);
  });
});
