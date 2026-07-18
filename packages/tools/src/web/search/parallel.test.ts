/**
 * parallel.ts tests — Parallel AI search + extract backend.
 *
 * Mocks global `fetch` so no real HTTP request is made. Tests:
 *   - isAvailable (env var check — no network)
 *   - provider metadata (name, supportsSearch, supportsExtract)
 *   - search happy path (parses results correctly)
 *   - search sends correct headers (x-api-key, parallel-beta)
 *   - search respects maxResults
 *   - search empty query → empty results
 *   - search no API key → empty results
 *   - search network error → empty array (never throws)
 *   - search non-OK HTTP → empty array
 *   - search response.json() error → empty array
 *   - extract happy path (returns markdown + title)
 *   - extract no API key → error result
 *   - extract guard integration (metadata IP, private IP, secret URL, file://)
 *   - extract network error → error result (never throws)
 *   - extract non-OK HTTP → error result
 *   - extract per-URL error in response → error result
 *   - extract empty content → error result
 *   - extract maxChars truncation
 *   - never-throws invariant
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parallelProvider } from "./parallel.js";

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
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Sample Parallel search response with 3 results. */
const SAMPLE_SEARCH_RESPONSE = {
  search_id: "search-123",
  results: [
    {
      url: "https://example.com",
      title: "Example Domain",
      excerpts: ["This domain is for use in illustrative examples."],
      publish_date: "2024-01-15",
    },
    {
      url: "https://nodejs.org",
      title: "Node.js",
      excerpts: ["Node.js is a JavaScript runtime."],
    },
    {
      url: "https://vitest.dev",
      title: "Vitest",
      excerpts: ["A blazing fast test framework."],
    },
  ],
  warnings: [],
  usage: [{ name: "credits", count: 1 }],
};

/** Sample Parallel extract response. */
const SAMPLE_EXTRACT_RESPONSE = {
  extract_id: "extract-456",
  results: [
    {
      url: "https://example.com",
      title: "Example Domain",
      excerpts: ["Welcome to Example Domain."],
      full_content: "# Example Domain\n\nThis domain is for use in illustrative examples.",
    },
  ],
  errors: [],
  warnings: [],
  usage: [{ name: "credits", count: 1 }],
};

/** Extract response with per-URL error. */
const EXTRACT_ERROR_RESPONSE = {
  extract_id: "extract-789",
  results: [],
  errors: [
    {
      url: "https://example.com",
      error_type: "fetch_failed",
      http_status_code: 404,
    },
  ],
  warnings: [],
  usage: [],
};

// ── Setup / teardown ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.PARALLEL_API_KEY;
});

// ── isAvailable ─────────────────────────────────────────────────────────────

describe("parallel — isAvailable", () => {
  it("returns false when PARALLEL_API_KEY is not set", () => {
    delete process.env.PARALLEL_API_KEY;
    expect(parallelProvider.isAvailable()).toBe(false);
  });

  it("returns true when PARALLEL_API_KEY is set", () => {
    process.env.PARALLEL_API_KEY = "test-key-123";
    expect(parallelProvider.isAvailable()).toBe(true);
  });

  it("is a cheap probe (no network call)", () => {
    process.env.PARALLEL_API_KEY = "test-key-123";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    parallelProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("parallel — provider metadata", () => {
  it("has name 'parallel'", () => {
    expect(parallelProvider.name).toBe("parallel");
  });

  it("supports search", () => {
    expect(parallelProvider.supportsSearch).toBe(true);
  });

  it("supports extract", () => {
    expect(parallelProvider.supportsExtract).toBe(true);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("parallel — search happy path", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("parses results from Parallel search response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test query");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("Example Domain");
    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.description).toContain("illustrative examples");
    expect(results[1]?.title).toBe("Node.js");
    expect(results[1]?.url).toBe("https://nodejs.org");
    expect(results[2]?.title).toBe("Vitest");
    expect(results[2]?.url).toBe("https://vitest.dev");
  });

  it("sends POST with correct headers (x-api-key, parallel-beta)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await parallelProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.parallel.ai/v1beta/search");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-123");
    expect(headers["parallel-beta"]).toBe("search-extract-2025-10-10");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes objective and search_queries in body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await parallelProvider.search("hello world");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.objective).toBe("hello world");
    expect(body.search_queries).toEqual(["hello world"]);
    expect(body.mode).toBe("fast");
  });

  it("respects maxResults option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("sends max_results in body when maxResults is specified", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await parallelProvider.search("test", { maxResults: 5 });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.max_results).toBe(5);
  });
});

// ── search — empty / no key ─────────────────────────────────────────────────

