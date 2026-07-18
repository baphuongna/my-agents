/**
 * firecrawl.ts tests — Firecrawl search + extract backend.
 *
 * Mocks global `fetch` so no real HTTP request is made. Tests:
 *   - isAvailable (env var check — no network)
 *   - provider metadata (name, supportsSearch, supportsExtract)
 *   - search happy path (parses results from data.web[])
 *   - search sends correct headers (Authorization Bearer)
 *   - search respects maxResults
 *   - search handles alternate response shapes (data.results, top-level)
 *   - search empty query → empty results
 *   - search no API key (and no gateway) → empty results
 *   - search network error → empty array (never throws)
 *   - search non-OK HTTP → empty array
 *   - extract happy path (returns markdown + title)
 *   - extract no API key → error result
 *   - extract guard integration (metadata IP, private IP, secret URL, file://)
 *   - extract network error → error result (never throws)
 *   - extract non-OK HTTP → error result
 *   - extract empty content → error result
 *   - extract gateway routing (FIRECRAWL_GATEWAY_URL)
 *   - extract maxChars truncation
 *   - never-throws invariant
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { firecrawlProvider } from "./firecrawl.js";

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

/** Sample Firecrawl search response (v2 shape: data.web[]). */
const SAMPLE_SEARCH_RESPONSE = {
  id: "search-123",
  data: {
    web: [
      {
        title: "Example Domain",
        url: "https://example.com",
        description: "This domain is for use in illustrative examples.",
      },
      {
        title: "Node.js",
        url: "https://nodejs.org",
        description: "Node.js is a JavaScript runtime.",
      },
      {
        title: "Vitest",
        url: "https://vitest.dev",
        description: "A blazing fast test framework.",
      },
    ],
  },
};

/** Alternate search response shape: data.results[]. */
const ALT_SEARCH_RESPONSE_DATA_RESULTS = {
  data: {
    results: [
      { title: "Alt", url: "https://alt.com", description: "Alt result" },
    ],
  },
};

/** Alternate search response shape: top-level results[]. */
const ALT_SEARCH_RESPONSE_TOP_LEVEL = {
  results: [
    { title: "Top", url: "https://top.com", description: "Top result" },
  ],
};

/** Alternate search response shape: top-level web[]. */
const ALT_SEARCH_RESPONSE_WEB = {
  web: [
    { title: "Web", url: "https://web.com", description: "Web result" },
  ],
};

/** Sample Firecrawl scrape response. */
const SAMPLE_SCRAPE_RESPONSE = {
  data: {
    markdown: "# Example Domain\n\nThis domain is for use in illustrative examples.",
    html: "<h1>Example Domain</h1><p>This domain is for use.</p>",
    metadata: {
      title: "Example Domain",
      sourceURL: "https://example.com",
    },
  },
};

// ── Setup / teardown ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_GATEWAY_URL;
  delete process.env.FIRECRAWL_API_URL;
});

// ── isAvailable ─────────────────────────────────────────────────────────────

describe("firecrawl — isAvailable", () => {
  it("returns false when no env var is set", () => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_GATEWAY_URL;
    delete process.env.FIRECRAWL_API_URL;
    expect(firecrawlProvider.isAvailable()).toBe(false);
  });

  it("returns true when FIRECRAWL_API_KEY is set", () => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
    expect(firecrawlProvider.isAvailable()).toBe(true);
  });

  it("returns true when FIRECRAWL_GATEWAY_URL is set (no API key)", () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_GATEWAY_URL = "https://gateway.local";
    expect(firecrawlProvider.isAvailable()).toBe(true);
  });

  it("returns true when FIRECRAWL_API_URL is set (self-hosted, no key)", () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_URL = "https://firecrawl.self-hosted.local";
    expect(firecrawlProvider.isAvailable()).toBe(true);
  });

  it("is a cheap probe (no network call)", () => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    firecrawlProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("firecrawl — provider metadata", () => {
  it("has name 'firecrawl'", () => {
    expect(firecrawlProvider.name).toBe("firecrawl");
  });

  it("supports search", () => {
    expect(firecrawlProvider.supportsSearch).toBe(true);
  });

  it("supports extract", () => {
    expect(firecrawlProvider.supportsExtract).toBe(true);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("firecrawl — search happy path", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("parses results from data.web[] shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test query");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("Example Domain");
    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.description).toContain("illustrative examples");
    expect(results[1]?.title).toBe("Node.js");
    expect(results[2]?.title).toBe("Vitest");
  });

  it("sends POST with Authorization Bearer header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.firecrawl.dev/v2/search");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fc-key-123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes query, limit, and sources in body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.search("test");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.query).toBe("test");
    expect(body.limit).toBe(10);
    expect(body.sources).toEqual([{ type: "web" }]);
  });

  it("respects maxResults option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("sends correct limit in body when maxResults specified", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.search("test", { maxResults: 5 });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.limit).toBe(5);
  });
});

// ── search — alternate response shapes ─────────────────────────────────────

describe("firecrawl — search alternate response shapes", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("parses results from data.results[] shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(ALT_SEARCH_RESPONSE_DATA_RESULTS));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://alt.com");
  });

  it("parses results from top-level results[] shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(ALT_SEARCH_RESPONSE_TOP_LEVEL));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://top.com");
  });

  it("parses results from top-level web[] shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(ALT_SEARCH_RESPONSE_WEB));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://web.com");
  });

  it("returns empty array when no results key is present", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse({ id: "x" }));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── search — empty / no key ─────────────────────────────────────────────────

