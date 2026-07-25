/**
 * Plugin slot registry — canonical injection-point names.
 *
 * Plugins inject components into named locations ("slots") in the app shell
 * and built-in pages. Pages render `<PluginSlot name="…" />` at the seam; the
 * registry (`./plugin-registry`) decides what — if anything — renders there.
 * This is the "extensibility seam": future plugins can populate slots without
 * page code changing.
 *
 * Adapted from Hermes' `KNOWN_SLOT_NAMES` pattern
 * (`source/hermes-agent/web/src/plugins/slots.ts`). Hermes uses shell slots
 * (`header-left`, `sidebar`) plus `page:top` / `page:bottom` page slots; mya
 * adopts the same `page:top` / `page:bottom` convention with
 * `header:start` / `header:end` and `sidebar:top` / `sidebar:bottom`.
 */

/**
 * Every slot name the mya shell + built-in pages know how to render.
 *
 * Shell-wide slots are rendered by app chrome (Sidebar/Header); page-scoped
 * slots use the `<page>:top` / `<page>:bottom` convention and are rendered by
 * the matching built-in page.
 */
export const KNOWN_SLOT_NAMES = [
  // Shell-wide
  "sidebar:top",
  "sidebar:bottom",
  "header:start",
  "header:end",
  // Page-scoped
  "dashboard:top",
  "dashboard:bottom",
  "sessions:top",
  "sessions:bottom",
  "skills:top",
  "skills:bottom",
  "config:top",
  "config:bottom",
  "system:top",
  "system:bottom",
  "models:top",
  "models:bottom",
  "tools:top",
  "tools:bottom",
] as const;

/** Union of every supported slot name. */
export type PluginSlotName = (typeof KNOWN_SLOT_NAMES)[number];

const SLOT_NAME_SET: ReadonlySet<string> = new Set(KNOWN_SLOT_NAMES);

/** Type guard: true when `name` is one of `KNOWN_SLOT_NAMES`. */
export function isValidSlot(name: string): name is PluginSlotName {
  return SLOT_NAME_SET.has(name);
}

/** Human-readable description per slot — used by the Plugins admin page. */
export const SLOT_DESCRIPTIONS: Record<PluginSlotName, string> = {
  "sidebar:top": "Top of the navigation sidebar",
  "sidebar:bottom": "Bottom of the navigation sidebar",
  "header:start": "Start of the top header bar",
  "header:end": "End of the top header bar",
  "dashboard:top": "Top of the Dashboard page",
  "dashboard:bottom": "Bottom of the Dashboard page",
  "sessions:top": "Top of the Sessions page",
  "sessions:bottom": "Bottom of the Sessions page",
  "skills:top": "Top of the Skills page",
  "skills:bottom": "Bottom of the Skills page",
  "config:top": "Top of the Config page",
  "config:bottom": "Bottom of the Config page",
  "system:top": "Top of the System page",
  "system:bottom": "Bottom of the System page",
  "models:top": "Top of the Models page",
  "models:bottom": "Bottom of the Models page",
  "tools:top": "Top of the Tools page",
  "tools:bottom": "Bottom of the Tools page",
};
