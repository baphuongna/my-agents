import { describe, it, expect } from "vitest";
import { MODEL_REGISTRY } from "./model-manager.js";

describe("[unit] tts model-manager registry", () => {
  it("MODEL_REGISTRY is non-empty + frozen", () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
    expect(Object.isFrozen(MODEL_REGISTRY)).toBe(true);
  });

  it("each entry has required fields", () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.id).toBeTypeOf("string");
      expect(m.name).toBeTypeOf("string");
      expect(m.repo).toBeTypeOf("string");
      expect(m.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("entries have unique ids", () => {
    const ids = MODEL_REGISTRY.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("known models: barkan + kokoro", () => {
    const ids = MODEL_REGISTRY.map(m => m.id);
    expect(ids).toContain("barkan-mlx");
    expect(ids).toContain("kokoro-mlx");
  });
});
