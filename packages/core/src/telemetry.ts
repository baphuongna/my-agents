/**
 * Telemetry export (§13) — a sampled, projected view of the RuntimeEvent stream.
 * Aggregates event-kind counters for O11s dashboards without leaking payload bytes
 * (we only record counts + aggregate timings + last-tick timestamps).
 *
 * Designed for opt-in; the host wires `TelemetrySink` to the runTurn event bus via
 * a thin adapter. Per-event projection is bounded (constant size, not event-
 * sized) so the sink can't OOM the host if it falls behind.
 *
 * Source: §13 (prose-level); the spec notes "opt-in sampled projection".
 */
import { nowWallclock } from "./time.js";

/** A projected, bounded view of one RuntimeEvent — no payload, no args. */
export interface TelemetryProjection {
  ts: number;
  kind: string;        // e.g. "turn", "tool", "budget", "approval"
  stage?: string;      // sub-stage, e.g. "start" | "end" | "event" for turn
  state?: string;      // turn-state if kind === "turn"
  ok?: boolean;        // for tool events: ok flag
}

export interface TelemetrySnapshot {
  /** Projections captured since the last flush (or since construction). */
  window: TelemetryProjection[];
  /** Per-kind counts since construction. */
  counts: Record<string, number>;
  /** Window-bounded ts of the first + last event in this window. */
  windowStartMs: number;
  windowEndMs: number;
  /** Sample rate actually applied (0..1). */
  sampleRate: number;
}

/** Project a RuntimeEvent into a bounded telemetry view (no payload leakage).
 * Review MEDIUM-1: for tool-result events, `ok` is read from `result.ok`
 * (the canonical RuntimeEvent shape — there is no top-level `ok` on tool events). */
export function project(e: { kind: string; [k: string]: unknown }): TelemetryProjection {
  const ts = (e as { ts?: number }).ts ?? nowWallclock();
  const stage = (e as { stage?: string }).stage;
  const te = (e as { turnEvent?: { state?: string } }).turnEvent;
  const state = te?.state;
  // tool-result events carry `ok` on result; fall back to top-level for budget/etc.
  const ok = (e as { result?: { ok?: boolean }; ok?: boolean }).result?.ok ?? (e as { ok?: boolean }).ok;
  return { ts, kind: e.kind, stage, state, ok };
}

/** A bounded event sink — records a sampled, projected rolling window. */
export class TelemetrySink {
  private counts: Record<string, number> = {};
  private window: TelemetryProjection[] = [];
  private windowStartMs = 0;
  private _windowEndMs = 0;
  private dropped = 0;
  private seen = 0;
  /** Review HIGH-1: ring-buffer write index — increments modulo maxWindow,
   * ensuring the LATEST maxWindow events are retained. */
  private writeIndex = 0;
  constructor(
    private sampleRate = 1,
    private readonly maxWindow = 10_000,
  ) {
    if (!(sampleRate > 0 && sampleRate <= 1)) throw new Error("telemetry: sampleRate must be in (0,1]");
  }

  /** Ingest one RuntimeEvent. Returns whether the event was sampled. */
  ingest(e: { kind: string; [k: string]: unknown }): boolean {
    // Deterministic sampling (counter-based, no Math.random): every (1/rate)th
    // event is kept; the rest are dropped. Reproducible across runs/tests.
    this.seen++;
    const interval = Math.max(1, Math.round(1 / this.sampleRate));
    if (this.sampleRate < 1 && this.seen % interval !== 0) {
      this.dropped++;
      return false;
    }
    const p = project(e);
    this.counts[p.kind] = (this.counts[p.kind] ?? 0) + 1;
    if (this.window.length === 0) this.windowStartMs = p.ts;
    this._windowEndMs = p.ts;
    if (this.window.length < this.maxWindow) {
      this.window.push(p);
    } else {
      // Review HIGH-1: real ring buffer — writeIndex advances modulo maxWindow,
      // so the latest maxWindow entries are always retained.
      this.window[this.writeIndex] = p;
      this.writeIndex = (this.writeIndex + 1) % this.maxWindow;
    }
    return true;
  }

  /** Snapshot + reset the window (counts are cumulative since construction). */
  flush(): TelemetrySnapshot {
    const snap: TelemetrySnapshot = {
      window: this.window.slice(),
      counts: { ...this.counts },
      windowStartMs: this.windowStartMs,
      windowEndMs: this._windowEndMs,
      sampleRate: this.sampleRate,
    };
    this.window = [];
    this.windowStartMs = 0;
    this._windowEndMs = 0;
    return snap;
  }

  /** Total dropped events (sample rate excluded them). */
  get droppedCount(): number { return this.dropped; }
  /** Current ring-buffer write index (test/debug). */
  get writeIndexCurrent(): number { return this.writeIndex; }
}
