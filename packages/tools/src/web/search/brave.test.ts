/**
 * brave.ts tests — Brave Search API backend.
 *
 * Mocks global `fetch` so no real HTTP request is made. Tests:
 *   - isAvailable (true when BRAVE_API_KEY set, false otherwise, no network)
 *   - search happy path (parses JSON results correctly)
 *   - search empty query → empty results
 *   - search empty results → empty array
 *   - search network error → empty array (never throws)
 *   - search non-OK HTTP status → empty array
 *   - search response.json() error → empty array
 *   - extract not supported → typed error
 *   - extract with blocked URL → guardBlock result
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { braveProvider } from "./brave.js";

// ── Mock fetch ─────────────────────────────────────────────────────────────

/** Build a mock Response-like object returning JSON. */
function mockJsonResponse(
  data: unknown,
  ok = true,
  status = 200,
): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

/** Sample Brave search JSON response with 3 results. */
const SAMPLE_RESPONSE = {
  web: {
    results: [
      {
        title: "Example Domain",
        url: "https://example.com",
        description: "This domain is for use in illustrative examples.",
        age: "2d",
        extra_snippets: ["Extra info about example.com"],
      },
      {
        title: "Node.js",
        url: "https://nodejs.org",
        description: "Node.js is a JavaScript runtime.",
        age: "1d",
        extra_snippets: [],
      },
      {
        title: "Vitest",
        url: "https://vitest.dev",
        description: "A blazing fast test framework.",
        age: "3h",
        extra_snippets: ["Vitest is built on Vite."],
      },
    ],
  },
  query: { original: "test query" },
};

/** Brave JSON response with no results. */
const EMPTY_RESPONSE = {
  web: {
    results: [],
  },
};

// ── Setup / teardown ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
});

