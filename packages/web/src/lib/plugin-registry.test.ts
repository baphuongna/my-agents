/**
 * plugin-registry unit tests — pure logic, no DOM.
 *
 * Covers: register/get, unsubscribe, priority ordering, stable insertion
 * order for ties, the useSyncExternalStore subscribe/notify contract, and
 * getSlotComponents referential stability between mutations.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerSlot,
  getSlotComponents,
  subscribe,
  clearRegistry,
  registeredSlotNames,
  registeredSlotCount,
  totalRegistrations,
  DEFAULT_SLOT_PRIORITY,
} from "@/lib/plugin-registry";
import type { PluginSlotName } from "@/lib/plugin-slots";

const SLOT: PluginSlotName = "dashboard:top";

const A = () => null;
const B = () => null;
const C = () => null;

beforeEach(() => {
  clearRegistry();
});

describe("[unit] registerSlot / getSlotComponents", () => {
  it("returns an empty array for a slot with no registrations", () => {
    expect(getSlotComponents("sessions:top")).toEqual([]);
  });

  it("returns registered components in registration order by default", () => {
    registerSlot(SLOT, A);
    registerSlot(SLOT, B);
    expect(getSlotComponents(SLOT)).toEqual([A, B]);
  });

  it("tracks per-slot registrations independently", () => {
    registerSlot(SLOT, A);
    registerSlot("sessions:top", B);
    expect(getSlotComponents(SLOT)).toEqual([A]);
    expect(getSlotComponents("sessions:top")).toEqual([B]);
  });

  it("defaults priority to DEFAULT_SLOT_PRIORITY", () => {
    const unsub = registerSlot(SLOT, A);
    // No priority given → DEFAULT_SLOT_PRIORITY. Verify by registering another
    // with a lower priority which must render first.
    registerSlot(SLOT, B, DEFAULT_SLOT_PRIORITY - 1);
    expect(getSlotComponents(SLOT)).toEqual([B, A]);
    unsub();
  });
});

describe("[unit] registerSlot unsubscribe", () => {
  it("returns a function", () => {
    const unsub = registerSlot(SLOT, A);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("removes only the matching registration", () => {
    const unsubA = registerSlot(SLOT, A);
    registerSlot(SLOT, B);
    expect(getSlotComponents(SLOT)).toEqual([A, B]);

    unsubA();
    expect(getSlotComponents(SLOT)).toEqual([B]);
  });

  it("is idempotent — calling twice removes only once", () => {
    const unsubA = registerSlot(SLOT, A);
    unsubA();
    unsubA();
    expect(getSlotComponents(SLOT)).toEqual([]);
  });

  it("notifies subscribers on register and on unsubscribe", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    const unsubReg = registerSlot(SLOT, A);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubReg();
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });
});

describe("[unit] priority ordering", () => {
  it("renders lower priority first", () => {
    registerSlot(SLOT, A, 50);
    registerSlot(SLOT, B, 10);
    expect(getSlotComponents(SLOT)).toEqual([B, A]);
  });

  it("keeps registration order for equal priorities (stable)", () => {
    registerSlot(SLOT, A, 10);
    registerSlot(SLOT, B, 10);
    registerSlot(SLOT, C, 10);
    expect(getSlotComponents(SLOT)).toEqual([A, B, C]);
  });

  it("mixes explicit and default priorities deterministically", () => {
    registerSlot(SLOT, C, 200); // highest → last
    registerSlot(SLOT, A); // default 100 → middle
    registerSlot(SLOT, B, 1); // lowest → first
    expect(getSlotComponents(SLOT)).toEqual([B, A, C]);
  });

  it("does not affect other slots' ordering", () => {
    registerSlot(SLOT, A, 5);
    registerSlot("skills:top", B, 5);
    registerSlot("skills:top", C, 1);
    expect(getSlotComponents(SLOT)).toEqual([A]);
    expect(getSlotComponents("skills:top")).toEqual([C, B]);
  });
});

describe("[unit] useSyncExternalStore contract", () => {
  it("subscribe returns an unsubscribe function", () => {
    const unsub = subscribe(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("getSlotComponents returns a stable reference between mutations", () => {
    registerSlot(SLOT, A);
    const first = getSlotComponents(SLOT);
    const second = getSlotComponents(SLOT);
    expect(second).toBe(first); // same reference, no mutation in between
  });

  it("getSlotComponents returns a NEW reference after a mutation", () => {
    registerSlot(SLOT, A);
    const before = getSlotComponents(SLOT);
    registerSlot(SLOT, B);
    const after = getSlotComponents(SLOT);
    expect(after).not.toBe(before);
    expect(after).toEqual([A, B]);
  });

  it("getSlotComponents returns a fresh empty array reference after full clear", () => {
    registerSlot(SLOT, A);
    getSlotComponents(SLOT); // prime cache
    clearRegistry();
    expect(getSlotComponents(SLOT)).toEqual([]);
  });

  it("a subscriber sees notifications fire after each mutation", () => {
    const listener = vi.fn();
    subscribe(listener);
    registerSlot(SLOT, A);
    registerSlot("sessions:top", B);
    clearRegistry();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not throw if a subscriber throws (others still notified)", () => {
    const good = vi.fn();
    subscribe(() => {
      throw new Error("boom");
    });
    subscribe(good);
    expect(() => registerSlot(SLOT, A)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("[unit] registry counters", () => {
  it("reports slot count, names, and total registrations", () => {
    expect(registeredSlotCount()).toBe(0);
    expect(registeredSlotNames()).toEqual([]);
    expect(totalRegistrations()).toBe(0);

    registerSlot(SLOT, A);
    registerSlot(SLOT, B);
    registerSlot("sessions:top", C);

    expect(registeredSlotCount()).toBe(2);
    expect(registeredSlotNames().sort()).toEqual(["dashboard:top", "sessions:top"]);
    expect(totalRegistrations()).toBe(3);
  });

  it("counters decrease as components are unsubscribed", () => {
    const unsub = registerSlot(SLOT, A);
    expect(totalRegistrations()).toBe(1);
    unsub();
    expect(totalRegistrations()).toBe(0);
    expect(registeredSlotCount()).toBe(0);
  });
});
