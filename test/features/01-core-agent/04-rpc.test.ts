/**
 * Feature 1.4 — RPC server (JSON-RPC 2.0 over stdio)
 *
 * FIXED: proper PassThrough stream output collection
 * Reference: packages/rpc/src/index.ts
 */

import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { RpcServer, type RpcHandler } from "../../../packages/rpc/src/index.ts";

// ──────────────────────────────────────────────────────────────
// Helper: wire up RpcServer with mock streams, return { send, getOutput }
// ──────────────────────────────────────────────────────────────

function makeRpc(handler: RpcHandler) {
	const input = new PassThrough();
	const output = new PassThrough();
	let buf = "";
	output.on("data", (chunk) => { buf += chunk.toString(); });
	const srv = new RpcServer(handler, input, output);
	srv.start();
	return {
		send: (line: string) => input.write(line + "\n"),
		end: () => input.end(),
		getLines: (): string[] => buf.split("\n").filter(Boolean),
		getOutput: (): string => buf,
	};
}

function wait(ms = 50): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function mockHandler(overrides: Partial<RpcHandler> = {}): RpcHandler {
	return {
		prompt: async (_text: string, _onEvent: (e: unknown) => void) => ({ ok: true }),
		cancel: () => {},
		status: () => ({ busy: false }),
		...overrides,
	};
}

// ──────────────────────────────────────────────────────────────
// UNIT — JSON-RPC framing
// ──────────────────────────────────────────────────────────────

describe("[unit] RpcServer framing", () => {
	it("rejects malformed JSON with parse error (-32700)", async () => {
		const rpc = makeRpc(mockHandler());
		rpc.send("not json");
		await wait();
		const lines = rpc.getLines();
		expect(lines.length).toBeGreaterThan(0);
		const resp = JSON.parse(lines[0]!);
		expect(resp.error.code).toBe(-32700);
	});

	it("rejects non-2.0 jsonrpc with invalid request (-32600)", async () => {
		const rpc = makeRpc(mockHandler());
		rpc.send(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }));
		await wait();
		const resp = JSON.parse(rpc.getLines()[0]!);
		expect(resp.error.code).toBe(-32600);
	});

	it("rejects method not found (-32601)", async () => {
		const rpc = makeRpc(mockHandler());
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "unknown_method" }));
		await wait();
		const resp = JSON.parse(rpc.getLines()[0]!);
		expect(resp.error.code).toBe(-32601);
	});

	it("dispatches prompt to handler.prompt", async () => {
		let called: string | null = null;
		const handler = mockHandler({
			prompt: async (text: string) => { called = text; return { ok: true }; },
		});
		const rpc = makeRpc(handler);
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { text: "hi" } }));
		await wait(100);
		expect(called).toBe("hi");
	});

	it("dispatches cancel to handler.cancel", async () => {
		let cancelled = false;
		const handler = mockHandler({ cancel: () => { cancelled = true; } });
		const rpc = makeRpc(handler);
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "cancel" }));
		await wait();
		expect(cancelled).toBe(true);
	});

	it("dispatches status to handler.status", async () => {
		const handler = mockHandler({ status: () => ({ uptime: 100, busy: false }) });
		const rpc = makeRpc(handler);
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "status" }));
		await wait();
		const resp = JSON.parse(rpc.getLines()[0]!);
		expect(resp.result).toEqual({ uptime: 100, busy: false });
	});

	it("dispatches heartbeat → returns { alive: true, ts }", async () => {
		const rpc = makeRpc(mockHandler());
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "heartbeat" }));
		await wait();
		const resp = JSON.parse(rpc.getLines()[0]!);
		expect(resp.result.alive).toBe(true);
		expect(typeof resp.result.ts).toBe("number");
	});

	it("emits notifications (no id) for streaming events", async () => {
		const handler = mockHandler({
			prompt: async (_text: string, onEvent: (e: unknown) => void) => {
				onEvent({ kind: "turn", stage: "start" });
				onEvent({ kind: "delta", text: "chunk1" });
				return { ok: true };
			},
		});
		const rpc = makeRpc(handler);
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { text: "x" } }));
		await wait(100);
		const lines = rpc.getLines();
		// Should have at least: 1 notification + 1 response
		expect(lines.length).toBeGreaterThanOrEqual(2);
		// First should be a notification (no id)
		const notif = JSON.parse(lines[0]!);
		expect(notif.method).toBe("event");
		expect(notif.id).toBeUndefined();
	});

	it("rejects concurrent prompts (R1: serialize)", async () => {
		let release: (() => void) | null = null;
		const blocking = new Promise<void>((r) => { release = r; });
		const handler = mockHandler({
			prompt: async () => { await blocking; return { ok: true }; },
		});
		const rpc = makeRpc(handler);
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { text: "a" } }));
		await wait(50); // let first start
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompt", params: { text: "b" } }));
		await wait(50);
		// Second should be rejected with -32001
		const lines = rpc.getLines();
		const rejected = lines.find((l) => {
			try { return JSON.parse(l).error?.code === -32001; } catch { return false; }
		});
		expect(rejected).toBeTruthy();
		// Release first
		release!();
		await wait(50);
	});

	it("prompt with missing params.text → -32600", async () => {
		const rpc = makeRpc(mockHandler());
		rpc.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt" }));
		await wait();
		const resp = JSON.parse(rpc.getLines()[0]!);
		expect(resp.error.code).toBe(-32600);
	});

	it("processes trailing partial line on EOF (R2)", async () => {
		const rpc = makeRpc(mockHandler());
		// Write without trailing newline
		rpc.send = (s: string) => { return true; }; // bypass
		// Direct write without \n then end
		const input = new PassThrough();
		const output = new PassThrough();
		let buf = "";
		output.on("data", (c) => { buf += c.toString(); });
		const srv = new RpcServer(mockHandler(), input, output);
		srv.start();
		input.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "status" })); // no \n
		input.end(); // EOF triggers trailing processing
		await wait(100);
		const lines = buf.split("\n").filter(Boolean);
		expect(lines.length).toBeGreaterThan(0);
		const resp = JSON.parse(lines[0]!);
		expect(resp.id).toBe(99);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] RPC module", () => {
	it("loads with all exports", async () => {
		const m = await import("../../../packages/rpc/src/index.ts");
		expect(typeof m.RpcServer).toBe("function");
		expect(typeof m.startTcpRpcServer).toBe("function");
	});

	it("constructs RpcServer", () => {
		expect(() => new RpcServer(mockHandler())).not.toThrow();
	});
});
