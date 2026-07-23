/**
 * §23 Provider Discovery — boot-time provider manifest discovery.
 *
 * provider-discovery scans two locations for declarative manifests:
 *   1. the user dir  ~/.mya/providers (any .json file)        (user-provided)
 *   2. node_modules/@mya/provider-X manifest.json             (pre-installed)
 *
 * Neither exists in this sandbox, so we exercise the real code path by writing
 * manifest files into ~/.mya/providers/ with a unique prefix and removing them
 * in afterEach (the agent's own data dir; no collateral). Env-var state is also
 * saved/restored per test so isProviderConfigured / getConfiguredProviders are
 * deterministic.
 *
 * Source: packages/ai/src/provider-discovery.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  scanProviders,
  isProviderConfigured,
  manifestToProfile,
  getConfiguredProviders,
} from "../../../packages/ai/src/provider-discovery.ts";
import type { ProviderPackageManifest } from "../../../packages/ai/src/provider-discovery.ts";

const PROVIDERS_DIR = join(homedir(), ".mya", "providers");
const PREFIX = "_vitest_pd_"; // unique filename prefix; cleaned up after each test

/** Track env mutations to restore them precisely. */
const envStack: Array<[string, string | undefined]> = [];
function setEnv(key: string, value: string): void {
  envStack.push([key, process.env[key]]);
  process.env[key] = value;
}
function clearEnv(key: string): void {
  envStack.push([key, process.env[key]]);
  delete process.env[key];
}

/** Write a manifest (or raw string) into ~/.mya/providers/ under the test prefix. */
function writeManifest(tag: string, content: unknown): string {
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  const p = join(PROVIDERS_DIR, `${PREFIX}${tag}.json`);
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
  return p;
}

/** Only manifests whose id begins with this marker are ours. */
function myProviders(): ProviderPackageManifest[] {
  return scanProviders().filter((m) => m.id.startsWith("vitest-"));
}

/** Build a valid manifest with sensible defaults. */
function manifest(
  over: Partial<ProviderPackageManifest> & { id: string; envVar: string },
): ProviderPackageManifest {
  return {
    name: over.name ?? `vitest-${over.id}`,
    version: "1.0.0",
    apiVersion: "1",
    baseUrl: "https://api.example.com/v1",
    defaultModel: "default-model",
    ...over,
  };
}

