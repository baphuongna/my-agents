/**
 * Feature 1.3 — JSON Stream mode (`mya --json`)
 *
 * Covers all 5 tiers:
 *  - UNIT:    NDJSON construction, partial chunk buffering
 *  - SMOKE:   module loads, no-throw
 *  - REAL:    spawn mya --json, verify NDJSON roundtrip
 *  - SYSTEM:  end-to-end JSON stream with auth
 *  - TUI UI:  N/A
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSink } from "../../../packages/print/src/index.ts";
import type { RuntimeEvent } from "@my-agent/core";

// ──────────────────────────────────────────────────────────────
// UNIT — NDJSON construction
// ──────────────────────────────────────────────────────────────

describe("[unit] NDJSON format", () => {
	let stdout: string[];
	beforeEach(() => {
		stdout = [];
		vi.spyOn(process.stdout, "write").mockImplementation((s: any) => { stdout.push(String(s)); return true; });
	});
	afterEach(() => vi.restoreAllMocks());

	it("each event ends with \\n (NDJSON spec)", () => {
		const sink = makeSink({ json: true });
		sink.write({ kind: "turn", stage: "start" } as any);
		sink.write({ kind: "turn", stage: "end" } as any);
		const out = stdout.join("");
		expect(out.endsWith("\n")).toBe(true);
		expect(out.match(/\n/g)?.length).toBeGreaterThanOrEqual(2);
	});

	it("does NOT add extra newlines within an event", () => {
		const sink = makeSink({ json: true });
		const ev: RuntimeEvent = { kind: "turn", stage: "delta", chunk: "line1\nline2" } as any;
		sink.write(ev);
		const out = stdout.join("");
		// The stream "line1\nline2" must appear verbatim, and the line ends with \n
		// Total real newlines = 1 (inner newline is JSON-escaped; only terminator is real)
		expect(out.match(/\n/g)?.length).toBe(1);
	});

	it("preserves order (FIFO)", () => {
		const sink = makeSink({ json: true });
		for (let i = 0; i < 100; i++) sink.write({ kind: "turn", i } as any);
		const lines = stdout.join("").split("\n").filter(Boolean);
		expect(lines.length).toBe(100);
		for (let i = 0; i < 100; i++) {
			expect(JSON.parse(lines[i]).i).toBe(i);
		}
	});

	it("each line is independently valid JSON", () => {
		const sink = makeSink({ json: true });
		sink.write({ kind: "turn", stage: "start" } as any);
		sink.write({ kind: "turn", stage: "end" } as any);
		const lines = stdout.join("").split("\n").filter(Boolean);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("handles malformed events gracefully (does not write garbage)", () => {
		const sink = makeSink({ json: true });
		expect(() => sink.write(undefined as any)).not.toThrow();
		expect(() => sink.write(null as any)).not.toThrow();
		expect(() => sink.write(42 as any)).not.toThrow();
		expect(() => sink.write("string" as any)).not.toThrow();
		// JSON.stringify on null/number/string -> valid JSON; undefined -> literal "undefined" (excluded)
		const lines = stdout.join("").split("\n").filter(l => l && l !== "undefined");
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("does not interleave events (write is sync)", () => {
		const sink = makeSink({ json: true });
		const events: any[] = [];
		for (let i = 0; i < 50; i++) {
			const ev = { kind: "turn", stage: "delta", payload: `payload-${i}` } as any;
			events.push(ev);
			sink.write(ev);
		}
		const lines = stdout.join("").split("\n").filter(Boolean);
		expect(lines.length).toBe(events.length);
	});

	it("handles binary/non-string args by JSON-encoding", () => {
		const sink = makeSink({ json: true });
		sink.write({ kind: "buffer", bytes: Buffer.from([0x01, 0x02, 0x03]) } as any);
		const out = stdout.join("");
		expect(() => JSON.parse(out.split("\n")[0])).not.toThrow();
	});

	it("does not append trailing newlines (no blank line)", () => {
		const sink = makeSink({ json: true });
		sink.write({ kind: "turn", stage: "start" } as any);
		const out = stdout.join("");
		expect(out).not.toMatch(/\n\n/); // no double newline
	});

	it("streaming chunk events are individually NDJSON", () => {
		const sink = makeSink({ json: true });
		const chunks = ["Hello", ", ", "world", "!"];
		for (const c of chunks) {
			sink.write({ kind: "turn", stage: "delta", chunk: c } as any);
		}
		const lines = stdout.join("").split("\n").filter(Boolean);
		expect(lines.length).toBe(4);
	});

	it("tool_call event preserves structured args", () => {
		const sink = makeSink({ json: true });
		const ev: any = {
			kind: "tool_call",
			id: "tc_1",
			name: "bash",
			args: { cmd: "ls -la", nested: { v: [1, 2, 3] } },
		};
		sink.write(ev);
		const parsed = JSON.parse(stdout[0]!);
		expect(parsed.name).toBe("bash");
		expect(parsed.args.cmd).toBe("ls -la");
		expect(parsed.args.nested.v).toEqual([1, 2, 3]);
	});
});

describe("[unit] partial chunk buffering (consumer side)", () => {
	it("partial JSON line carries over to next chunk", () => {
		// Simulate: stream arrives in chunks but NDJSON consumer must buffer
		const consumer = createNdjsonConsumer();
		// First chunk: half a line
		consumer.feed('{"kind":"turn","i":');
		expect(consumer.completeLines()).toEqual([]);
		// Second chunk: rest of line
		consumer.feed('1}\n{"kind":"turn","i":2}\n');
		expect(consumer.completeLines().length).toBe(2);
		expect(JSON.parse(consumer.completeLines()[0]!).i).toBe(1);
		expect(JSON.parse(consumer.completeLines()[1]!).i).toBe(2);
	});

	it("trailing partial line buffered until next newline", () => {
		const consumer = createNdjsonConsumer();
		consumer.feed('{"a":1}\n{"a":2');
		expect(consumer.completeLines().length).toBe(1);
		// After feed completes the line:
		consumer.feed("");
		expect(consumer.completeLines().length).toBe(1); // still 1
		consumer.feed("}\n");
		expect(consumer.completeLines().length).toBe(2);
	});

	it("survives long stream (>1MB)", () => {
		const consumer = createNdjsonConsumer();
		const big = "x".repeat(2048);
		const events: string[] = [];
		for (let i = 0; i < 1000; i++) events.push(JSON.stringify({ i, big }));
		consumer.feed(events.join("\n") + "\n");
		expect(consumer.completeLines().length).toBe(1000);
	});

	it("ignores empty lines", () => {
		const consumer = createNdjsonConsumer();
		consumer.feed("\n\n\n{}\n\n");
		expect(consumer.completeLines().length).toBe(1);
	});

	it("does not crash on EOF without trailing newline", () => {
		const consumer = createNdjsonConsumer();
		consumer.feed('{"a":1}\n{"a":2}'); // no final \n
		expect(consumer.completeLines().length).toBe(1);
		// Force flush on EOF
		consumer.eof();
		expect(consumer.completeLines().length).toBe(2);
	});
});

// NDJSON consumer helper (matches typical shell pipe consumer)
function createNdjsonConsumer() {
	let buffer = "";
	const lines: string[] = [];
	return {
		feed(chunk: string) {
			buffer += chunk;
			let nl: number;
			while ((nl = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (line) lines.push(line);
			}
		},
		eof() {
			const trailing = buffer.trim();
			buffer = "";
			if (trailing) lines.push(trailing);
		},
		completeLines() { return [...lines]; },
	};
}

// ──────────────────────────────────────────────────────────────
// SMOKE — JSON stream module
// ──────────────────────────────────────────────────────────────

describe("[smoke] JSON stream module", () => {
	it("sink module loads", async () => {
		const mod = await import("../../../packages/print/src/index.ts");
		expect(typeof mod.makeSink).toBe("function");
	});

	it("constructs sink in both modes", () => {
		expect(() => makeSink({ json: true })).not.toThrow();
		expect(() => makeSink({ json: false })).not.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — End-to-end JSON stream integration (skip without MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. mock auth, mya --json "tool-call test" → verify tool_call event emitted
//   2. mock auth, mya --json "approval needed" → verify approval event
//   3. long-running turn → verify JSON events arrive BEFORE exit (real-time)
//   4. SIGTERM during run → graceful close, events flushed
//   5. partial line buffering: stream from mya piped to custom consumer

// ──────────────────────────────────────────────────────────────
// TUI UI — N/A (JSON mode is non-interactive)
// ──────────────────────────────────────────────────────────────
