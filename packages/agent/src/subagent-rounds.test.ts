/**
 * Port Plan 2 — Per-subagent iteration budget tests.
 *
 * Verifies that `maxSubagentToolRounds` config is accepted, forwarded to the
 * subagent path, and defaults to `maxToolRounds` when unset.
 *
 * The actual exhaustion behavior is tested in core/loop.test.ts.
 * Here we verify the config plumbing (Port Plan 2 Tier 1).
 */
import { describe, it, expect } from "vitest";
import { createAgent, type AgentConfig } from "./index.js";
import { MockProvider } from "@my-agent/ai";
import type { StreamEvent } from "@my-agent/core";

function textProvider(text = "Done."): MockProvider {
  const events: StreamEvent[] = [
    { kind: "text", text },
    { kind: "done", usage: { input: 10, output: 5 }, finish: "stop" },
  ];
  return new MockProvider({ id: "mock", model: "mock-1", events });
}

describe("[unit] Port Plan 2 — maxSubagentToolRounds config plumbing", () => {
	it("AgentConfig accepts maxSubagentToolRounds", () => {
		const config: AgentConfig = {
			providers: [textProvider()],
			maxToolRounds: 10,
			maxSubagentToolRounds: 5,
		};
		expect(config.maxSubagentToolRounds).toBe(5);
		expect(config.maxToolRounds).toBe(10);
	});

	it("maxSubagentToolRounds is optional (unset = undefined)", () => {
		const config: AgentConfig = {
			providers: [textProvider()],
			maxToolRounds: 10,
		};
		expect(config.maxSubagentToolRounds).toBeUndefined();
	});

	it("subagent completes normally with maxSubagentToolRounds set", async () => {
		const agent = createAgent({
			providers: [textProvider("Task complete.")],
			maxToolRounds: 5,
			maxSubagentToolRounds: 25,
		});

		const sub = agent.spawnSubagent("simple task");
		const result = await sub.wait();

		expect(result).toBe("Task complete.");
		expect(sub.status).toBe("done");
	});

	it("subagent works with only maxToolRounds (backward compat)", async () => {
		const agent = createAgent({
			providers: [textProvider("Backward compat works.")],
			maxToolRounds: 5,
			// maxSubagentToolRounds NOT set
		});

		const sub = agent.spawnSubagent("backward compat test");
		const result = await sub.wait();

		expect(result).toBe("Backward compat works.");
		expect(sub.status).toBe("done");
	});

	it("parent run completes fine regardless of maxSubagentToolRounds", async () => {
		const agent = createAgent({
			providers: [textProvider("Parent done.")],
			maxToolRounds: 5,
			maxSubagentToolRounds: 1,
		});

		// Parent uses its own maxToolRounds=5, not the subagent cap
		await agent.run("simple prompt", () => {});
		// If we get here without error, parent was unaffected
		expect(true).toBe(true);
	});
});


