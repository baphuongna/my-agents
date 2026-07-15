/**
 * key-rotation.test.ts — KeyState, pure helpers, config loader, and KeyRouter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  KeyState,
  KeyRouter,
  OVERLOADED_RE,
  RATE_LIMITED_RE,
  UNAUTHORIZED_RE,
  initKeyStates,
  pickNextKey,
  matchProvider,
  waitForNextKey,
  defaultConfig,
  configPath,
  loadConfig,
  resolveProviderName,
} from "./key-rotation.js";
import type { KeyRouterConfig } from "./key-rotation.js";

// ── KeyState ──

describe("KeyState", () => {
  it("initializes as untried and available", () => {
    const s = new KeyState({ name: "a", value: "k" });
    expect(s.name).toBe("a");
    expect(s.value).toBe("k");
    expect(s.lastStatus).toBe("untried");
    expect(s.cooldownUntil).toBe(0);
    expect(s.isAvailable(1000)).toBe(true);
  });

  it("isAvailable returns false during cooldown, true after expiry", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.markBad("rate-limited", 5000, 1000); // cooldown until 6000
    expect(s.isAvailable(1000)).toBe(false);
    expect(s.isAvailable(5999)).toBe(false);
    expect(s.isAvailable(6000)).toBe(true);
  });

  it("isAvailable returns false during overload window", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.markOverloaded(5000, 1000); // overloaded until 6000
    expect(s.isAvailable(1000)).toBe(false);
    expect(s.isAvailable(6000)).toBe(true);
  });

  it("markBad sets status, cooldown, and failure count", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.markBad("rate-limited", 5000, 1000);
    expect(s.lastStatus).toBe("rate-limited");
    expect(s.cooldownUntil).toBe(6000);
    expect(s.failures).toBe(1);
  });

  it("markBad unauthorized sets correct status", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.markBad("unauthorized", 10000, 0);
    expect(s.lastStatus).toBe("unauthorized");
  });

  it("markOverloaded does not bump failures or change status", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.recordUse();
    s.recordUse();
    s.markOk();
    s.markOverloaded(30000, 1000);
    expect(s.overloadedUntil).toBe(31000);
    expect(s.failures).toBe(0);
    expect(s.lastStatus).toBe("ok");
    expect(s.uses).toBe(2);
  });

  it("markOk clears cooldown and sets status", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.markBad("rate-limited", 5000, 1000);
    s.markOk();
    expect(s.lastStatus).toBe("ok");
    expect(s.cooldownUntil).toBe(0);
  });

  it("isOverloaded reflects the window", () => {
    const s = new KeyState({ name: "a", value: "k" });
    expect(s.isOverloaded(1000)).toBe(false);
    s.markOverloaded(5000, 1000); // until 6000
    expect(s.isOverloaded(1000)).toBe(true);
    expect(s.isOverloaded(5999)).toBe(true);
    expect(s.isOverloaded(6000)).toBe(false);
  });

  it("cooldown and overload are checked independently", () => {
    const s = new KeyState({ name: "a", value: "k" });
    s.markBad("rate-limited", 2000, 1000);  // cooldown until 3000
    s.markOverloaded(500, 1000);             // overload until 1500
    expect(s.isAvailable(1000)).toBe(false);  // both active
    expect(s.isAvailable(1500)).toBe(false);  // overload cleared, cooldown still active
    expect(s.isAvailable(3000)).toBe(true);   // both cleared
  });
});

// ── pickNextKey ──

describe("pickNextKey", () => {
  it("returns preferred when available", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    expect(pickNextKey(states, 0, 1000)).toBe(0);
    expect(pickNextKey(states, 1, 1000)).toBe(1);
  });

  it("rotates to next when preferred on cooldown", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    states[0]!.markBad("rate-limited", 5000, 1000);
    expect(pickNextKey(states, 0, 1000)).toBe(1);
  });

  it("picks soonest-expiring when all on cooldown", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    states[0]!.markBad("rate-limited", 5000, 1000); // until 6000
    states[1]!.markBad("rate-limited", 3000, 1000); // until 4000
    expect(pickNextKey(states, 0, 1000)).toBe(1); // b expires first
  });

  it("skips keys in overload window", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    states[0]!.markOverloaded(5000, 1000); // a overloaded until 6000
    expect(pickNextKey(states, 0, 1000)).toBe(1); // b is available
  });

  it("returns soonest-expiring overload when all overloaded", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    states[0]!.markOverloaded(5000, 1000); // until 6000
    states[1]!.markOverloaded(2000, 1000); // until 3000
    expect(pickNextKey(states, 0, 1000)).toBe(1); // b recovers first
  });

  it("returns -1 for empty list", () => {
    expect(pickNextKey([], 0, 0)).toBe(-1);
  });
});

// ── matchProvider ──

describe("matchProvider", () => {
  it("matches by URL substring (case-insensitive)", () => {
    const providers = [{ name: "z-ai", match: ["api.z.ai"] }];
    expect(matchProvider(providers, "https://api.z.ai/v1/chat")).toBeDefined();
    expect(matchProvider(providers, "https://API.Z.AI/v1/chat")).toBeDefined();
    expect(matchProvider(providers, "https://example.com")).toBeUndefined();
  });

  it("matches one of multiple substrings", () => {
    const providers = [{ name: "z-ai", match: ["api.z.ai", "z.ai"] }];
    expect(matchProvider(providers, "https://z.ai/x")).toBeDefined();
  });
});

// ── waitForNextKey ──

describe("waitForNextKey", () => {
  it("returns 0 when at least one key is available", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    states[0]!.markBad("rate-limited", 5000, 1000);
    expect(waitForNextKey(states, 1000)).toBe(0);
  });

  it("returns min cooldown when all on cooldown", () => {
    const states = initKeyStates([
      { name: "a", value: "k1" },
      { name: "b", value: "k2" },
    ]);
    states[0]!.markBad("rate-limited", 5000, 1000); // until 6000 → wait 5000
    states[1]!.markBad("rate-limited", 2000, 1000); // until 3000 → wait 2000
    expect(waitForNextKey(states, 1000)).toBe(2000);
  });
});

// ── Error regexes ──

describe("error regexes", () => {
  it("OVERLOADED_RE matches 529 and 'overloaded'", () => {
    expect(OVERLOADED_RE.test("Error 529: overloaded")).toBe(true);
    expect(OVERLOADED_RE.test("service overloaded")).toBe(true);
    expect(OVERLOADED_RE.test("Error 429")).toBe(false);
  });

  it("RATE_LIMITED_RE matches 429 and rate-limit text", () => {
    expect(RATE_LIMITED_RE.test("Error 429: Too Many Requests")).toBe(true);
    expect(RATE_LIMITED_RE.test("rate limit exceeded")).toBe(true);
    expect(RATE_LIMITED_RE.test("Error 401")).toBe(false);
  });

  it("UNAUTHORIZED_RE matches 401/403 and auth text", () => {
    expect(UNAUTHORIZED_RE.test("Error 401: Unauthorized")).toBe(true);
    expect(UNAUTHORIZED_RE.test("Error 403: Forbidden")).toBe(true);
    expect(UNAUTHORIZED_RE.test("Error 500")).toBe(false);
  });
});

// ── resolveProviderName ──

describe("resolveProviderName", () => {
  it("maps display names to canonical ids", () => {
    expect(resolveProviderName("z-ai")).toBe("zai");
    expect(resolveProviderName("z.ai")).toBe("zai");
    expect(resolveProviderName("open-router")).toBe("openrouter");
  });

  it("returns unmapped names as-is", () => {
    expect(resolveProviderName("custom-provider")).toBe("custom-provider");
  });
});

// ── Config ──

let tmp: string;

function fakeHome(): string {
  const h = path.join(tmp, "fake-home");
  fs.mkdirSync(path.join(h, ".mya"), { recursive: true });
  return h;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keyrotation-cfg-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("defaultConfig", () => {
  it("returns empty config with sensible defaults", () => {
    const cfg = defaultConfig();
    expect(cfg.providers).toEqual([]);
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.cooldownMs).toBe(60_000);
    expect(cfg.overloadedCooldownMs).toBe(30_000);
  });
});

describe("configPath", () => {
  it("points at ~/.mya/keyrouter.json (never project-scoped)", () => {
    const home = fakeHome();
    expect(configPath(undefined, home)).toBe(path.join(home, ".mya", "keyrouter.json"));
  });

  it("cwd argument is ignored — always user-level", () => {
    const home = fakeHome();
    expect(configPath("/some/project", home)).toBe(configPath("/", home));
  });
});

describe("loadConfig", () => {
  it("returns default when no config file found", () => {
    const cfg = loadConfig(undefined, fakeHome());
    expect(cfg.providers).toEqual([]);
    expect(cfg.maxRetries).toBe(3);
  });

  it("loads from ~/.mya/keyrouter.json", () => {
    const home = fakeHome();
    fs.writeFileSync(
      path.join(home, ".mya", "keyrouter.json"),
      JSON.stringify({
        providers: [
          {
            name: "z-ai",
            match: ["api.z.ai"],
            keys: [
              { name: "primary", value: "k1" },
              { name: "backup", value: "k2" },
            ],
          },
        ],
      }),
    );
    const cfg = loadConfig(undefined, home);
    expect(cfg.providers.length).toBe(1);
    expect(cfg.providers[0]?.name).toBe("z-ai");
    expect(cfg.providers[0]?.keys.length).toBe(2);
  });

  it("ignores malformed JSON, returns default", () => {
    const home = fakeHome();
    fs.writeFileSync(path.join(home, ".mya", "keyrouter.json"), "{ not valid json");
    const cfg = loadConfig(undefined, home);
    expect(cfg.providers).toEqual([]);
  });

  it("filters out invalid provider entries", () => {
    const home = fakeHome();
    fs.writeFileSync(
      path.join(home, ".mya", "keyrouter.json"),
      JSON.stringify({
        providers: [
          { name: "valid", match: ["x"], keys: [{ name: "a", value: "v" }] },
          { name: "missing-match" },
          { name: "missing-keys", match: ["x"] },
        ],
      }),
    );
    const cfg = loadConfig(undefined, home);
    expect(cfg.providers.length).toBe(1);
    expect(cfg.providers[0]?.name).toBe("valid");
  });

  it("NEVER reads from cwd — project-local keyrouter.json is ignored", () => {
    const home = fakeHome();
    const project = path.join(tmp, "project");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "keyrouter.json"),
      JSON.stringify({
        providers: [{ name: "evil", match: ["x"], keys: [{ name: "a", value: "stolen" }] }],
      }),
    );
    const cfg = loadConfig(project, home);
    expect(cfg.providers).toEqual([]);
  });
});

// ── KeyRouter ──

describe("KeyRouter", () => {
  const testConfig: KeyRouterConfig = {
    providers: [
      {
        name: "zai",
        match: ["api.z.ai"],
        keys: [
          { name: "primary", value: "key-1" },
          { name: "backup", value: "key-2" },
          { name: "tertiary", value: "key-3" },
        ],
      },
    ],
    maxRetries: 3,
    cooldownMs: 60_000,
    overloadedCooldownMs: 30_000,
  };

  it("activate bootstraps providers and currentKey returns first key", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    expect(router.hasProvider("zai")).toBe(true);
    expect(router.currentKey("zai")).toBe("key-1");
    expect(router.currentIndex("zai")).toBe(0);
  });

  it("handleError with 429 marks current bad and rotates", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    const next = router.handleError("zai", "Error 429: rate limit exceeded");
    expect(next).toBe("key-2");
    expect(router.currentKey("zai")).toBe("key-2");
    // First key should be on cooldown
    const states = router.keyStates("zai");
    expect(states[0]!.lastStatus).toBe("rate-limited");
    expect(states[0]!.failures).toBe(1);
  });

  it("handleError with 401 marks current bad and rotates", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    const next = router.handleError("zai", "Error 401: Unauthorized");
    expect(next).toBe("key-2");
    expect(states(router, "zai")[0]!.lastStatus).toBe("unauthorized");
  });

  it("handleError with 529 marks ALL keys overloaded without rotation", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    const result = router.handleError("zai", "Error 529: overloaded");
    expect(result).toBeUndefined();
    expect(router.currentKey("zai")).toBe("key-1"); // no rotation
    // All keys should have overload window
    for (const k of router.keyStates("zai")) {
      expect(k.overloadedUntil).toBeGreaterThan(0);
      expect(k.failures).toBe(0); // not counted as failure
    }
  });

  it("handleError on unmanaged provider returns undefined", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    expect(router.handleError("unknown", "Error 429")).toBeUndefined();
  });

  it("markOk clears cooldown on current key", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    router.handleError("zai", "Error 429"); // mark key-1 bad, rotate to key-2
    router.markOk("zai");
    expect(router.keyStates("zai")[1]!.lastStatus).toBe("ok");
    expect(router.keyStates("zai")[1]!.cooldownUntil).toBe(0);
  });

  it("reset clears all state", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    expect(router.hasProvider("zai")).toBe(true);
    router.reset();
    expect(router.hasProvider("zai")).toBe(false);
    expect(router.currentKey("zai")).toBeUndefined();
  });

  it("activate is idempotent — does not re-bootstrap existing providers", () => {
    const router = new KeyRouter(testConfig);
    router.activate();
    const idx1 = router.currentIndex("zai");
    router.handleError("zai", "Error 429"); // rotate to key-2
    router.activate(); // should NOT reset
    expect(router.currentIndex("zai")).toBe(1); // still on key-2
    expect(idx1).toBe(0);
  });
});

/** Helper to keep test lines short. */
function states(router: KeyRouter, provider: string): readonly KeyState[] {
  return router.keyStates(provider);
}
