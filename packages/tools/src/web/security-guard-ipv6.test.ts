/**
 * security-guard-ipv6.test.ts — RED BASELINE for Bug C (Phase 5 audit).
 *
 * Bug: `packages/tools/src/web/security-guard.ts` declares
 *   `METADATA_IPV6 = ["fd00:ec2::254"]` at line 113 and `isMetadataHost`
 *   (line 321) only matches against this explicit list. IPv4-mapped IPv6
 *   forms like `::ffff:169.254.169.254` and `::ffff:169.254.170.2` are
 *   NOT recognized as cloud metadata endpoints — they're treated as
 *   generic private/internal hosts (caught by layer 3 with category
 *   `ssrf-private`) instead of the unconditional metadata floor (layer 2,
 *   category `ssrf-metadata`).
 *
 * Why this matters: layer 3 is gated by `allowPrivateUrls`. A future caller
 * who opts into private URLs (e.g. a local-only agent) would UNBLOCK
 * `[::ffff:169.254.169.254]` because layer 3 returns ok, but the host is
 * still a cloud metadata endpoint and must remain unconditionally blocked.
 * The category also matters for observability: an alert on `ssrf-metadata`
 *   is a security incident (IAM credential exfil), whereas `ssrf-private`
 *   is a config mistake (RFC1918 in a public path).
 *
 * Root cause: `isMetadataHost` only iterates the explicit `METADATA_IPV6`
 * list. It never calls the existing `extractEmbeddedIPv4` helper (line 227)
 * to recognize IPv4-mapped forms, and never checks the 0xfe9/0xfea lower
 * octets that cover 169.254.x.x (link-local) mapped into IPv6.
 *
 * Minimal fix (NOT applied — this is the red baseline):
 *   1. In `isMetadataHost`, after the existing `METADATA_IPV6` loop, check
 *      if the host is an IPv6 with embedded IPv4 (`extractEmbeddedIPv4`)
 *      AND that embedded IPv4 is in `METADATA_HOSTS` → return true.
 *   2. Also check the case where groups[6] / groups[7] match the 0xfe9x /
 *      0xfeax lower-octet pattern (covers 169.254.169.254 and 169.254.170.2
 *      in mapped form).
 *
 * This test MUST fail under the current code and pass after the fix.
 */
import { describe, it, expect } from "vitest";
import { checkUrl } from "./security-guard.js";

/** Wrapper that asserts both `ok === false` AND the category. */
function expectMetadataBlock(url: string): void {
  const d = checkUrl(url);
  expect(d.ok).toBe(false);
  if (!d.ok) {
    expect(d.category).toBe("ssrf-metadata");
  }
}

// ─── Bug C: IPv4-mapped IPv6 metadata bypass ─────────────────────────────────

describe("security-guard — IPv6 metadata floor must recognize IPv4-mapped forms", () => {
  it("blocks http://[::ffff:169.254.169.254]/ as ssrf-metadata (AWS IMDS IPv4-mapped)", () => {
    // RED BASELINE: today this returns ok=false with category='ssrf-private'
    // (caught by layer 3 via extractEmbeddedIPv4 → ipv4InBlockedRange).
    // After the fix, the metadata floor (layer 2) must fire FIRST so the
    // category is 'ssrf-metadata' AND the block is unconditional (not
    // bypassable by allowPrivateUrls).
    const d = checkUrl("http://[::ffff:169.254.169.254]/");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-metadata");
    }
  });

  it("blocks http://[::ffff:169.254.170.2]/ as ssrf-metadata (AWS ECS task metadata IPv4-mapped)", () => {
    // Same shape as the IMDS test, but for ECS task metadata (169.254.170.2).
    // Today: returns ssrf-private. After fix: must return ssrf-metadata.
    const d = checkUrl("http://[::ffff:169.254.170.2]/");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-metadata");
    }
  });

  it("blocks http://[::ffff:169.254.169.254]/latest/meta-data/ as ssrf-metadata", () => {
    // Realistic IMDS path on the IPv4-mapped form.
    const d = checkUrl("http://[::ffff:169.254.169.254]/latest/meta-data/");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-metadata");
    }
  });

  it("blocks http://[::ffff:169.254.169.254]/ even when allowPrivateUrls=true (unconditional floor)", () => {
    // The metadata floor MUST be unconditional. Even if a caller passes
    // allowPrivateUrls=true (e.g. local-only agent), the IPv4-mapped IMDS
    // address must remain blocked with category='ssrf-metadata'.
    // Today: returns ssrf-private (which IS bypassable — the block is
    //         suppressed by allowPrivateUrls=true and the host passes!).
    // After fix: returns ssrf-metadata unconditionally.
    const d = checkUrl("http://[::ffff:169.254.169.254]/", { allowPrivateUrls: true });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-metadata");
    }
  });

  it("blocks http://[::ffff:169.254.170.2]/ even when allowPrivateUrls=true", () => {
    // Same as above for ECS task metadata.
    const d = checkUrl("http://[::ffff:169.254.170.2]/", { allowPrivateUrls: true });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-metadata");
    }
  });
});

