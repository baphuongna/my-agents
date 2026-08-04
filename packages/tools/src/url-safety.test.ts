import { describe, it, expect, beforeEach } from "vitest";
import { urlSafetyTool } from "./url-safety.js";

describe("[unit] url-safety tool", () => {
  beforeEach(() => { delete process.env.MYA_SAFE_BROWSING_KEY; }, {} as never);

  it("meta has correct name + readOnly mode", () => {
    expect(urlSafetyTool.meta.name).toBe("check_url_safety");
    expect(urlSafetyTool.meta.requiredMode).toBe("ReadOnly");
  }, {} as never);

  it("safe URL → safe=true, no reasons", async () => {
    const r = await urlSafetyTool.run({ url: "https://example.com/docs" }, {} as never);
    expect(r.ok).toBe(true);
    expect((r.output as { safe: boolean }).safe).toBe(true);
    expect((r.output as { reasons: string[] }).reasons).toHaveLength(0);
  }, {} as never);

  it("phishing hostname pattern → unsafe", async () => {
    const r = await urlSafetyTool.run({ url: "https://free-stuff-download.com/x" }, {} as never);
    const out = r.output as { safe: boolean; reasons: string[] };
    expect(out.safe).toBe(false);
    expect(out.reasons.length).toBeGreaterThan(0);
  }, {} as never);

  it("login-secure pattern → unsafe", async () => {
    const r = await urlSafetyTool.run({ url: "https://my-login-secure.net/login" }, {} as never);
    expect((r.output as { safe: boolean }).safe).toBe(false);
  }, {} as never);

  it("hostname-only match (path doesn't trigger) — R1-fix", async () => {
    // wikipedia article about malware should NOT trigger (path match only)
    const r = await urlSafetyTool.run({ url: "https://wikipedia.org/wiki/Malware" }, {} as never);
    expect((r.output as { safe: boolean }).safe).toBe(true);
  }, {} as never);

  it("URL shortener → warning (but still safe)", async () => {
    const r = await urlSafetyTool.run({ url: "https://bit.ly/abc" }, {} as never);
    const out = r.output as { safe: boolean; warnings: string[] };
    expect(out.safe).toBe(true);
    expect(out.warnings.some(w => w.includes("shortener"))).toBe(true);
  }, {} as never);

  it("suspicious TLD → warning", async () => {
    const r = await urlSafetyTool.run({ url: "https://example.tk/page" }, {} as never);
    const out = r.output as { safe: boolean; warnings: string[] };
    expect(out.warnings.some(w => w.includes("suspicious TLD"))).toBe(true);
  }, {} as never);

  it("raw IP hostname → warning", async () => {
    const r = await urlSafetyTool.run({ url: "http://192.168.1.1/admin" }, {} as never);
    const out = r.output as { warnings: string[] };
    expect(out.warnings.some(w => w.includes("raw IP"))).toBe(true);
  }, {} as never);

  it("missing url → error", async () => {
    const r = await urlSafetyTool.run({}, {} as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/url required/);
  }, {} as never);

  it("invalid URL → error", async () => {
    const r = await urlSafetyTool.run({ url: "not a url" }, {} as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid URL/);
  }, {} as never);

  it("hostname in output (lowercase)", async () => {
    const r = await urlSafetyTool.run({ url: "https://Example.COM/Path" }, {} as never);
    expect((r.output as { hostname: string }).hostname).toBe("example.com");
  }, {} as never);
}, {} as never);
