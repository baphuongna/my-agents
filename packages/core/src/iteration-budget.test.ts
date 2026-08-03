/**
 * IterationBudget tests — consume/refund semantics.
 * Port Plan 2 Tier 2.
 */
import { describe, it, expect } from "vitest";
import { createIterationBudget, type IterationBudget } from "./iteration-budget.js";

describe("[unit] IterationBudget", () => {
	it("consume returns true while budget remains", () => {
		const ib = createIterationBudget(3);
		expect(ib.consume()).toBe(true);
		expect(ib.consume()).toBe(true);
		expect(ib.consume()).toBe(true);
	});

	it("consume returns false when exhausted", () => {
		const ib = createIterationBudget(2);
		expect(ib.consume()).toBe(true);
		expect(ib.consume()).toBe(true);
		expect(ib.consume()).toBe(false);
		expect(ib.consume()).toBe(false); // stays false
	});

	it("used reflects consume count", () => {
		const ib = createIterationBudget(5);
		expect(ib.used).toBe(0);
		ib.consume();
		expect(ib.used).toBe(1);
		ib.consume();
		ib.consume();
		expect(ib.used).toBe(3);
	});

	it("remaining == max - used", () => {
		const ib = createIterationBudget(10);
		expect(ib.remaining()).toBe(10);
		ib.consume();
		ib.consume();
		expect(ib.remaining()).toBe(8);
	});

	it("refund decrements used", () => {
		const ib = createIterationBudget(5);
		ib.consume();
		ib.consume();
		expect(ib.used).toBe(2);
		ib.refund();
		expect(ib.used).toBe(1);
	});

	it("refund on zero is a no-op (floor at 0)", () => {
		const ib = createIterationBudget(5);
		ib.refund();
		expect(ib.used).toBe(0);
		ib.consume();
		ib.refund();
		ib.refund();
		expect(ib.used).toBe(0);
	});

	it("refund allows consuming again after exhaustion", () => {
		const ib = createIterationBudget(2);
		ib.consume();
		ib.consume();
		expect(ib.consume()).toBe(false); // exhausted
		ib.refund();
		expect(ib.consume()).toBe(true); // refunded one
		expect(ib.consume()).toBe(false); // exhausted again
	});

	it("max is readonly", () => {
		const ib = createIterationBudget(7);
		expect(ib.max).toBe(7);
	});

	it("zero budget always returns false", () => {
		const ib = createIterationBudget(0);
		expect(ib.consume()).toBe(false);
		expect(ib.used).toBe(0);
		expect(ib.remaining()).toBe(0);
	});
});
