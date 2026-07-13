/**
 * @my-agent/coding-agent — subagent spawning.
 *
 * Subagent = a separate AgentSession with isolated cwd + JSONL history,
 * created via createAgentSession(). Shares model registry + auth with parent.
 *
 * Pattern (parent calls from anywhere):
 *   const sub = await spawnSubagent(parentSession, {
 *     goal: "review the auth code",
 *     allowedTools: ["read", "grep"],
 *   });
 *   // ... later:
 *   sub.status   // "running" | "done" | "failed" | "aborted"
 *   sub.output   // collected assistant text
 *   sub.abort()  // cancel
 *   for await (const chunk of sub.stream()) { ... }
 *
 * Note: pi's AgentSession doesn't natively support per-tool restrictions
 * (that's a future enhancement). For now, the restriction is enforced via
 * the goal/prompt — the subagent's system identity tells it which tools
 * to use. (For strict enforcement, layer ToolPolicy.)
 */
import { createAgentSession, type AgentSession, type CreateAgentSessionOptions } from "./sdk.js";
import { nowWallclock } from "@my-agent/core";

export type SubagentStatus = "running" | "done" | "failed" | "aborted";

/** Max recursion depth for subagent tree (parent → sub → sub). Default 3. */
export const MAX_SUBAGENT_DEPTH = 3;

export interface SubagentOptions {
  /** Working directory for the subagent (isolated from parent). */
  cwd?: string;
  /** Tool names the subagent is allowed to use (encoded into system identity). */
  allowedTools?: string[];
  /** Model override (defaults to parent's model). */
  model?: string;
  /** Depth in the subagent tree. 0 = top-level. Max 3. */
  parentDepth?: number;
}

export interface SubagentHandle {
  readonly id: string;
  readonly goal: string;
  readonly startedAt: number;
  readonly allowedTools?: string[];
  readonly parentSessionId: string;
  /** Depth in subagent tree (0 = top-level). */
  readonly depth: number;
  status: SubagentStatus;
  output: string;
  error?: string;
  endedAt?: number;
  abort(): void;
  wait(): Promise<string>;
  stream(): AsyncIterable<string>;
  /** Internal AgentSession (for extensions to wire in). */
  readonly session: AgentSession;
}

let counter = 0;
function nextSubagentId(): string {
  counter = (counter + 1) & 0xffff;
  return `sub-${nowWallclock().toString(36)}-${counter.toString(36)}`;
}

/**
 * Spawn a subagent. Creates a new AgentSession with custom cwd + system overlay.
 * Returns handle for tracking.
 */
