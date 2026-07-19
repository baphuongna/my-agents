import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  checkUrlAsync,
  _setDnsResolverForTest,
} from "./security-guard.js";

// We inject the DNS resolver (no vi.mock of node:dns/promises) so we can
// simulate DNS-rebinding — a hostname that resolves to a private / metadata
// IP — deterministically, without real network DNS.
function resolverOf(addrs: { address: string; family: number }[]) {
  return async () => addrs;
}

describe("checkUrlAsync — DNS-rebinding protection (G1)", () => {
  afterEach(() => _setDnsResolverForTest(null)); // restore real resolver

  it("blocks a hostname that resolves to a private IP (RFC1918)", async () => {
    _setDnsResolverForTest(resolverOf([{ address: "10.0.0.5", family: 4 }]));
    const d = await checkUrlAsync("https://internal.corp.example/page");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-private");
  });

  it("blocks a hostname that resolves to loopback", async () => {
    _setDnsResolverForTest(resolverOf([{ address: "127.0.0.1", family: 4 }]));
    const d = await checkUrlAsync("https://localhost-alias.evil/page");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-private");
  });

  it("blocks a hostname resolving to cloud metadata (UNCONDITIONAL, even with allowPrivateUrls)", async () => {
    _setDnsResolverForTest(
      resolverOf([{ address: "169.254.169.254", family: 4 }]),
    );
    const d = await checkUrlAsync("https://imds-alias.evil/page", {
      allowPrivateUrls: true,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-metadata");
  });

  it("blocks a hostname resolving to the AWS IMDS IPv6 (fd00:ec2::254)", async () => {
    _setDnsResolverForTest(
      resolverOf([{ address: "fd00:ec2::254", family: 6 }]),
    );
    const d = await checkUrlAsync("https://imds6.evil/page");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-metadata");
  });

  it("allows a hostname that resolves to a public IP", async () => {
    _setDnsResolverForTest(resolverOf([{ address: "93.184.216.34", family: 4 }]));
    const d = await checkUrlAsync("https://example.com/");
    expect(d.ok).toBe(true);
  });

  it("fail-closed on DNS resolution error", async () => {
    _setDnsResolverForTest(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const d = await checkUrlAsync("https://nonexistent.invalid/page");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-private");
  });

  it("blocks if ANY resolved address is private (multi-record split-horizon)", async () => {
    _setDnsResolverForTest(
      resolverOf([
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ]),
    );
    const d = await checkUrlAsync("https://split.evil/page");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-private");
  });

  it("does NOT call DNS for an IP literal (sync path handles it)", async () => {
    let called = false;
    _setDnsResolverForTest(async () => {
      called = true;
      return [];
    });
    const d = await checkUrlAsync("https://127.0.0.1/");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-private");
    expect(called).toBe(false);
  });

  it("allowPrivateUrls=true permits a private resolved IP", async () => {
    _setDnsResolverForTest(resolverOf([{ address: "10.0.0.5", family: 4 }]));
    const d = await checkUrlAsync("https://internal.corp.example/page", {
      allowPrivateUrls: true,
    });
    expect(d.ok).toBe(true);
  });

  it("still runs the sync secret-in-URL gauntlet before DNS", async () => {
    let called = false;
    _setDnsResolverForTest(async () => {
      called = true;
      return [];
    });
    const d = await checkUrlAsync(
      "https://example.com/?key=sk-ant-1234567890abcdef",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("secret-url");
    expect(called).toBe(false);
  });

  it("a public hostname with all-public records passes", async () => {
    _setDnsResolverForTest(
      resolverOf([
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]),
    );
    const d = await checkUrlAsync("https://example.com/");
    expect(d.ok).toBe(true);
  });

  it("fail-closed on an empty DNS answer (defense-in-depth)", async () => {
    _setDnsResolverForTest(resolverOf([]));
    const d = await checkUrlAsync("https://empty.evil/page");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.category).toBe("ssrf-private");
  });
});
