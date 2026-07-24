/**
 * Tests for the StdinBuffer class.
 *
 * StdinBuffer accumulates (possibly partial) input chunks and emits complete
 * terminal sequences via the "data" event, and bracketed-paste payloads via the
 * "paste" event. These tests exercise buffering, sequence completion, paste
 * handling, flushing, and cleanup using a synchronous event collector.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StdinBuffer } from "./stdin-buffer.ts";

const ESC = "\x1b";

function collector(buf: StdinBuffer): { data: string[]; paste: string[] } {
	const data: string[] = [];
	const paste: string[] = [];
	buf.on("data", (d) => data.push(d));
	buf.on("paste", (p) => paste.push(p));
	return { data, paste };
}

describe("construction", () => {
	it("constructs with default options", () => {
		const buf = new StdinBuffer();
		expect(buf).toBeInstanceOf(StdinBuffer);
		expect(buf.getBuffer()).toBe("");
		buf.destroy();
	});

	it("constructs with a custom timeout option", () => {
		const buf = new StdinBuffer({ timeout: 100 });
		expect(buf.getBuffer()).toBe("");
		buf.destroy();
	});
});

describe("process — plain text", () => {
	let buf: StdinBuffer;
	beforeEach(() => {
		buf = new StdinBuffer({ timeout: 100 });
	});
	afterEach(() => buf.destroy());

	it("emits one data event per character for plain text", () => {
		const { data } = collector(buf);
		buf.process("hello");
		expect(data).toEqual(["h", "e", "l", "l", "o"]);
	});

	it("emits an empty data event when processing an empty string on an empty buffer", () => {
		const { data } = collector(buf);
		buf.process("");
		expect(data).toEqual([""]);
	});

	it("emits nothing until a complete escape sequence arrives", () => {
		const { data } = collector(buf);
		buf.process(ESC);
		expect(data).toEqual([]);
		expect(buf.getBuffer()).toBe(ESC);
		buf.process("[A");
		expect(data).toEqual(["\x1b[A"]);
		expect(buf.getBuffer()).toBe("");
	});
});

describe("process — escape sequences", () => {
	let buf: StdinBuffer;
	beforeEach(() => {
		buf = new StdinBuffer({ timeout: 100 });
	});
	afterEach(() => buf.destroy());

	it("emits a complete CSI sequence as a single event", () => {
		const { data } = collector(buf);
		buf.process("\x1b[A"); // arrow up
		expect(data).toEqual(["\x1b[A"]);
	});

	it("completes a split CSI sequence across two chunks", () => {
		const { data } = collector(buf);
		buf.process("\x1b[");
		expect(data).toEqual([]);
		buf.process("B"); // arrow down
		expect(data).toEqual(["\x1b[B"]);
	});

	it("emits an SGR mouse sequence as a single event", () => {
		const { data } = collector(buf);
		buf.process("\x1b[<35;20;5M");
		expect(data).toEqual(["\x1b[<35;20;5M"]);
	});

	it("completes an old-style mouse sequence once 6 bytes arrive", () => {
		const { data } = collector(buf);
		buf.process("\x1b[Mab"); // only 5 bytes → incomplete
		expect(data).toEqual([]);
		buf.process("c"); // 6th byte
		expect(data).toEqual(["\x1b[Mabc"]);
	});

	it("treats ESC + single char as a complete meta-key sequence", () => {
		const { data } = collector(buf);
		buf.process("\x1ba");
		expect(data).toEqual(["\x1ba"]);
	});

	it("splits the WezTerm double-Escape key sequence (ESC + CSI-u)", () => {
		const { data } = collector(buf);
		buf.process("\x1b\x1b[27;1;80u");
		expect(data).toEqual(["\x1b", "\x1b[27;1;80u"]);
	});

	it("emits multiple distinct sequences from one chunk", () => {
		const { data } = collector(buf);
		buf.process("a\x1b[Db");
		expect(data).toEqual(["a", "\x1b[D", "b"]);
	});
});

describe("process — buffer & UTF-8 handling", () => {
	let buf: StdinBuffer;
	beforeEach(() => {
		buf = new StdinBuffer({ timeout: 100 });
	});
	afterEach(() => buf.destroy());

	it("converts a single high byte (>127) into ESC + (byte-128)", () => {
		const { data } = collector(buf);
		buf.process(Buffer.from([0xc3])); // 195 -> 67 -> 'C'
		expect(data).toEqual(["\x1bC"]);
	});

	it("emits characters from a multi-byte UTF-8 Buffer", () => {
		const { data } = collector(buf);
		buf.process(Buffer.from("hi", "utf8"));
		expect(data).toEqual(["h", "i"]);
	});

	it("emits multi-byte characters as individual code points", () => {
		const { data } = collector(buf);
		buf.process("héllo");
		expect(data).toEqual(["h", "é", "l", "l", "o"]);
	});

	it("handles a large input without dropping characters", () => {
		const { data } = collector(buf);
		const big = "ab".repeat(5000); // 10000 chars
		buf.process(big);
		expect(data.length).toBe(10000);
		expect(data.join("")).toBe(big);
	});
});

describe("bracketed paste", () => {
	let buf: StdinBuffer;
	beforeEach(() => {
		buf = new StdinBuffer({ timeout: 100 });
	});
	afterEach(() => buf.destroy());

	it("emits paste content for a complete bracketed paste", () => {
		const { data, paste } = collector(buf);
		buf.process("\x1b[200~hello\x1b[201~");
		expect(paste).toEqual(["hello"]);
		expect(data).toEqual([]);
	});

	it("emits preceding text as data, then the paste", () => {
		const { data, paste } = collector(buf);
		buf.process("ab\x1b[200~hi\x1b[201~");
		expect(data).toEqual(["a", "b"]);
		expect(paste).toEqual(["hi"]);
	});

	it("re-assembles a paste split across multiple chunks", () => {
		const { paste } = collector(buf);
		buf.process("\x1b[200~hel");
		buf.process("lo\x1b[201~");
		expect(paste).toEqual(["hello"]);
	});
});

describe("flush, clear, and destroy", () => {
	let buf: StdinBuffer;
	beforeEach(() => {
		buf = new StdinBuffer({ timeout: 100 });
	});
	afterEach(() => buf.destroy());

	it("flush returns the pending incomplete buffer and clears it", () => {
		buf.process("\x1b"); // incomplete, stays buffered
		expect(buf.getBuffer()).toBe("\x1b");
		const flushed = buf.flush();
		expect(flushed).toEqual(["\x1b"]);
		expect(buf.getBuffer()).toBe("");
	});

	it("flush returns an empty array when there is nothing buffered", () => {
		expect(buf.flush()).toEqual([]);
	});

	it("clear resets the buffer and pending state", () => {
		buf.process("\x1b"); // leaves an incomplete buffer
		expect(buf.getBuffer()).toBe("\x1b");
		buf.clear();
		expect(buf.getBuffer()).toBe("");
		// After clear, subsequent plain input still works.
		const { data } = collector(buf);
		buf.process("ok");
		expect(data).toEqual(["o", "k"]);
	});

	it("destroy clears the buffer", () => {
		buf.process("\x1b[");
		expect(buf.getBuffer()).not.toBe("");
		buf.destroy();
		expect(buf.getBuffer()).toBe("");
	});
});

describe("timeout flush", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes an incomplete buffer after the configured timeout", () => {
		const buf = new StdinBuffer({ timeout: 10 });
		const { data } = collector(buf);
		buf.process("\x1b"); // incomplete
		expect(data).toEqual([]);
		expect(buf.getBuffer()).toBe("\x1b");

		vi.advanceTimersByTime(10);

		expect(data).toEqual(["\x1b"]);
		expect(buf.getBuffer()).toBe("");
		buf.destroy();
	});

	it("does not flush before the timeout elapses", () => {
		const buf = new StdinBuffer({ timeout: 10 });
		const { data } = collector(buf);
		buf.process("\x1b");
		vi.advanceTimersByTime(9);
		expect(data).toEqual([]);
		buf.destroy();
	});
});