afterEach(() => {
  // restore env
  while (envStack.length) {
    const [k, v] = envStack.pop()!;
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // remove only our prefixed manifest files
  if (existsSync(PROVIDERS_DIR)) {
    for (const f of readdirSync(PROVIDERS_DIR)) {
      if (f.startsWith(PREFIX)) rmSync(join(PROVIDERS_DIR, f), { force: true });
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// scanProviders — discovery + manifest validation
// ───────────────────────────────────────────────────────────────────────────
describe("[§23] scanProviders — discovery + validation", () => {
  it("returns an array of discovered providers", () => {
    const out = scanProviders();
    expect(Array.isArray(out)).toBe(true);
  });

  it("discovers a valid manifest from ~/.mya/providers/*.json", () => {
    writeManifest("alpha", manifest({ id: "vitest-alpha", envVar: "VITEST_PD_ALPHA_KEY" }));
    const ids = myProviders().map((m) => m.id);
    expect(ids).toContain("vitest-alpha");
  });

  it("skips a corrupt JSON file without throwing (returns valid manifests only)", () => {
    writeManifest("alpha", manifest({ id: "vitest-alpha", envVar: "VITEST_PD_ALPHA_KEY" }));
    writeManifest("corrupt", "{ this is :: not valid json,,,");
    const ids = myProviders().map((m) => m.id);
    expect(ids).toEqual(["vitest-alpha"]);
  });

  it("skips an invalid manifest missing a required field (unknown provider handling)", () => {
    writeManifest("alpha", manifest({ id: "vitest-alpha", envVar: "VITEST_PD_ALPHA_KEY" }));
    // missing envVar → rejected by isValidManifest
    writeManifest("noenv", { name: "x", id: "vitest-noenv", baseUrl: "https://x" });
    const ids = myProviders().map((m) => m.id);
    expect(ids).toEqual(["vitest-alpha"]);
    expect(ids).not.toContain("vitest-noenv");
  });

  it("returns multiple discovered manifests", () => {
    writeManifest("alpha", manifest({ id: "vitest-alpha", envVar: "VITEST_PD_ALPHA_KEY" }));
    writeManifest("beta", manifest({ id: "vitest-beta", envVar: "VITEST_PD_BETA_KEY" }));
    const ids = myProviders().map((m) => m.id).sort();
    expect(ids).toEqual(["vitest-alpha", "vitest-beta"]);
  });

  it("is deterministic: two scans return an identical sequence (stable provider ordering)", () => {
    writeManifest("alpha", manifest({ id: "vitest-alpha", envVar: "VITEST_PD_ALPHA_KEY" }));
    writeManifest("beta", manifest({ id: "vitest-beta", envVar: "VITEST_PD_BETA_KEY" }));
    const first = myProviders().map((m) => m.id);
    const second = myProviders().map((m) => m.id);
    expect(second).toEqual(first);
  });

  it("duplicate provider ids across files are both enumerated (no crash)", () => {
    writeManifest("dup1", manifest({ id: "vitest-dup", envVar: "VITEST_PD_DUP_KEY" }));
    writeManifest("dup2", manifest({ id: "vitest-dup", envVar: "VITEST_PD_DUP_KEY" }));
    const dups = myProviders().filter((m) => m.id === "vitest-dup");
    expect(dups.length).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// isProviderConfigured + manifestToProfile
// ───────────────────────────────────────────────────────────────────────────
describe("[§23] isProviderConfigured + manifestToProfile", () => {
  it("isProviderConfigured() returns false when the env var is unset", () => {
    clearEnv("VITEST_PD_CFG_KEY");
    const m = manifest({ id: "vitest-cfg", envVar: "VITEST_PD_CFG_KEY" });
    expect(isProviderConfigured(m)).toBe(false);
  });

  it("isProviderConfigured() returns true when the env var is set", () => {
    setEnv("VITEST_PD_CFG_KEY", "sk-test");
    const m = manifest({ id: "vitest-cfg", envVar: "VITEST_PD_CFG_KEY" });
    expect(isProviderConfigured(m)).toBe(true);
  });

  it("manifestToProfile() returns null when the provider is not configured", () => {
    clearEnv("VITEST_PD_CFG_KEY");
    const m = manifest({ id: "vitest-cfg", envVar: "VITEST_PD_CFG_KEY" });
    expect(manifestToProfile(m)).toBeNull();
  });

  it("manifestToProfile() returns a profile using defaultModel when configured", () => {
    setEnv("VITEST_PD_CFG_KEY", "sk-test");
    const m = manifest({
      id: "vitest-cfg",
      envVar: "VITEST_PD_CFG_KEY",
      defaultModel: "gpt-default",
    });
    const profile = manifestToProfile(m);
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe("vitest-cfg");
    expect(profile!.model).toBe("gpt-default");
    expect(typeof profile!.health).toBe("function");
  });

  it("manifestToProfile() honours the ${envVar}_MODEL override over defaultModel", () => {
    setEnv("VITEST_PD_CFG_KEY", "sk-test");
    setEnv("VITEST_PD_CFG_KEY_MODEL", "override-model");
    const m = manifest({
      id: "vitest-cfg",
      envVar: "VITEST_PD_CFG_KEY",
      defaultModel: "gpt-default",
    });
    expect(manifestToProfile(m)!.model).toBe("override-model");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getConfiguredProviders — end-to-end configured list
// ───────────────────────────────────────────────────────────────────────────
describe("[§23] getConfiguredProviders", () => {
  it("returns [] when nothing is configured", () => {
    // No manifests in node_modules/@mya and (after afterEach) none in ~/.mya;
    // with no env set, getConfiguredProviders must be empty.
    clearEnv("VITEST_PD_E2E_KEY");
    expect(getConfiguredProviders()).toEqual([]);
  });

  it("returns a profile for a discovered + configured manifest", () => {
    writeManifest("e2e", manifest({ id: "vitest-e2e", envVar: "VITEST_PD_E2E_KEY" }));
    setEnv("VITEST_PD_E2E_KEY", "sk-test");
    const profiles = getConfiguredProviders().filter((p) => p.id.startsWith("vitest-"));
    expect(profiles.map((p) => p.id)).toContain("vitest-e2e");
  });
});
