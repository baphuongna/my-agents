/**
 * provider.ts tests — verify the WebSearchProvider interface shape, shared
 * types, and helper functions.
 *
 * These are unit tests for the type-level contract and runtime helpers. They
 * ensure that any backend implementing WebSearchProvider satisfies the
 * interface and that the error-result helpers produce correct shapes.
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect } from "vitest";
import type {
  WebSearchProvider,
  SearchResult,
  ExtractResult,
  SearchOptions,
  ExtractOptions,
} from "./provider.js";
import {
  guardBlockResult,
  errorResult,
  notSupportedResult,
} from "./provider.js";

// ── Type-level contract (compile-time) ──────────────────────────────────────

/** A minimal mock provider to verify the interface shape is satisfied. */
const mockProvider: WebSearchProvider = {
  name: "mock",
  supportsSearch: true,
  supportsExtract: false,
  isAvailable: () => true,
  search: async () => [],
  extract: async (url: string) => errorResult(url, "not implemented"),
};

describe("WebSearchProvider interface", () => {
  it("satisfies the interface shape (compile-time check)", () => {
    // If this compiles, the interface shape is correct.
    expect(mockProvider.name).toBe("mock");
    expect(mockProvider.supportsSearch).toBe(true);
    expect(mockProvider.supportsExtract).toBe(false);
    expect(typeof mockProvider.isAvailable).toBe("function");
    expect(typeof mockProvider.search).toBe("function");
    expect(typeof mockProvider.extract).toBe("function");
  });

  it("isAvailable returns a boolean", () => {
    expect(typeof mockProvider.isAvailable()).toBe("boolean");
  });

  it("search returns a Promise of SearchResult[]", async () => {
    const result = await mockProvider.search("test");
    expect(Array.isArray(result)).toBe(true);
  });

  it("extract returns a Promise of ExtractResult", async () => {
    const result = await mockProvider.extract("https://example.com");
    expect(result).toHaveProperty("markdown");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("url");
  });
});

// ── Shared types shape verification ────────────────────────────────────────

describe("SearchResult type shape", () => {
  it("has title, url, and description string fields", () => {
    const result: SearchResult = {
      title: "Example",
      url: "https://example.com",
      description: "An example result",
    };
    expect(result.title).toBe("Example");
    expect(result.url).toBe("https://example.com");
    expect(result.description).toBe("An example result");
  });
});

describe("ExtractResult type shape", () => {
  it("has markdown, title, and url string fields", () => {
    const result: ExtractResult = {
      markdown: "# Hello",
      title: "Hello",
      url: "https://example.com",
    };
    expect(result.markdown).toBe("# Hello");
    expect(result.title).toBe("Hello");
    expect(result.url).toBe("https://example.com");
  });

  it("can include optional error field", () => {
    const result: ExtractResult = {
      markdown: "",
      title: "",
      url: "https://example.com",
      error: "network timeout",
    };
    expect(result.error).toBe("network timeout");
  });

  it("can include optional guardBlock field", () => {
    const result: ExtractResult = {
      markdown: "",
      title: "",
      url: "http://169.254.169.254",
      guardBlock: { reason: "metadata endpoint blocked", category: "ssrf-metadata" },
    };
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
  });
});

describe("SearchOptions type shape", () => {
  it("accepts maxResults, region, safeSearch, timeoutMs", () => {
    const opts: SearchOptions = {
      maxResults: 5,
      region: "us-en",
      safeSearch: true,
      timeoutMs: 5000,
    };
    expect(opts.maxResults).toBe(5);
    expect(opts.region).toBe("us-en");
  });
});

describe("ExtractOptions type shape", () => {
  it("accepts timeoutMs and maxChars", () => {
    const opts: ExtractOptions = {
      timeoutMs: 10000,
      maxChars: 15000,
    };
    expect(opts.timeoutMs).toBe(10000);
    expect(opts.maxChars).toBe(15000);
  });
});

// ── Helper functions ────────────────────────────────────────────────────────

describe("guardBlockResult", () => {
  it("builds an ExtractResult with guardBlock set", () => {
    const result = guardBlockResult(
      "http://169.254.169.254",
      "cloud metadata endpoint blocked: 169.254.169.254",
      "ssrf-metadata",
    );
    expect(result.markdown).toBe("");
    expect(result.title).toBe("");
    expect(result.url).toBe("http://169.254.169.254");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.guardBlock?.reason).toContain("metadata");
  });

  it("does not set error field", () => {
    const result = guardBlockResult("http://10.0.0.1", "private blocked", "ssrf-private");
    expect(result.error).toBeUndefined();
  });
});

describe("errorResult", () => {
  it("builds an ExtractResult with error set", () => {
    const result = errorResult("https://example.com", "network timeout");
    expect(result.markdown).toBe("");
    expect(result.title).toBe("");
    expect(result.url).toBe("https://example.com");
    expect(result.error).toBe("network timeout");
  });

  it("does not set guardBlock field", () => {
    const result = errorResult("https://example.com", "parse error");
    expect(result.guardBlock).toBeUndefined();
  });
});

describe("notSupportedResult", () => {
  it("builds an ExtractResult with a not-supported error", () => {
    const result = notSupportedResult("ddgs", "https://example.com");
    expect(result.markdown).toBe("");
    expect(result.url).toBe("https://example.com");
    expect(result.error).toContain("ddgs");
    expect(result.error).toContain("does not support extraction");
  });

  it("does not set guardBlock field", () => {
    const result = notSupportedResult("searxng", "https://example.com");
    expect(result.guardBlock).toBeUndefined();
  });
});