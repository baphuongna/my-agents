/**
 * @my-agent/memory/weibull — Per-type Weibull decay curves.
 *
 * Copied from mnemopi/src/core/weibull.ts.
 *
 * Different memory types have different decay rates:
 *   profile:    eta=8760h (1 year)  — very slow
 *   preference: eta=4380h (6 months)
 *   event:      eta=168h  (1 week)   — fast
 *   request:    eta=72h   (3 days)   — very fast
 */
export type MemoryType = keyof typeof WEIBULL_PARAMS;

export interface WeibullParams {
  readonly k: number;  // shape (higher = faster decay onset)
  readonly eta: number; // scale in hours (higher = slower decay)
}

// Per-memory-type Weibull parameters.
export const WEIBULL_PARAMS = {
  profile: { k: 0.3, eta: 8760.0 },
  preference: { k: 0.4, eta: 4380.0 },
  relationship: { k: 0.35, eta: 8760.0 },
  learning: { k: 0.7, eta: 1440.0 },

  fact: { k: 0.8, eta: 720.0 },
  entity: { k: 0.5, eta: 4380.0 },
  setup: { k: 0.6, eta: 2160.0 },
  pattern: { k: 0.6, eta: 1680.0 },
  context: { k: 0.85, eta: 360.0 },
  observation: { k: 0.9, eta: 480.0 },
  artifact: { k: 0.75, eta: 2160.0 },

  project: { k: 0.85, eta: 1080.0 },
  goal: { k: 0.9, eta: 720.0 },
  decision: { k: 1.0, eta: 336.0 },
  commitment: { k: 1.0, eta: 240.0 },

  event: { k: 1.2, eta: 168.0 },
  instruction: { k: 0.9, eta: 480.0 },
  error: { k: 1.1, eta: 336.0 },
  issue: { k: 1.1, eta: 336.0 },
  request: { k: 1.5, eta: 72.0 },

  general: { k: 1.0, eta: 168.0 },
} as const satisfies Record<string, WeibullParams>;

export const DEFAULT_HALFLIFE_HOURS = 168.0;

type TimestampInput = string | Date | null | undefined;

export function parseTimestamp(timestamp: TimestampInput): Date | null {
  if (timestamp == null) return null;
  if (timestamp instanceof Date) {
    return Number.isFinite(timestamp.getTime()) ? timestamp : null;
  }
  if (typeof timestamp !== "string") return null;
  const normalized = timestamp;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function paramsFor(memoryType: string): WeibullParams | undefined {
  return WEIBULL_PARAMS[memoryType as MemoryType];
}

/**
 * Compute a temporal boost score [0, 1] using Weibull decay.
 * Recent memories get higher boost; old memories decay toward 0.
 */
export function weibullBoost(
  timestamp: TimestampInput,
  queryTime: Date | null = new Date(),
  memoryType = "general",
  halflifeHours?: number | null,
): number {
  const memoryTime = parseTimestamp(timestamp);
  const resolvedQueryTime = queryTime ?? new Date();
  if (memoryTime === null || !Number.isFinite(resolvedQueryTime.getTime())) return 0.0;

  const ageHours = (resolvedQueryTime.getTime() - memoryTime.getTime()) / 3_600_000.0;
  if (ageHours < 0) return 1.0; // future timestamp → max boost

  if (halflifeHours != null) {
    if (halflifeHours <= 0) return 0.0;
    return Math.exp(-ageHours / halflifeHours);
  }

  const params = paramsFor(memoryType);
  if (params === undefined) {
    return Math.exp(-ageHours / DEFAULT_HALFLIFE_HOURS);
  }

  if (params.eta <= 0) return 0.0;
  return Math.exp(-((ageHours / params.eta) ** params.k));
}

/** Compute decay factor from age in hours (for purge decisions). */
export function weibullDecayFactor(ageHours: number, memoryType = "general"): number {
  if (ageHours <= 0) return 1.0;
  const params = paramsFor(memoryType);
  if (params === undefined) {
    return Math.exp(-ageHours / DEFAULT_HALFLIFE_HOURS);
  }
  if (params.eta <= 0) return 0.0;
  return Math.exp(-((ageHours / params.eta) ** params.k));
}