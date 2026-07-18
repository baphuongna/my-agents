/**
 * tavily.ts tests — Tavily search+extract backend.
 *
 * Mocks global `fetch` and env vars so no real HTTP request is made. Tests:
 *   - isAvailable (with/without TAVILY_API_KEY)
 *   - search happy path (parses API response correctly)
 *   - search empty query → empty results
 *   - search error (network error, non-OK HTTP, parse error)
 *   - extract happy path (returns markdown content)
 *   - extract with blocked URL → guardBlock result
 *   - extract with no API key → error result
 *   - never-throws invariant
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tavilyProvider } from "./tavily.js";

// ── Mock fetch ─────────────────────────────────────────────────────────────

/** Build a mock Response-like object. */
function mockResponse(
  body: unknown,
  ok = true,
  status = 200,
): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  } as unknown as Response;
}

/** Sample Tavily search API response with 3 results. */
const SAMPLE_SEARCH_RESPONSE = {
  results: [
    {
      title: "Example Domain",
      url: "https://example.com",
      content: "This domain is for use in illustrative examples.",
      published_date: "2024-01-15",
    },
    {
      title: "Node.js",
      url: "https://nodejs.org",
      content: "Node.js is a JavaScript runtime built on Chrome's V8 engine.",
    },
    {
      title: "Vitest",
      url: "https://vitest.dev",
      content: "A blazing fast test framework powered by Vite.",
    },
  ],
  answer: "These are example results.",
  request_id: "req-123",
};

/** Sample Tavily extract API response. */
const SAMPLE_EXTRACT_RESPONSE = {
  results: [
    {
      url: "https://example.com",
      title: "Example Domain",
      raw_content: "# Example Domain\n\nThis domain is for use in illustrative examples.",
    },
  ],
  failed_results: [],
  failed_urls: [],
};

/** Sample Tavily extract response with a failed URL. */
const FAILED_EXTRACT_RESPONSE = {
  results: [],
  failed_results: [
    {
      url: "https://broken.com",
      error: "Failed to fetch: 404",
    },
  ],
  failed_urls: ["https://broken.com"],
};

// ── Env helpers ────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ── Setup / teardown ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  // Set a default API key for tests that need it.
  setEnv("TAVILY_API_KEY", "tvly-test-key");
});

afterEach(() => {
  // Restore original fetch and env.
  globalThis.fetch = originalFetch;
  process.env = { ...ORIGINAL_ENV };
});

// ── isAvailable ─────────────────────────────────────────────────────────────

describe("tavily — isAvailable", () => {
  it("returns true when TAVILY_API_KEY is set", () => {
    setEnv("TAVILY_API_KEY", "tvly-real-key");
    expect(tavilyProvider.isAvailable()).toBe(true);
  });

  it("returns false when TAVILY_API_KEY is not set", () => {
    setEnv("TAVILY_API_KEY", undefined);
    expect(tavilyProvider.isAvailable()).toBe(false);
  });

  it("returns false when TAVILY_API_KEY is empty string", () => {
    setEnv("TAVILY_API_KEY", "");
    expect(tavilyProvider.isAvailable()).toBe(false);
  });

  it("is a cheap probe (no network call)", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    tavilyProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("tavily — provider metadata", () => {
  it("has name 'tavily'", () => {
    expect(tavilyProvider.name).toBe("tavily");
  });

  it("supports search", () => {
    expect(tavilyProvider.supportsSearch).toBe(true);
  });

  it("supports extract", () => {
    expect(tavilyProvider.supportsExtract).toBe(true);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("tavily — search happy path", () => {
  it("parses results from Tavily API response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test query");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("Example Domain");
    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.description).toContain("illustrative examples");
    expect(results[1]?.title).toBe("Node.js");
    expect(results[1]?.url).toBe("https://nodejs.org");
    expect(results[2]?.title).toBe("Vitest");
    expect(results[2]?.url).toBe("https://vitest.dev");
  });

  it("sends POST to /search with correct headers and body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await tavilyProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");
    expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tvly-test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.query).toBe("hello world");
    expect(body.max_results).toBe(10);
    expect(body.search_depth).toBe("basic");
    expect(body.include_answer).toBe("advanced");
  });

  it("respects maxResults option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("uses TAVILY_BASE_URL when set", async () => {
    setEnv("TAVILY_BASE_URL", "https://custom.tavily.example");
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await tavilyProvider.search("test");

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://custom.tavily.example/search");
  });

  it("uses default base URL when TAVILY_BASE_URL is not set", async () => {
    setEnv("TAVILY_BASE_URL", undefined);
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await tavilyProvider.search("test");

    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.tavily.com/search");
  });
});