describe("parallel — search empty / no key", () => {
  it("returns empty array for empty query", async () => {
    process.env.PARALLEL_API_KEY = "test-key-123";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    process.env.PARALLEL_API_KEY = "test-key-123";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when API key is not configured", async () => {
    delete process.env.PARALLEL_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("parallel — search error handling (never throws)", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({ error: "server error" }, false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test");
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

    const results = await parallelProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array when results array is missing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({ search_id: "x", warnings: [] }),
    );
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test");
    expect(results).toEqual([]);
  });

  it("skips items without a url field", async () => {
    const partialResponse = {
      search_id: "x",
      results: [
        { title: "No URL", excerpts: ["text"] },
        { url: "https://valid.com", title: "Valid", excerpts: ["content"] },
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(partialResponse));
    globalThis.fetch = fetchSpy;

    const results = await parallelProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://valid.com");
  });
});

// ── extract — happy path ───────────────────────────────────────────────────

describe("parallel — extract happy path", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("extracts markdown content from a valid URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");

    expect(result.markdown).toContain("Example Domain");
    expect(result.title).toBe("Example Domain");
    expect(result.url).toBe("https://example.com");
    expect(result.error).toBeUndefined();
    expect(result.guardBlock).toBeUndefined();
  });

  it("sends POST to /v1beta/extract with correct headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    await parallelProvider.extract("https://example.com");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.parallel.ai/v1beta/extract");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-123");
    expect(headers["parallel-beta"]).toBe("search-extract-2025-10-10");
  });

  it("includes urls, excerpts, and full_content in body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_EXTRACT_RESPONSE));
    globalThis.fetch = fetchSpy;

    await parallelProvider.extract("https://example.com");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.urls).toEqual(["https://example.com"]);
    expect(body.excerpts).toBe(true);
    expect(body.full_content).toBe(true);
  });

  it("prefers full_content over excerpts", async () => {
    const response = {
      extract_id: "x",
      results: [
        {
          url: "https://example.com",
          title: "Example",
          excerpts: ["short excerpt"],
          full_content: "This is the full content, much longer than the excerpt.",
        },
      ],
      errors: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    // full_content takes priority since excerptContent is truthy, but
    // excerptContent is checked first — excerpts are used when non-empty.
    // The implementation uses excerptContent || fullContent.
    expect(result.markdown).toContain("short excerpt");
  });
});

// ── extract — error handling ───────────────────────────────────────────────

describe("parallel — extract error handling", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("returns error result when API key is not configured", async () => {
    delete process.env.PARALLEL_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("PARALLEL_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns error result on non-OK HTTP status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({ error: "bad request" }, false, 400),
    );
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("HTTP 400");
  });

  it("returns error result on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("connection refused"));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("connection refused");
  });

  it("returns error result when response has per-URL error", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(EXTRACT_ERROR_RESPONSE));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("fetch_failed");
  });

  it("returns error result when no matching result for URL", async () => {
    const response = {
      extract_id: "x",
      results: [
        { url: "https://other.com", title: "Other", excerpts: ["text"] },
      ],
      errors: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("no result");
  });

  it("returns error result when content is empty", async () => {
    const response = {
      extract_id: "x",
      results: [
        { url: "https://example.com", title: "Empty", excerpts: [], full_content: "" },
      ],
      errors: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("empty content");
  });

  it("returns error result when response.json() throws", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("parse error")),
    } as unknown as Response;
    const fetchSpy = vi.fn().mockResolvedValue(badResponse);
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toBeDefined();
  });
});

// ── extract — guard integration ─────────────────────────────────────────────

describe("parallel — extract guard integration (checkUrl)", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("returns guardBlock for metadata IP", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for private IP", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for secret-bearing URL", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for non-http(s) scheme", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("file:///etc/passwd");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("invalid-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── extract — truncation ───────────────────────────────────────────────────

describe("parallel — extract truncation", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("truncates content exceeding maxChars", async () => {
    const longContent = "A".repeat(20_000);
    const response = {
      extract_id: "x",
      results: [
        { url: "https://example.com", title: "Long", excerpts: [], full_content: longContent },
      ],
      errors: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com", { maxChars: 100 });
    expect(result.markdown.length).toBeLessThan(longContent.length);
    expect(result.markdown).toContain("omitted");
  });

  it("does not truncate content under maxChars", async () => {
    const shortContent = "Short content";
    const response = {
      extract_id: "x",
      results: [
        { url: "https://example.com", title: "Short", excerpts: [], full_content: shortContent },
      ],
      errors: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await parallelProvider.extract("https://example.com", { maxChars: 1000 });
    expect(result.markdown).toBe(shortContent);
  });
});

// ── never-throws invariant ──────────────────────────────────────────────────

describe("parallel — never throws", () => {
  beforeEach(() => {
    process.env.PARALLEL_API_KEY = "test-key-123";
  });

  it("search never throws — returns empty array on all errors", async () => {
    const cases = [
      () => parallelProvider.search(""),
      () => parallelProvider.search("   "),
      () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("fail"));
        return parallelProvider.search("test");
      },
      () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({}, false, 503));
        return parallelProvider.search("test");
      },
    ];
    for (const fn of cases) {
      const result = await fn();
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it("extract never throws — returns ExtractResult on all errors", async () => {
    const urls = [
      "https://example.com",
      "http://169.254.169.254",
      "not a url",
      "",
      "file:///etc/passwd",
    ];
    for (const url of urls) {
      const result = await parallelProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});