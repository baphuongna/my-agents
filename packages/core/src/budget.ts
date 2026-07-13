/**
 * BudgetConfig — tree-accounting budget (§21). CORRECTED model (R39).
 *
 * Model:
 *   - The ROOT owns a single atomic `reserved` counter = sum of (deriveChild
 *     pre-charges) + (the root node's own direct spends).
 *   - A CHILD's spend() deducts from the child's LOCAL ownSpent (capped at its
 *     alloc) — it does NOT touch root.reserved again (the pre-charge already
 *     reserved it). This avoids the double-count bug.
 *   - remaining() = root.total - root.reserved (global available pool).
 *   - releasePrecharge(childId) refunds alloc - child.ownSpent to root.reserved
 *     on ANY terminal state (CC2) — the unused reservation returns to the pool.
 *
 * Invariants (§21): CC2 (refund on any terminal), CC10 (pre-charge locks parent),
 * CC13 (spend rejects on breach — local cap for child, abortThreshold for root).
 */
import type { BudgetConfig, Cost } from "./types.js";
import { nowMonotonic } from "./time.js";

interface RootState {
  total: number;
  warningThreshold: number;
  reserved: number; // atomic: pre-charges + root direct spends
  children: Map<string, ChildRecord>;
}

interface ChildRecord {
  alloc: number;
  ownSpent: number;
}

interface BudgetNode {
  alloc: number; // root: == total; child: the reserved slice
  abortThreshold: number;
  unlimited: boolean;
  isRoot: boolean;
  id: string; // root: "root"; child: generated
  root: RootState;
  parent?: BudgetConfig;
}

function makeBudget(node: BudgetNode): BudgetConfig {
  return {
    total: node.root.total,
    id: node.id,
    warningThreshold: node.root.warningThreshold,
    abortThreshold: node.abortThreshold,
    unlimited: node.unlimited,
    parent: node.parent,
    remaining: () => Math.max(0, node.root.total - node.root.reserved),
    spend: (c: Cost): boolean => {
      if (node.unlimited) return true;
      if (node.isRoot) {
        // Root spend: deducts from the shared reserved pool, abortThreshold-gated.
        const next = node.root.reserved + c.usd;
        if (next > node.abortThreshold) return false;
        node.root.reserved = next;
        return true;
      }
      // Child spend: deducts from LOCAL ownSpent, capped at alloc.
      const rec = node.root.children.get(node.id);
      if (!rec) return false;
      if (rec.ownSpent + c.usd > node.alloc) return false;
      rec.ownSpent += c.usd;
      return true;
    },
    deriveChild: (alloc: number): BudgetConfig => {
      const reserve = Math.max(0, Math.min(alloc, node.root.total - node.root.reserved));
      node.root.reserved += reserve; // pre-charge (CC10: locks the pool)
      // LOW-8 fix: use the single time helper (invariant #10) not bare Date.now().
      const childId = `child-${node.root.children.size + 1}-${nowMonotonic().toString(36)}`;
      node.root.children.set(childId, { alloc: reserve, ownSpent: 0 });
      return makeBudget({
        alloc: reserve,
        abortThreshold: node.abortThreshold,
        unlimited: node.unlimited,
        isRoot: false,
        id: childId,
        root: node.root,
        parent: makeBudget(node),
      });
    },
    releasePrecharge: (childId: string): number => {
      // CC2: refund alloc - child.ownSpent to the pool on ANY terminal state.
      const rec = node.root.children.get(childId);
      if (!rec) return 0;
      const refund = Math.max(0, rec.alloc - rec.ownSpent);
      node.root.reserved -= refund;
      node.root.children.delete(childId);
      return refund;
    },
    exhausted: () => !node.unlimited && node.root.reserved >= node.abortThreshold,
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
  const root: RootState = {
    total: opts.total,
    warningThreshold: opts.warningThreshold ?? opts.total * 0.8,
    reserved: 0,
    children: new Map(),
  };
  return makeBudget({
    alloc: opts.total,
    abortThreshold: abort,
    unlimited: opts.unlimited ?? false,
    isRoot: true,
    id: "root",
    root,
  });
}

/** A zero-cost budget for tests / MockProvider turns. */
export function freeBudget(): BudgetConfig {
  return createBudget({ total: 0, unlimited: true });
}
