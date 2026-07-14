import { describe, it, expect } from "vitest";
import { validateDeepLink, verifyUpdate, SidecarLifecycle, type UpdateDeclaration } from "./index.js";

describe("validateDeepLink", () => {
  it("accepts valid open action with sessionId", () => {
    const result = validateDeepLink("myagent://open?sessionId=abc123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.link.host).toBe("open");
      expect(result.link.params.sessionId).toBe("abc123");
    }
  });

  it("accepts approve action with both required params", () => {
    const result = validateDeepLink("myagent://approve?sessionId=s1&callId=c1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.link.params.callId).toBe("c1");
    }
  });

  it("accepts focus action (no required params)", () => {
    const result = validateDeepLink("myagent://focus");
    expect(result.ok).toBe(true);
  });

  it("rejects missing required params", () => {
    const result = validateDeepLink("myagent://open");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing");
  });

  it("rejects unknown action", () => {
    const result = validateDeepLink("myagent://delete?sessionId=x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unknown");
  });

  it("rejects wrong scheme", () => {
    const result = validateDeepLink("https://open?sessionId=x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("scheme");
  });

  it("rejects malformed URI", () => {
    const result = validateDeepLink("not a url at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("malformed");
  });
});

describe("verifyUpdate", () => {
  it("rejects missing signature", () => {
    const decl: UpdateDeclaration = {
      version: "1.0.0",
      url: "https://example.com/update",
      contentHash: "abc123",
    } as unknown as UpdateDeclaration;

    const result = verifyUpdate(decl);
    expect(result.ok).toBe(false);
  });
});

describe("SidecarLifecycle", () => {
  it("starts in booting state", () => {
    const lifecycle = new SidecarLifecycle({ readiness: () => ({ ok: false }) });
    expect(lifecycle.state).toBe("booting");
  });

  it("transitions to ready when readiness ok", async () => {
    const lifecycle = new SidecarLifecycle({ readiness: () => ({ ok: true }) });
    await lifecycle.waitForReady({ timeoutMs: 1000, pollMs: 10 });
    expect(lifecycle.state).toBe("ready");
  });

  it("transitions to degraded on timeout", async () => {
    const lifecycle = new SidecarLifecycle({ readiness: () => ({ ok: false }) });
    await lifecycle.waitForReady({ timeoutMs: 50, pollMs: 10 });
    expect(lifecycle.state).toBe("degraded");
  });

  it("transitions to stopped", () => {
    const lifecycle = new SidecarLifecycle({ readiness: () => ({ ok: true }) });
    lifecycle.stop();
    expect(lifecycle.state).toBe("stopped");
  });
});
