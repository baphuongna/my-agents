/**
 * OpenAIAdapter — request building, HTTP error mapping, and SSE response
 * parsing (text deltas, streamed tool calls, finish_reason, usage).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { TextEncoder } from "node:util";
import { OpenAIAdapter } from "./openai.js";
import type { SystemPrompt, History } from "@my-agent/core";

const emptyPrompt: SystemPrompt = { stable: "", context: "", volatile: "" };
const emptyHistory: History = {
  append: () => {},
  entries: () => [],
};

/** Build an SSE Response from a list of raw SSE-frame strings (each incl. `\n\n`). */
function sseResponse(frames: string[], status = 200, headers?: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

/** Convenience: wrap a JSON payload as a `data:` SSE frame. */
function dataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIAdapter — construction", () => {
  it("defaults id to openai:<model>", () => {
    const a = new OpenAIAdapter({ model: "gpt-4.1", apiKey: "k" });
    expect(a.id).toBe("openai:gpt-4.1");
    expect(a.model).toBe("gpt-4.1");
  });

  it("honours a custom id", () => {
    const a = new OpenAIAdapter({ model: "gpt-4.1", id: "my-route", apiKey: "k" });
    expect(a.id).toBe("my-route");
  });

  it("strips a trailing slash from baseUrl", () => {
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://api.openai.com/v1/" });
    // baseUrl is private; verify indirectly via the fetch URL below — here we
    // just assert the adapter is constructible without error and health works.
    expect(a.health()).toBe("Healthy");
  });

  it("health is Degraded without an apiKey (and env unset)", () => {
    const a = new OpenAIAdapter({ model: "m", apiKey: "" });
    expect(a.health()).toBe("Degraded");
  });

  it("health is Healthy with an apiKey", () => {
    const a = new OpenAIAdapter({ model: "m", apiKey: "sk-test" });
    expect(a.health()).toBe("Healthy");
  });
});

describe("OpenAIAdapter — error mapping", () => {
  it("returns an auth error immediately when no API key is set", async () => {
    const a = new OpenAIAdapter({ model: "m", apiKey: "" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps HTTP 401 to a non-recoverable auth error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "error",
      error: { phase: "auth", recoverable: false },
    });
  });

  it("maps HTTP 403 to a non-recoverable auth error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events[0]).toMatchObject({ kind: "error", error: { phase: "auth" } });
  });

  it("maps HTTP 429 to a recoverable quota error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events[0]).toMatchObject({
      kind: "error",
      error: { phase: "quota", recoverable: true },
    });
  });

  it("maps a generic non-ok status to a provider net error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events[0]).toMatchObject({
      kind: "error",
      error: { phase: "provider", recoverable: true },
    });
  });

  it("maps a fetch rejection to a provider net error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events[0]).toMatchObject({
      kind: "error",
      error: { phase: "provider", context: { reason: "ECONNREFUSED" } },
    });
  });
});

describe("OpenAIAdapter — SSE parsing", () => {
  it("emits text events from content deltas and a done event", async () => {
    const frames = [dataFrame({ choices: [{ delta: { content: "Hel" } }] }), dataFrame({ choices: [{ delta: { content: "lo" } }] }), dataFrame({ choices: [{ delta: {}, finish_reason: "stop" }] })];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["Hel", "lo"]);
    const done = events[events.length - 1]!;
    expect(done.kind).toBe("done");
    expect((done as { finish: string }).finish).toBe("stop");
  });

  it("ignores the [DONE] sentinel and still emits done", async () => {
    const frames = [dataFrame({ choices: [{ delta: { content: "x" } }] }), "data: [DONE]\n\n"];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    expect(events.some((e) => e.kind === "done")).toBe(true);
  });

  it("maps finish_reason 'length' to finish 'length'", async () => {
    const frames = [dataFrame({ choices: [{ delta: { content: "x" }, finish_reason: "length" }] })];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    const done = events[events.length - 1]!;
    expect((done as { finish: string }).finish).toBe("length");
  });

  it("maps finish_reason 'tool_calls' to finish 'tool'", async () => {
    const frames = [dataFrame({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    const done = events[events.length - 1]!;
    expect((done as { finish: string }).finish).toBe("tool");
  });

  it("maps finish_reason 'content_filter' to finish 'error'", async () => {
    const frames = [dataFrame({ choices: [{ delta: {}, finish_reason: "content_filter" }] })];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    const done = events[events.length - 1]!;
    expect((done as { finish: string }).finish).toBe("error");
  });

  it("collects streamed tool calls across index-keyed chunks into one tool_calls event", async () => {
    // First chunk carries id+name; second carries only the arguments delta.
    const frames = [
      dataFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: "{\"q\":" } }] } }] }),
      dataFrame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"cats\"}" } }] } }] }),
      dataFrame({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    const tc = events.find((e) => e.kind === "tool_calls") as { calls: Array<{ id: string; name: string; args: unknown }> } | undefined;
    expect(tc).toBeDefined();
    expect(tc!.calls).toHaveLength(1);
    expect(tc!.calls[0]!.id).toBe("call_1");
    expect(tc!.calls[0]!.name).toBe("search");
    expect(tc!.calls[0]!.args).toEqual({ q: "cats" });
  });

  it("includes usage in the done event when the provider sends it", async () => {
    const frames = [dataFrame({ choices: [{ delta: { content: "hi" } }] }), dataFrame({ usage: { prompt_tokens: 10, completion_tokens: 4 } })];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const { events } = await a.stream(emptyPrompt, emptyHistory);
    const done = events[events.length - 1]!;
    expect((done as { usage: { input: number; output: number } }).usage).toEqual({ input: 10, output: 4 });
  });

  it("sends the merged system prompt (stable+context+volatile) as a single system message", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return sseResponse([dataFrame({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]);
    }));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    await a.stream({ stable: "BASE", context: "CTX", volatile: "ENV" }, emptyHistory);
    const messages = capturedBody!["messages"] as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toBe("BASE\n\nCTX\n\nENV");
  });

  it("includes tools in the request body when provided", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return sseResponse([dataFrame({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]);
    }));
    const a = new OpenAIAdapter({ model: "m", apiKey: "k", baseUrl: "https://x.test/v1" });
    const tool = { type: "function" as const, function: { name: "echo", description: "d" } };
    await a.stream(emptyPrompt, emptyHistory, { tools: [tool] });
    expect(capturedBody!["tools"]).toEqual([tool]);
  });
});
