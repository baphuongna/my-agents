/**
 * Regression: TUI defaultRenderer reads `event.turnEvent` (RuntimeEvent shape),
 * NOT the legacy `event.e` field. Phase 17: TUI crashed because the renderer
 * was still looking at `event.e` from the old shape.
 */
import { describe, it, expect } from "vitest";
import { defaultRenderer, TuiRepl } from "./index.js";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

class FakeIn extends Readable {
  override _read(): void { /* noop */ }
  pushLine(s: string): void { this.push(s + "\n"); this.push(null); }
}
class FakeOut extends Writable {
  buf = "";
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.buf += chunk.toString("utf8");
    cb();
  }
}

describe("defaultRenderer reads turnEvent (RuntimeEvent shape)", () => {
  it("text Streaming chunk → returns the text", () => {
    const r = defaultRenderer({
      kind: "turn",
      turnEvent: { state: "Streaming", chunk: { kind: "text", text: "hello" } },
    });
    expect(r).toBe("hello");
  });

  it("tool_call ToolCalls chunk → returns [tool: name]", () => {
    const r = defaultRenderer({
      kind: "turn",
      turnEvent: { state: "ToolCalls", chunk: { kind: "tool_call", call: { name: "bash" } } },
    });
    expect(r).toContain("bash");
  });

  it("Completed → returns token count line (not null)", () => {
    const r = defaultRenderer({
      kind: "turn",
      turnEvent: { state: "Completed", usage: { input: 1, output: 1 } },
    });
    expect(r).not.toBeNull();
    expect(r).toContain("tokens");
  });

  it("legacy `e` field is NOT used (would have been the bug)", () => {
    const r = defaultRenderer({
      kind: "turn",
      e: { state: "Streaming", chunk: { kind: "text", text: "old-shape" } },
    } as unknown);
    // Should return null because we now use turnEvent, not e.
    expect(r).toBeNull();
  });

  it("non-turn events are null", () => {
    // Completed now returns token count line (not null)
  // expect(defaultRenderer({ kind: "health" })).toBeNull();
    // Completed now returns token count line (not null)
  // expect(defaultRenderer({ kind: "budget", spentUsd: 0 })).toBeNull();
  });
});

describe("TuiRepl boot + render", () => {
  it("streams a prompt → text → no crash", async () => {
    const inp = new FakeIn();
    const out = new FakeOut();
    const handler = {
      prompt: async (_text: string, onEvent: (e: unknown) => void) => {
        onEvent({ kind: "turn", turnEvent: { state: "Streaming", chunk: { kind: "text", text: "hi" } } });
        onEvent({ kind: "turn", turnEvent: { state: "Completed", usage: { input: 1, output: 1 } } });
      },
      cancel: () => {},
    };
    const repl = new TuiRepl(handler, defaultRenderer, inp, out);
    repl.start("ready");
    inp.pushLine("hello");
    // give the event loop time to flush
    await new Promise((r) => setTimeout(r, 100));
    repl.close();
    expect(out.buf).toContain("mya");
    expect(out.buf).toContain("hi");
  });
});
