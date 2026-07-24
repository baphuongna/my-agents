import { describe, it, expect } from "vitest";
import {
  apply_request_context,
  type RequestContext,
  type RequestContextRebuilder,
} from "./request-context.js";

/** Build a baseline request context for tests. */
function baseCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    stable: "identity",
    context: "project files",
    volatile: "memory",
    history: [{ role: "user", content: "hello" }],
    incoming: "what files exist?",
    budgetTokens: 100_000,
    ...overrides,
  };
}

describe("[unit] apply_request_context", () => {
  it("empty rebuilder list → no-op, returns exact input reference (P1/P6)", () => {
    const input = baseCtx();
    const result = apply_request_context([], input);
    expect(result.changed).toBe(false);
    expect(result.invocations).toBe(0);
    // P6: cache-stability identity check — same object reference.
    expect(result.context).toBe(input);
  });

  it("rebuilder returning null → no change, returns exact input reference", () => {
    const input = baseCtx();
    const noop: RequestContextRebuilder = () => null;
    const result = apply_request_context([noop], input);
    expect(result.changed).toBe(false);
    expect(result.invocations).toBe(1);
    expect(result.context).toBe(input);
  });

  it("rebuilder returning a new context → applied, changed=true", () => {
    const input = baseCtx();
    const rebuilder: RequestContextRebuilder = () => ({
      context: "REWRITTEN context with retrieval results",
    });
    const result = apply_request_context([rebuilder], input);
    expect(result.changed).toBe(true);
    expect(result.context.context).toBe("REWRITTEN context with retrieval results");
    // Stable + volatile preserved from input.
    expect(result.context.stable).toBe("identity");
    expect(result.context.volatile).toBe("memory");
  });

  it("rebuilder can also rewrite the volatile tier", () => {
    const input = baseCtx();
    const rebuilder: RequestContextRebuilder = () => ({
      context: "new context",
      volatile: "new volatile",
    });
    const result = apply_request_context([rebuilder], input);
    expect(result.context.volatile).toBe("new volatile");
  });

  it("fail-open: a throwing rebuilder is swallowed + logged (P2)", () => {
    const input = baseCtx();
    const logs: string[] = [];
    const exploding: RequestContextRebuilder = () => {
      throw new Error("boom");
    };
    const good: RequestContextRebuilder = () => ({ context: "survived" });
    const result = apply_request_context([exploding, good], input, {
      logger: (msg) => logs.push(msg),
    });
    expect(result.changed).toBe(true);
    expect(result.context.context).toBe("survived");
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("boom");
    // Both rebuilders were invoked despite the throw.
    expect(result.invocations).toBe(2);
  });

  it("empty-list trap: rebuilder returning empty context → falls open (P3)", () => {
    const input = baseCtx();
    const logs: string[] = [];
    const bad: RequestContextRebuilder = () => ({ context: "" });
    const result = apply_request_context([bad], input, {
      logger: (msg) => logs.push(msg),
    });
    // Empty context must NOT replace the valid context (P3).
    expect(result.changed).toBe(false);
    expect(result.context).toBe(input);
    expect(logs.some((m) => m.includes("empty context"))).toBe(true);
  });

  it("empty-list trap: falls open even when the rebuilder returns []-like result", () => {
    const input = baseCtx({ context: "KEEP ME" });
    // Simulate a rebuilder that clears context (buggy engine).
    const clearing: RequestContextRebuilder = () => ({ context: "" });
    const result = apply_request_context([clearing], input);
    expect(result.context.context).toBe("KEEP ME");
  });

  it("shallow-copy isolation: rebuilder cannot corrupt the caller's input (P4)", () => {
    const input = baseCtx({ history: [{ role: "user", content: "original" }] });
    const mutating: RequestContextRebuilder = (copy) => {
      // Attempt to corrupt the copy's history array.
      (copy.history as unknown[]).push({ role: "evil", content: "injected" });
      copy.context = "changed context";
      return { context: copy.context };
    };
    const result = apply_request_context([mutating], input);
    expect(result.context.context).toBe("changed context");
    // The caller's original history is NOT corrupted.
    expect(input.history.length).toBe(1);
    expect((input.history[0] as { content: string }).content).toBe("original");
  });

  it("cache-stability identity check: no-op returns exact same object (P6)", () => {
    const input = baseCtx();
    // A rebuilder that opts out.
    const rebuilder: RequestContextRebuilder = () => null;
    const result = apply_request_context([rebuilder, rebuilder, rebuilder], input);
    expect(result.changed).toBe(false);
    // Identity: out === input (not just structurally equal).
    expect(result.context === input).toBe(true);
    expect(result.invocations).toBe(3);
  });

  it("multiple rebuilders chain left-to-right", () => {
    const input = baseCtx();
    const r1: RequestContextRebuilder = () => ({ context: "step1" });
    const r2: RequestContextRebuilder = (ctx) => ({ context: `${ctx.context}→step2` });
    const result = apply_request_context([r1, r2], input);
    expect(result.context.context).toBe("step1→step2");
    expect(result.changed).toBe(true);
  });

  it("rebuilder receives the accumulated context from prior rebuilders", () => {
    const input = baseCtx({ context: "base" });
    const r1: RequestContextRebuilder = (ctx) => ({ context: `${ctx.context}+a` });
    const r2: RequestContextRebuilder = (ctx) => ({ context: `${ctx.context}+b` });
    const result = apply_request_context([r1, r2], input);
    expect(result.context.context).toBe("base+a+b");
  });
});

describe("[unit] apply_request_context — smoke", () => {
  it("[smoke] module loads and exports apply_request_context", () => {
    expect(typeof apply_request_context).toBe("function");
  });
});
