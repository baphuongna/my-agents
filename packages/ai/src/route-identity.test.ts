/**
 * Tests for route-identity: URL normalization, route mismatch detection,
 * and context pin clearing (fail-closed).
 *
 * Ported from Hermes route_identity.py (deep-dive-r2.md §4.2).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeRouteBaseUrl,
  contextRouteMismatch,
  shouldClearContextPin,
} from "./route-identity.js";

// ─── normalizeRouteBaseUrl ─────────────────────────────────────────────────

describe("normalizeRouteBaseUrl", () => {
  it("returns empty string for undefined", () => {
    expect(normalizeRouteBaseUrl(undefined)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(normalizeRouteBaseUrl(null)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(normalizeRouteBaseUrl("")).toBe("");
  });

  it("lowercases scheme", () => {
    expect(normalizeRouteBaseUrl("HTTPS://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("lowercases host", () => {
    expect(normalizeRouteBaseUrl("https://API.OpenAI.COM/v1")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("strips default https port 443", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com:443/v1")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("strips default http port 80", () => {
    expect(normalizeRouteBaseUrl("http://localhost:80/v1")).toBe(
      "http://localhost/v1",
    );
  });

  it("preserves non-default port", () => {
    expect(normalizeRouteBaseUrl("http://localhost:8080/v1")).toBe(
      "http://localhost:8080/v1",
    );
  });

  it("preserves non-default https port", () => {
    expect(normalizeRouteBaseUrl("https://localhost:8443/v1")).toBe(
      "https://localhost:8443/v1",
    );
  });

  it("strips one trailing slash", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("strips only one trailing slash (double becomes single)", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com/v1//")).toBe(
      "https://api.openai.com/v1/",
    );
  });

  it("preserves root slash", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com/")).toBe(
      "https://api.openai.com/",
    );
  });

  it("preserves root slash with default port", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com:443/")).toBe(
      "https://api.openai.com/",
    );
  });

  it("preserves query params", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com/v1?key=val")).toBe(
      "https://api.openai.com/v1?key=val",
    );
  });

  it("preserves query params with trailing slash", () => {
    expect(normalizeRouteBaseUrl("https://api.openai.com/v1/?key=val")).toBe(
      "https://api.openai.com/v1?key=val",
    );
  });

  it("preserves userinfo", () => {
    expect(normalizeRouteBaseUrl("https://user:pass@api.openai.com/v1")).toBe(
      "https://user:pass@api.openai.com/v1",
    );
  });

  it("preserves userinfo with default port", () => {
    expect(normalizeRouteBaseUrl("https://user:pass@api.openai.com:443/v1")).toBe(
      "https://user:pass@api.openai.com/v1",
    );
  });

  it("preserves userinfo with username only", () => {
    expect(normalizeRouteBaseUrl("https://user@api.openai.com/v1")).toBe(
      "https://user@api.openai.com/v1",
    );
  });

  it("fail-closed: returns raw on whitespace (space)", () => {
    const raw = "https://api.openai.com /v1";
    expect(normalizeRouteBaseUrl(raw)).toBe(raw);
  });

  it("fail-closed: returns raw on whitespace (tab)", () => {
    const raw = "https://api.openai.com\t/v1";
    expect(normalizeRouteBaseUrl(raw)).toBe(raw);
  });

  it("fail-closed: returns raw on control character", () => {
    const raw = "https://api.openai.com\x00/v1";
    expect(normalizeRouteBaseUrl(raw)).toBe(raw);
  });

  it("returns raw for non-URL string", () => {
    expect(normalizeRouteBaseUrl("not-a-url")).toBe("not-a-url");
  });

  it("is idempotent (normalizing twice gives same result)", () => {
    const url = "https://api.openai.com:443/v1/";
    const once = normalizeRouteBaseUrl(url);
    const twice = normalizeRouteBaseUrl(once);
    expect(twice).toBe(once);
  });
});

// ─── contextRouteMismatch ──────────────────────────────────────────────────

describe("contextRouteMismatch", () => {
  it("returns false for identical routes", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1" },
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1" },
      ),
    ).toBe(false);
  });

  it("returns false for routes that normalize to the same value", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", baseUrl: "https://api.openai.com:443/v1/" },
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1" },
      ),
    ).toBe(false);
  });

  it("returns true for different routes", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1" },
        { model: "gpt-4", baseUrl: "https://api.openrouter.ai/v1" },
      ),
    ).toBe(true);
  });

  it("returns false when no baseUrl configured (empty route)", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4" },
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1" },
      ),
    ).toBe(false);
  });

  it("returns false when neither has baseUrl and providers match", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", provider: "openai" },
        { model: "gpt-4", provider: "openai" },
      ),
    ).toBe(false);
  });

  it("returns true when providers differ and no URL", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", provider: "openai" },
        { model: "gpt-4", provider: "anthropic" },
      ),
    ).toBe(true);
  });

  it("provider comparison is case-insensitive", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", provider: "OpenAI" },
        { model: "gpt-4", provider: "openai" },
      ),
    ).toBe(false);
  });

  it("returns false when configured has no provider and no URL", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4" },
        { model: "gpt-4", provider: "openai" },
      ),
    ).toBe(false);
  });

  it("returns false when active has no provider and no URL", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", provider: "openai" },
        { model: "gpt-4" },
      ),
    ).toBe(false);
  });

  it("prefers URL comparison over provider when URL is configured", () => {
    expect(
      contextRouteMismatch(
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1", provider: "openai" },
        { model: "gpt-4", baseUrl: "https://api.openai.com/v1", provider: "anthropic" },
      ),
    ).toBe(false);
  });
});

// ─── shouldClearContextPin ─────────────────────────────────────────────────

describe("shouldClearContextPin", () => {
  it("returns true on model mismatch", () => {
    expect(
      shouldClearContextPin("gpt-4", "claude-3", "https://api.openai.com/v1", "https://api.openai.com/v1"),
    ).toBe(true);
  });

  it("returns true on route mismatch with same model", () => {
    expect(
      shouldClearContextPin("gpt-4", "gpt-4", "https://api.openai.com/v1", "https://api.openrouter.ai/v1"),
    ).toBe(true);
  });

  it("returns false on clean match (same model + same route)", () => {
    expect(
      shouldClearContextPin("gpt-4", "gpt-4", "https://api.openai.com/v1", "https://api.openai.com/v1"),
    ).toBe(false);
  });

  it("returns false on clean match with normalization", () => {
    expect(
      shouldClearContextPin("gpt-4", "gpt-4", "https://api.openai.com:443/v1/", "https://api.openai.com/v1"),
    ).toBe(false);
  });

  it("returns false when no URL configured and same model", () => {
    expect(shouldClearContextPin("gpt-4", "gpt-4")).toBe(false);
  });

  it("returns true on provider mismatch when no URL", () => {
    expect(
      shouldClearContextPin("gpt-4", "gpt-4", undefined, undefined, "openai", "anthropic"),
    ).toBe(true);
  });

  it("returns false when configured model is empty", () => {
    expect(shouldClearContextPin("", "gpt-4")).toBe(false);
  });

  it("returns false on same model with same provider and no URL", () => {
    expect(
      shouldClearContextPin("gpt-4", "gpt-4", undefined, undefined, "openai", "openai"),
    ).toBe(false);
  });
});
