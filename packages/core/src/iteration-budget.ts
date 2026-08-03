/**
 * IterationBudget — caps how many LLM API-call iterations an agent may make
 * within a single run. Ported from Hermes `agent/iteration_budget.py`.
 *
 * Unlike Hermes' threading.Lock version, mya's runTurn is single-threaded
 * on the Node event loop — no lock needed.
 *
 * Port Plan 2 Tier 2.
 */
import type { nowWallclock } from "@my-agent/core";

/**
 * A consume/refund integer counter that bounds provider→tool-call iterations.
 */
export interface IterationBudget {
	/** Consume one iteration. Returns false if exhausted (caller must stop). */
	consume(): boolean;
	/** Refund one iteration (e.g. execute-tool rounds that shouldn't count). */
	refund(): void;
	/** Remaining iterations. */
	remaining(): number;
	/** Iterations used so far. */
	readonly used: number;
	/** Maximum iterations. */
	readonly max: number;
}

/**
 * Create an IterationBudget with the given max.
 * consume() returns false when used >= max.
 * refund() decrements used (floor at 0).
 */
export function createIterationBudget(maxTotal: number): IterationBudget {
	let used = 0;
	return {
		consume(): boolean {
			if (used >= maxTotal) return false;
			used++;
			return true;
		},
		refund(): void {
			if (used > 0) used--;
		},
		remaining(): number {
			return Math.max(0, maxTotal - used);
		},
		get used(): number {
			return used;
		},
		get max(): number {
			return maxTotal;
		},
	};
}
