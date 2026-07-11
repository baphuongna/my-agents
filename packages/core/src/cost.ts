/**
 * computeCost — real per-model USD pricing (§4, §6).
 *
 * Pricing is per 1M tokens (input / output), sourced from public model cards.
 * A cacheRead token is billed at ~50% of input (provider cache discounts vary;
 * this is a conservative estimate). Unknown models fall back to a safe default
 * ($1.00/1M in, $3.00/1M out) so the budget gate is exercised, never zero.
 *
 * The `model` arg is optional + case-insensitive (substring match on the table
 * key) so `gpt-4o-2024-08-06` matches `gpt-4o`. Returned Cost is rounded to 8 dp
 * to avoid float noise in the Merkle audit hash.
 */
import type { Cost, TokenUsage } from "./types.js";

/** Per 1M tokens: [inputUsd, outputUsd]. */
const PRICING: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4.1": [2.0, 8.0],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "o1": [15.0, 60.0],
  "o1-mini": [3.0, 12.0],
  "o3-mini": [1.1, 4.4],
  "claude-3-5-sonnet": [3.0, 15.0],
  "claude-3-5-haiku": [0.8, 4.0],
  "claude-sonnet-4": [3.0, 15.0],
  "claude-opus-4": [15.0, 75.0],
  "claude-haiku-3": [0.25, 1.25],
  "minimax-m3": [1.0, 1.0],
  "minimax-m1": [0.4, 0.4],
  "gemini-2.5-pro": [1.25, 10.0],
  "gemini-2.5-flash": [0.075, 0.3],
  "deepseek-chat": [0.27, 1.1],
  "deepseek-reasoner": [0.55, 2.19],
  "llama-3.3-70b": [0.6, 0.7],
};

/** Conservative default for unknown models — never zero (keeps the budget gate real). */
const DEFAULT_PRICE: [number, number] = [1.0, 3.0];

function lookup(model?: string): [number, number] {
  if (!model) return DEFAULT_PRICE;
  const m = model.toLowerCase();
  // longest-key-first so "gpt-4o-mini" matches before "gpt-4o"
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const k of keys) if (m.includes(k)) return PRICING[k]!;
  return DEFAULT_PRICE;
}

export function computeCost(u: TokenUsage, model?: string): Cost {
  const [inPer1M, outPer1M] = lookup(model);
  const inputCost = ((u.input ?? 0) / 1_000_000) * inPer1M;
  const outputCost = ((u.output ?? 0) / 1_000_000) * outPer1M;
  // cacheRead billed at 50% of input (provider cache discount approximation).
  const cacheCost = ((u.cacheRead ?? 0) / 1_000_000) * inPer1M * 0.5;
  const usd = inputCost + outputCost + cacheCost;
  // round to 8 dp — float noise would destabilize the Merkle audit hash.
  return { usd: Math.round(usd * 1e8) / 1e8 };
}

/** Back-compat alias for any caller still importing the old name. */
export const computeCostStub = computeCost;
