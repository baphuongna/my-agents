import { describe, it, expect } from "vitest";

describe("[smoke] pi-intercom extension", () => {
  it("loads as an extension factory (default export is a function)", async () => {
    const mod = await import("@my-agent/intercom");
    expect(typeof mod.default).toBe("function");
  });

  it("factory does not throw when called with a mock ExtensionAPI", async () => {
    const { default: piIntercomFactory } = await import("@my-agent/intercom");
    // Proxy returns no-op functions for any property access — simulates full ExtensionAPI
    const mockPi = new Proxy({
      getSessionName: () => "test-session",
      events: { emit: () => {}, on: () => {} },
    }, {
      get(target, prop) {
        return target[prop] ?? ((...args: unknown[]) => {});
      },
    });
    // The factory should not throw during synchronous registration.
    // It may schedule async work (broker connect) that we don't await here.
    expect(() => piIntercomFactory(mockPi as never)).not.toThrow();
  });

  it("IntercomClient is exported for inter-agent messaging", async () => {
    const { IntercomClient } = await import("@my-agent/intercom");
    expect(typeof IntercomClient).toBe("function");
    expect(IntercomClient.name).toBe("IntercomClient");
  });

  it("module loads without error (all types resolve)", async () => {
    const mod = await import("@my-agent/intercom");
    expect(mod).toBeDefined();
  });
});
