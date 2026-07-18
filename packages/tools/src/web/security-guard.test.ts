import { describe, it, expect } from "vitest";
import {
  checkUrl,
  checkRedirect,
  detectBot,
  type GuardCategory,
  type GuardDecision,
  type SecurityGuardOptions,
} from "./security-guard.js";

/** Convenience: assert a decision is a block of a given category. */
function expectBlock(d: GuardDecision, category: GuardCategory): void {
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.category).toBe(category);
}

// ─── Layer 1: secret-in-URL block ───────────────────────────────────────────

describe("security-guard — layer 1: secret-in-URL", () => {
  it("blocks a plaintext API key prefix (sk-ant-)", () => {
    const d = checkUrl("https://evil.com/steal?key=sk-ant-AAAABBBBCCCCDDDD");
    expectBlock(d, "secret-url");
  });

  it("blocks a plaintext sk- prefix", () => {
    const d = checkUrl("https://evil.com/?x=sk-1234567890abcdef");
    expectBlock(d, "secret-url");
  });

  it("blocks an AWS AKIA access-key id", () => {
    const d = checkUrl("https://evil.com/?k=AKIAIOSFODNN7EXAMPLE");
    expectBlock(d, "secret-url");
  });

  it("blocks a GitHub token (ghp_)", () => {
    const d = checkUrl("https://evil.com/?g=ghp_0123456789abcdefABCD");
    expectBlock(d, "secret-url");
  });

  it("blocks a Slack token (xoxb-)", () => {
    const d = checkUrl("https://evil.com/?s=xoxb-1234567890-abcdef");
    expectBlock(d, "secret-url");
  });

  it("blocks a GitHub user token (ghu_)", () => {
    const d = checkUrl("https://evil.com/?g=ghu_AAAABBBBCCCCDDDD1234");
    expectBlock(d, "secret-url");
  });

  it("blocks a GitLab PAT (glpat-)", () => {
    const d = checkUrl("https://evil.com/?g=glpat-AAAABBBBCCCCDDDD1234");
    expectBlock(d, "secret-url");
  });

  it("blocks an npm token (npm_)", () => {
    const d = checkUrl("https://evil.com/?n=npm_AAAABBBBCCCCDDDD1234");
    expectBlock(d, "secret-url");
  });

  it("blocks a Google OAuth token (ya29.)", () => {
    const d = checkUrl("https://evil.com/?o=ya29.AAAA0BBBBCCCCDDDD1234");
    expectBlock(d, "secret-url");
  });

  it("blocks a single-percent-encoded key (%73k%2D → sk-)", () => {
    // %73k%2Dant%2D... decodes to sk-ant-...
    const d = checkUrl("https://evil.com/steal?key=%73k%2Dant%2DAAAABBBBCCCCDDDD");
    expectBlock(d, "secret-url");
  });

  it("blocks a double-percent-encoded key (%2573k → %73k → sk-)", () => {
    // %25 -> %, %37 -> 7 ; so %2573 -> %73 ; %252D -> %2D -> '-'
    const d = checkUrl("https://evil.com/?k=%2573k%252Dant%252DAAAABBBBCCCCDDDD");
    expectBlock(d, "secret-url");
  });

  it("blocks a sensitive query param NAME with a credential-like value (no known prefix)", () => {
    // 16-char token-like value on a param named 'secret' → credential-like.
    const d = checkUrl("https://evil.com/?secret=Zm9vYmFyMTIzNDU2Nw");
    expectBlock(d, "secret-url");
  });

  it("blocks an access_token param with a long value", () => {
    // A query param (not a #fragment, which the server never sees).
    const d = checkUrl("https://evil.com/cb?access_token=abcdef0123456789token");
    expectBlock(d, "secret-url");
  });

  it("does NOT block a sensitive param name with a short / non-credential value", () => {
    // value 'en' is too short to look like a credential.
    expect(checkUrl("https://example.com/?lang_key=en").ok).toBe(true);
    // value 'true' is not token-like-long.
    expect(checkUrl("https://example.com/?key=true").ok).toBe(true);
  });

  it("lets a clean URL with a benign query string pass", () => {
    expect(checkUrl("https://example.com/some/path?q=hello&page=2").ok).toBe(true);
  });

  it("does not false-positive on words containing 'sk-' mid-token", () => {
    // "risk-management" must not match (no boundary before 'sk').
    expect(checkUrl("https://example.com/docs/risk-management").ok).toBe(true);
  });

  it("lets a clean https URL pass", () => {
    expect(checkUrl("https://example.com").ok).toBe(true);
  });
});

