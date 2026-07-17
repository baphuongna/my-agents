/**
 * Tool-call repair tests (§6 Tier-1 + A3 lenient JSON recovery).
 */
import { describe, it, expect } from "vitest";
import { repair, parseJsonLenient } from "./repair.js";
import type { ToolCall } from "@my-agent/core";

function call(args: unknown): ToolCall {
  return { id: "t1", name: "edit", args };
}

describe("repair — Tier 1", () => {
  it("parses args given as a JSON string", () => {
    const r = repair(call('{"path":"a.ts","content":"x"}'));
    expect("ok" in r).toBe(true);
    if (!("ok" in r)) return;
    expect(r.ok.args).toEqual({ path: "a.ts", content: "x" });
  });

  it("treats empty/blank args string as {}", () => {
    const e = repair(call(""));
    expect("ok" in e && e.ok.args).toEqual({});
    const w = repair(call("   "));
    expect("ok" in w).toBe(true);
  });

  it("null/undefined args become {}", () => {
    const r = repair(call(null));
    expect("ok" in r && r.ok.args).toEqual({});
  });

  it("passes through object args unchanged", () => {
    const r = repair(call({ path: "a.ts" }));
    expect("ok" in r && r.ok.args).toEqual({ path: "a.ts" });
  });

  it("rejects missing tool name as unrepairable", () => {
    const r = repair({ id: "t1", name: "", args: {} });
    expect("unrepairable" in r).toBe(true);
  });
});

describe("parseJsonLenient — A3 JSON recovery", () => {
  it("parses strict JSON unchanged", () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLenient("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("strips trailing commas (object + array)", () => {
    expect(parseJsonLenient('{"a":1,}')).toEqual({ a: 1 });
    expect(parseJsonLenient('[1,2,]')).toEqual([1, 2]);
    expect(parseJsonLenient('{"a":{"b":2,},}')).toEqual({ a: { b: 2 } });
  });

  it("balances unclosed delimiters", () => {
    expect(parseJsonLenient('{"a":1')).toEqual({ a: 1 });
    expect(parseJsonLenient("[1,2")).toEqual([1, 2]);
    expect(parseJsonLenient('{"a":{"b":2}')).toEqual({ a: { b: 2 } });
  });

  it("balances an unclosed string", () => {
    expect(parseJsonLenient('{"msg":"hello')).toEqual({ msg: "hello" });
  });

  it("handles trailing comma + unclosed delimiter together", () => {
    expect(parseJsonLenient('{"a":1,')).toEqual({ a: 1 });
    expect(parseJsonLenient('{"a":1,"b":[2,')).toEqual({ a: 1, b: [2] });
  });

  it("returns undefined for genuinely unrepairable input", () => {
    expect(parseJsonLenient("not json at all ::::")).toBeUndefined();
    expect(parseJsonLenient("{key value}")).toBeUndefined(); // no recovery for missing colon/quotes
  });
});

describe("repair — A3 integration (malformed args recovered)", () => {
  it("repairs trailing-comma args", () => {
    const r = repair(call('{"path":"a.ts","content":"x",}'));
    expect("ok" in r && r.ok.args).toEqual({ path: "a.ts", content: "x" });
  });

  it("repairs truncated/unclosed args", () => {
    const r = repair(call('{"path":"a.ts","content":"hello'));
    expect("ok" in r).toBe(true);
    if (!("ok" in r)) return;
    expect((r.ok.args as { content: string }).content).toBe("hello");
  });

  it("still rejects truly broken args as unrepairable", () => {
    const r = repair(call(":::not json:::"));
    expect("unrepairable" in r).toBe(true);
  });
});
