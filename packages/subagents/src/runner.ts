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
  MAX_APPROVAL_CHAIN_DEPTH,
} from "@my-agent/core";
import { verifyGreen } from "./green.js";

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
    // §10 R27-9/O4: enforce the hierarchical approval-chain depth cap (DoS guard).
    if ((s.chainDepth ?? 0) >= MAX_APPROVAL_CHAIN_DEPTH) {
      return { ok: false, error: `max approval chain depth exceeded (${MAX_APPROVAL_CHAIN_DEPTH})` };
    }
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
      // §10 GAP-10.1: validate the yield against the declared JSON schema (fail-closed).
      if (s.resultSchema) {
        const sv = validateSchema(data, s.resultSchema);
        if (!sv.ok) return { ok: false, error: `subagent yield schema mismatch: ${sv.error}` };
      }
      // §10.2 GreenContract: every child MUST reach its declared level + produce
      // passing evidence before the parent accepts the yield (fail-closed).
      if (s.greenContract) {
        const gv = verifyGreen(s.greenContract as never);
        if (!gv.ok) return { ok: false, error: `green-violation: ${gv.reason} — ${gv.detail}` };
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
  // M7 fix: cap concurrency (§14 MAX_CONCURRENT_SUBAGENTS, default 8). Without a
  // cap, n=10000 would spawn 10000 nested turns (DoS — budget bounds cost, not
  // concurrency). Shard across the bounded cap; each shard fans within budget.
  const MAX_CONCURRENT = 8;
  const capped = Math.max(1, Math.min(Math.floor(n), MAX_CONCURRENT));
  const spawns: Promise<SubagentResult>[] = [];
  for (let i = 0; i < capped; i++) {
    spawns.push(
      runner.spawn({ prompt: `${prompt} [shard ${i + 1}/${capped}]`, toolSurface: surface, approval, budget, topology: "fanout_fanin" }),
    );
  }
  return Promise.all(spawns);
}

export type { SubagentResult, SubagentSpawn, ToolCall, ToolResult, DegradedResult, SystemPrompt };

/**
 * Minimal JSON-Schema validator (§10 resultSchema). Handles the common subset
 * (type, required, properties, items, enum) without an ajv dependency. Returns
 * {ok:true} or {ok:false, error}. Fail-closed: an unknown schema keyword is
 * ignored, but a present field of the wrong type is rejected.
 */
export function validateSchema(value: unknown, schema: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  const check = (v: unknown, s: Record<string, unknown>, path: string): string | null => {
    if (typeof s.type === "string") {
      const t = s.type as string;
      const okType =
        (t === "object" && typeof v === "object" && v !== null && !Array.isArray(v)) ||
        (t === "array" && Array.isArray(v)) ||
        (t === "string" && typeof v === "string") ||
        (t === "number" && typeof v === "number") ||
        (t === "boolean" && typeof v === "boolean") ||
        (t === "null" && v === null) ||
        (t === "integer" && typeof v === "number" && Number.isInteger(v));
      if (!okType) return `${path}: expected ${t}, got ${Array.isArray(v) ? "array" : v === null ? "null" : typeof v}`;
    }
    if (Array.isArray(s.enum) && !(s.enum as unknown[]).includes(v)) {
      return `${path}: value not in enum`;
    }
    if (s.type === "object" && typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
      for (const req of (s.required as string[] | undefined) ?? []) {
        if (!(req in obj)) return `${path}.${req}: missing required field`;
      }
      const props = (s.properties as Record<string, Record<string, unknown>> | undefined);
      if (props) {
        for (const [k, sub] of Object.entries(props)) {
          if (k in obj) {
            const e = check(obj[k], sub, `${path}.${k}`);
            if (e) return e;
          }
        }
      }
    }
    if (s.type === "array" && Array.isArray(v)) {
      const items = s.items as Record<string, unknown> | undefined;
      if (items) for (let i = 0; i < v.length; i++) {
        const e = check((v as unknown[])[i], items, `${path}[${i}]`);
        if (e) return e;
      }
    }
    return null;
  };
  const err = check(value, schema, "$");
  return err ? { ok: false, error: err } : { ok: true };
}
