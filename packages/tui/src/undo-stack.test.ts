import { describe, it, expect } from "vitest";
import { UndoStack } from "./undo-stack.ts";

describe("UndoStack", () => {
	it("starts empty and pop returns undefined", () => {
		const stack = new UndoStack<number>();
		expect(stack.length).toBe(0);
		expect(stack.pop()).toBeUndefined();
	});

	it("push then pop returns values in LIFO order", () => {
		const stack = new UndoStack<string>();
		stack.push("a");
		stack.push("b");
		expect(stack.length).toBe(2);
		expect(stack.pop()).toBe("b");
		expect(stack.pop()).toBe("a");
		expect(stack.length).toBe(0);
	});

	it("clone-on-push isolates a pushed primitive-containing state", () => {
		const stack = new UndoStack<{ n: number }>();
		const state = { n: 1 };
		stack.push(state);
		state.n = 999; // mutate original after push
		expect(stack.pop()?.n).toBe(1);
	});

	it("deep-clones nested objects", () => {
		const stack = new UndoStack<{ obj: { a: number } }>();
		const state = { obj: { a: 1 } };
		stack.push(state);
		state.obj.a = 2; // mutate nested member after push
		expect(stack.pop()?.obj.a).toBe(1);
	});

	it("deep-clones arrays", () => {
		const stack = new UndoStack<number[]>();
		const arr = [1, 2, 3];
		stack.push(arr);
		arr.push(4); // mutate original array after push
		expect(stack.pop()).toEqual([1, 2, 3]);
	});

	it("pushing the same object twice produces two independent clones", () => {
		const stack = new UndoStack<{ v: number }>();
		const state = { v: 0 };
		stack.push(state);
		stack.push(state);
		state.v = 5; // mutate original after both pushes
		const first = stack.pop();
		const second = stack.pop();
		expect(first?.v).toBe(0);
		expect(second?.v).toBe(0);
	});

	it("popped snapshots are detached (mutating them does not affect the stack)", () => {
		const stack = new UndoStack<{ x: number }>();
		stack.push({ x: 1 });
		stack.push({ x: 2 });
		const popped = stack.pop();
		if (popped) popped.x = 42;
		expect(stack.pop()?.x).toBe(1);
	});

	it("clear removes all snapshots", () => {
		const stack = new UndoStack<number>();
		stack.push(1);
		stack.push(2);
		stack.clear();
		expect(stack.length).toBe(0);
		expect(stack.pop()).toBeUndefined();
	});

	it("clear on an empty stack is a no-op", () => {
		const stack = new UndoStack<number>();
		stack.clear();
		expect(stack.length).toBe(0);
	});

	it("preserves LIFO order across many pushes", () => {
		const stack = new UndoStack<number>();
		for (let i = 0; i < 5; i++) stack.push(i);
		const out: number[] = [];
		while (stack.length > 0) out.push(stack.pop()!);
		expect(out).toEqual([4, 3, 2, 1, 0]);
	});
});
