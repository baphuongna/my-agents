/**
 * backend-resolver.test.ts — tests for Chain B resolution.
 *
 * Tests:
 *   - Chain ordering (search: tavily > exa > ... > ddgs; extract: firecrawl > tavily > ...)
 *   - Override (per-capability config)
 *   - Capability discrimination (search-only backend configured for extract → typed error)
 *   - All-unavailable → error / fallback
 *
 * Since the real backends use env-var probes, we manipulate env vars in tests
 * to control availability. We also test the chain ordering by inspecting
 * `_searchChain` / `_extractChain`.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  resolveSearchBackend,
  resolveExtractBackend,
  _searchChain,
  _extractChain,
  _allBackends,
  type ResolutionResult,
  type CapabilityMismatchError,
  type UnresolvedBackend,
} from "./backend-resolver.js";

// ── Env var names for each backend ─────────────────────────────────────────

const ENV_VARS: Record<string, string[]> = {
  tavily: ["TAVILY_API_KEY"],
  exa: ["EXA_API_KEY"],
  parallel: ["PARALLEL_API_KEY"],
  firecrawl: ["FIRECRAWL_API_KEY", "FIRECRAWL_GATEWAY_URL", "FIRECRAWL_API_URL"],
  searxng: ["SEARXNG_URL"],
  brave: ["BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY"],
  ddgs: [], // always available
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Save original env values so we can restore them. */
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(keys: string[]): void {
  for (const k of keys) {
    savedEnv[k] = process.env[k];
  }
}

function restoreEnv(keys: string[]): void {
  for (const k of keys) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
}

/** Clear all env vars for a set of backends (makes them unavailable). */
function clearBackends(names: string[]): void {
  for (const name of names) {
    for (const v of ENV_VARS[name] ?? []) {
      delete process.env[v];
    }
  }
}

/** Set env vars to make a backend available. */
function enableBackend(name: string): void {
  for (const v of ENV_VARS[name] ?? []) {
    process.env[v] = "test-key";
  }
}

