/**
 * exa.ts tests — Exa search+extract backend.
 *
 * Mocks global `fetch` and env vars so no real HTTP request is made. Tests:
 *   - isAvailable (with/without EXA_API_KEY)
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
import { exaProvider } from "./exa.js";

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

/** Sample Exa search API response with 3 results. */
const SAMPLE_SEARCH_RESPONSE = {
  requestId: "req-456",
  results: [
    {
      title: "Example Domain",
      url: "https://example.com",
      text: "This domain is for use in illustrative examples.",
      highlights: ["illustrative examples"],
      summary: "An example domain.",
      publishedDate: "2024-01-15",
      author: "example",
    },
    {
      title: "Node.js",
      url: "https://nodejs.org",
      text: "Node.js is a JavaScript runtime built on Chrome's V8 engine.",
      highlights: ["JavaScript runtime"],
      summary: "Node.js homepage.",
    },
    {
      title: "Vitest",
      url: "https://vitest.dev",
      text: "A blazing fast test framework powered by Vite.",
      highlights: ["blazing fast"],
      summary: "Vitest homepage.",
    },
  ],
  resolvedSearchType: "neural",
};

/** Sample Exa contents (extract) API response. */
const SAMPLE_EXTRACT_RESPONSE = {
  results: [
    {
      url: "https://example.com",
      title: "Example Domain",
      text: "# Example Domain\n\nThis domain is for use in illustrative examples.",
    },
  ],
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
  setEnv("EXA_API_KEY", "exa-test-key");
});

afterEach(() => {
  // Restore original fetch and env.
  globalThis.fetch = originalFetch;
  process.env = { ...ORIGINAL_ENV };
});

// ── isAvailable ─────────────────────────────────────────────────────────────

describe("exa — isAvailable", () => {
  it("returns true when EXA_API_KEY is set", () => {
    setEnv("EXA_API_KEY", "exa-real-key");
    expect(exaProvider.isAvailable()).toBe(true);
  });

  it("returns false when EXA_API_KEY is not set", () => {
    setEnv("EXA_API_KEY", undefined);
    expect(exaProvider.isAvailable()).toBe(false);
  });

  it("returns false when EXA_API_KEY is empty string", () => {
    setEnv("EXA_API_KEY", "");
    expect(exaProvider.isAvailable()).toBe(false);
  });

  it("is a cheap probe (no network call)", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    exaProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("exa — provider metadata", () => {
  it("has name 'exa'", () => {
    expect(exaProvider.name).toBe("exa");
  });

  it("supports search", () => {
    expect(exaProvider.supportsSearch).toBe(true);
  });

  it("supports extract", () => {
    expect(exaProvider.supportsExtract).toBe(true);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("exa — search happy path", () => {
  it("parses results from Exa API response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test query");

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

    await exaProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.exa.ai/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");
    expect((init?.headers as Record<string, string>)?.["x-api-key"]).toBe("exa-test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.query).toBe("hello world");
    expect(body.numResults).toBe(10);
    expect(body.type).toBe("auto");
    expect(body.contents).toBeDefined();
    expect(body.contents.highlights).toBe(true);
  });

  it("respects maxResults option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("falls back to summary when text is missing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          {
            title: "Summary Only",
            url: "https://summary.com",
            summary: "Summary content here",
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.description).toBe("Summary content here");
  });

  it("falls back to highlights when text and summary are missing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          {
            title: "Highlights Only",
            url: "https://highlights.com",
            highlights: ["highlight one", "highlight two"],
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.description).toContain("highlight one");
    expect(results[0]?.description).toContain("highlight two");
  });
});

// ── search — empty / edge cases ─────────────────────────────────────────────

describe("exa — search empty / edge cases", () => {
  it("returns empty array for empty query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when API key is not set", async () => {
    setEnv("EXA_API_KEY", undefined);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when response has no results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse({ results: [] }));
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("nonexistent");
    expect(results).toEqual([]);
  });

  it("skips results with empty URLs", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          { title: "Has URL", url: "https://example.com", text: "good" },
          { title: "No URL", url: "", text: "bad" },
          { title: "Also good", url: "https://other.com", text: "ok" },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
    expect(results.length).toBe(2);
    expect(results[0]?.title).toBe("Has URL");
    expect(results[1]?.title).toBe("Also good");
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("exa — search error handling (never throws)", () => {
  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse("Internal Server Error", false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await exaProvider.search("test");
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

    const results = await exaProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── extract — happy path ───────────────────────────────────────────────────

describe("exa — extract happy path", () => {
  it("returns markdown content from Exa contents API", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com");

    expect(result.markdown).toContain("Example Domain");
    expect(result.title).toBe("Example Domain");
    expect(result.url).toBe("https://example.com");
    expect(result.error).toBeUndefined();
    expect(result.guardBlock).toBeUndefined();
  });

  it("sends POST to /contents with correct headers and body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    await exaProvider.extract("https://example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.exa.ai/contents");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.["x-api-key"]).toBe("exa-test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.ids).toEqual(["https://example.com"]);
    expect(body.text).toBe(true);
  });

  it("truncates long content to maxChars", async () => {
    const longContent = "B".repeat(50_000);
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          {
            url: "https://example.com",
            title: "Long Page",
            text: longContent,
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com", { maxChars: 1000 });
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
            text: shortContent,
          },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com", { maxChars: 15_000 });
    expect(result.markdown).toBe(shortContent);
  });
});

// ── extract — guard block ──────────────────────────────────────────────────

describe("exa — extract with blocked URL (security guard)", () => {
  it("returns guardBlock for metadata IP — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for private IP — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for secret-bearing URL — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for non-http(s) scheme — no fetch call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("file:///etc/passwd");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("invalid-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── extract — error handling ────────────────────────────────────────────────

describe("exa — extract error handling", () => {
  it("returns error when API key is not set", async () => {
    setEnv("EXA_API_KEY", undefined);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com");
    expect(result.error).toContain("EXA_API_KEY");
    expect(result.markdown).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns error when API returns non-OK status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse("Rate limited", false, 429),
    );
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com");
    expect(result.error).toContain("429");
    expect(result.markdown).toBe("");
  });

  it("returns error when no matching result found", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        results: [
          { url: "https://other.com", title: "Other", text: "content" },
        ],
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com");
    expect(result.error).toContain("no result");
    expect(result.markdown).toBe("");
  });

  it("returns error on network failure (never throws)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("network error");
    expect(result.markdown).toBe("");
  });

  it("returns error on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const result = await exaProvider.extract("https://example.com");
    expect(result.error).toBeDefined();
    expect(result.markdown).toBe("");
  });
});

// ── never-throws invariant ──────────────────────────────────────────────────

describe("exa — never throws invariant", () => {
  it("extract never throws — all extract calls return a result", async () => {
    const urls = [
      "https://example.com",
      "http://169.254.169.254",
      "not a url",
      "",
      "file:///etc/passwd",
    ];
    for (const url of urls) {
      const result = await exaProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});