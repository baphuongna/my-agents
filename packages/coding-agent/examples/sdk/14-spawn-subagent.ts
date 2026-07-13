/**
 * SDK Example 14: Spawn Subagent Directly
 *
 * Demonstrates calling spawnSubagent() without going through an LLM tool call.
 * Useful for programmatic subagent orchestration (e.g. batch processing pipelines).
 *
 * Pattern:
 *   1. Create parent AgentSession
 *   2. Call spawnSubagent(parent, {goal, allowedTools, parentDepth})
 *   3. Wait for output via wait() or stream via stream()
 *   4. Subagent runs in isolated cwd + restricted tools
 *
 * Requirements:
 *   - API key in env (MINIMAX_API_KEY, OPENAI_API_KEY, etc.)
 *   - Or use a custom ProviderProfile with stream() that throws gracefully
 *
 * Run:
 *   MINIMAX_API_KEY=xxx npx tsx packages/coding-agent/examples/sdk/14-spawn-subagent.ts
 */
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import {
  spawnSubagent,
  trackSubagent,
  listSubagents,
  MAX_SUBAGENT_DEPTH,
  type SubagentHandle,
} from "../../src/core/subagent.ts";

async function main() {
  console.log(`Subagent demo (max depth: ${MAX_SUBAGENT_DEPTH})\n`);

  const parent = await createAgentSession({
    cwd: process.cwd(),
    agentDir: process.env["MYA_AGENT_DIR"] ?? `${process.env.HOME}/.mya/agent`,
  });
  console.log(`✓ Parent session: ${parent.session.sessionId?.slice(0, 16)}...`);

  // Spawn single subagent
  console.log("\n▶ Spawning subagent #1 (no tools, just text response)...");
  const sub1 = await spawnSubagent(parent.session, {
    goal: "Reply with exactly: hello from subagent #1",
    allowedTools: [], // no tools = pure text response
    parentDepth: 0,
  });
  trackSubagent(parent.session.sessionId ?? "", sub1);
  console.log(`  spawned: ${sub1.id} (depth ${sub1.depth})`);
  console.log(`  active: ${listSubagents(parent.session.sessionId ?? "").length}`);

  // Wait for completion
  const result1 = await sub1.wait();
  console.log(`\n▶ Subagent #1 done in ${Date.now() - sub1.startedAt}ms`);
  console.log(`  status: ${sub1.status}`);
  console.log(`  output: "${result1}"`);

  // Stream variant
  console.log("\n▶ Spawning subagent #2 (streaming output)...");
  const sub2 = await spawnSubagent(parent.session, {
    goal: "Count from 1 to 3 in your response",
    allowedTools: [],
    parentDepth: 0,
  });
  console.log(`  spawned: ${sub2.id}`);
  console.log("  chunks:");
  process.stdout.write("    ");
  for await (const chunk of sub2.stream()) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
  console.log(`  status: ${sub2.status}`);

  // Tree: subagent spawns sub-sub-agent
  console.log("\n▶ Tree: parent spawns sub #3 (depth 1)...");
  const sub3 = await spawnSubagent(parent.session, {
    goal: "I will spawn a sub-sub-agent to demonstrate depth=1",
    allowedTools: [],
    parentDepth: 1, // parent is at depth 0, this is at depth 1
  });
  console.log(`  spawned: ${sub3.id} (depth ${sub3.depth})`);

  // Show all active
  console.log(`\n▶ Active subagents: ${listSubagents(parent.session.sessionId ?? "").length}`);
  for (const s of listSubagents(parent.session.sessionId ?? "")) {
    console.log(`    ${s.id} [${s.status}] depth=${s.depth}: ${s.goal.slice(0, 40)}`);
  }

  // Wait + cleanup
  await sub3.wait();
  console.log("\n✓ All subagents complete");
}

main().catch((e) => {
  console.error("✗ Error:", e.message);
  process.exit(1);
});