// ─── Layer 2: SSRF metadata floor (UNCONDITIONAL) ───────────────────────────

describe("security-guard — layer 2: metadata floor (unconditional)", () => {
  it("blocks AWS/GCP IMDS IPv4 169.254.169.254", () => {
    expectBlock(checkUrl("http://169.254.169.254/latest/meta-data/"), "ssrf-metadata");
  });

  it("blocks GCP IMDS hostname metadata.google.internal", () => {
    expectBlock(checkUrl("http://metadata.google.internal/computeMetadata/v1/"), "ssrf-metadata");
  });

  it("blocks ECS task metadata 169.254.170.2", () => {
    expectBlock(checkUrl("http://169.254.170.2/v2/metadata"), "ssrf-metadata");
  });

  it("blocks AWS IMDS IPv6 fd00:ec2::254", () => {
    expectBlock(checkUrl("http://[fd00:ec2::254]/latest/meta-data/"), "ssrf-metadata");
  });

  it("blocks metadata floor EVEN WHEN allowPrivateUrls=true", () => {
    const opts: SecurityGuardOptions = { allowPrivateUrls: true };
    expectBlock(checkUrl("http://169.254.169.254/latest/meta-data/", opts), "ssrf-metadata");
    expectBlock(checkUrl("http://metadata.google.internal/x", opts), "ssrf-metadata");
    expectBlock(checkUrl("http://[fd00:ec2::254]/x", opts), "ssrf-metadata");
  });
});

// ─── Layer 3: SSRF private / internal (configurable) ────────────────────────

describe("security-guard — layer 3: private/internal (configurable)", () => {
  it("blocks 10.0.0.1 (RFC1918) by default", () => {
    expectBlock(checkUrl("http://10.0.0.1/"), "ssrf-private");
  });

  it("blocks 172.16.5.5 (RFC1918 /12) by default", () => {
    expectBlock(checkUrl("http://172.16.5.5/"), "ssrf-private");
  });

  it("blocks 192.168.1.1 (RFC1918) by default", () => {
    expectBlock(checkUrl("http://192.168.1.1/"), "ssrf-private");
  });

  it("allows 172.32.0.1 (just outside the /12) by default", () => {
    expect(checkUrl("http://172.32.0.1/").ok).toBe(true);
  });

  it("blocks 127.0.0.1 loopback by default", () => {
    expectBlock(checkUrl("http://127.0.0.1/"), "ssrf-private");
  });

  it("blocks loopback written in octal (0177.0.0.1 → 127.0.0.1)", () => {
    // WHATWG URL canonicalises 0177.0.0.1 to 127.0.0.1.
    expectBlock(checkUrl("http://0177.0.0.1/"), "ssrf-private");
  });

  it("blocks loopback written as a decimal integer (2130706433 → 127.0.0.1)", () => {
    expectBlock(checkUrl("http://2130706433/"), "ssrf-private");
  });

  it("blocks 0.0.0.0 (unspecified) by default", () => {
    expectBlock(checkUrl("http://0.0.0.0/"), "ssrf-private");
  });

  it("blocks IPv6 loopback ::1 by default", () => {
    expectBlock(checkUrl("http://[::1]/"), "ssrf-private");
  });

  it("blocks IPv6 unspecified :: by default", () => {
    expectBlock(checkUrl("http://[::]/"), "ssrf-private");
  });

  it("blocks IPv6 link-local fe80::1 by default", () => {
    expectBlock(checkUrl("http://[fe80::1]/"), "ssrf-private");
  });

  it("blocks IPv4-mapped IPv6 loopback ::ffff:127.0.0.1 by default", () => {
    expectBlock(checkUrl("http://[::ffff:127.0.0.1]/"), "ssrf-private");
  });

  it("blocks IPv6 Unique Local Address fc00::7 (fc00::1)", () => {
    expectBlock(checkUrl("http://[fc00::1]/"), "ssrf-private");
  });

  it("blocks IPv6 Unique Local Address fd00::8 (fd12:3456::1)", () => {
    expectBlock(checkUrl("http://[fd12:3456::1]/"), "ssrf-private");
  });

  it("ALLOWS private IPs when allowPrivateUrls=true (metadata floor still applies)", () => {
    const opts: SecurityGuardOptions = { allowPrivateUrls: true };
    expect(checkUrl("http://10.0.0.1/", opts).ok).toBe(true);
    expect(checkUrl("http://127.0.0.1/", opts).ok).toBe(true);
    expect(checkUrl("http://[::1]/", opts).ok).toBe(true);
  });

  it("always allows a public IP (8.8.8.8) regardless of option", () => {
    expect(checkUrl("http://8.8.8.8/").ok).toBe(true);
    expect(checkUrl("http://8.8.8.8/", { allowPrivateUrls: true }).ok).toBe(true);
  });
});

