/**
 * computeCost — stub (Tier 0).
 *
 * Real per-model pricing lands with the §6 provider registry (Tier 1).
 * Tier 0 returns a zero cost so the budget pipeline is exercised end-to-end
 * without a pricing table. Replaced — never stubbed-then-forgotten (invariant).
 */
import type { Cost, TokenUsage } from "./types.js";

export function computeCostStub(_u: TokenUsage): Cost {
  return { usd: 0 };
}
