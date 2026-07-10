/**
 * Subagent runner (§10) — Tier 1 in-process.
 *
 * spawn() derives a child budget (deriveChild — pre-charge), runs a nested turn
 * with a RESTRICTED tool surface (ToolSet: allowed/blocked + DELEGATE_BLOCKED_TOOLS),
 * and refunds the unused pre-charge on ANY terminal state (CC2 — incl. crash).
 *
 * CoW overlay isolation (overlayfs/reflink/git-worktree via natives) is Tier 2 —
 * it backs the `changedPaths` diff. Tier 1 runs in-process with tool-surface
 * restriction as the isolation boundary. The SubagentResult schema is stable so
 * the CoW merge-back (§10 R27-7/O2) drops in unchanged at Tier 2.
 *
 * Source: §10 Subagents, oh-my-pi task, R27-6/CC2/CC10, R27-7/O2.
 */
import {
  createSession,
  runTurn,
  type BudgetConfig,
  type DegradedResult,
  type ProviderProfile,
  type SubagentResult,
  type SubagentSpawn,
  type SystemPrompt,
  type TeamTopology,
  type ToolCall,
  type ToolExecutor,
  type ToolResult,
} from "@my-agent/core";

/** A factory that builds a tool executor restricted to the subagent's ToolSet. */
export type RestrictedToolExecutorFactory = (
  surface: SubagentSpawn["toolSurface"],
) => ToolExecutor;

export interface InProcessRunnerOptions {
  /** Profile the subagent uses (Tier 1: caller picks; §6 fallback Tier 2). */
  profile: ProviderProfile;
  /** Build a tool executor filtered to the subagent's allowed/blocked surface. */
  makeToolExecutor: RestrictedToolExecutorFactory;
  /** Parent budget — the child derives a slice + refunds unused on completion. */
  parentBudget: BudgetConfig;
  /** Per-child allocation (USD). */
  childAlloc: number;
}

/**
 * InProcessRunner — the Tier 1 SubagentRunner. Runs the child as a nested turn.
 * The schema-validated object yield (oh-my-pi) is approximated by the child's
 * final Streaming text parsed as JSON when possible (Tier 1; JTD validation Tier 2).
 */
export class InProcessRunner {
  constructor(private opts: InProcessRunnerOptions) {}

  async spawn(s: SubagentSpawn): Promise<SubagentResult> {
    const childBudget = this.opts.parentBudget.deriveChild(this.opts.childAlloc);
    const childId = childBudget.id ?? "unknown";
    const tools = this.opts.makeToolExecutor(s.toolSurface);
    const stableTier = `You are a subagent. Topology: ${s.topology ?? "pipeline"}. Yield a JSON object.`;
    const session = createSession({ profiles: [this.opts.profile], stableTier });
    session.history.append({ role: "user", content: s.prompt });

    const collected: string[] = [];
    const handle = runTurn({
      session,
      budget: childBudget,
      tools,
      maxToolRounds: 10,
    });
    handle.on((e) => {
      if (e.kind === "turn" && e.turnEvent?.state === "Streaming" && e.turnEvent.chunk.kind === "text") {
        collected.push(e.turnEvent.chunk.text);
      }
    });

    const terminal = await handle.done;

    // CC2: refund unused pre-charge on ANY terminal state (incl. fail/cancel).
    this.opts.parentBudget.releasePrecharge(childId);

    if (terminal.state === "Completed") {
      const text = collected.join("");
      const data = tryParseJson(text);
      if (data === PARSE_FAILED) {
        return { ok: false, error: `subagent yield not valid JSON: ${text.slice(0, 80)}` };
      }
      if (data === EMPTY) {
        return { ok: false, error: "subagent yielded empty output" };
      }
      // Tier 1: no file diff (CoW lands Tier 2); changedPaths deferred.
      return { ok: true, data, changedPaths: [] };
    }
    return {
      ok: false,
      error: terminal.state === "Failed"
        ? `subagent failed: ${terminal.error.context["reason"] ?? terminal.error.phase}`
        : `subagent ${terminal.state}`,
    };
  }
}

const PARSE_FAILED = Symbol("parse-failed");
const EMPTY = Symbol("empty");
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return EMPTY;
  try {
    return JSON.parse(trimmed);
  } catch {
    return PARSE_FAILED;
  }
}

// ─── Topology helpers (§10) ─────────────────────────────────────────────────
/** All 6 declarable topologies (harness catalog, research-validated). */
export const TOPOLOGIES: readonly TeamTopology[] = [
  "pipeline",
  "fanout_fanin",
  "expert_pool",
  "producer_reviewer",
  "supervisor",
  "hierarchical",
];

/** Fan-out a prompt to N parallel subagents, fan-in the results (Expert Pool / Fan-out-Fan-in). */
export async function fanOutFanIn(
  runner: InProcessRunner,
  prompt: string,
  n: number,
  surface: SubagentSpawn["toolSurface"],
  approval: SubagentSpawn["approval"],
  budget: BudgetConfig,
): Promise<SubagentResult[]> {
  const spawns: Promise<SubagentResult>[] = [];
  for (let i = 0; i < n; i++) {
    spawns.push(
      runner.spawn({ prompt: `${prompt} [shard ${i + 1}/${n}]`, toolSurface: surface, approval, budget, topology: "fanout_fanin" }),
    );
  }
  return Promise.all(spawns);
}

export type { SubagentResult, SubagentSpawn, ToolCall, ToolResult, DegradedResult, SystemPrompt };
