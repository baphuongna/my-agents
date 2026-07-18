/**
 * ddgs.ts tests — DuckDuckGo zero-key search backend.
 *
 * Mocks global `fetch` so no real HTTP request is made. Tests:
 *   - isAvailable (always true — zero-key)
 *   - search happy path (parses HTML results correctly)
 *   - search empty query → empty results
 *   - search empty results page → empty array
 *   - search network error → empty array (never throws)
 *   - search non-OK HTTP status → empty array
 *   - extract not supported → typed error
 *   - extract with blocked URL → guardBlock result
 *   - extract with valid URL → not supported error
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ddgsProvider } from "./ddgs.js";

// ── Mock fetch ─────────────────────────────────────────────────────────────

/** Build a mock Response-like object. */
function mockResponse(html: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

/** Sample DuckDuckGo HTML response with 3 results. */
const SAMPLE_HTML = `
<html><body>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=abc">Example Domain</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">This domain is for use in illustrative examples.</a>
</div>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org&rut=def">Node.js</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org">Node.js is a JavaScript runtime.</a>
</div>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvitest.dev&rut=ghi">Vitest</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvitest.dev">A blazing fast test framework.</a>
</div>
</body></html>
`;

/** HTML response with no results. */
const EMPTY_HTML = `
<html><body>
<div class="no-results">No results found.</div>
</body></html>
`;

// ── Setup / teardown ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Restore original fetch after each test.
  globalThis.fetch = originalFetch;
});

// ── isAvailable ─────────────────────────────────────────────────────────────

describe("ddgs — isAvailable", () => {
  it("returns true (zero-key — no env var needed)", () => {
    expect(ddgsProvider.isAvailable()).toBe(true);
  });

  it("is a cheap probe (no network call)", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    ddgsProvider.isAvailable();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Provider metadata ───────────────────────────────────────────────────────

describe("ddgs — provider metadata", () => {
  it("has name 'ddgs'", () => {
    expect(ddgsProvider.name).toBe("ddgs");
  });

  it("supports search", () => {
    expect(ddgsProvider.supportsSearch).toBe(true);
  });

  it("does not support extract", () => {
    expect(ddgsProvider.supportsExtract).toBe(false);
  });
});

// ── search — happy path ─────────────────────────────────────────────────────

describe("ddgs — search happy path", () => {
  it("parses results from DuckDuckGo HTML", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_HTML));
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("test query");

    expect(results.length).toBe(3);
    expect(results[0]?.title).toBe("Example Domain");
    expect(results[0]?.url).toBe("https://example.com");
    expect(results[0]?.description).toContain("illustrative examples");
    expect(results[1]?.title).toBe("Node.js");
    expect(results[1]?.url).toBe("https://nodejs.org");
    expect(results[2]?.title).toBe("Vitest");
    expect(results[2]?.url).toBe("https://vitest.dev");
  });

  it("sends POST with form-encoded body containing query", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_HTML));
    globalThis.fetch = fetchSpy;

    await ddgsProvider.search("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://html.duckduckgo.com/html/");
    expect(init?.method).toBe("POST");
    // Body should contain the query.
    const body = init?.body;
    expect(typeof body).toBe("string");
    expect(body).toContain("q=hello+world");
  });

  it("respects maxResults option", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_HTML));
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("test", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("passes region option to the request body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_HTML));
    globalThis.fetch = fetchSpy;

    await ddgsProvider.search("test", { region: "uk-en" });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = init?.body;
    expect(body).toContain("kl=uk-en");
  });
});

// ── search — empty / edge cases ─────────────────────────────────────────────

describe("ddgs — search empty / edge cases", () => {
  it("returns empty array for empty query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when HTML has no results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(EMPTY_HTML));
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("nonexistent");
    expect(results).toEqual([]);
  });
});

// ── search — error handling (never throws) ─────────────────────────────────

describe("ddgs — search error handling (never throws)", () => {
  it("returns empty array on network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on timeout (AbortError)", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-OK HTTP status (500)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse("Internal Server Error", false, 500),
    );
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("test");
    expect(results).toEqual([]);
  });

  it("returns empty array when response.text() throws", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error("read error")),
    } as unknown as Response;
    const fetchSpy = vi.fn().mockResolvedValue(badResponse);
    globalThis.fetch = fetchSpy;

    const results = await ddgsProvider.search("test");
    expect(results).toEqual([]);
  });
});

// ── extract — not supported ─────────────────────────────────────────────────

describe("ddgs — extract (not supported)", () => {
  it("returns error result for valid URL (supportsExtract=false)", async () => {
    const result = await ddgsProvider.extract("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.error).toContain("ddgs");
    expect(result.error).toContain("does not support extraction");
    expect(result.guardBlock).toBeUndefined();
  });

  it("returns guardBlock for metadata IP (checkUrl still applies)", async () => {
    const result = await ddgsProvider.extract("http://169.254.169.254/latest/meta-data/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(result.error).toBeUndefined();
  });

  it("returns guardBlock for private IP", async () => {
    const result = await ddgsProvider.extract("http://10.0.0.1/");
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-private");
  });

  it("returns guardBlock for secret-bearing URL", async () => {
    const result = await ddgsProvider.extract(
      "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD",
    );
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
  });

  it("returns guardBlock for non-http(s) scheme", async () => {
    const result = await ddgsProvider.extract("file:///etc/passwd");
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
      const result = await ddgsProvider.extract(url);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
    }
  });
});