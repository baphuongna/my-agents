import { describe, it, expect } from "vitest";

describe("[smoke] package barrels", () => {
  it("agent/sdk Agent class", async () => {
    const { Agent } = await import("./sdk.js");
    expect(Agent).toBeTypeOf("function");
  });

  it("agent/index barrel", async () => {
    const mod = await import("./index.js");
    expect(mod.createAgent).toBeTypeOf("function");
  });
});
