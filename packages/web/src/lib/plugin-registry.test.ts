// [unit] plugin-registry page registration functions
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPluginPage,
  getPluginPage,
  registeredPageNames,
  totalPluginPages,
  clearPluginPages,
  subscribePages,
} from "@/lib/plugin-registry";

const Stub = () => null;

describe("[unit] plugin-registry page registration", () => {
  beforeEach(() => {
    clearPluginPages();
  });

  it("registerPluginPage stores the component", () => {
    expect(getPluginPage("alpha")).toBeUndefined();
    registerPluginPage("alpha", Stub);
    expect(getPluginPage("alpha")).toBe(Stub);
  });

  it("registerPluginPage is idempotent — re-registration replaces", () => {
    const A = () => null;
    const B = () => null;
    registerPluginPage("dup", A);
    registerPluginPage("dup", B);
    expect(getPluginPage("dup")).toBe(B);
  });

  it("returned unsubscribe removes only the matching component", () => {
    const unregister = registerPluginPage("only", Stub);
    expect(getPluginPage("only")).toBe(Stub);
    unregister();
    expect(getPluginPage("only")).toBeUndefined();
  });

  it("unsubscribe is idempotent (double-call safe)", () => {
    const unregister = registerPluginPage("safe", Stub);
    unregister();
    expect(() => unregister()).not.toThrow();
    expect(getPluginPage("safe")).toBeUndefined();
  });

  it("registeredPageNames returns all current page names", () => {
    registerPluginPage("x", Stub);
    registerPluginPage("y", Stub);
    expect(registeredPageNames().sort()).toEqual(["x", "y"]);
  });

  it("totalPluginPages reflects current count", () => {
    expect(totalPluginPages()).toBe(0);
    registerPluginPage("a", Stub);
    registerPluginPage("b", Stub);
    expect(totalPluginPages()).toBe(2);
  });

  it("subscribePages fires on registration and unsubscribe", () => {
    const calls: string[] = [];
    const unsub = subscribePages(() => calls.push("notify"));
    registerPluginPage("watched", Stub);
    expect(calls).toEqual(["notify"]);
    clearPluginPages();
    expect(calls).toEqual(["notify", "notify"]);
    unsub();
    registerPluginPage("after-unsub", Stub);
    expect(calls).toEqual(["notify", "notify"]); // no third call
  });
});
