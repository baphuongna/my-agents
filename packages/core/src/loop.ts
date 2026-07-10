/**
 * runTurn — the core agent loop (§4).
 *
 * Tier-0 skeleton: stream → (tool calls deferred to §7 package) → complete.
 * Implements the FSM contract + budget spend + RuntimeEvent emission.
 * The full retry/fallback/approval pipeline lands with the §6/§7 packages.
 */
import type {
  BudgetConfig,
  Cost,
  DegradedResult,
  LifecycleError,
  ProviderProfile,
  RuntimeEvent,
  Session,
  StreamEvent,
  ToolCall,
  ToolExecutor,
  ToolResult,
  TurnContext,
  TurnEvent,
} from "./types.js";
import { computeCostStub as computeCost } from "./cost.js";

export interface TurnHandle {
  /** Subscribe to RuntimeEvents. */
  on(fn: (e: RuntimeEvent) => void): () => void;
  /** Abort the turn. */
  cancel(): void;
  /** Resolved when the turn reaches a terminal state. */
  done: Promise<TurnTerminal>;
}

export type TurnTerminal =
  | { state: "Completed"; usage: import("./types.js").TokenUsage; cost: Cost }
  | { state: "Failed"; error: LifecycleError }
  | { state: "Cancelled"; reason: string };

export interface RunTurnOptions {
  session: Session;
  budget: BudgetConfig;
  /** Which profile to use (Tier 0: caller picks; Tier 1: streamWithFallback picks). */
  profile?: ProviderProfile;
  /** §6 stream function (fallback chain). If provided, used instead of opts.profile.
   *  Keeps core layering-clean: ai provides streamWithFallback; orchestration injects it. */
  stream?: (
    prompt: import("./types.js").SystemPrompt,
    history: import("./types.js").History,
  ) => Promise<{ events: import("./types.js").StreamEvent[] } | { error: LifecycleError }>;
  /** §7 tool executor. If absent, tool calls are emitted but not executed (Tier 0). */
  tools?: ToolExecutor;
  /** Max tool-exec rounds before forcing completion (safety against infinite loops). */
  maxToolRounds?: number;
  signal?: AbortSignal;
}

const MAX_ATTEMPTS = 3;

/**
 * Run a single turn. Tier-0: a straight stream → complete, with bounded retry
 * on recoverable stream errors. Tool-call execution is a no-op stub here
 * (lands with the §7 tools package).
 */