// ── search — empty / edge cases ─────────────────────────────────────────────

describe("tavily — search empty / edge cases", () => {
  it("returns empty array for empty query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when API key is not set", async () => {
    setEnv("TAVILY_API_KEY", undefined);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when response has no results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse({ results: [] }));
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("nonexistent");
    expect(results).toEqual([]);
  });

  it("skips results with empty URLs", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          { title: "Has URL", url: "https://example.com", content: "good" },
          { title: "No URL", url: "", content: "bad" },
          { title: "Also good", url: "https://other.com", content: "ok" },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test");
    expect(results.length).toBe(2);
    expect(results[0]?.title).toBe("Has URL");
    expect(results[1]?.title).toBe("Also good");
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("tavily — search error handling (never throws)", () => {
  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse("Internal Server Error", false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array when response.json() throws", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("parse error")),
    } as unknown as Response;
    const fetchSpy = vi.fn().mockResolvedValue(badResponse);
    globalThis.fetch = fetchSpy;

    const results = await tavilyProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── extract — happy path ───────────────────────────────────────────────────

describe("tavily — extract happy path", () => {
  it("returns markdown content from Tavily extract API", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");

    expect(result.markdown).toContain("Example Domain");
    expect(result.title).toBe("Example Domain");
    expect(result.url).toBe("https://example.com");
    expect(result.error).toBeUndefined();
    expect(result.guardBlock).toBeUndefined();
  });

  it("sends POST to /extract with correct headers and body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    await tavilyProvider.extract("https://example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.tavily.com/extract");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tvly-test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.urls).toEqual(["https://example.com"]);
    expect(body.include_images).toBe(false);
  });

  it("truncates long content to maxChars", async () => {
    const longContent = "A".repeat(50_000);
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          {
            url: "https://example.com",
            title: "Long Page",
            raw_content: longContent,
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com", { maxChars: 1000 });
    expect(result.markdown.length).toBeLessThan(longContent.length);
    expect(result.markdown).toContain("chars omitted");
  });

  it("does not truncate content shorter than maxChars", async () => {
    const shortContent = "Short content.";
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          {
            url: "https://example.com",
            title: "Short Page",
            raw_content: shortContent,
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com", { maxChars: 15_000 });
    expect(result.markdown).toBe(shortContent);
  });

  it("falls back to 'content' field when 'raw_content' is missing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          {
            url: "https://example.com",
            title: "Fallback",
            content: "Content from 'content' field",
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");
    expect(result.markdown).toBe("Content from 'content' field");
  });
});

// ── extract — guard block ──────────────────────────────────────────────────

describe("tavily — extract with blocked URL (security guard)", () => {
  it("returns guardBlock for metadata IP — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for private IP — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for secret-bearing URL — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for non-http(s) scheme — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("file:///etc/passwd");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("invalid-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── extract — error handling ────────────────────────────────────────────────

describe("tavily — extract error handling", () => {
  it("returns error when API key is not set", async () => {
    setEnv("TAVILY_API_KEY", undefined);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");
    expect(result.error).toContain("TAVILY_API_KEY");
    expect(result.markdown).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns error when API returns non-OK status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse("Rate limited", false, 429),
    );
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");
    expect(result.error).toContain("429");
    expect(result.markdown).toBe("");
  });

  it("returns error when URL is in failed_results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(FAILED_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://broken.com");
    expect(result.error).toBeDefined();
    expect(result.markdown).toBe("");
  });

  it("returns error when no matching result found", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          { url: "https://other.com", title: "Other", raw_content: "content" },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");
    expect(result.error).toContain("no result");
    expect(result.markdown).toBe("");
  });

  it("returns error on network failure (never throws)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("network error");
    expect(result.markdown).toBe("");
  });

  it("returns error on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const result = await tavilyProvider.extract("https://example.com");
    expect(result.error).toBeDefined();
    expect(result.markdown).toBe("");
  });
});

// ── never-throws invariant ──────────────────────────────────────────────────

describe("tavily — never throws invariant", () => {
  it("extract never throws — all extract calls return a result", async () => {
    const urls = [
      "https://example.com",
      "http://169.254.169.254",
      "not a url",
      "",
      "file:///etc/passwd",
    ];
    for (const url of urls) {
      const result = await tavilyProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});