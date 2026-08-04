import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getProviderRegistry, detectProviderSummary, type ProviderEntry, type ProviderSummary } from "./provider-registry.js";

describe("[unit] provider-registry", () => {
  it("getProviderRegistry returns non-empty list", () => {
    const entries = getProviderRegistry();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("each entry has required fields", () => {
    for (const e of getProviderRegistry()) {
      expect(e.id).toBeTypeOf("string");
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.name).toBeTypeOf("string");
      expect(e.model).toBeTypeOf("string");
      expect(Array.isArray(e.allEnvKeys)).toBe(true);
      expect(e.hasOAuth).toBeTypeOf("boolean");
    }
  });

  it("entries are unique by id", () => {
    const ids = getProviderRegistry().map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("entries have envKey (primary API key) when allEnvKeys non-empty", () => {
    for (const e of getProviderRegistry()) {
      if (e.allEnvKeys.length > 0) {
        expect(e.envKey).toBeTypeOf("string");
        // envKey should be one of allEnvKeys
        expect(e.allEnvKeys).toContain(e.envKey);
      }
    }
  });

  it("detectProviderSummary adds configured boolean", () => {
    const summaries = detectProviderSummary();
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(typeof s.configured).toBe("boolean");
    }
  });

  it("detectProviderSummary: setting env var marks provider configured", () => {
    const entries = getProviderRegistry();
    // Find a provider with envKeys and set one
    const target = entries.find(e => e.allEnvKeys.length > 0);
    if (!target) return; // skip if none
    const key = target.allEnvKeys[0]!;
    const before = detectProviderSummary().find(s => s.id === target.id);
    expect(before?.configured).toBe(false);

    process.env[key] = "test-key-12345";
    try {
      const after = detectProviderSummary().find(s => s.id === target.id);
      expect(after?.configured).toBe(true);
    } finally {
      delete process.env[key];
    }
  });

  it("getProviderRegistry is cached (same ref on second call)", () => {
    const a = getProviderRegistry();
    const b = getProviderRegistry();
    expect(a).toBe(b);
  });
});