export function runTurn(opts: RunTurnOptions): TurnHandle {
  const subs = new Set<(e: RuntimeEvent) => void>();
  // Replay buffer: events emitted before the first subscriber attaches are
  // buffered + flushed on first .on(). This makes runTurn robust to callers
  // that subscribe after an await (e.g. agent.startTurn awaits refresh before
  // returning the handle). (R40 fix.)
  const replay: RuntimeEvent[] = [];
  let cancelled = false;
  let resolveDone!: (t: TurnTerminal) => void;
  const done = new Promise<TurnTerminal>((res) => {
    resolveDone = res;
  });
  // Internal controller for turns with no caller-supplied signal.
  const internal = new AbortController();
  const signal = opts.signal ?? internal.signal;

  const emit = (e: RuntimeEvent) => {
    if (subs.size === 0) {
      replay.push(e);
      return;
    }
    for (const fn of subs) fn(e);
  };
  const emitTurn = (te: TurnEvent) =>
    emit({ kind: "turn", stage: "event", turnEvent: te });

  if (signal.aborted) cancel("aborted before start");

  function cancel(reason: string) {
    if (cancelled) return;
    cancelled = true;
    internal.abort();
    emitTurn({ state: "Cancelled", reason });
    emit({ kind: "turn", stage: "end" });
    resolveDone({ state: "Cancelled", reason });
  }
  signal.addEventListener("abort", () => cancel("abort signal"));

  // Defer the loop to a microtask so the caller can subscribe (handle.on)
  // BEFORE any event is emitted. Otherwise turn/start fires to an empty
  // subscriber set and is lost. (R37-2 fix.)
  queueMicrotask(() => void runLoop());

  async function runLoop(): Promise<void> {
    if (cancelled) return; // pre-abort guard: don't emit start after end
    emit({ kind: "turn", stage: "start" });
    const profile = opts.profile ?? opts.session.profiles[0];
    if (!profile) {
      const err: LifecycleError = {
        phase: "provider",
        recoverable: false,
        retries: 0,
        context: { reason: "no provider profile" },
      };
      emitTurn({ state: "Failed", error: err });
      emit({ kind: "turn", stage: "end" });
      resolveDone({ state: "Failed", error: err });
      return;
    }

    const maxRounds = opts.maxToolRounds ?? 25; // §4 safety: bounded, not unbounded recursion
    // §4 runTurn: while-loop until a turn produces no tool calls (R27-1/D4).
    for (let round = 0; round <= maxRounds; round++) {
      if (cancelled) return;
      // §4: budget gate — abort BEFORE spending.
      if (opts.budget.exhausted()) {
        const err: LifecycleError = {
          phase: "resource",
          recoverable: false,
          retries: round,
          context: { reason: "budget exhausted before stream" },
        };
        emitTurn({ state: "Failed", error: err });
        emit({ kind: "turn", stage: "end" });
        resolveDone({ state: "Failed", error: err });
        return;
      }
      try {
        const prompt = opts.session.prompt ?? {
          stable: opts.session.stableTier,
          context: "",
          volatile: opts.session.userMd,
        };
        // §6: prefer the injected stream function (fallback chain); else the single profile.
        let events: import("./types.js").StreamEvent[];
        if (opts.stream) {
          const r = await opts.stream(prompt, opts.session.history);
          if ("error" in r) {
            emitTurn({ state: "Failed", error: r.error });
            emit({ kind: "turn", stage: "end" });
            resolveDone({ state: "Failed", error: r.error });
            return;
          }
          events = r.events;
        } else {
          const { events: ev } = await profile.stream(prompt, opts.session.history);
          events = ev;
        }
        const result = consumeStream(events, emitTurn);
        if (result.kind === "error") {
          emitTurn({ state: "Failed", error: result.error });
          emit({ kind: "turn", stage: "end" });
          resolveDone({ state: "Failed", error: result.error });
          return;
        }
        const cost = computeCost(result.usage);
        const spent = opts.budget.spend(cost);
        if (!spent && !opts.budget.unlimited) {
          const err: LifecycleError = {
            phase: "resource",
            recoverable: false,
            retries: round,
            context: { reason: "budget exhausted (abortThreshold breached)" },
          };
          emitTurn({ state: "Failed", error: err });
          emit({ kind: "turn", stage: "end" });
          resolveDone({ state: "Failed", error: err });
          return;
        }
        emit({
          kind: "budget",
          spentUsd: cost.usd,
          remainingUsd: opts.budget.remaining(),
          exhausted: opts.budget.exhausted(),
        });

        // If the stream produced tool calls AND we have an executor, run them
        // and loop back for the model to continue (§4 while-loop).
        if (result.toolCalls.length > 0 && opts.tools) {
          const ctx: TurnContext = {
            session: opts.session,
            history: opts.session.history,
            budget: opts.budget,
            approval: makeStubApproval(),
            emit: emitTurn,
          };
          const toolResult = await opts.tools.execute(result.toolCalls, ctx);
          emitTurn({ state: "ToolExec", result: toolResult });
          // Append tool results to history so the next stream round sees them.
          opts.session.history.append({ role: "tool", results: toolResult });
          continue; // loop back: model continues with tool results
        }

        // No tool calls (or no executor) → terminal.
        emitTurn({ state: "Completed", usage: result.usage, cost });
        emit({ kind: "turn", stage: "end" });
        resolveDone({ state: "Completed", usage: result.usage, cost });
        return;
      } catch (e) {
        const err: LifecycleError = {
          phase: "stream",
          recoverable: true,
          retries: round,
          context: { reason: e instanceof Error ? e.message : String(e) },
        };
        emitTurn({ state: "Failed", error: err });
        emit({ kind: "turn", stage: "end" });
        resolveDone({ state: "Failed", error: err });
        return;
      }
    }
    // Exhausted tool rounds → fail (safety against runaway loops).
    const err: LifecycleError = {
      phase: "tool",
      recoverable: false,
      retries: maxRounds,
      context: { reason: `exceeded maxToolRounds (${maxRounds})` },
    };
    emitTurn({ state: "Failed", error: err });
    emit({ kind: "turn", stage: "end" });
    resolveDone({ state: "Failed", error: err });
  }

  return {
    on: (fn) => {
      subs.add(fn);
      // Flush any buffered events to the new subscriber.
      for (const e of replay) fn(e);
      replay.length = 0;
      return () => subs.delete(fn);
    },
    cancel: (reason = "user") => cancel(reason),
    done,
  };
}

type StreamConsume =
  | { kind: "ok"; usage: import("./types.js").TokenUsage; toolCalls: ToolCall[] }
  | { kind: "error"; error: LifecycleError };

function consumeStream(
  events: StreamEvent[],
  emitTurn: (te: TurnEvent) => void,
): StreamConsume {
  let usage: import("./types.js").TokenUsage | undefined;
  const toolCalls: ToolCall[] = [];
  for (const ev of events) {
    switch (ev.kind) {
      case "text":
        emitTurn({ state: "Streaming", chunk: { kind: "text", text: ev.text } });
        break;
      case "tool_calls":
        emitTurn({ state: "ToolCalls", calls: ev.calls });
        toolCalls.push(...ev.calls);
        break;
      case "done":
        usage = ev.usage;
        break;
      case "error":
        return { kind: "error", error: ev.error };
    }
  }
  if (!usage) {
    return {
      kind: "error",
      error: {
        phase: "stream",
        recoverable: false,
        retries: 0,
        context: { reason: "stream ended without usage" },
      },
    };
  }
  return { kind: "ok", usage, toolCalls };
}

// Tier-1 stub approval channel: allows ReadOnly/WorkspaceWrite, DENIES
// DangerFullAccess (bash) unless the caller injects a real approval channel.
// This keeps the §7 gate honest for the dangerous-tool path (R37-38).
function makeStubApproval(): import("./types.js").ApprovalChannel {
  return {
    request: async (r) =>
      r.requiredMode === "DangerFullAccess"
        ? { decision: "Deny" as const, reason: "DangerFullAccess requires a real approval channel (stub denies)" }
        : { decision: "Allow" as const },
  };
}
