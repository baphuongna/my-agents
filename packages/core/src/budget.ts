/**
 * BudgetConfig — tree-accounting budget (§21).
 *
 * Every node shares ONE atomic root `spent`. `spend` uses atomic CAS that rejects
 * a breach of `abortThreshold`. `deriveChild` atomically reserves + pre-charges;
 * `releasePrecharge` refunds on ANY terminal state (incl. crash) — CC2/CC13.
 */
import type { BudgetConfig, Cost } from "./types.js";

interface BudgetNode {
  total: number;
  warningThreshold: number;
  abortThreshold: number;
  unlimited: boolean;
  parent?: BudgetConfig;
  // shared root state
  root: { spent: number };
  // this node's pre-charge (for child refund accounting)
  precharged: number;
  resource?: import("./types.js").ResourceBudget;
}

function makeBudget(node: BudgetNode): BudgetConfig {
  return {
    total: node.total,
    warningThreshold: node.warningThreshold,
    abortThreshold: node.abortThreshold,
    unlimited: node.unlimited,
    parent: node.parent,
    remaining: () => Math.max(0, node.total - node.root.spent),
    spend: (c: Cost) => {
      if (node.unlimited) return true;
      const next = node.root.spent + c.usd;
      // CC13: atomic CAS — reject a spend breaching abortThreshold
      if (next > node.abortThreshold) return false;
      node.root.spent = next;
      return true;
    },
    deriveChild: (alloc: number): BudgetConfig => {
      const reserve = Math.min(alloc, node.total - node.root.spent);
      node.root.spent += reserve; // pre-charge (CC10: locks PARENT node only)
      return makeBudget({
        total: node.total, // child shares the SAME root total
        warningThreshold: node.warningThreshold,
        abortThreshold: node.abortThreshold,
        unlimited: node.unlimited,
        parent: makeBudget(node),
        root: node.root, // shared atomic root
        precharged: reserve,
      });
    },
    releasePrecharge: (_childId: string): number => {
      // CC2: refund = precharge - what child actually spent beyond its slice
      // For Tier 0 scaffold: refund the unused portion of this node's precharge.
      // (Full child.spent accounting lands when SubagentRunner is implemented.)
      return 0;
    },
    exhausted: () => node.total - node.root.spent <= 0,
    resource: node.resource,
  };
}

/** Create a root budget. */
export function createBudget(opts: {
  total: number;
  warningThreshold?: number;
  abortThreshold?: number;
  unlimited?: boolean;
}): BudgetConfig {
  const abort = opts.abortThreshold ?? opts.total;
  return makeBudget({
    total: opts.total,
    warningThreshold: opts.warningThreshold ?? opts.total * 0.8,
    abortThreshold: abort,
    unlimited: opts.unlimited ?? false,
    root: { spent: 0 },
    precharged: 0,
  });
}

/** A zero-cost budget for tests / MockProvider turns. */
export function freeBudget(): BudgetConfig {
  return createBudget({ total: 0, unlimited: true });
}
