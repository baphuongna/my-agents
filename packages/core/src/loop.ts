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
  LifecycleError,
  ProviderProfile,
  RuntimeEvent,
  Session,
  StreamEvent,
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
  let cancelled = false;
  let resolveDone!: (t: TurnTerminal) => void;
  const done = new Promise<TurnTerminal>((res) => {
    resolveDone = res;
  });
  // Internal controller for turns with no caller-supplied signal.
  const internal = new AbortController();
  const signal = opts.signal ?? internal.signal;

  const emit = (e: RuntimeEvent) => {
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

  void (async () => {
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

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (cancelled) return;
      try {
        const prompt = opts.session.prompt ?? {
          stable: opts.session.stableTier,
          context: "",
          volatile: opts.session.userMd,
        };
        const { events } = await profile.stream(
          prompt,
          opts.session.history,
        );
        const result = consumeStream(events, emitTurn);
        if (result.kind === "error") {
          if (result.error.recoverable && attempt < MAX_ATTEMPTS) {
            emitTurn({ state: "Recoverable", error: result.error });
            continue;
          }
          emitTurn({ state: "Failed", error: result.error });
          emit({ kind: "turn", stage: "end" });
          resolveDone({ state: "Failed", error: result.error });
          return;
        }
        const cost = computeCost(result.usage);
        opts.budget.spend(cost);
        emit({
          kind: "budget",
          spentUsd: cost.usd,
          remainingUsd: opts.budget.remaining(),
          exhausted: opts.budget.exhausted(),
        });
        emitTurn({ state: "Completed", usage: result.usage, cost });
        emit({ kind: "turn", stage: "end" });
        resolveDone({
          state: "Completed",
          usage: result.usage,
          cost,
        });
        return;
      } catch (e) {
        const err: LifecycleError = {
          phase: "stream",
          recoverable: true,
          retries: attempt - 1,
          context: { reason: e instanceof Error ? e.message : String(e) },
        };
        if (attempt < MAX_ATTEMPTS) {
          emitTurn({ state: "Recoverable", error: err });
          continue;
        }
        err.recoverable = false;
        emitTurn({ state: "Failed", error: err });
        emit({ kind: "turn", stage: "end" });
        resolveDone({ state: "Failed", error: err });
        return;
      }
    }
  })();

  return {
    on: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    cancel: (reason = "user") => cancel(reason),
    done,
  };
}

type StreamConsume =
  | { kind: "ok"; usage: import("./types.js").TokenUsage }
  | { kind: "error"; error: LifecycleError };

function consumeStream(
  events: StreamEvent[],
  emitTurn: (te: TurnEvent) => void,
): StreamConsume {
  let usage: import("./types.js").TokenUsage | undefined;
  for (const ev of events) {
    switch (ev.kind) {
      case "text":
        emitTurn({ state: "Streaming", chunk: { kind: "text", text: ev.text } });
        break;
      case "tool_calls":
        emitTurn({ state: "ToolCalls", calls: ev.calls });
        // Tier 0: tool execution is a §7-package concern; no-op here.
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
  return { kind: "ok", usage };
}
