import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { osvCheckTool } from "./osv-check.js";

describe("[unit] osv-check tool", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("meta: name + readOnly", () => {
    expect(osvCheckTool.meta.name).toBe("osv_check");
    expect(osvCheckTool.meta.requiredMode).toBe("ReadOnly");
  });

  it("missing package/version → error", async () => {
    const r = await osvCheckTool.run({ package: "lodash" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/package \+ version required/);
  });

  it("no vulnerabilities → vulnerable=false", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as never;
    const r = await osvCheckTool.run({ package: "safe-pkg", version: "1.0.0" });
    expect(r.ok).toBe(true);
    expect((r.output as { vulnerable: boolean }).vulnerable).toBe(false);
    expect((r.output as { count: number }).count).toBe(0);
  });

  it("vulnerabilities found → vulnerable=true + details", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      vulns: [
        { id: "GHSA-1234", summary: "XSS in lib", severity: [{ type: "CVSS_V3", score: "7.5" }] },
      ],
    }), { status: 200 })) as never;
    const r = await osvCheckTool.run({ package: "lodash", version: "4.17.20" });
    expect(r.ok).toBe(true);
    const out = r.output as { vulnerable: boolean; count: number; vulnerabilities: Array<{ id: string; severity: string }> };
    expect(out.vulnerable).toBe(true);
    expect(out.count).toBe(1);
    expect(out.vulnerabilities[0]!.id).toBe("GHSA-1234");
    expect(out.vulnerabilities[0]!.severity).toBe("7.5");
  });

  it("API error → tool error", async () => {
    global.fetch = vi.fn(async () => new Response("err", { status: 500 })) as never;
    const r = await osvCheckTool.run({ package: "x", version: "1.0" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OSV API 500/);
  });

  it("network error → caught + error message", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as never;
    const r = await osvCheckTool.run({ package: "x", version: "1.0" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it("default ecosystem is npm", async () => {
    let capturedBody: string | undefined;
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({}), { status: 200 });
    }) as never;
    await osvCheckTool.run({ package: "pkg", version: "1.0" });
    expect(JSON.parse(capturedBody!).package.ecosystem).toBe("npm");
  });
});