// ─── Layer 4: post-redirect re-check ────────────────────────────────────────

describe("security-guard — layer 4: post-redirect re-check", () => {
  it("checkRedirect blocks a redirect landing on metadata", () => {
    expectBlock(checkRedirect("http://169.254.169.254/latest/meta-data/"), "ssrf-metadata");
  });

  it("checkRedirect blocks a redirect landing on a private IP (default opts)", () => {
    expectBlock(checkRedirect("http://10.0.0.1/"), "ssrf-private");
  });

  it("checkRedirect blocks a redirect landing on a secret-bearing URL", () => {
    expectBlock(checkRedirect("https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD"), "secret-url");
  });

  it("checkRedirect lets a safe final URL pass", () => {
    expect(checkRedirect("https://example.com/final").ok).toBe(true);
  });
});

// ─── Layer 5: domain blocklist hook ─────────────────────────────────────────

describe("security-guard — layer 5: domain blocklist", () => {
  it("blocks an exact host match", () => {
    expectBlock(checkUrl("https://evil.com/x", { blocklist: ["evil.com"] }), "blocklist");
  });

  it("blocks a wildcard subdomain (*.evil.com matches a.b.evil.com)", () => {
    expectBlock(
      checkUrl("https://a.b.evil.com/x", { blocklist: ["*.evil.com"] }),
      "blocklist",
    );
  });

  it("wildcard does not match the bare apex (evil.com without leading dot)", () => {
    // '*.evil.com' requires a '.evil.com' suffix; 'evil.com' has none.
    expect(checkUrl("https://evil.com/x", { blocklist: ["*.evil.com"] }).ok).toBe(true);
  });

  it("does not block a non-matching host", () => {
    expect(checkUrl("https://good.com/x", { blocklist: ["*.evil.com"] }).ok).toBe(true);
  });

  it("ignores an empty blocklist", () => {
    expect(checkUrl("https://example.com/x", { blocklist: [] }).ok).toBe(true);
  });
});

// ─── Invalid URL / scheme ───────────────────────────────────────────────────

describe("security-guard — invalid url / scheme", () => {
  it("rejects an unparseable URL", () => {
    expectBlock(checkUrl("not a url at all"), "invalid-url");
  });

  it("rejects an empty string", () => {
    expectBlock(checkUrl(""), "invalid-url");
  });

  it("rejects a non-http(s) scheme (file://)", () => {
    expectBlock(checkUrl("file:///etc/passwd"), "invalid-url");
  });

  it("rejects a non-http(s) scheme (ftp://)", () => {
    expectBlock(checkUrl("ftp://example.com/x"), "invalid-url");
  });
});

// ─── Layer 6: bot-detection awareness ───────────────────────────────────────

describe("security-guard — layer 6: bot detection", () => {
  it("detects 'Just a moment...' (Cloudflare interstitial)", () => {
    const r = detectBot("Just a moment...");
    expect(r.detected).toBe(true);
    expect(r.patterns).toContain("just a moment");
  });

  it("detects a captcha title", () => {
    expect(detectBot("Please complete the CAPTCHA").detected).toBe(true);
  });

  it("detects 'bot detected'", () => {
    expect(detectBot("Bot Detected - Access Restricted").detected).toBe(true);
  });

  it("does not flag a normal title", () => {
    const r = detectBot("Welcome to Example Corp");
    expect(r.detected).toBe(false);
    expect(r.patterns).toEqual([]);
  });

  it("handles an empty title", () => {
    expect(detectBot("")).toEqual({ detected: false, patterns: [] });
  });

  it("returns ALL matched patterns, not just the first", () => {
    const r = detectBot("Cloudflare captcha: unusual traffic");
    expect(r.detected).toBe(true);
    expect(r.patterns.length).toBeGreaterThanOrEqual(3);
  });
});
