/**
 * OTel + Langfuse exporters (Gap 12) — concrete TelemetryExporter implementations.
 *
 * Lives outside core (§18 minimal-core invariant). The interface + NoopExporter
 * stay in core/telemetry.ts; these classes import from @my-agent/core.
 *
 * Config:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP/HTTP endpoint (e.g. https://api.honeycomb.io)
 *   OTEL_SERVICE_NAME           — service.name attribute (default: "mya")
 *   LANGFUSE_PUBLIC_KEY          — Langfuse public key
 *   LANGFUSE_SECRET_KEY          — Langfuse secret key
 *   LANGFUSE_HOST                — Langfuse host (default: https://cloud.langfuse.com)
 *
 * Source: GAP-IMPLEMENTATION-PLAN.md Gap 12; §13 telemetry.
 */
import { nowMonotonic, nowWallclock, NoopExporter, type TelemetryExporter, type Span } from "@my-agent/core";
import { randomBytes } from "node:crypto";

// ─── Shared buffered span (used by both exporters) ────────────────────────

interface BufferedSpan {
  name: string;
  startTime: number;
  endTime: number;
  attrs: Record<string, unknown>;
}

function makeSpan(name: string, attrs: Record<string, unknown>, buffer: BufferedSpan[]): Span {
  const startTime = nowMonotonic();
  let ended = false;
  return {
    name,
    startTime,
    attrs: { ...attrs },
    end(extra?: Record<string, unknown>) {
      if (ended) return; // idempotent
      ended = true;
      buffer.push({
        name,
        startTime,
        endTime: nowMonotonic(),
        attrs: { ...attrs, ...(extra ?? {}) },
      });
    },
  };
}

// ─── OtelExporter (OTLP/HTTP JSON) ────────────────────────────────────────

/**
 * OpenTelemetry OTLP/HTTP exporter.
 * Buffers spans and POSTs them as OTLP JSON on flush().
 * No-op (no network call) when endpoint is unset.
 */
export class OtelExporter implements TelemetryExporter {
  private readonly endpoint?: string;
  private readonly serviceName: string;
  private readonly headers?: Record<string, string>;
  private buffer: BufferedSpan[] = [];

  constructor(opts?: {
    endpoint?: string;
    serviceName?: string;
    headers?: Record<string, string>;
  }) {
    this.endpoint = opts?.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    this.serviceName = opts?.serviceName ?? process.env.OTEL_SERVICE_NAME ?? "mya";
    this.headers = opts?.headers ?? parseOtelHeaders();
  }

  startSpan(name: string, attrs?: Record<string, unknown>): Span {
    return makeSpan(name, attrs ?? {}, this.buffer);
  }

  /** Number of buffered (ended but not yet flushed) spans. */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.endpoint) return;
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: this.serviceName } }] },
          scopeSpans: [
            {
              scope: { name: "mya" },
              spans: this.buffer.map((s) => ({
                name: s.name,
                kind: 0, // INTERNAL
                startTimeUnixNano: String(Math.round(s.startTime * 1e6)),
                endTimeUnixNano: String(Math.round(s.endTime * 1e6)),
                attributes: Object.entries(s.attrs).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: typeof v === "string" ? v : JSON.stringify(v) },
                })),
              })),
            },
          ],
        },
      ],
    };
    this.buffer = [];
    try {
      await fetch(this.endpoint + "/v1/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.headers ?? {}) },
        body: JSON.stringify(payload),
      });
    } catch {
      // network failure — spans are dropped (fire-and-forget observability)
    }
  }
}

function parseOtelHeaders(): Record<string, string> | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

// ─── LangfuseExporter ─────────────────────────────────────────────────────

/**
 * Langfuse exporter — maps spans to Langfuse trace/generation/event model.
 * POSTs batches to the Langfuse ingestion API on flush().
 * No-op when keys are absent.
 */
export class LangfuseExporter implements TelemetryExporter {
  private readonly publicKey?: string;
  private readonly secretKey?: string;
  private readonly host: string;
  private buffer: BufferedSpan[] = [];

  constructor(opts?: { publicKey?: string; secretKey?: string; host?: string }) {
    this.publicKey = opts?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
    this.secretKey = opts?.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
    this.host = opts?.host ?? process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";
  }

  startSpan(name: string, attrs?: Record<string, unknown>): Span {
    return makeSpan(name, attrs ?? {}, this.buffer);
  }

  get bufferedCount(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.publicKey || !this.secretKey) return;
    const batchId = cryptoRandom();
    const body = {
      batchId,
      data: this.buffer.map((s, i) => mapSpanToLangfuse(s, i)),
    };
    this.buffer = [];
    try {
      const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString("base64");
      await fetch(`${this.host}/api/public/ingestion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // network failure — spans are dropped
    }
  }
}

function mapSpanToLangfuse(s: BufferedSpan, index: number): Record<string, unknown> {
  const ts = Math.round(s.startTime / 1e6); // ns → ms wallclock-ish
  // agent.turn → trace, provider.stream → generation, everything else → event
  if (s.name === "agent.turn") {
    return {
      id: `trace-${index}`,
      type: "trace-create",
      timestamp: new Date(ts).toISOString(),
      body: { name: s.name, id: `trace-${index}`, metadata: s.attrs },
    };
  }
  if (s.name === "provider.stream") {
    return {
      id: `gen-${index}`,
      type: "generation-create",
      timestamp: new Date(ts).toISOString(),
      body: { name: s.name, traceId: s.attrs.traceId ?? `trace-${s.spanId}`, metadata: s.attrs },
    };
  }
  return {
    id: `event-${index}`,
    type: "event-create",
    timestamp: new Date(ts).toISOString(),
    body: { name: s.name, traceId: s.attrs.traceId ?? `trace-${s.spanId}`, metadata: s.attrs },
  };
}

function cryptoRandom(): string {
  return randomBytes(8).toString("hex") + nowWallclock().toString(36);
}

// ─── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a TelemetryExporter from environment configuration.
 * Returns NoopExporter when no backend is configured (graceful no-op).
 */
export function createExporter(
  fallback: TelemetryExporter = new NoopExporter(),
): TelemetryExporter {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return new OtelExporter();
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    return new LangfuseExporter();
  }
  return fallback;
}
