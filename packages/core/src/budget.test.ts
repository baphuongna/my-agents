import { describe, it, expect } from "vitest";
import { createBudget, freeBudget } from "@my-agent/core";
import type { Cost } from "@my-agent/core";

const usd = (n: number): Cost => ({ usd: n });

describe("Budget tree-accounting (R39: root owns atomic reserved)", () => {
  it("root spend deducts from the shared pool", () => {
    const b = createBudget({ total: 100 });
    expect(b.remaining()).toBe(100);
    expect(b.spend(usd(30))).toBe(true);
    expect(b.remaining()).toBe(70);
  });

  it("deriveChild pre-charges the root (reserved pool locks)", () => {
    const b = createBudget({ total: 100 });
    const child = b.deriveChild(40);
    // R39: pre-charge reserves 40 from the global pool
    expect(b.remaining()).toBe(60);
    // child can spend its own alloc without touching root.reserved again (no double-count)
    expect(child.spend(usd(10))).toBe(true);
    expect(b.remaining()).toBe(60); // unchanged — child.spend is LOCAL
  });

  it("releasePrecharge refunds alloc - ownSpent to the root", () => {
    const b = createBudget({ total: 100 });
    const child = b.deriveChild(40);
    const childId = child.id!;
    child.spend(usd(15));
    const refund = b.releasePrecharge(childId);
    // R39: refund = alloc(40) - ownSpent(15) = 25; root pool returns to 100-15 = 85
    expect(b.remaining()).toBe(85);
    expect(refund).toBe(25);
  });

  it("deriveChild is clamped to the remaining pool", () => {
    const b = createBudget({ total: 100 });
    b.spend(usd(80));
    const child = b.deriveChild(50); // only 20 left
    expect(child.remaining()).toBeLessThanOrEqual(20);
  });

  it("exhausted() trips at the abort threshold", () => {
    const b = createBudget({ total: 100, abortThreshold: 100 });
    b.spend(usd(100));
    expect(b.exhausted()).toBe(true);
  });

  it("free budget never exhausts", () => {
    const u = freeBudget();
    expect(u.spend(usd(1e9))).toBe(true);
    expect(u.exhausted()).toBe(false);
  });
});
