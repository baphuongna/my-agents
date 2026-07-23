import { describe, it, expect } from "vitest";
import { cancelAny } from "@my-agent/core";

describe("cancelAny — unified cancel protocol (§4 R31)", () => {
  it("returns a fresh, non-aborted signal for an empty list", () => {
    const sig = cancelAny([]);
    expect(sig.aborted).toBe(false);
  });

  it("filters out undefined signals and returns a non-aborted signal", () => {
    const sig = cancelAny([undefined, undefined]);
    expect(sig.aborted).toBe(false);
  });

  it("a single already-aborted source makes the combined signal aborted", () => {
    const ctrl = new AbortController();
    ctrl.abort("timeout");
    const sig = cancelAny([ctrl.signal]);
    expect(sig.aborted).toBe(true);
  });

  it("a single live source keeps the combined signal live until aborted", () => {
    const ctrl = new AbortController();
    const sig = cancelAny([ctrl.signal]);
    expect(sig.aborted).toBe(false);
    ctrl.abort("user");
    expect(sig.aborted).toBe(true);
  });

  it("aborts on the FIRST of several sources to abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const c = new AbortController();
    const sig = cancelAny([a.signal, b.signal, c.signal]);
    expect(sig.aborted).toBe(false);
    b.abort("upstream");
    expect(sig.aborted).toBe(true);
  });

  it("stays live while none of the sources abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const sig = cancelAny([a.signal, b.signal]);
    expect(sig.aborted).toBe(false);
    expect(sig.aborted).toBe(false);
  });

  it("mixes undefined and live sources; undefined are ignored", () => {
    const a = new AbortController();
    const sig = cancelAny([undefined, a.signal, undefined]);
    expect(sig.aborted).toBe(false);
    a.abort();
    expect(sig.aborted).toBe(true);
  });

  it("propagates the source abort reason", () => {
    const ctrl = new AbortController();
    const sig = cancelAny([ctrl.signal]);
    ctrl.abort("shutdown");
    expect(sig.reason).toBe("shutdown");
  });

  it("does not abort the source signals when combined is consumed", () => {
    const a = new AbortController();
    const b = new AbortController();
    cancelAny([a.signal, b.signal]);
    expect(a.signal.aborted).toBe(false);
    expect(b.signal.aborted).toBe(false);
  });
});
