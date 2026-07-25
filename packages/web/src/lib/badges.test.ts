import { describe, it, expect } from "vitest";
import {
  STATE_BADGE,
  TRANSPORT_BADGE,
  TRUST_BADGE,
  UNKNOWN_BADGE,
  resolveBadge,
  type BadgeConfig,
} from "./badges";

describe("[unit] badges", () => {
  describe("STATE_BADGE", () => {
    it("maps known connection states to configs", () => {
      expect(STATE_BADGE.connected.label).toBe("Connected");
      expect(STATE_BADGE.disconnected.label).toBe("Disconnected");
      expect(STATE_BADGE.connecting.label).toBe("Connecting");
      expect(STATE_BADGE.error.label).toBe("Error");
    });

    it("maps health aliases to connected/error", () => {
      expect(STATE_BADGE.healthy.label).toBe("Connected");
      expect(STATE_BADGE.ok.label).toBe("Connected");
      expect(STATE_BADGE.unhealthy.label).toBe("Error");
      expect(STATE_BADGE.degraded.label).toBe("Degraded");
    });

    it("every config carries tailwind colour classes", () => {
      for (const cfg of Object.values(STATE_BADGE)) {
        expect(cfg.className).toMatch(/bg-/);
        expect(cfg.className).toMatch(/text-/);
      }
    });
  });

  describe("TRANSPORT_BADGE", () => {
    it("maps stdio/sse/http transports", () => {
      expect(TRANSPORT_BADGE.stdio.label).toBe("stdio");
      expect(TRANSPORT_BADGE.sse.label).toBe("SSE");
      expect(TRANSPORT_BADGE.http.label).toBe("HTTP");
    });
  });

  describe("TRUST_BADGE", () => {
    it("maps low/medium/high trust levels", () => {
      expect(TRUST_BADGE.low.label).toBe("Low Trust");
      expect(TRUST_BADGE.medium.label).toBe("Medium Trust");
      expect(TRUST_BADGE.high.label).toBe("High Trust");
    });

    it("escalates red → amber → green from low to high", () => {
      expect(TRUST_BADGE.low!.className).toMatch(/text-red-400/);
      expect(TRUST_BADGE.medium!.className).toMatch(/text-amber-400/);
      expect(TRUST_BADGE.high!.className).toMatch(/text-green-400/);
    });
  });

  describe("resolveBadge", () => {
    it("returns the mapped config for a known key", () => {
      const got = resolveBadge(STATE_BADGE, "connected");
      expect(got).toBe(STATE_BADGE.connected);
    });

    it("falls back to UNKNOWN_BADGE when key is undefined", () => {
      expect(resolveBadge(STATE_BADGE, undefined)).toEqual(UNKNOWN_BADGE);
    });

    it("falls back to UNKNOWN_BADGE when key is empty string", () => {
      expect(resolveBadge(TRANSPORT_BADGE, "")).toEqual(UNKNOWN_BADGE);
    });

    it("falls back to a label-bearing config for an unknown key", () => {
      const got = resolveBadge(TRANSPORT_BADGE, "websocket");
      expect(got.label).toBe("websocket");
      expect(got.className).toBe(UNKNOWN_BADGE.className);
    });

    it("works with an empty mapping", () => {
      const map: Record<string, BadgeConfig> = {};
      expect(resolveBadge(map, "anything").label).toBe("anything");
      expect(resolveBadge(map, undefined)).toEqual(UNKNOWN_BADGE);
    });

    it("is consistent for the same unknown key", () => {
      const a = resolveBadge(TRUST_BADGE, "unknown-level");
      const b = resolveBadge(TRUST_BADGE, "unknown-level");
      expect(a).toEqual(b);
    });
  });
});