export async function spawnSubagent(
  parent: { sessionId?: string } | AgentSession | string,
  opts: { goal: string; cwd?: string; allowedTools?: string[]; model?: string; parentDepth?: number },
): Promise<SubagentHandle> {
  const depth = opts.parentDepth ?? 0;
  if (depth >= MAX_SUBAGENT_DEPTH) {
    throw new Error(
      `spawnSubagent: max recursion depth ${MAX_SUBAGENT_DEPTH} reached (current depth: ${depth})`,
    );
  }
  const id = nextSubagentId();
  const cwd = opts.cwd ?? process.cwd();
  const parentSessionId = typeof parent === "string" ? parent : (parent.sessionId ?? "");
  const depthLine = depth > 0 ? `\nYou are a sub-subagent (depth ${depth + 1}).` : "";
  const toolLine = opts.allowedTools?.length
    ? `\nAllowed tools: ${opts.allowedTools.join(", ")}\nUse only these tools.`
    : "";

  // System overlay = replace agent identity. Pi AgentSession uses stableTier
  // via systemPrompt at turn-time, so we embed the goal into the user prompt.
  // The actual restriction is best-effort — subagent must comply.

  const sessionOpts: CreateAgentSessionOptions = {
    cwd,
    // Strict tool restriction: if allowedTools specified, disable ALL builtins
    // and let subagent use only the allowed set (via extension custom tools).
    // If not specified, subagent gets no tools (must rely on its own prompt).
    noTools: "builtin",
    tools: opts.allowedTools, // empty array = no tools, ["read","grep"] = only those
  };
  if (opts.model) sessionOpts.model = opts.model as never;

  const created = await createAgentSession(sessionOpts);
  const session = created.session;

  const chunks: string[] = [];
  const streamWaiters: Array<(v: IteratorResult<string>) => void> = [];
  let streamDone = false;
  let streamError: Error | null = null;

  function pushChunk(c: string): void {
    if (streamWaiters.length > 0) {
      streamWaiters.shift()!({ value: c, done: false });
    } else {
      chunks.push(c);
    }
  }
  function signalEnd(err?: Error): void {
    streamDone = true;
    streamError = err ?? null;
    if (err) {
      while (streamWaiters.length > 0) streamWaiters.shift()!(Promise.reject(err) as unknown as IteratorResult<string>);
    } else {
      while (streamWaiters.length > 0) streamWaiters.shift()!({ value: undefined as unknown as string, done: true });
    }
  }

  const handle: SubagentHandle = {
    id,
    goal: opts.goal,
    startedAt: nowWallclock(),
    allowedTools: opts.allowedTools,
    parentSessionId,
    depth,
    status: "running",
    output: "",
    session,
    abort: () => {
      if (handle.status === "running") {
        session.abort();
        handle.status = "aborted";
        handle.endedAt = nowWallclock();
      }
    },
    wait: () => completionPromise,
    stream: () => ({
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<string>> {
            if (streamError) return Promise.reject(streamError);
            if (chunks.length > 0) return Promise.resolve({ value: chunks.shift()!, done: false });
            if (streamDone) return Promise.resolve({ value: undefined as unknown as string, done: true });
            return new Promise((resolve) => streamWaiters.push(resolve));
          },
        };
      },
    }),
  };

  const completionPromise = (async () => {
    try {
      // Inject subagent identity + tool restriction into the goal.
      const effectivePrompt = `[SUBAGENT — focused task${depth > 0 ? ` (depth ${depth + 1})` : ""}]${depthLine}${toolLine}\nGoal: ${opts.goal}\n\nWhen done, output the final answer prefixed with "<DONE>".`;
      const unsub = session.subscribe((event) => {
        const ev = event as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
        if (ev.type === "message_update") {
          const content = ev.message?.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              // pi's message_update gives full accumulated text for current turn.
              // Overwrite is correct for single-turn subagents (current design).
              // For multi-turn: would need turn-boundary detection to accumulate properly.
              if (c?.type === "text" && c.text) handle.output = c.text;
            }
          }
        } else if (ev.type === "message_end") {
          if (handle.output) pushChunk(handle.output);
        }
      });
      try {
        await session.prompt(effectivePrompt, { streamingBehavior: "followUp" });
      } finally {
        unsub();
      }
      signalEnd();
      if (handle.status === "running") {
        handle.status = "done";
        handle.endedAt = nowWallclock();
      }
      return handle.output;
    } catch (e) {
      const err = e as Error;
      handle.error = err.message;
      signalEnd(err);
      if (handle.status === "running") handle.status = "failed";
      handle.endedAt = nowWallclock();
      return handle.output;
    }
  })();

  return handle;
}

/** Active subagents per parent session. */
const activeByParent = new Map<string, Set<SubagentHandle>>();
/** Optional global hook to notify UI when subagent count changes (for footer). */
let subagentCountListener: ((n: number) => void) | null = null;
export function setSubagentCountListener(fn: ((n: number) => void) | null): void {
  subagentCountListener = fn;
}
function totalActiveSubagents(): number {
  let n = 0;
  for (const set of activeByParent.values()) {
    for (const s of set) if (s.status === "running") n++;
  }
  return n;
}

/** Register a subagent under its parent (for /subagents listing). */
export function trackSubagent(parentId: string, sub: SubagentHandle): void {
  let set = activeByParent.get(parentId);
  if (!set) {
    set = new Set();
    activeByParent.set(parentId, set);
  }
  set.add(sub);
  subagentCountListener?.(totalActiveSubagents());
  // Auto-untrack when finished (with 10min hard cap to prevent permanent leak)
  const startTime = nowWallclock();
  const interval = setInterval(() => {
    if (sub.status !== "running" || nowWallclock() - startTime > 600_000) {
      set?.delete(sub);
      clearInterval(interval);
      if (set && set.size === 0) activeByParent.delete(parentId);
      subagentCountListener?.(totalActiveSubagents());
    }
  }, 500);
  interval.unref?.();
}

/** List active subagents for a parent session. */
export function listSubagents(parentId: string): SubagentHandle[] {
  const set = activeByParent.get(parentId);
  if (!set) return [];
  return [...set];
}

/** Kill all subagents for a parent. */
export function killAllSubagents(parentId: string): number {
  const set = activeByParent.get(parentId);
  if (!set) return 0;
  let n = 0;
  for (const sub of set) {
    if (sub.status === "running") {
      sub.abort();
      n++;
    }
  }
  subagentCountListener?.(totalActiveSubagents());
  return n;
}