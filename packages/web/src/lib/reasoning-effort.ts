/**
 * Reasoning-effort option set shared by the ReasoningPicker + config round-trip.
 *
 * The effort persists to config at `agent.reasoning_effort` (the same key the
 * TUI's `/reasoning <level>` command writes). Port of Hermes
 * `lib/reasoning-effort.ts`.
 */

export interface EffortOption {
  value: string;
  label: string;
}

export const EFFORT_OPTIONS: readonly EffortOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export const VALID_EFFORTS: ReadonlySet<string> = new Set(
  EFFORT_OPTIONS.map((o) => o.value),
);

/** Coerce an arbitrary stored value into a known effort string (default medium). */
export function normalizeEffort(v: unknown): string {
  return typeof v === "string" && VALID_EFFORTS.has(v) ? v : "medium";
}
