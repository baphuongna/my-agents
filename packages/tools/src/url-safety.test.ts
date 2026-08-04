import { describe, it, expect, beforeEach } from "vitest";
import { urlSafetyTool } from "./url-safety.js";

describe("[unit] url-safety tool", () => {
  beforeEach(() => { delete process.env.MYA_SAFE_BROWSING_KEY; });

  it("meta has correct name + readOnly mode", () => {
    expect(urlSafetyTool.meta.name).toBe("check_url_safety");
    expect(urlSafetyTool.meta.requiredMode).toBe("ReadOnly");
  });

  it("safe URL → safe=true, no reasons", async () => {
    const r = await urlSafetyTool.run({ url: "https://example.com/docs" });
    expect(r.ok).toBe(true);
    expect((r.output as { safe: boolean }).safe).toBe(true);
    expect((r.output as { reasons: string[] }).reasons).toHaveLength(0);
  });

  it("phishing hostname pattern → unsafe", async () => {
    const r = await urlSafetyTool.run({ url: "https://free-stuff-download.com/x" });
    const out = r.output as { safe: boolean; reasons: string[] };
    expect(out.safe).toBe(false);
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("login-secure pattern → unsafe", async () => {
    const r = await urlSafetyTool.run({ url: "https://my-login-secure.net/login" });
    expect((r.output as { safe: boolean }).safe).toBe(false);
  });

  it("hostname-only match (path doesn't trigger) — R1-fix", async () => {
    // wikipedia article about malware should NOT trigger (path match only)
    const r = await urlSafetyTool.run({ url: "https://wikipedia.org/wiki/Malware" });
    expect((r.output as { safe: boolean }).safe).toBe(true);
  });

  it("URL shortener → warning (but still safe)", async () => {
    const r = await urlSafetyTool.run({ url: "https://bit.ly/abc" });
    const out = r.output as { safe: boolean; warnings: string[] };
    expect(out.safe).toBe(true);
    expect(out.warnings.some(w => w.includes("shortener"))).toBe(true);
  });

  it("suspicious TLD → warning", async () => {
    const r = await urlSafetyTool.run({ url: "https://example.tk/page" });
    const out = r.output as { safe: boolean; warnings: string[] };
    expect(out.warnings.some(w => w.includes("suspicious TLD"))).toBe(true);
  });

  it("raw IP hostname → warning", async () => {
    const r = await urlSafetyTool.run({ url: "http://192.168.1.1/admin" });
    const out = r.output as { warnings: string[] };
    expect(out.warnings.some(w => w.includes("raw IP"))).toBe(true);
  });

  it("missing url → error", async () => {
    const r = await urlSafetyTool.run({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/url required/);
  });

  it("invalid URL → error", async () => {
    const r = await urlSafetyTool.run({ url: "not a url" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid URL/);
  });

  it("hostname in output (lowercase)", async () => {
    const r = await urlSafetyTool.run({ url: "https://Example.COM/Path" });
    expect((r.output as { hostname: string }).hostname).toBe("example.com");
  });
});
