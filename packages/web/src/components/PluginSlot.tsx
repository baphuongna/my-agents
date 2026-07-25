/**
 * PluginSlot — renders components registered for a named slot.
 *
 * This is the *extensibility seam*: pages place `<PluginSlot name="…" />` at
 * injection points; whatever a plugin has registered (via
 * `registerSlot` from `@/lib/plugin-registry`) renders there in priority
 * order. When nothing is registered, `fallback` renders instead (or nothing).
 *
 * Reactivity: backed by `useSyncExternalStore`, so registrations that happen
 * after mount appear without a manual refresh.
 *
 * Today the registry starts empty — there is no plugin loader yet — so slots
 * render their `fallback`. The seam exists so future plugins can fill slots
 * without touching page code.
 */
import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import type { PluginSlotName } from "@/lib/plugin-slots";
import { subscribe, getSlotComponents } from "@/lib/plugin-registry";

interface PluginSlotProps {
  /** Slot identifier (e.g. `"dashboard:top"`). */
  name: PluginSlotName;
  /** Content rendered when no components are registered for the slot. */
  fallback?: ReactNode;
}

/** Render all components registered for `name`, or `fallback` if none. */
export function PluginSlot({ name, fallback }: PluginSlotProps) {
  const components = useSyncExternalStore(
    subscribe,
    () => getSlotComponents(name),
  );

  if (components.length === 0) {
    return fallback != null ? <Fragment>{fallback}</Fragment> : null;
  }

  return (
    <Fragment>
      {components.map((Component, i) => (
        <Component key={i} />
      ))}
    </Fragment>
  );
}
