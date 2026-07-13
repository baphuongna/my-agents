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

export type SubagentStatus = "running" | "done" | "failed" | "aborted";

export interface SubagentOptions {
  /** Working directory for the subagent (isolated from parent). */
  cwd?: string;
  /** Tool names the subagent is allowed to use (encoded into system identity). */
  allowedTools?: string[];
  /** Model override (defaults to parent's model). */
  model?: string;
}

export interface SubagentHandle {
  readonly id: string;
  readonly goal: string;
  readonly startedAt: number;
  readonly allowedTools?: string[];
  readonly parentSessionId: string;
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
  return `sub-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Spawn a subagent. Creates a new AgentSession with custom cwd + system overlay.
 * Returns handle for tracking.
 */
export async function spawnSubagent(
  parent: AgentSession,
  opts: { goal: string; cwd?: string; allowedTools?: string[]; model?: string },
): Promise<SubagentHandle> {
  const id = nextSubagentId();
  const cwd = opts.cwd ?? process.cwd();
  const toolLine = opts.allowedTools?.length
    ? `\nAllowed tools: ${opts.allowedTools.join(", ")}\nUse only these tools.`
    : "";

  // System overlay = replace agent identity. Pi AgentSession uses stableTier
  // via systemPrompt at turn-time, so we embed the goal into the user prompt.
  // The actual restriction is best-effort — subagent must comply.

  const sessionOpts: CreateAgentSessionOptions = {
    cwd,
  };
  if (opts.model) sessionOpts.model = opts.model as never;

  const session = await createAgentSession(sessionOpts);

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
    startedAt: Date.now(),
    allowedTools: opts.allowedTools,
    parentSessionId: parent.sessionId ?? "",
    status: "running",
    output: "",
    session,
    abort: () => {
      if (handle.status === "running") {
        session.abort();
        handle.status = "aborted";
        handle.endedAt = Date.now();
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
      const effectivePrompt = `[SUBAGENT — focused task]${toolLine}\nGoal: ${opts.goal}\n\nWhen done, output the final answer prefixed with "<DONE>".`;
      const unsub = session.subscribe((event) => {
        // Stream + accumulate text chunks from session events
        const ev = event as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
        if (ev.type === "message_update" || ev.type === "message_end") {
          const content = ev.message?.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c?.type === "text" && c.text) {
                handle.output += c.text;
                pushChunk(c.text);
              }
            }
          }
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
        handle.endedAt = Date.now();
      }
      return handle.output;
    } catch (e) {
      const err = e as Error;
      handle.error = err.message;
      signalEnd(err);
      if (handle.status === "running") handle.status = "failed";
      handle.endedAt = Date.now();
      return handle.output;
    }
  })();

  return handle;
}

/** Active subagents per parent session. */
const activeByParent = new Map<string, Set<SubagentHandle>>();

/** Register a subagent under its parent (for /subagents listing). */
export function trackSubagent(parentId: string, sub: SubagentHandle): void {
  let set = activeByParent.get(parentId);
  if (!set) {
    set = new Set();
    activeByParent.set(parentId, set);
  }
  set.add(sub);
  // Auto-untrack when finished
  const interval = setInterval(() => {
    if (sub.status !== "running") {
      set?.delete(sub);
      clearInterval(interval);
      if (set && set.size === 0) activeByParent.delete(parentId);
    }
  }, 500);
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
  return n;
}