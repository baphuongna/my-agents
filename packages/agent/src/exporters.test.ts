/**
 * @my-agent/agent — exporter tests (Gap 12).
 *
 * Covers OtelExporter (OTLP/HTTP JSON), LangfuseExporter, and the
 * createExporter() factory routing with NoopExporter fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OtelExporter, LangfuseExporter, createExporter } from "./exporters.js";
import { NoopExporter } from "@my-agent/core";

// Snapshot of relevant env vars for save/restore.
const ENV_KEYS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_SERVICE_NAME",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_HOST",
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

/** A typed fetch mock factory that records calls. */
type FetchMock = ReturnType<typeof vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>>;

function makeFetchMock(responder: (url: string) => Response): FetchMock {
  return vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return responder(url);
  });
}

let envSnap: Record<string, string | undefined>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  envSnap = snapshotEnv();
  originalFetch = globalThis.fetch;
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  restoreEnv(envSnap);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OtelExporter", () => {
  it("startSpan returns a Span with name + startTime and end() buffers", () => {
    const ex = new OtelExporter({ endpoint: "https://otlp.test" });
    const span = ex.startSpan("test.op", { foo: "bar" });
    expect(span.name).toBe("test.op");
    expect(typeof span.startTime).toBe("number");
    expect(span.attrs).toEqual({ foo: "bar" });
    span.end();
    expect(ex.bufferedCount).toBe(1);
  });

  it("flush() sends an OTLP POST with resourceSpans shape", async () => {
    const spy = makeFetchMock(() => new Response("{}", { status: 200 }));
    globalThis.fetch = spy;

    const ex = new OtelExporter({ endpoint: "https://otlp.test" });
    const span = ex.startSpan("test.op");
    span.end();
    await ex.flush();

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    expect(String(url)).toBe("https://otlp.test/v1/traces");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    const spanName =
      body.resourceSpans[0].scopeSpans[0].spans[0].name;
    expect(spanName).toBe("test.op");
  });

  it("flush() is a no-op (no fetch) without an endpoint", async () => {
    const spy = makeFetchMock(() => new Response("{}", { status: 200 }));
    globalThis.fetch = spy;

    // No env var set, no opts endpoint.
    const ex = new OtelExporter();
    expect(ex.bufferedCount).toBe(0);
    const span = ex.startSpan("noop.op");
    span.end();
    await ex.flush();
    expect(spy).not.toHaveBeenCalled();
    // Buffer is NOT cleared when endpoint is absent (flush returns early).
    expect(ex.bufferedCount).toBe(1);
  });
});

describe("LangfuseExporter", () => {
  it("flush() sends to ingestion API with Basic auth header", async () => {
    const spy = makeFetchMock(() => new Response("{}", { status: 200 }));
    globalThis.fetch = spy;

    const ex = new LangfuseExporter({
      publicKey: "pk-test",
      secretKey: "sk-test",
      host: "https://lf.test",
    });
    const span = ex.startSpan("agent.turn");
    span.end();
    await ex.flush();

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]!;
    const url = String(call[0]);
    const init = call[1];
    expect(url).toContain("/api/public/ingestion");
    const headers = init?.headers as Record<string, string>;
    const expected = Buffer.from("pk-test:sk-test").toString("base64");
    expect(headers["Authorization"]).toBe(`Basic ${expected}`);
    // Body should include trace-create for agent.turn.
    const body = JSON.parse(init?.body as string);
    expect(body.data[0].type).toBe("trace-create");
  });

  it("flush() is a no-op without keys", async () => {
    const spy = makeFetchMock(() => new Response("{}", { status: 200 }));
    globalThis.fetch = spy;

    // No env keys, no opts keys.
    const ex = new LangfuseExporter();
    const span = ex.startSpan("some.op");
    span.end();
    await ex.flush();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("createExporter routing", () => {
  it("returns NoopExporter when no backend is configured", () => {
    // All env vars already deleted in beforeEach.
    const ex = createExporter();
    expect(ex).toBeInstanceOf(NoopExporter);
  });

  it("returns OtelExporter when OTEL_EXPORTER_OTLP_ENDPOINT is set, LangfuseExporter when keys are set", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.test";
    expect(createExporter()).toBeInstanceOf(OtelExporter);

    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    expect(createExporter()).toBeInstanceOf(LangfuseExporter);
  });
});
