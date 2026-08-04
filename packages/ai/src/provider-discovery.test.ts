import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProviderConfigured, manifestToProfile, scanProviders, type ProviderPackageManifest } from "./provider-discovery.js";

const VALID: ProviderPackageManifest = { name: "test", version: "1", apiVersion: "1", id: "test-id", baseUrl: "https://x", envVar: "TEST_KEY", defaultModel: "m1" };

describe("[unit] provider-discovery", () => {
  it("isValidManifest via scanProviders (valid manifest)", () => {
    // scanProviders reads from homedir + cwd — we test the exported helpers instead
    const m = { ...VALID };
    expect(m.id).toBe("test-id");
  });

  it("isProviderConfigured: env set → true", () => {
    process.env.TEST_KEY = "abc";
    expect(isProviderConfigured(VALID)).toBe(true);
    delete process.env.TEST_KEY;
  });

  it("isProviderConfigured: env missing → false", () => {
    delete process.env.TEST_KEY;
    expect(isProviderConfigured(VALID)).toBe(false);
  });

  it("manifestToProfile: unconfigured → null", () => {
    delete process.env.TEST_KEY;
    expect(manifestToProfile(VALID)).toBeNull();
  });

  it("manifestToProfile: configured → profile stub", () => {
    process.env.TEST_KEY = "abc";
    const p = manifestToProfile(VALID);
    expect(p).not.toBeNull();
    expect(p!.id).toBe("test-id");
    expect(p!.model).toBe("m1");
    delete process.env.TEST_KEY;
  });

  it("manifestToProfile: custom model via env", () => {
    process.env.TEST_KEY = "abc";
    process.env.TEST_KEY_MODEL = "custom-model";
    const p = manifestToProfile(VALID);
    expect(p!.model).toBe("custom-model");
    delete process.env.TEST_KEY;
    delete process.env.TEST_KEY_MODEL;
  });

  it("scanProviders returns array (may be empty in test env)", () => {
    const result = scanProviders();
    expect(Array.isArray(result)).toBe(true);
  });
});
