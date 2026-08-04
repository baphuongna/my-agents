import { describe, it, expect } from "vitest";

describe("[smoke] gateway-types", () => {
  it("types module loads without error", async () => {
    const mod = await import("./gateway-types.js");
    expect(mod).toBeDefined();
  });
});

describe("[smoke] gateway index (Gateway class)", () => {
  it("Gateway class is constructable", async () => {
    const { Gateway } = await import("./index.js");
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    expect(gw).toBeDefined();
    expect(typeof gw.cronSweep).toBe("function");
    expect(typeof gw.start).toBe("function");
  });
});
