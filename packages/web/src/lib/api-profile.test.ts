// @vitest-environment node
/**
 * api-profile — withProfile URL construction + management-profile scope.
 *
 * Pure logic tests (no DOM). Covers: global scope injection, explicit
 * param override, non-scoped passthrough, existing-param passthrough, and
 * the setManagementProfile/getManagementProfile round-trip.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  withProfile,
  setManagementProfile,
  getManagementProfile,
} from "@/lib/api";

describe("[unit] withProfile URL construction", () => {
  beforeEach(() => {
    setManagementProfile("");
  });

  it("returns the URL unchanged when no scope is set", () => {
    expect(withProfile("/sessions")).toBe("/sessions");
    expect(withProfile("/config?raw=1")).toBe("/config?raw=1");
  });

  it("appends ?profile= to a scoped endpoint when global scope is set", () => {
    setManagementProfile("work");
    expect(withProfile("/sessions")).toBe("/sessions?profile=work");
    expect(withProfile("/config")).toBe("/config?profile=work");
    expect(withProfile("/models")).toBe("/models?profile=work");
    expect(withProfile("/cron/jobs")).toBe("/cron/jobs?profile=work");
    expect(withProfile("/skills")).toBe("/skills?profile=work");
    expect(withProfile("/mcp/servers")).toBe("/mcp/servers?profile=work");
    expect(withProfile("/tools")).toBe("/tools?profile=work");
  });

  it("uses & when the URL already has a query string", () => {
    setManagementProfile("work");
    expect(withProfile("/sessions?limit=20")).toBe(
      "/sessions?limit=20&profile=work",
    );
    expect(withProfile("/config?raw=1&foo=bar")).toBe(
      "/config?raw=1&foo=bar&profile=work",
    );
  });

  it("URL-encodes the profile name", () => {
    setManagementProfile("a & b/c");
    expect(withProfile("/sessions")).toBe("/sessions?profile=a%20%26%20b%2Fc");
  });

  it("does not touch non-scoped endpoints", () => {
    setManagementProfile("work");
    expect(withProfile("/health/live")).toBe("/health/live");
    expect(withProfile("/ready")).toBe("/ready");
    expect(withProfile("/status")).toBe("/status");
    expect(withProfile("/profiles")).toBe("/profiles");
    expect(withProfile("/profiles/active")).toBe("/profiles/active");
    expect(withProfile("/pool/sessions")).toBe("/pool/sessions");
    expect(withProfile("/sync/state")).toBe("/sync/state");
    expect(withProfile("/memory/stats")).toBe("/memory/stats");
  });

  it("explicit profile param always wins over global scope", () => {
    setManagementProfile("work");
    expect(withProfile("/sessions", "personal")).toBe(
      "/sessions?profile=personal",
    );
    expect(withProfile("/config", "personal")).toBe(
      "/config?profile=personal",
    );
  });

  it("explicit empty-string profile suppresses scoping", () => {
    setManagementProfile("work");
    expect(withProfile("/sessions", "")).toBe("/sessions");
  });

  it("never overwrites an existing profile= param", () => {
    setManagementProfile("work");
    expect(withProfile("/sessions?profile=other")).toBe(
      "/sessions?profile=other",
    );
    expect(withProfile("/sessions?limit=5&profile=other")).toBe(
      "/sessions?limit=5&profile=other",
    );
    // explicit arg also yields to the pre-existing param
    expect(withProfile("/sessions?profile=other", "personal")).toBe(
      "/sessions?profile=other",
    );
  });

  it("setManagementProfile trims whitespace", () => {
    setManagementProfile("  work  ");
    expect(getManagementProfile()).toBe("work");
    expect(withProfile("/sessions")).toBe("/sessions?profile=work");
  });

  it("setManagementProfile with empty/whitespace clears the scope", () => {
    setManagementProfile("work");
    setManagementProfile("   ");
    expect(getManagementProfile()).toBe("");
    expect(withProfile("/sessions")).toBe("/sessions");
  });

  it("getManagementProfile returns the raw current scope", () => {
    setManagementProfile("acme");
    expect(getManagementProfile()).toBe("acme");
  });
});
