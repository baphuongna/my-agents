/**
 * Tests for pure functions and constants exported from tui.ts.
 *
 * Covers: CURSOR_MARKER, isFocusable type guard, Container class,
 * and the re-exported visibleWidth.
 */
import { describe, it, expect } from "vitest";
import { CURSOR_MARKER, isFocusable, Container, visibleWidth, type Component } from "./tui.ts";

// Helper: create a minimal Component for testing.
function makeComponent(lines: string[]): Component {
	return {
		render: () => lines,
		invalidate: () => {},
	};
}

// A component that tracks invalidate calls via closure.
function makeTrackingComponent(lines: string[]): { component: Component; invalidateCount: () => number } {
	let count = 0;
	const component: Component = {
		render: () => lines,
		invalidate: () => {
			count++;
		},
	};
	return { component, invalidateCount: () => count };
}

// =============================================================================
// CURSOR_MARKER
// =============================================================================

describe("CURSOR_MARKER", () => {
	it("is a non-empty string", () => {
		expect(CURSOR_MARKER).toBeTruthy();
		expect(CURSOR_MARKER.length).toBeGreaterThan(0);
	});

	it("starts with ESC (APC introducer)", () => {
		expect(CURSOR_MARKER.startsWith("\x1b")).toBe(true);
	});

	it("ends with BEL terminator", () => {
		expect(CURSOR_MARKER.endsWith("\x07")).toBe(true);
	});

	it("is a zero-width APC sequence (ESC _)", () => {
		// APC format: ESC _ payload BEL
		expect(CURSOR_MARKER[1]).toBe("_");
	});

	it("contains the cursor payload identifier", () => {
		expect(CURSOR_MARKER).toContain("pi:c");
	});
});

// =============================================================================
// isFocusable
// =============================================================================

describe("isFocusable", () => {
	it("returns true for an object with focused property", () => {
		const obj = { render: () => [] as string[], invalidate: () => {}, focused: false };
		expect(isFocusable(obj)).toBe(true);
	});

	it("returns true when focused is true", () => {
		const obj = { render: () => [] as string[], invalidate: () => {}, focused: true };
		expect(isFocusable(obj)).toBe(true);
	});

	it("returns false for an object without focused property", () => {
		const obj = { render: () => [] as string[], invalidate: () => {} };
		expect(isFocusable(obj)).toBe(false);
	});

	it("returns false for null", () => {
		expect(isFocusable(null)).toBe(false);
	});

	it("narrows the type so focused is accessible after guard", () => {
		const component: Component | null = {
			render: () => [],
			invalidate: () => {},
			focused: false,
		};
		if (isFocusable(component)) {
			// This assignment should compile and run due to the type guard.
			component.focused = true;
			expect(component.focused).toBe(true);
		}
	});

	it("returns false for a plain object with render but no focused", () => {
		expect(isFocusable({ render: () => [] })).toBe(false);
	});
});

// =============================================================================
// Container
// =============================================================================

describe("Container", () => {
	it("starts with no children", () => {
		const container = new Container();
		expect(container.children).toHaveLength(0);
	});

	it("addChild appends to children", () => {
		const container = new Container();
		const child = makeComponent(["a"]);
		container.addChild(child);
		expect(container.children).toHaveLength(1);
		expect(container.children[0]).toBe(child);
	});

	it("removeChild removes the specified child", () => {
		const container = new Container();
		const a = makeComponent(["a"]);
		const b = makeComponent(["b"]);
		container.addChild(a);
		container.addChild(b);
		container.removeChild(a);
		expect(container.children).toHaveLength(1);
		expect(container.children[0]).toBe(b);
	});

	it("removeChild is a no-op for a non-existent child", () => {
		const container = new Container();
		const a = makeComponent(["a"]);
		const stray = makeComponent(["stray"]);
		container.addChild(a);
		container.removeChild(stray);
		expect(container.children).toHaveLength(1);
	});

	it("clear empties all children", () => {
		const container = new Container();
		container.addChild(makeComponent(["a"]));
		container.addChild(makeComponent(["b"]));
		container.clear();
		expect(container.children).toHaveLength(0);
	});

	it("render concatenates children render output", () => {
		const container = new Container();
		container.addChild(makeComponent(["line1", "line2"]));
		container.addChild(makeComponent(["line3"]));
		expect(container.render(80)).toEqual(["line1", "line2", "line3"]);
	});

	it("render of empty container returns empty array", () => {
		const container = new Container();
		expect(container.render(80)).toEqual([]);
	});

	it("invalidate calls invalidate on all children", () => {
		const container = new Container();
		const { component: a, invalidateCount: countA } = makeTrackingComponent(["a"]);
		const { component: b, invalidateCount: countB } = makeTrackingComponent(["b"]);
		container.addChild(a);
		container.addChild(b);

		container.invalidate();
		expect(countA()).toBe(1);
		expect(countB()).toBe(1);

		container.invalidate();
		expect(countA()).toBe(2);
		expect(countB()).toBe(2);
	});

	it("invalidate on empty container does not throw", () => {
		const container = new Container();
		expect(() => container.invalidate()).not.toThrow();
	});

	it("supports nested containers", () => {
		const outer = new Container();
		const inner = new Container();
		inner.addChild(makeComponent(["deep"]));
		outer.addChild(makeComponent(["top"]));
		outer.addChild(inner);
		expect(outer.render(80)).toEqual(["top", "deep"]);
	});
});

// =============================================================================
// visibleWidth (re-exported from utils)
// =============================================================================

describe("visibleWidth re-export", () => {
	it("is the same function imported from utils", () => {
		expect(typeof visibleWidth).toBe("function");
		expect(visibleWidth("hello")).toBe(5);
	});

	it("handles ANSI codes (zero-width)", () => {
		expect(visibleWidth("\x1b[31mhi\x1b[0m")).toBe(2);
	});

	it("returns 0 for empty string", () => {
		expect(visibleWidth("")).toBe(0);
	});
});