describe("firecrawl — search empty / no key", () => {
  it("returns empty array for empty query", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when API key is not configured (no gateway)", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_GATEWAY_URL;
    delete process.env.FIRECRAWL_API_URL;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still searches when only FIRECRAWL_GATEWAY_URL is set (no API key)", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_GATEWAY_URL = "https://gateway.local";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Authorization header should NOT be set when no API key
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    // URL should use gateway base
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("gateway.local");
  });

  it("uses FIRECRAWL_API_URL as base URL when set", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
    process.env.FIRECRAWL_API_URL = "https://firecrawl.custom.local";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.search("test");
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("firecrawl.custom.local");
    expect(url).toContain("/v2/search");
  });

  it("uses FIRECRAWL_GATEWAY_URL over FIRECRAWL_API_URL when both are set", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
    process.env.FIRECRAWL_GATEWAY_URL = "https://gateway.local";
    process.env.FIRECRAWL_API_URL = "https://api-url.local";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SEARCH_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.search("test");
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toContain("gateway.local");
    expect(url).not.toContain("api-url.local");
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("firecrawl — search error handling (never throws)", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({ error: "server error" }, false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
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

    const results = await firecrawlProvider.search("test");
    expect(results).toEqual([]);
  });

  it("skips items without a url field", async () => {
    const partialResponse = {
      data: {
        web: [
          { title: "No URL", description: "text" },
          { title: "Valid", url: "https://valid.com", description: "content" },
        ],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(partialResponse));
    globalThis.fetch = fetchSpy;

    const results = await firecrawlProvider.search("test");
    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://valid.com");
  });
});

// ── extract — happy path ───────────────────────────────────────────────────

describe("firecrawl — extract happy path", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("extracts markdown content from a valid URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SCRAPE_RESPONSE));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");

    expect(result.markdown).toContain("Example Domain");
    expect(result.title).toBe("Example Domain");
    expect(result.url).toBe("https://example.com");
    expect(result.error).toBeUndefined();
    expect(result.guardBlock).toBeUndefined();
  });

  it("sends POST to /v2/scrape with correct headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SCRAPE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.extract("https://example.com");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fc-key-123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes url and formats in body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SCRAPE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.extract("https://example.com");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(init?.body as string);
    expect(body.url).toBe("https://example.com");
    expect(body.formats).toEqual(["markdown", "html"]);
  });

  it("falls back to html when markdown is empty", async () => {
    const response = {
      data: {
        markdown: "",
        html: "<h1>Title</h1><p>HTML content</p>",
        metadata: { title: "Title", sourceURL: "https://example.com" },
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");
    expect(result.markdown).toContain("HTML content");
  });
});

// ── extract — error handling ───────────────────────────────────────────────

describe("firecrawl — extract error handling", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("returns error result when API key is not configured (no gateway)", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_GATEWAY_URL;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("FIRECRAWL_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns error result on non-OK HTTP status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({ error: "bad request" }, false, 400),
    );
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("HTTP 400");
  });

  it("returns error result on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("connection refused"));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("connection refused");
  });

  it("returns error result when data is missing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse({}));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("no data");
  });

  it("returns error result when content is empty", async () => {
    const response = {
      data: {
        markdown: "",
        html: "",
        metadata: { title: "Empty", sourceURL: "https://example.com" },
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com");
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

    const result = await firecrawlProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toBeDefined();
  });
});

// ── extract — gateway routing ───────────────────────────────────────────────

describe("firecrawl — extract gateway routing", () => {
  it("uses FIRECRAWL_GATEWAY_URL as base URL for extract", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_GATEWAY_URL = "https://gateway.local/";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SCRAPE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.extract("https://example.com");
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://gateway.local/v2/scrape");
  });

  it("does not send Authorization header when using gateway without API key", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_GATEWAY_URL = "https://gateway.local";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SCRAPE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.extract("https://example.com");
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("strips trailing slash from gateway URL", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_GATEWAY_URL = "https://gateway.local/////";
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_SCRAPE_RESPONSE));
    globalThis.fetch = fetchSpy;

    await firecrawlProvider.extract("https://example.com");
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://gateway.local/v2/scrape");
  });
});

// ── extract — guard integration ─────────────────────────────────────────────

describe("firecrawl — extract guard integration (checkUrl)", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("returns guardBlock for metadata IP", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for private IP", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for secret-bearing URL", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns guardBlock for non-http(s) scheme", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("file:///etc/passwd");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("invalid-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── extract — truncation ───────────────────────────────────────────────────

describe("firecrawl — extract truncation", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("truncates content exceeding maxChars", async () => {
    const longMarkdown = "B".repeat(20_000);
    const response = {
      data: {
        markdown: longMarkdown,
        html: "",
        metadata: { title: "Long", sourceURL: "https://example.com" },
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com", { maxChars: 100 });
    expect(result.markdown.length).toBeLessThan(longMarkdown.length);
    expect(result.markdown).toContain("omitted");
  });

  it("does not truncate content under maxChars", async () => {
    const shortMarkdown = "Short content";
    const response = {
      data: {
        markdown: shortMarkdown,
        html: "",
        metadata: { title: "Short", sourceURL: "https://example.com" },
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(response));
    globalThis.fetch = fetchSpy;

    const result = await firecrawlProvider.extract("https://example.com", { maxChars: 1000 });
    expect(result.markdown).toBe(shortMarkdown);
  });
});

// ── never-throws invariant ──────────────────────────────────────────────────

describe("firecrawl — never throws", () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "fc-key-123";
  });

  it("search never throws — returns empty array on all errors", async () => {
    const cases = [
      () => firecrawlProvider.search(""),
      () => firecrawlProvider.search("   "),
      () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("fail"));
        return firecrawlProvider.search("test");
      },
      () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({}, false, 503));
        return firecrawlProvider.search("test");
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
      const result = await firecrawlProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});