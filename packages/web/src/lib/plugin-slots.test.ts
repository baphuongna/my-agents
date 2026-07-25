/**
 * plugin-slots unit tests — pure logic, no DOM.
 *
 * Covers: KNOWN_SLOT_NAMES completeness, no accidental duplicates,
 * isValidSlot type guard happy/negative paths.
 */
import { describe, it, expect } from "vitest";
import {
  KNOWN_SLOT_NAMES,
  isValidSlot,
  SLOT_DESCRIPTIONS,
  type PluginSlotName,
} from "@/lib/plugin-slots";

describe("[unit] KNOWN_SLOT_NAMES", () => {
  it("contains the shell-wide slots", () => {
    expect(KNOWN_SLOT_NAMES).toContain("sidebar:top");
    expect(KNOWN_SLOT_NAMES).toContain("sidebar:bottom");
    expect(KNOWN_SLOT_NAMES).toContain("header:start");
    expect(KNOWN_SLOT_NAMES).toContain("header:end");
  });

  it("contains top+bottom page-scoped slots for every main page", () => {
    const pages = [
      "dashboard",
      "sessions",
      "skills",
      "config",
      "system",
      "models",
      "tools",
    ];
    for (const page of pages) {
      expect(KNOWN_SLOT_NAMES).toContain(`${page}:top` as PluginSlotName);
      expect(KNOWN_SLOT_NAMES).toContain(`${page}:bottom` as PluginSlotName);
    }
  });

  it("has no duplicate slot names", () => {
    const dupes = KNOWN_SLOT_NAMES.filter(
      (n, i) => KNOWN_SLOT_NAMES.indexOf(n) !== i,
    );
    expect(dupes).toEqual([]);
  });

  it("has exactly 18 slots (4 shell-wide + 7 pages × 2)", () => {
    expect(KNOWN_SLOT_NAMES).toHaveLength(18);
  });
});

describe("[unit] isValidSlot", () => {
  it("returns true for known slot names", () => {
    expect(isValidSlot("dashboard:top")).toBe(true);
    expect(isValidSlot("sidebar:bottom")).toBe(true);
    expect(isValidSlot("tools:bottom")).toBe(true);
  });

  it("returns false for unknown / malformed names", () => {
    expect(isValidSlot("dashboard:middle")).toBe(false);
    expect(isValidSlot("unknown:top")).toBe(false);
    expect(isValidSlot("")).toBe(false);
    expect(isValidSlot("dashboard")).toBe(false);
    expect(isValidSlot("header-left")).toBe(false); // Hermes naming, not mya's
  });

  it("narrows the type", () => {
    const maybe: string = "sessions:bottom";
    if (isValidSlot(maybe)) {
      // `maybe` is now PluginSlotName; assignable to the description record key
      const _desc: string = SLOT_DESCRIPTIONS[maybe];
      expect(_desc).toBe("Bottom of the Sessions page");
    } else {
      throw new Error("should have validated");
    }
  });
});

describe("[unit] SLOT_DESCRIPTIONS", () => {
  it("has a description for every known slot", () => {
    for (const name of KNOWN_SLOT_NAMES) {
      expect(SLOT_DESCRIPTIONS[name]).toBeTruthy();
    }
  });

  it("has no keys outside KNOWN_SLOT_NAMES", () => {
    const keys = new Set(Object.keys(SLOT_DESCRIPTIONS));
    for (const name of KNOWN_SLOT_NAMES) {
      expect(keys.has(name)).toBe(true);
    }
    expect(keys.size).toBe(KNOWN_SLOT_NAMES.length);
  });
});
