/**
 * Tests for model-routing: phase routing (exact/regex/default) and tier
 * routing (ranking, degradation, load/save round-trip).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveModelForPhase,
  buildDefaultTierConfig,
  resolveTierModel,
  loadModelTierConfig,
  saveModelTierConfig,
  sortedTierNames,
} from "./model-routing.js";

describe("resolveModelForPhase", () => {
  it("returns the model for an exact phase match", () => {
    const config = {
      defaultModel: "default-model",
      routes: [{ phasePattern: "analyze", model: "analyze-model" }],
    };
    expect(resolveModelForPhase("analyze", config)).toBe("analyze-model");
  });

  it("returns the model for a regex phase match", () => {
    const config = {
      defaultModel: "default-model",
      routes: [{ phasePattern: "analyze.*", model: "regex-model", useRegex: true }],
    };
    expect(resolveModelForPhase("analyze-deep", config)).toBe("regex-model");
  });

  it("falls back to defaultModel when no route matches", () => {
    const config = {
      defaultModel: "fallback",
      routes: [{ phasePattern: "analyze", model: "analyze-model" }],
    };
    expect(resolveModelForPhase("unknown-phase", config)).toBe("fallback");
  });

  it("returns undefined when no route matches and no default", () => {
    const config = { routes: [{ phasePattern: "analyze", model: "analyze-model" }] };
    expect(resolveModelForPhase("unknown", config)).toBeUndefined();
  });
});

describe("buildDefaultTierConfig", () => {
  it("assigns mini/flash to small, opus/pro to big with 3+ models", () => {
    const config = buildDefaultTierConfig([
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/o3-pro",
    ]);
    expect(config.tiers.small).toBe("openai/gpt-4.1-mini");
    expect(config.tiers.big).toBe("openai/o3-pro");
    // medium is the neutral model (middle of the ranking)
    expect(config.tiers.medium).toBe("openai/gpt-4.1");
  });

  it("degrades gracefully with 2 models (weaker→small, stronger→medium+big)", () => {
    const config = buildDefaultTierConfig(["gpt-4.1", "gpt-4.1-mini"]);
    expect(config.tiers.small).toBe("gpt-4.1-mini");
    expect(config.tiers.medium).toBe("gpt-4.1");
    expect(config.tiers.big).toBe("gpt-4.1");
  });

  it("falls back to currentModelSpec when no models available", () => {
    const config = buildDefaultTierConfig([], "my-current-model");
    expect(config.tiers.small).toBe("my-current-model");
    expect(config.tiers.medium).toBe("my-current-model");
    expect(config.tiers.big).toBe("my-current-model");
  });
});

describe("resolveTierModel + sortedTierNames", () => {
  it("resolves configured tiers and returns undefined for unknown", () => {
    const config = { tiers: { small: "mini-model", big: "big-model" } };
    expect(resolveTierModel("small", config)).toBe("mini-model");
    expect(resolveTierModel("big", config)).toBe("big-model");
    expect(resolveTierModel("medium", config)).toBeUndefined();
  });

  it("sorts tier names: small < medium < big", () => {
    const config = { tiers: { big: "b", small: "s", medium: "m" } };
    expect(sortedTierNames(config)).toEqual(["small", "medium", "big"]);
  });
});

describe("loadModelTierConfig / saveModelTierConfig", () => {
  it("round-trips a tier config through disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "mya-model-tiers-"));
    const configPath = join(dir, "model-tiers.json");
    try {
      const original = { tiers: { small: "mini", medium: "standard", big: "opus" } };
      saveModelTierConfig(original, configPath);
      const loaded = loadModelTierConfig(configPath);
      expect(loaded).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "mya-model-tiers-"));
    try {
      expect(loadModelTierConfig(join(dir, "nonexistent.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the JSON is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "mya-model-tiers-"));
    const configPath = join(dir, "model-tiers.json");
    try {
      writeFileSync(configPath, "not json {{{", "utf-8");
      expect(loadModelTierConfig(configPath)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates parent directories when saving", () => {
    const dir = mkdtempSync(join(tmpdir(), "mya-model-tiers-"));
    const nestedDir = join(dir, "nested", "deep");
    const configPath = join(nestedDir, "model-tiers.json");
    try {
      saveModelTierConfig({ tiers: { small: "mini" } }, configPath);
      expect(loadModelTierConfig(configPath)).toEqual({ tiers: { small: "mini" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
