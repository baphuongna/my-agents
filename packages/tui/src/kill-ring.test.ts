import { describe, it, expect } from "vitest";
import { KillRing } from "./kill-ring.ts";

describe("KillRing", () => {
	it("starts empty", () => {
		const ring = new KillRing();
		expect(ring.length).toBe(0);
		expect(ring.peek()).toBeUndefined();
	});

	it("push increments length and peek returns the most recent entry", () => {
		const ring = new KillRing();
		ring.push("a", { prepend: false });
		ring.push("b", { prepend: false });
		expect(ring.length).toBe(2);
		expect(ring.peek()).toBe("b");
	});

	it("pushing an empty string is a no-op", () => {
		const ring = new KillRing();
		ring.push("", { prepend: false });
		expect(ring.length).toBe(0);

		ring.push("a", { prepend: false });
		ring.push("", { prepend: false });
		expect(ring.length).toBe(1);
		expect(ring.peek()).toBe("a");
	});

	it("accumulate merges into the most recent entry by appending", () => {
		const ring = new KillRing();
		ring.push("foo", { prepend: false });
		ring.push("bar", { prepend: false, accumulate: true });
		expect(ring.length).toBe(1);
		expect(ring.peek()).toBe("foobar");
	});

	it("accumulate with prepend puts new text before the last entry", () => {
		const ring = new KillRing();
		ring.push("foo", { prepend: false });
		ring.push("bar", { prepend: true, accumulate: true });
		expect(ring.peek()).toBe("barfoo");
	});

	it("accumulate on an empty ring just pushes a new entry", () => {
		const ring = new KillRing();
		ring.push("only", { prepend: true, accumulate: true });
		expect(ring.length).toBe(1);
		expect(ring.peek()).toBe("only");
	});

	it("multiple accumulate calls keep extending the same entry", () => {
		const ring = new KillRing();
		ring.push("x", { prepend: false });
		ring.push("y", { prepend: false, accumulate: true });
		ring.push("z", { prepend: false, accumulate: true });
		expect(ring.length).toBe(1);
		expect(ring.peek()).toBe("xyz");
	});

	it("rotate moves the last entry to the front for yank-pop cycling", () => {
		const ring = new KillRing();
		ring.push("a", { prepend: false });
		ring.push("b", { prepend: false });
		ring.push("c", { prepend: false });

		expect(ring.peek()).toBe("c");
		ring.rotate();
		expect(ring.peek()).toBe("b");
		ring.rotate();
		expect(ring.peek()).toBe("a");
		ring.rotate();
		expect(ring.peek()).toBe("c");
		expect(ring.length).toBe(3);
	});

	it("rotate is a no-op for zero or one entries", () => {
		const empty = new KillRing();
		empty.rotate();
		expect(empty.length).toBe(0);

		const single = new KillRing();
		single.push("solo", { prepend: false });
		single.rotate();
		expect(single.length).toBe(1);
		expect(single.peek()).toBe("solo");
	});

	it("maintains push order across many pushes", () => {
		const ring = new KillRing();
		for (const v of ["one", "two", "three", "four"]) {
			ring.push(v, { prepend: false });
		}
		expect(ring.length).toBe(4);
		expect(ring.peek()).toBe("four");
	});
});
