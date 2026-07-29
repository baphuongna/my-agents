/**
 * Plugin slot registration store.
 *
 * A small external store backing {@link PluginSlot}. Components register
 * themselves against a slot name; `PluginSlot` reads them reactively via
 * `useSyncExternalStore`, so plugins that register after a page mounts appear
 * without a manual refresh.
 *
 * Design notes:
 * - The store is a module-level singleton (one registry per app).
 * - `registerSlot` returns an unsubscribe function for tear-down / HMR.
 * - Priority controls render order: lower numbers render first; ties keep
 *   registration (insertion) order (stable sort).
 * - `getSlotComponents` returns a *memoized* array reference that only changes
 *   when the registry mutates, so it is safe to pass as the snapshot to
 *   `useSyncExternalStore` (which compares snapshots with `Object.is`).
 */
import type { ComponentType } from "react";
import type { PluginSlotName } from "./plugin-slots";

type Listener = () => void;

/** A registered component paired with its unique stable key. */
export interface SlotComponent {
  id: number;
  component: ComponentType;
}

interface SlotEntry {
  component: ComponentType;
  priority: number;
  /** Unique monotonic id for stable React keys. */
  id: number;
}

/** Default priority when none is given. Mid-range so plugins can render
 *  before (lower) or after (higher) the default. */
export const DEFAULT_SLOT_PRIORITY = 100;

/** Monotonic registration id — keeps stable insertion order for tie-breaks. */
let nextRegistrationId = 0;

/** Map<slotName, entries> in registration order. */
const registry = new Map<PluginSlotName, SlotEntry[]>();
const listeners = new Set<Listener>();

/** Per-slot memoized snapshot (ComponentType[]) for `useSyncExternalStore`.
 *  Cleared on every mutation so the next read rebuilds a fresh reference. */
const snapshotCache = new Map<PluginSlotName, SlotComponent[]>();

function emitSlots(): void {
  snapshotCache.clear();
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* swallow listener errors — one bad subscriber must not break others */
    }
  }
}

/* Page-registry listeners — kept separate from slot listeners so that page
 * mutations don't trigger spurious slot re-renders (and vice versa). */
const pageListeners = new Set<Listener>();
function emitPages(): void {
  for (const fn of pageListeners) {
    try {
      fn();
    } catch {
      /* swallow listener errors — one bad subscriber must not break others */
    }
  }
}

/** Subscribe to page-registry changes (for `useSyncExternalStore`). */
export function subscribePages(listener: Listener): () => void {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
}

/** Sort entries: lower priority first, ties broken by insertion order. */
function computeComponents(slot: PluginSlotName): SlotComponent[] {
  const entries = registry.get(slot);
  if (!entries || entries.length === 0) return [];
  return [...entries]
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => a.entry.priority - b.entry.priority || a.idx - b.idx)
    .map((e) => ({ id: e.entry.id, component: e.entry.component }));
}

/**
 * Components registered for `slot`, ordered by priority.
 *
 * The returned array reference is stable between mutations, so it is safe to
 * use as the snapshot for `useSyncExternalStore`.
 */
export function getSlotComponents(slot: PluginSlotName): SlotComponent[] {
  const cached = snapshotCache.get(slot);
  if (cached) return cached;
  const fresh = computeComponents(slot);
  snapshotCache.set(slot, fresh);
  return fresh;
}

/**
 * Register a component for a slot. Returns an unsubscribe function that
 * removes exactly this registration.
 *
 * @param slot    Target slot (must be a known {@link PluginSlotName}).
 * @param component React component type to render.
 * @param priority Render order — lower renders first. Defaults to
 *                 {@link DEFAULT_SLOT_PRIORITY}. Ties keep registration order.
 */
export function registerSlot(
  slot: PluginSlotName,
  component: ComponentType,
  priority: number = DEFAULT_SLOT_PRIORITY,
): () => void {
  const entry: SlotEntry = { component, priority, id: nextRegistrationId++ };
  const existing = registry.get(slot);
  if (existing) {
    existing.push(entry);
  } else {
    registry.set(slot, [entry]);
  }
  emitSlots();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unregisterEntry(slot, component);
  };
}

/** Remove the first entry matching `component` for the slot. */
function unregisterEntry(slot: PluginSlotName, component: ComponentType): void {
  const entries = registry.get(slot);
  if (!entries) return;
  const idx = entries.findIndex((e) => e.component === component);
  if (idx === -1) return;
  entries.splice(idx, 1);
  if (entries.length === 0) {
    registry.delete(slot);
  } else {
    registry.set(slot, entries);
  }
  emitSlots();
}

/** Subscribe to registry changes (for `useSyncExternalStore`). */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Number of distinct slots that currently have ≥1 registration. */
export function registeredSlotCount(): number {
  return registry.size;
}

/** All slot names that currently have ≥1 registration. */
export function registeredSlotNames(): PluginSlotName[] {
  return [...registry.keys()];
}

/** Total component registrations across all slots. */
export function totalRegistrations(): number {
  let n = 0;
  for (const entries of registry.values()) n += entries.length;
  return n;
}

/** Clear all registrations. Primarily for tests / plugin hot-reload. */
export function clearRegistry(): void {
  registry.clear();
  emitSlots();
}

/* ======================================================================
 * Plugin page registry — separate store for plugins that contribute a
 * top-level route via their manifest (`tab.path` / `tab.override`).
 * Distilled from hermes-agent/web buildRoutes pattern. Slot registration
 * is independent from page registration; a single plugin can register
 * both a slot component and a page component under the same name.
 * ====================================================================== */

const pageRegistry = new Map<string, ComponentType>();

/**
 * Register a React component to render at the path declared by a plugin's
 * manifest. Idempotent — re-registering with the same name replaces the
 * component (useful for HMR). Returns an unsubscribe function.
 */
export function registerPluginPage(name: string, component: ComponentType): () => void {
  pageRegistry.set(name, component);
  emitPages();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (pageRegistry.get(name) === component) {
      pageRegistry.delete(name);
      emitPages();
    }
  };
}

/** Lookup a registered plugin page component by name. */
export function getPluginPage(name: string): ComponentType | undefined {
  return pageRegistry.get(name);
}

/** All currently registered plugin page names. */
export function registeredPageNames(): string[] {
  return [...pageRegistry.keys()];
}

/** Total registered plugin pages. */
export function totalPluginPages(): number {
  return pageRegistry.size;
}

/** Clear all page registrations (also clears slot registrations). For tests. */
export function clearPluginPages(): void {
  pageRegistry.clear();
  emitPages();
}
