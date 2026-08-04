import { describe, it, expect } from "vitest";
import { HERMES_STUBS, hasHermesStub, getHermesStub } from "./hermes-stubs.js";

describe("[unit] hermes-stubs", () => {
  it("has /auth/me stub", () => {
    expect(hasHermesStub("/auth/me")).toBe(true);
    expect(getHermesStub("/auth/me")).toEqual({ authenticated: true, user: "local", provider: "loopback" });
  });

  it("has /profiles stub", () => {
    expect(hasHermesStub("/profiles")).toBe(true);
    const body = getHermesStub("/profiles") as { profiles: unknown[] };
    expect(body.profiles).toHaveLength(1);
  });

  it("has /dashboard/plugins stub", () => {
    expect(hasHermesStub("/dashboard/plugins")).toBe(true);
  });

  it("pattern stubs: /sessions/stats", () => {
    expect(hasHermesStub("/sessions/stats")).toBe(false); // not in HERMES_STUBS directly
    expect(getHermesStub("/sessions/stats")).toEqual({ total: 0, active: 0, today: 0 });
  });

  it("pattern stubs: /sessions/empty/count", () => {
    expect(getHermesStub("/sessions/empty/count")).toEqual({ count: 0 });
  });

  it("pattern stubs: /profiles/active", () => {
    expect(getHermesStub("/profiles/active")).toEqual({ name: "default" });
  });

  it("unknown path → undefined", () => {
    expect(hasHermesStub("/unknown")).toBe(false);
    expect(getHermesStub("/unknown")).toBeUndefined();
  });

  it("HERMES_STUBS has both / and /api/ variants", () => {
    expect("/auth/me" in HERMES_STUBS).toBe(true);
    expect("/api/auth/me" in HERMES_STUBS).toBe(true);
  });
});