/** Clear ALL backend env vars. */
function clearAllBackends(): void {
  for (const name of Object.keys(ENV_VARS)) {
    clearBackends([name]);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("backend-resolver", () => {
  const ALL_NAMES = Object.keys(ENV_VARS);

  beforeEach(() => {
    saveEnv(Object.values(ENV_VARS).flat());
    clearAllBackends();
  });

  afterEach(() => {
    restoreEnv(Object.values(ENV_VARS).flat());
  });

  // ── Chain ordering ─────────────────────────────────────────────────────────

  describe("chain ordering", () => {
    it("search chain order: tavily > exa > parallel > firecrawl > searxng > brave > ddgs", () => {
      expect(_searchChain.map((p) => p.name)).toEqual([
        "tavily",
        "exa",
        "parallel",
        "firecrawl",
        "searxng",
        "brave",
        "ddgs",
      ]);
    });

    it("extract chain order: firecrawl > tavily > exa > parallel", () => {
      expect(_extractChain.map((p) => p.name)).toEqual([
        "firecrawl",
        "tavily",
        "exa",
        "parallel",
      ]);
    });

    it("extract chain excludes search-only backends", () => {
      for (const p of _extractChain) {
        expect(p.supportsExtract).toBe(true);
      }
    });

    it("search chain includes ddgs as the zero-key floor", () => {
      expect(_searchChain[_searchChain.length - 1]?.name).toBe("ddgs");
    });

    it("all 7 backends are in the all-backends map", () => {
      expect(_allBackends.size).toBe(7);
      for (const name of ["tavily", "exa", "parallel", "firecrawl", "searxng", "brave", "ddgs"]) {
        expect(_allBackends.get(name)).toBeDefined();
      }
    });
  });

  // ── Search resolution ───────────────────────────────────────────────────────

  describe("resolveSearchBackend", () => {
    it("returns ddgs when no paid backends are available (zero-key floor)", () => {
      clearAllBackends();
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("ddgs");
      }
    });

    it("returns tavily when tavily is available (highest priority)", () => {
      enableBackend("tavily");
      enableBackend("exa");
      enableBackend("parallel");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("tavily");
      }
    });

    it("returns exa when tavily is unavailable but exa is available", () => {
      enableBackend("exa");
      enableBackend("parallel");
      enableBackend("firecrawl");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("exa");
      }
    });

    it("returns parallel when tavily+exa unavailable but parallel is available", () => {
      enableBackend("parallel");
      enableBackend("firecrawl");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("parallel");
      }
    });

    it("returns firecrawl when tavily+exa+parallel unavailable but firecrawl available", () => {
      enableBackend("firecrawl");
      enableBackend("searxng");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("firecrawl");
      }
    });

    it("returns searxng when firecrawl unavailable but searxng available", () => {
      enableBackend("searxng");
      enableBackend("brave");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("searxng");
      }
    });

    it("returns brave when searxng unavailable but brave available", () => {
      enableBackend("brave");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("brave");
      }
    });

    it("skips unavailable backends and picks the next available", () => {
      enableBackend("parallel");
      // tavily, exa not available; parallel is 3rd in chain
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("parallel");
      }
    });

    it("never returns an unavailable backend", () => {
      enableBackend("exa");
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).not.toBe("tavily"); // tavily is higher but unavailable
        expect(result.backend.name).toBe("exa");
      }
    });
  });

  // ── Search override ─────────────────────────────────────────────────────────

  describe("resolveSearchBackend override", () => {
    it("returns the configured backend when available", () => {
      enableBackend("searxng");
      const result = resolveSearchBackend({ searchBackend: "searxng" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("searxng");
      }
    });

    it("returns error for unknown backend name", () => {
      const result = resolveSearchBackend({ searchBackend: "nonexistent" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("not a known backend");
      }
    });

    it("returns error when configured backend is not available", () => {
      clearAllBackends();
      // ddgs is always available, so use a paid one
      const result = resolveSearchBackend({ searchBackend: "tavily" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("not available");
      }
    });

    it("override skips the chain entirely", () => {
      enableBackend("tavily");
      enableBackend("searxng");
      // Even though tavily is higher priority, override forces searxng
      const result = resolveSearchBackend({ searchBackend: "searxng" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("searxng");
      }
    });
  });

  // ── Extract resolution ─────────────────────────────────────────────────────

  describe("resolveExtractBackend", () => {
    it("signals fallback to web_fetch when no extract backend is available", () => {
      clearAllBackends();
      const result = resolveExtractBackend();
      expect(result.ok).toBe(false);
      if (!result.ok && !("configuredBackend" in result)) {
        const unresolved = result as UnresolvedBackend;
        expect(unresolved.fallbackToWebFetch).toBe(true);
        expect(unresolved.reason).toContain("web_fetch");
      }
    });

    it("returns firecrawl when firecrawl is available (highest extract priority)", () => {
      enableBackend("firecrawl");
      enableBackend("tavily");
      enableBackend("exa");
      const result = resolveExtractBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("firecrawl");
      }
    });

    it("returns tavily when firecrawl unavailable but tavily available", () => {
      enableBackend("tavily");
      enableBackend("exa");
      const result = resolveExtractBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("tavily");
      }
    });

    it("returns exa when firecrawl+tavily unavailable but exa available", () => {
      enableBackend("exa");
      const result = resolveExtractBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("exa");
      }
    });

    it("returns parallel when firecrawl+tavily+exa unavailable but parallel available", () => {
      enableBackend("parallel");
      const result = resolveExtractBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("parallel");
      }
    });

    it("never returns search-only backends (searxng, brave, ddgs)", () => {
      enableBackend("searxng");
      enableBackend("brave");
      // ddgs is always available but search-only
      const result = resolveExtractBackend();
      expect(result.ok).toBe(false);
      if (!result.ok && !("configuredBackend" in result)) {
        const unresolved = result as UnresolvedBackend;
        expect(unresolved.fallbackToWebFetch).toBe(true);
      }
    });
  });

  // ── Extract override ──────────────────────────────────────────────────────────

  describe("resolveExtractBackend override", () => {
    it("returns the configured extract backend when available", () => {
      enableBackend("tavily");
      const result = resolveExtractBackend({ extractBackend: "tavily" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("tavily");
      }
    });

    it("returns typed CapabilityMismatchError when search-only backend is configured for extract", () => {
      const result = resolveExtractBackend({ extractBackend: "searxng" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect("configuredBackend" in result).toBe(true);
        if ("configuredBackend" in result) {
          const mismatch = result as CapabilityMismatchError;
          expect(mismatch.configuredBackend).toBe("searxng");
          expect(mismatch.requestedCapability).toBe("extract");
        }
      }
    });

    it("typed error for brave configured for extract (search-only)", () => {
      const result = resolveExtractBackend({ extractBackend: "brave" });
      expect(result.ok).toBe(false);
      if (!result.ok && "configuredBackend" in result) {
        const mismatch = result as CapabilityMismatchError;
        expect(mismatch.configuredBackend).toBe("brave");
      }
    });

    it("typed error for ddgs configured for extract (search-only)", () => {
      const result = resolveExtractBackend({ extractBackend: "ddgs" });
      expect(result.ok).toBe(false);
      if (!result.ok && "configuredBackend" in result) {
        const mismatch = result as CapabilityMismatchError;
        expect(mismatch.configuredBackend).toBe("ddgs");
      }
    });

    it("returns error for unknown extract backend name", () => {
      const result = resolveExtractBackend({ extractBackend: "nonexistent" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("not a known backend");
      }
    });

    it("returns error when configured extract backend is not available", () => {
      clearAllBackends();
      const result = resolveExtractBackend({ extractBackend: "tavily" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("not available");
      }
    });

    it("override does NOT silently fall back to web_fetch when configured backend is search-only", () => {
      const result = resolveExtractBackend({ extractBackend: "brave" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result as UnresolvedBackend).fallbackToWebFetch).toBeUndefined();
        expect("configuredBackend" in result).toBe(true);
      }
    });
  });

  // ── Capability discrimination ──────────────────────────────────────────────

  describe("capability discrimination", () => {
    it("search-only backends have supportsExtract=false", () => {
      expect(_allBackends.get("searxng")?.supportsExtract).toBe(false);
      expect(_allBackends.get("brave")?.supportsExtract).toBe(false);
      expect(_allBackends.get("ddgs")?.supportsExtract).toBe(false);
    });

    it("extract-capable backends have supportsExtract=true", () => {
      expect(_allBackends.get("tavily")?.supportsExtract).toBe(true);
      expect(_allBackends.get("exa")?.supportsExtract).toBe(true);
      expect(_allBackends.get("parallel")?.supportsExtract).toBe(true);
      expect(_allBackends.get("firecrawl")?.supportsExtract).toBe(true);
    });

    it("all backends have supportsSearch=true", () => {
      for (const name of ALL_NAMES) {
        expect(_allBackends.get(name)?.supportsSearch).toBe(true);
      }
    });

    it("resolveExtractBackend never returns a search-only backend from the chain", () => {
      // Enable everything
      for (const name of ALL_NAMES) {
        enableBackend(name);
      }
      const result = resolveExtractBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.supportsExtract).toBe(true);
        expect(["firecrawl", "tavily", "exa", "parallel"]).toContain(
          result.backend.name,
        );
      }
    });
  });

  // ── All-unavailable scenarios ──────────────────────────────────────────────

  describe("all-unavailable", () => {
    it("search always resolves via ddgs (zero-key floor)", () => {
      clearAllBackends();
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backend.name).toBe("ddgs");
      }
    });

    it("extract signals fallback to web_fetch when all extract backends unavailable", () => {
      clearAllBackends();
      const result = resolveExtractBackend();
      expect(result.ok).toBe(false);
      if (!result.ok && !("configuredBackend" in result)) {
        const unresolved = result as UnresolvedBackend;
        expect(unresolved.fallbackToWebFetch).toBe(true);
      }
    });

    it("extract with search-only backends available still signals web_fetch fallback", () => {
      enableBackend("searxng");
      enableBackend("brave");
      // ddgs is always available
      const result = resolveExtractBackend();
      expect(result.ok).toBe(false);
      if (!result.ok && !("configuredBackend" in result)) {
        const unresolved = result as UnresolvedBackend;
        expect(unresolved.fallbackToWebFetch).toBe(true);
      }
    });
  });

  // ── isAvailable is a cheap probe (no network) ──────────────────────────────

  describe("isAvailable is a cheap env probe", () => {
    it("ddgs isAvailable returns true even with no env vars", () => {
      clearAllBackends();
      expect(_allBackends.get("ddgs")?.isAvailable()).toBe(true);
    });

    it("tavily isAvailable returns false without TAVILY_API_KEY", () => {
      clearAllBackends();
      expect(_allBackends.get("tavily")?.isAvailable()).toBe(false);
    });

    it("tavily isAvailable returns true with TAVILY_API_KEY set", () => {
      process.env.TAVILY_API_KEY = "test-key";
      expect(_allBackends.get("tavily")?.isAvailable()).toBe(true);
      delete process.env.TAVILY_API_KEY;
    });
  });

  // ── Real backend integration (smoke tests) ──────────────────────────────────

  describe("real backend integration", () => {
    it("resolveSearchBackend returns a WebSearchProvider with search() method", () => {
      const result = resolveSearchBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.backend.search).toBe("function");
        expect(typeof result.backend.isAvailable).toBe("function");
        expect(result.backend.supportsSearch).toBe(true);
      }
    });

    it("resolveExtractBackend with firecrawl available returns backend with extract()", () => {
      enableBackend("firecrawl");
      const result = resolveExtractBackend();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.backend.extract).toBe("function");
        expect(result.backend.supportsExtract).toBe(true);
      }
    });
  });
});