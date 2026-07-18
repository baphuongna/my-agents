/**
 * searxng.ts tests — SearXNG self-hosted metasearch backend.
 *
 * Mocks global `fetch` so no real HTTP request is made. Tests:
 *   - isAvailable (true when SEARXNG_URL set, false otherwise, no network)
 *   - search happy path (parses JSON results correctly, sorted by score)
 *   - search empty query → empty results
 *   - search empty results → empty array
 *   - search network error → empty array (never throws)
 *   - search non-OK HTTP status → empty array
 *   - search response.text() / json() error → empty array
 *   - extract not supported → typed error
 *   - extract with blocked URL → guardBlock result
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searxngProvider } from "./searxng.js";

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

/** Sample SearXNG JSON response with 3 results. */
const SAMPLE_RESPONSE = {
  results: [
    {
      title: "Example Domain",
      url: "https://example.com",
      content: "This domain is for use in illustrative examples.",
      engine: "google",
      score: 5.0,
    },
    {
      title: "Node.js",
      url: "https://nodejs.org",
      content: "Node.js is a JavaScript runtime.",
      engine: "bing",
      score: 3.0,
    },
    {
      title: "Vitest",
      url: "https://vitest.dev",
      content: "A blazing fast test framework.",
      engine: "duckduckgo",
      score: 1.0,
    },
  ],
  suggestions: [],
  unresponsive_engines: [],
};

/** SearXNG JSON response with no results. */
const EMPTY_RESPONSE = {
  results: [],
  suggestions: [],
  unresponsive_engines: [],
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

describe("searxng — isAvailable", () => {
  it("returns true when SEARXNG_URL is set", () => {
    process.env["SEARXNG_URL"] = "http://localhost:8080";
    expect(searxngProvider.isAvailable()).toBe(true);
  });

  it("returns false when SEARXNG_URL is not set", () => {
    delete process.env["SEARXNG_URL"];
    expect(searxngProvider.isAvailable()).toBe(false);
  });

  it("returns false when SEARXNG_URL is empty string", () => {
    process.env["SEARXNG_URL"] = "";
    expect(searxngProvider.isAvailable()).toBe(false);
  });

  it("returns false when SEARXNG_URL is whitespace only", () => {
    process.env["SEARXNG_URL"] = "   ";
    expect(searxngProvider.isAvailable()).toBe(false);
  });

  it("is a cheap probe (no network call)", () => {
    process.env["SEARXNG_URL"] = "http://localhost:8080";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    searxngProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("searxng — provider metadata", () => {
  it("has name 'searxng'", () => {
    expect(searxngProvider.name).toBe("searxng");
  });

  it("supports search", () => {
    expect(searxngProvider.supportsSearch).toBe(true);
  });

  it("does not support extract", () => {
    expect(searxngProvider.supportsExtract).toBe(false);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("searxng — search happy path", () => {
  beforeEach(() => {
    process.env["SEARXNG_URL"] = "http://localhost:8080";
  });

  it("parses results from SearXNG JSON response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test query");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("Example Domain");
    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.description).toContain("illustrative examples");
    expect(results[1]?.title).toBe("Node.js");
    expect(results[1]?.url).toBe("https://nodejs.org");
    expect(results[2]?.title).toBe("Vitest");
    expect(results[2]?.url).toBe("https://vitest.dev");
  });

  it("sorts results by score descending", async () => {
    // Provide results in random score order.
    const scrambled = {
      results: [
        {
          title: "Low Score",
          url: "https://low.example.com",
          content: "low",
          score: 1.0,
        },
        {
          title: "High Score",
          url: "https://high.example.com",
          content: "high",
          score: 10.0,
        },
        {
          title: "Mid Score",
          url: "https://mid.example.com",
          content: "mid",
          score: 5.0,
        },
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(scrambled));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("High Score");
    expect(results[1]?.title).toBe("Mid Score");
    expect(results[2]?.title).toBe("Low Score");
  });

  it("sends GET request with query params to SEARXNG_URL/search", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await searxngProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("http://localhost:8080/search");
    expect(url).toContain("q=hello+world");
    expect(url).toContain("format=json");
    expect(init?.method).toBe("GET");
  });

  it("respects maxResults option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("passes region option as language param", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await searxngProvider.search("test", { region: "uk-en" });

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("language=uk-en");
  });

  it("sets safesearch=0 when safeSearch is false", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await searxngProvider.search("test", { safeSearch: false });

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("safesearch=0");
  });

  it("includes bearer auth header when SEARXNG_TOKEN is set", async () => {
    process.env["SEARXNG_TOKEN"] = "my-secret-token";
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await searxngProvider.search("test");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-secret-token");
  });

  it("includes basic auth header when SEARXNG_BASIC_USERNAME/PASSWORD set", async () => {
    delete process.env["SEARXNG_TOKEN"];
    process.env["SEARXNG_BASIC_USERNAME"] = "user";
    process.env["SEARXNG_BASIC_PASSWORD"] = "pass";
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(SAMPLE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await searxngProvider.search("test");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Basic /);
  });
});

// ── search — empty / edge cases ─────────────────────────────────────────────

describe("searxng — search empty / edge cases", () => {
  beforeEach(() => {
    process.env["SEARXNG_URL"] = "http://localhost:8080";
  });

  it("returns empty array for empty query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when response has no results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(EMPTY_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("nonexistent");
    expect(results).toEqual([]);
  });

  it("returns empty array when SEARXNG_URL is not set", async () => {
    delete process.env["SEARXNG_URL"];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips results with missing title or url", async () => {
    const partial = {
      results: [
        { title: "Has Title", url: "https://good.example.com", content: "ok", score: 5 },
        { url: "https://no-title.example.com", content: "no title" }, // missing title
        { title: "No URL", content: "no url" }, // missing url
        { title: "", url: "https://empty-title.example.com", content: "empty title" }, // empty title
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(partial));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Has Title");
  });

  it("skips results with SSRF-blocked URLs (defence-in-depth)", async () => {
    const withBlocked = {
      results: [
        { title: "Good", url: "https://example.com", content: "ok", score: 5 },
        {
          title: "Metadata IP",
          url: "http://169.254.169.254/latest/meta-data/",
          content: "blocked",
          score: 10,
        },
        {
          title: "Private IP",
          url: "http://10.0.0.1/",
          content: "blocked",
          score: 8,
        },
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(withBlocked));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Good");
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("searxng — search error handling (never throws)", () => {
  beforeEach(() => {
    process.env["SEARXNG_URL"] = "http://localhost:8080";
  });

  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockJsonResponse({ error: "Internal Server Error" }, false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await searxngProvider.search("test");
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

    const results = await searxngProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── extract — not supported ─────────────────────────────────────────────────

describe("searxng — extract (not supported)", () => {
  it("returns error result for valid URL (supportsExtract=false)", async () => {
    const result = await searxngProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("searxng");
    expect(result.error).toContain("does not support extraction");
    expect(result.guardBlock).toBeUndefined();
  });

  it("returns guardBlock for metadata IP (checkUrl still applies)", async () => {
    const result = await searxngProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
  });

  it("returns guardBlock for private IP", async () => {
    const result = await searxngProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
  });

  it("returns guardBlock for secret-bearing URL", async () => {
    const result = await searxngProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
  });

  it("returns guardBlock for non-http(s) scheme", async () => {
    const result = await searxngProvider.extract("file:///etc/passwd");
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
      const result = await searxngProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});