afterEach(() => {
  // Restore fetch and env after each test.
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

// ── isAvailable ─────────────────────────────────────────────────────────────

describe("brave — isAvailable", () => {
  it("returns true when BRAVE_API_KEY is set", () => {
    process.env["BRAVE_API_KEY"] = "BSA-test-key";
    expect(braveProvider.isAvailable()).toBe(true);
  });

  it("returns false when BRAVE_API_KEY is not set", () => {
    delete process.env["BRAVE_API_KEY"];
    expect(braveProvider.isAvailable()).toBe(false);
  });

  it("returns false when BRAVE_API_KEY is empty string", () => {
    process.env["BRAVE_API_KEY"] = "";
    expect(braveProvider.isAvailable()).toBe(false);
  });

  it("returns false when BRAVE_API_KEY is whitespace only", () => {
    process.env["BRAVE_API_KEY"] = "   ";
    expect(braveProvider.isAvailable()).toBe(false);
  });

  it("is a cheap probe (no network call)", () => {
    process.env["BRAVE_API_KEY"] = "BSA-test-key";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    braveProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("brave — provider metadata", () => {
  it("has name 'brave'", () => {
    expect(braveProvider.name).toBe("brave");
  });

  it("supports search", () => {
    expect(braveProvider.supportsSearch).toBe(true);
  });

  it("does not support extract", () => {
    expect(braveProvider.supportsExtract).toBe(false);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("brave — search happy path", () => {
  beforeEach(() => {
    process.env["BRAVE_API_KEY"] = "BSA-test-key";
  });

  it("parses results from Brave JSON response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test query");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("Example Domain");
    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.description).toContain("illustrative examples");
    expect(results[1]?.title).toBe("Node.js");
    expect(results[1]?.url).toBe("https://nodejs.org");
    expect(results[2]?.title).toBe("Vitest");
    expect(results[2]?.url).toBe("https://vitest.dev");
  });

  it("sends GET request with query params to Brave endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await braveProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("https://api.search.brave.com/res/v1/web/search");
    expect(url).toContain("q=hello+world");
    expect(init?.method).toBe("GET");
  });

  it("sends X-Subscription-Token header with API key", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await braveProvider.search("test");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe("BSA-test-key");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("respects maxResults option (caps count param)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("caps count param at 20 (API max)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await braveProvider.search("test", { maxResults: 50 });

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("count=20");
  });

  it("sends extra_snippets=true param", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await braveProvider.search("test");

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("extra_snippets=true");
  });

  it("sets safesearch=off when safeSearch is false", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await braveProvider.search("test", { safeSearch: false });

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("safesearch=off");
  });

  it("uses extra_snippets as description when description is empty", async () => {
    const withSnippetOnly = {
      web: {
        results: [
          {
            title: "Snippet Only",
            url: "https://snippet.example.com",
            description: "",
            extra_snippets: ["Description from snippet"],
          },
        ],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(withSnippetOnly));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.description).toBe("Description from snippet");
  });
});

// ── search — empty / edge cases ─────────────────────────────────────────────

describe("brave — search empty / edge cases", () => {
  beforeEach(() => {
    process.env["BRAVE_API_KEY"] = "BSA-test-key";
  });

  it("returns empty array for empty query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when response has no results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(EMPTY_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("nonexistent");
    expect(results).toEqual([]);
  });

  it("returns empty array when BRAVE_API_KEY is not set", async () => {
    delete process.env["BRAVE_API_KEY"];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips results with missing title or url", async () => {
    const partial = {
      web: {
        results: [
          { title: "Has Title", url: "https://good.example.com", description: "ok" },
          { url: "https://no-title.example.com", description: "no title" },
          { title: "No URL", description: "no url" },
          { title: "", url: "https://empty-title.example.com", description: "empty" },
        ],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(partial));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Has Title");
  });

  it("skips results with SSRF-blocked URLs (defence-in-depth)", async () => {
    const withBlocked = {
      web: {
        results: [
          { title: "Good", url: "https://example.com", description: "ok" },
          {
            title: "Metadata IP",
            url: "http://169.254.169.254/latest/meta-data/",
            description: "blocked",
          },
          {
            title: "Private IP",
            url: "http://10.0.0.1/",
            description: "blocked",
          },
        ],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(withBlocked));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Good");
  });

  it("handles response with missing web field gracefully", async () => {
    const noWeb = { query: { original: "test" } };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(noWeb));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("brave — search error handling (never throws)", () => {
  beforeEach(() => {
    process.env["BRAVE_API_KEY"] = "BSA-test-key";
  });

  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockJsonResponse({ error: "Internal Server Error" }, false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (401 unauthorized)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockJsonResponse({ error: "Unauthorized" }, false, 401),
    );
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array when response.json() throws", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("parse error")),
      text: () => Promise.reject(new Error("read error")),
    } as unknown as Response;
    const fetchSpy = vi.fn().mockResolvedValue(badResponse);
    globalThis.fetch = fetchSpy;

    const results = await braveProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── extract — not supported ─────────────────────────────────────────────────

describe("brave — extract (not supported)", () => {
  it("returns error result for valid URL (supportsExtract=false)", async () => {
    const result = await braveProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("brave");
    expect(result.error).toContain("does not support extraction");
    expect(result.guardBlock).toBeUndefined();
  });

  it("returns guardBlock for metadata IP (checkUrl still applies)", async () => {
    const result = await braveProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
  });

  it("returns guardBlock for private IP", async () => {
    const result = await braveProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
  });

  it("returns guardBlock for secret-bearing URL", async () => {
    const result = await braveProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
  });

  it("returns guardBlock for non-http(s) scheme", async () => {
    const result = await braveProvider.extract("file:///etc/passwd");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("invalid-url");
  });

  it("never throws — all extract calls return a result", async () => {
    const urls = [
      "https://example.com",
      "http://169.254.169.254",
      "not a url",
      "",
      "file:///etc/passwd",
    ];
    for (const url of urls) {
      const result = await braveProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});