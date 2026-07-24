/**
 * resolve-page-title unit tests — pure logic, no DOM.
 *
 * Covers: known builtin routes, plugin-tab override, fallback capitalize,
 * trailing-slash normalization, and the root path.
 */
import { describe, it, expect } from "vitest";
import { resolvePageTitle } from "@/lib/resolve-page-title";
import { en } from "@/lib/i18n/en.js";
import type { Translations } from "@/lib/i18n";

const t: Translations = en;

describe("[unit] resolvePageTitle — known routes", () => {
  it("maps builtin routes to their localized titles", () => {
    expect(resolvePageTitle("/chat", t)).toBe("Chat");
    expect(resolvePageTitle("/sessions", t)).toBe("Sessions");
    expect(resolvePageTitle("/events", t)).toBe("Live Events");
    expect(resolvePageTitle("/cron", t)).toBe("Cron");
    expect(resolvePageTitle("/models", t)).toBe("Models");
    expect(resolvePageTitle("/analytics", t)).toBe("Analytics");
    expect(resolvePageTitle("/logs", t)).toBe("Logs");
  });

  it("maps API-keys route to the localized label", () => {
    expect(resolvePageTitle("/keys", t)).toBe("API Keys");
  });

  it("maps the MCP route", () => {
    expect(resolvePageTitle("/mcp", t)).toBe("MCP");
  });
});

describe("[unit] resolvePageTitle — normalization + root", () => {
  it("strips a trailing slash", () => {
    expect(resolvePageTitle("/chat/", t)).toBe("Chat");
    expect(resolvePageTitle("/sessions//", t)).toBe("Sessions");
  });

  it("returns the main title for the root path", () => {
    expect(resolvePageTitle("/", t)).toBe(t.main);
  });
});

describe("[unit] resolvePageTitle — plugin tabs", () => {
  it("a plugin tab label overrides the builtin mapping", () => {
    const tabs = [{ path: "/chat", label: "Super Chat" }];
    expect(resolvePageTitle("/chat", t, tabs)).toBe("Super Chat");
  });

  it("a plugin tab adds a brand-new route", () => {
    const tabs = [{ path: "/custom-tool", label: "Custom Tool" }];
    expect(resolvePageTitle("/custom-tool", t, tabs)).toBe("Custom Tool");
  });

  it("no plugin tabs fall through to builtin / capitalize", () => {
    expect(resolvePageTitle("/tools", t)).toBe("Tools");
    expect(resolvePageTitle("/tools", t, undefined)).toBe("Tools");
  });
});

describe("[unit] resolvePageTitle — fallback capitalize", () => {
  it("capitalizes the first segment of an unknown single-segment path", () => {
    expect(resolvePageTitle("/profiles", t)).toBe("Profiles");
    expect(resolvePageTitle("/dashboard", t)).toBe("Dashboard");
    expect(resolvePageTitle("/webhooks", t)).toBe("Webhooks");
  });

  it("uses only the first segment for a nested path", () => {
    expect(resolvePageTitle("/profiles/new", t)).toBe("Profiles");
    expect(resolvePageTitle("/foo/bar/baz", t)).toBe("Foo");
  });

  it("capitalizes a single-letter segment", () => {
    expect(resolvePageTitle("/x", t)).toBe("X");
  });
});
