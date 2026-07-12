/**
 * @my-agent/ai — provider registry + mock adapter tests (no real HTTP).
 */
import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "./registry.js";
import { textMock } from "./mock.js";

describe("ProviderRegistry", () => {
  it("register + all", () => {
    const reg = new ProviderRegistry();
    const mock = textMock("hello from mock", "mock-test");
    reg.register(mock);
    expect(reg.all().length).toBe(1);
    expect(reg.all()[0]!.id).toContain("mock");
  });

  it("register throws on duplicate", () => {
    const reg = new ProviderRegistry();
    reg.register(textMock("a", "dup-id"));
    expect(() => reg.register(textMock("b", "dup-id"))).toThrow(/already registered/);
  });
});

describe("textMock provider", () => {
  it("has correct id and model", () => {
    const mock = textMock("response", "custom-model");
    expect(mock.model).toBe("custom-model");
    expect(mock.id).toContain("mock");
  });

  it("health returns Healthy", () => {
    const mock = textMock("response", "mock-id");
    expect(mock.health()).toBe("Healthy");
  });

  it("stream returns events", async () => {
    const mock = textMock("hello world", "mock-id");
    const result = await mock.stream({ stable: "", context: "", volatile: "" }, { append: () => {}, entries: () => [] } as never);
    expect(result.events.length).toBeGreaterThan(0);
  });
});
