/**
 * Model routing for workflows.
 *
 * Two complementary mechanisms:
 *
 * 1. **Phase routing** — map named workflow phases to specific models via
 *    author-controlled patterns (exact match or regex).
 * 2. **Tier routing** — a coarse, user-configurable small/medium/big knob
 *    independent of any concrete provider/model id. Tiers are ranked by model
 *    name hints (mini/flash → small, opus/pro → big).
 *
 * Ported from pi-dynamic-workflows, adapted for `@my-agent/ai` (no pi-ai
 * registry dependency; config lives at `~/.mya/model-tiers.json`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Phase routing types
// ---------------------------------------------------------------------------

export interface ModelRoute {
  /** Phase name pattern (regex or exact match). */
  phasePattern: string;
  /** Model to use for this phase. */
  model: string;
  /** Whether to use regex matching. */
  useRegex?: boolean;
}

export interface ModelRoutingConfig {
  /** Default model for all phases. */
  defaultModel?: string;
  /** Per-phase model overrides. */
  routes: ModelRoute[];
}

// ---------------------------------------------------------------------------
// Phase routing
// ---------------------------------------------------------------------------

/**
 * Resolve which model to use for a given phase.
 *
 * Iterates routes in order. For regex routes (`useRegex: true`) the pattern is
 * matched case-insensitively; invalid regexes are silently skipped. For exact
 * routes the phase name is compared case-sensitively. Falls back to
 * `config.defaultModel` when no route matches.
 */
export function resolveModelForPhase(phase: string | undefined, config: ModelRoutingConfig): string | undefined {
  if (!phase || !config.routes.length) {
    return config.defaultModel;
  }

  for (const route of config.routes) {
    if (route.useRegex) {
      try {
        const regex = new RegExp(route.phasePattern, "i");
        if (regex.test(phase)) {
          return route.model;
        }
      } catch {
        // Invalid regex, skip
      }
    } else if (phase === route.phasePattern) {
      return route.model;
    }
  }

  return config.defaultModel;
}

/**
 * Parse model routing from workflow meta: per-phase models from
 * `phases[].model` and a top-level default.
 */
export function parseModelRoutingFromMeta(
  phases?: Array<{ title: string; model?: string }>,
  defaultModel?: string,
): ModelRoutingConfig {
  const routes: ModelRoute[] = [];

  if (phases) {
    for (const phase of phases) {
      if (phase.model) {
        routes.push({
          phasePattern: phase.title,
          model: phase.model,
        });
      }
    }
  }

  return { defaultModel, routes };
}

// ---------------------------------------------------------------------------
// Tier routing types
// ---------------------------------------------------------------------------

/** Named capability slot for tier routing. */
export type ModelTier = "small" | "medium" | "big";

/**
 * Model tier configuration. Maps tier names (e.g. "small", "medium", "big")
 * to a single model spec string.
 */
export interface ModelTierConfig {
  tiers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Configuration path
// ---------------------------------------------------------------------------

/** Path to the model tiers JSON config file (~/.mya/model-tiers.json). */
export function getModelTierConfigPath(): string {
  return join(homedir(), ".mya", "model-tiers.json");
}

// ---------------------------------------------------------------------------
// Capability hints
// ---------------------------------------------------------------------------

/**
 * Substrings that identify small/cheap models (case-insensitive).
 * Used by `rankByCapability` to rank models lowest.
 */
export const SMALL_MODEL_HINTS = ["mini", "flash", "haiku", "nano", "small"] as const;

/**
 * Substrings that identify large/capable models (case-insensitive).
 * Used by `rankByCapability` to rank models highest.
 */
export const BIG_MODEL_HINTS = ["opus", "pro", "ultra", "large", "plus"] as const;

/**
 * Capability score for a single model spec: +1 if it matches a big-model hint,
 * -1 if it matches a small-model hint, 0 otherwise. If a model matches both
 * hint sets the small hint wins — a "mini"-labelled model should never outrank
 * a neutral or clearly-large one.
 */
function capabilityScore(model: string): number {
  const lower = model.toLowerCase();
  if (SMALL_MODEL_HINTS.some((hint) => lower.includes(hint))) return -1;
  if (BIG_MODEL_HINTS.some((hint) => lower.includes(hint))) return 1;
  return 0;
}

/**
 * Rank `available` models from least to most capable using `capabilityScore`.
 * The sort is stable (ties preserve original order).
 */
function rankByCapability(available: string[]): string[] {
  return available
    .map((model, index) => ({ model, index, score: capabilityScore(model) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.model);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Build a default tier config from a list of available model specs.
 *
 * Models are first ranked least → most capable via `rankByCapability`. Tiers
 * are then assigned from this ranked pool with exclusion — each model is used
 * for at most one tier:
 *
 *   - small  = least capable (first in ranking)
 *   - big    = most capable (last in ranking)
 *   - medium = middle-ranked
 *
 * When fewer than 3 distinct models are available, degrades gracefully by
 * reusing the strongest model for higher tier(s):
 *
 *   - 2 models: small = weaker, medium = big = stronger
 *   - ≤1 model: small = medium = big = that model (or `currentModelSpec` / ""
 *     fallback when the list is empty)
 */
export function buildDefaultTierConfig(availableModels: string[], currentModelSpec?: string): ModelTierConfig {
  const ranked = rankByCapability(availableModels);

  if (ranked.length >= 3) {
    const small = ranked[0]!;
    const big = ranked[ranked.length - 1]!;
    const medium = ranked[Math.floor(ranked.length / 2)]!;
    return { tiers: { small, medium, big } };
  }
  if (ranked.length === 2) {
    const weaker = ranked[0]!;
    const stronger = ranked[1]!;
    return { tiers: { small: weaker, medium: stronger, big: stronger } };
  }
  const fallback = ranked[0] ?? currentModelSpec ?? "";
  return {
    tiers: {
      small: fallback,
      medium: fallback,
      big: fallback,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Resolve a tier name to its configured model spec, or `undefined` if the tier
 * is not configured.
 */
export function resolveTierModel(tier: ModelTier | string, config: ModelTierConfig): string | undefined {
  return config.tiers[tier];
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load the model tier config from disk. Returns `null` if the file does not
 * exist or is unparseable (callers fall back to a default).
 */
export function loadModelTierConfig(configPath?: string): ModelTierConfig | null {
  const path = configPath ?? getModelTierConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (!obj.tiers || typeof obj.tiers !== "object") return null;
    for (const val of Object.values(obj.tiers as Record<string, unknown>)) {
      if (typeof val !== "string") return null;
    }
    return obj as unknown as ModelTierConfig;
  } catch {
    return null;
  }
}

/**
 * Save a model tier config to disk. Creates parent directories if needed.
 */
export function saveModelTierConfig(config: ModelTierConfig, configPath?: string): void {
  const path = configPath ?? getModelTierConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return all tier names sorted: small < medium < big, then alphabetically. */
export function sortedTierNames(config: ModelTierConfig): string[] {
  const names = Object.keys(config.tiers);
  const rank: Record<string, number> = { small: 0, medium: 1, big: 2 };
  return names.sort((a, b) => (rank[a] ?? 99) - (rank[b] ?? 99) || a.localeCompare(b));
}