// ─── Regression guards (existing IPv6 metadata behavior must NOT break) ──────

describe("security-guard — IPv6 metadata floor regression guards", () => {
  it("still blocks the explicit fd00:ec2::254 form as ssrf-metadata", () => {
    // The existing IPv6 metadata address must continue to be blocked.
    expectMetadataBlock("http://[fd00:ec2::254]/latest/meta-data/");
  });

  it("still blocks the explicit fd00:ec2::254 form with allowPrivateUrls=true", () => {
    expectMetadataBlock("http://[fd00:ec2::254]/latest/meta-data/");
  });

  it("still allows a non-metadata IPv6 host (e.g. 2001:db8::1)", () => {
    const d = checkUrl("http://[2001:db8::1]/");
    expect(d.ok).toBe(true);
  });

  it("still blocks ::1 (IPv6 loopback) as ssrf-private", () => {
    // ::1 is private/internal, NOT metadata. Must remain ssrf-private so
    // the security gauntlet categories stay consistent.
    const d = checkUrl("http://[::1]/");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-private");
    }
  });

  it("still blocks ::ffff:127.0.0.1 (IPv4-mapped IPv6 loopback) as ssrf-private", () => {
    // 127.0.0.1 is loopback, NOT a cloud metadata endpoint. The category
    // must remain ssrf-private (not ssrf-metadata) so it doesn't pollute
    // metadata-alert telemetry.
    const d = checkUrl("http://[::ffff:127.0.0.1]/");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-private");
    }
  });

  it("still blocks ::ffff:10.0.0.1 (IPv4-mapped RFC1918) as ssrf-private", () => {
    // 10.0.0.1 is RFC1918, NOT metadata. Must remain ssrf-private.
    const d = checkUrl("http://[::ffff:10.0.0.1]/");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.category).toBe("ssrf-private");
    }
  });
});

// ─── Combined gauntlet behavior ──────────────────────────────────────────────

describe("security-guard — IPv6-mapped metadata + secret-in-URL", () => {
  it("blocks http://[::ffff:169.254.169.254]/?key=AKIA… with secret-url (layer 1 wins)", () => {
    // When multiple layers apply, the secret-in-URL layer (1) is checked
    // first per the existing gauntlet order. The category must be
    // 'secret-url', NOT 'ssrf-metadata'.
    const d = checkUrl(
      "http://[::ffff:169.254.169.254]/?key=AKIAIOSFODNN7EXAMPLE",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      // Layer 1 (secret-in-URL) fires before layer 2 (metadata).
      expect(d.category).toBe("secret-url");
    }
  });
});

// Sanity guard: helper functions used in the file (no-op test to ensure
// the import actually loaded).
describe("security-guard — sanity", () => {
  it("exports checkUrl", () => {
    expect(typeof checkUrl).toBe("function");
  });
});