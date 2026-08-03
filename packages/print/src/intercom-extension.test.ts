import { describe, it, expect } from "vitest";

describe("[smoke] pi-intercom extension", () => {
  it("loads as an extension factory (default export is a function)", async () => {
    const mod = await import("@my-agent/intercom");
    expect(typeof mod.default).toBe("function");
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
