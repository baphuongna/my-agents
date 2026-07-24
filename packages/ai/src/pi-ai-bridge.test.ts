/**
 * PiAiProviderBridge — converts pi-ai stream events into @my-agent/core
 * StreamEvents: text deltas, tool calls, done/usage mapping, error handling,
 * history + system-prompt assembly, and API-key resolution.
 */
import { describe, it, expect } from "vitest";
import { PiAiProviderBridge, wrapPiAiProvider, wrapAllPiAiProviders } from "./pi-ai-bridge.js";
import type { SystemPrompt, History } from "@my-agent/core";

// ── Minimal pi-ai event shape (structurally compatible with the bridge) ──

interface TestUsage {
  input: number;
  output: number;
  cacheRead?: number;
}
interface TestContent {
  type: "text" | "thinking" | "toolCall";
  text?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}
interface TestMessage {
  content: TestContent[];
  usage: TestUsage;
  stopReason?: string;
}
interface TestEvent {
  type: "start" | "text_start" | "text_delta" | "text_end" | "thinking_start" | "thinking_delta" | "thinking_end" | "toolcall_start" | "toolcall_delta" | "toolcall_end" | "done" | "error";
  delta?: string;
  content?: string;
  toolCall?: { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };
  reason?: string;
  message?: TestMessage;
}

const emptyPrompt: SystemPrompt = { stable: "", context: "", volatile: "" };
const emptyHistory: History = {
  append: () => {},
  entries: () => [],
};

/** Build a fake pi-ai provider that replays a fixed list of events. */
function makeProvider(
  events: TestEvent[],
  opts: { id?: string; apiKeyResolve?: () => string | undefined; capture?: (ctx: unknown) => void } = {},
) {
  const capture = opts.capture;
  return {
    id: opts.id ?? "testprov",
    auth: opts.apiKeyResolve ? { apiKey: { resolve: opts.apiKeyResolve } } : undefined,
    async *streamSimple(
      _model: { id: string; api?: string },
      context: unknown,
      _options?: { apiKey?: string; signal?: AbortSignal; reasoning?: string },
    ): AsyncGenerator<TestEvent> {
      if (capture) capture(context);
      for (const e of events) yield e;
    },
  };
}

describe("PiAiProviderBridge — construction & health", () => {
  it("defaults id to <providerId>:<modelId>", () => {
    const b = new PiAiProviderBridge({ provider: makeProvider([]), model: { id: "claude-x" }, apiKey: "k" });
    expect(b.id).toBe("testprov:claude-x");
    expect(b.model).toBe("claude-x");
  });

  it("honours an explicit id override", () => {
    const b = new PiAiProviderBridge({ provider: makeProvider([]), model: { id: "m" }, apiKey: "k", id: "custom-id" });
    expect(b.id).toBe("custom-id");
  });

  it("health is Healthy when an apiKey is set", () => {
    const b = new PiAiProviderBridge({ provider: makeProvider([]), model: { id: "m" }, apiKey: "k" });
    expect(b.health()).toBe("Healthy");
  });

  it("health is Degraded when no apiKey can be resolved", () => {
    const b = new PiAiProviderBridge({ provider: makeProvider([]), model: { id: "m" } });
    expect(b.health()).toBe("Degraded");
  });

  it("resolves apiKey from provider.auth when not passed explicitly", () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([], { apiKeyResolve: () => "from-auth" }),
      model: { id: "m" },
    });
    expect(b.health()).toBe("Healthy");
  });
});

describe("PiAiProviderBridge — event conversion", () => {
  it("converts text_delta events into text StreamEvents", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([
        { type: "text_delta", delta: "Hel" },
        { type: "text_delta", delta: "lo" },
        { type: "done", message: { content: [], usage: { input: 1, output: 2 } }, reason: "stop" },
      ]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["Hel", "lo"]);
  });

  it("falls back to text_end full content when no text_delta was emitted", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "text_end", content: "full-content" }, { type: "done" }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["full-content"]);
  });

  it("does NOT add text_end content when text_delta already emitted text", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([
        { type: "text_delta", delta: "real" },
        { type: "text_end", content: "should-not-appear" },
        { type: "done" },
      ]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["real"]);
  });

  it("converts toolcall_end into a tool_calls StreamEvent", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([
        { type: "toolcall_end", toolCall: { type: "toolCall", id: "t1", name: "search", arguments: { q: "x" } } },
        { type: "done", reason: "toolUse" },
      ]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const tc = events.find((e) => e.kind === "tool_calls") as { calls: Array<{ id: string; name: string; args: unknown }> } | undefined;
    expect(tc).toBeDefined();
    expect(tc!.calls).toEqual([{ id: "t1", name: "search", args: { q: "x" } }]);
    const done = events[events.length - 1]!;
    expect((done as { finish: string }).finish).toBe("tool");
  });

  it("emits tool calls found in the done message content, without duplicates", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([
        { type: "toolcall_end", toolCall: { type: "toolCall", id: "dup", name: "a", arguments: {} } },
        {
          type: "done",
          message: {
            usage: { input: 3, output: 4 },
            content: [
              { type: "toolCall", id: "dup", name: "a", arguments: {} }, // duplicate — must be skipped
              { type: "toolCall", id: "new", name: "b", arguments: {} }, // new — must be added
            ],
          },
        },
      ]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const tcs = events.filter((e) => e.kind === "tool_calls");
    const ids = tcs.flatMap((e) => (e as { calls: Array<{ id: string }> }).calls.map((c) => c.id));
    expect(ids).toEqual(["dup", "new"]);
  });

  it("maps the done event's usage and finish reason", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done", message: { content: [], usage: { input: 5, output: 6 } }, reason: "stop" }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const done = events[events.length - 1]!;
    expect(done.kind).toBe("done");
    expect((done as { usage: { input: number; output: number } }).usage).toEqual({ input: 5, output: 6 });
  });

  it("includes cacheRead in usage when present", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done", message: { content: [], usage: { input: 1, output: 1, cacheRead: 7 } } }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    const done = events[events.length - 1]!;
    expect((done as { usage: { cacheRead?: number } }).usage.cacheRead).toBe(7);
  });

  it("maps finish reason 'length'", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done", reason: "length" }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    expect((events.at(-1) as { finish: string }).finish).toBe("length");
  });

  it("maps an unknown finish reason to 'stop'", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done", reason: "some-weird-reason" }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    expect((events.at(-1) as { finish: string }).finish).toBe("stop");
  });

  it("emits an error StreamEvent on a pi-ai error event", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "error", reason: "boom" }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    expect(events[0]!.kind).toBe("error");
    expect((events[0] as { error: { phase: string } }).error.phase).toBe("provider");
  });

  it("synthesizes a done event when the stream ends without one", async () => {
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "text_delta", delta: "hi" }]),
      model: { id: "m" },
      apiKey: "k",
    });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    expect(events.at(-1)!.kind).toBe("done");
    expect((events.at(-1) as { finish: string }).finish).toBe("stop");
  });

  it("returns an error StreamEvent when streamSimple throws", async () => {
    const throwingProvider = {
      id: "broken",
      async *streamSimple(): AsyncGenerator<TestEvent> {
        throw new Error("connection reset");
      },
    };
    const b = new PiAiProviderBridge({ provider: throwingProvider, model: { id: "m" }, apiKey: "k" });
    const { events } = await b.stream(emptyPrompt, emptyHistory);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("error");
    expect((events[0] as unknown as { error: { context: { detail: string } } }).error.context.detail).toContain("connection reset");
  });
});

describe("PiAiProviderBridge — prompt & history assembly", () => {
  it("joins stable+context+volatile system tiers with double-newlines", async () => {
    let captured: unknown;
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done" }], { capture: (c) => (captured = c) }),
      model: { id: "m" },
      apiKey: "k",
    });
    await b.stream({ stable: "S", context: "C", volatile: "V" }, emptyHistory);
    const ctx = captured as { systemPrompt: string };
    expect(ctx.systemPrompt).toBe("S\n\nC\n\nV");
  });

  it("converts string history entries with role tagging", async () => {
    let captured: unknown;
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done" }], { capture: (c) => (captured = c) }),
      model: { id: "m" },
      apiKey: "k",
    });
    const history: History = {
      append: () => {},
      entries: () => [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
    };
    await b.stream(emptyPrompt, history);
    const ctx = captured as { messages: Array<{ role: string; content: string }> };
    expect(ctx.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("joins array-content history entries into a single text string", async () => {
    let captured: unknown;
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done" }], { capture: (c) => (captured = c) }),
      model: { id: "m" },
      apiKey: "k",
    });
    const history: History = {
      append: () => {},
      entries: () => [{ role: "user", content: [{ text: "part-a" }, { text: "part-b" }] }],
    };
    await b.stream(emptyPrompt, history);
    const ctx = captured as { messages: Array<{ role: string; content: string }> };
    expect(ctx.messages[0]!.content).toBe("part-apart-b");
  });

  it("skips history entries whose array-content yields no text, but keeps empty-string content", async () => {
    let captured: unknown;
    const b = new PiAiProviderBridge({
      provider: makeProvider([{ type: "done" }], { capture: (c) => (captured = c) }),
      model: { id: "m" },
      apiKey: "k",
    });
    const history: History = {
      append: () => {},
      entries: () => [
        { role: "user", content: [{ text: "" }] }, // empty array text → skipped
        { role: "user", content: "keep" },
        { role: "user", content: 42 } as unknown, // non-string/non-array → skipped
      ],
    };
    await b.stream(emptyPrompt, history);
    const ctx = captured as { messages: Array<{ role: string; content: string }> };
    expect(ctx.messages).toEqual([{ role: "user", content: "keep" }]);
  });
});

describe("PiAiProviderBridge — setReasoning", () => {
  it("passes the reasoning level through to streamSimple options", async () => {
    let capturedOpts: { reasoning?: string } | undefined;
    const provider = {
      id: "prov",
      async *streamSimple(_m: unknown, _c: unknown, opts?: { reasoning?: string }): AsyncGenerator<TestEvent> {
        capturedOpts = opts;
        yield { type: "done" };
      },
    };
    const b = new PiAiProviderBridge({ provider, model: { id: "m" }, apiKey: "k" });
    expect(capturedOpts).toBeUndefined();
    b.setReasoning("high");
    await b.stream(emptyPrompt, emptyHistory);
    expect(capturedOpts?.reasoning).toBe("high");
  });
});

describe("wrapPiAiProvider / wrapAllPiAiProviders — wrap ALL providers", () => {
  function makeModelProvider(
    id: string,
    modelIds: string[],
    opts: { apiKeyResolve?: () => string | undefined; events?: TestEvent[] } = {},
  ) {
    const events = opts.events ?? [{ type: "done", message: { content: [], usage: { input: 1, output: 2 } } }];
    return {
      id,
      auth: opts.apiKeyResolve ? { apiKey: { resolve: opts.apiKeyResolve } } : undefined,
      getModels() {
        return modelIds.map((m) => ({ id: m, api: "openai-responses" }));
      },
      async *streamSimple(
        model: { id: string; api?: string },
        _context: unknown,
        _options?: { apiKey?: string; signal?: AbortSignal; reasoning?: string },
      ): AsyncGenerator<TestEvent> {
        // emit model id as a text delta so we can distinguish providers
        yield { type: "text_delta", delta: `${id}:${model.id}` };
        for (const e of events) yield e;
      },
    };
  }

  it("wrapPiAiProvider uses the provider's first model by default", () => {
    const prov = makeModelProvider("anthropic", ["claude-x", "claude-y"], { apiKeyResolve: () => "k" });
    const profile = wrapPiAiProvider(prov);
    expect(profile.id).toBe("anthropic:claude-x");
    expect(profile.model).toBe("claude-x");
    expect(profile.health()).toBe("Healthy");
  });

  it("wrapPiAiProvider honours an explicit model override", () => {
    const prov = makeModelProvider("openai", ["gpt-1", "gpt-2"], { apiKeyResolve: () => "k" });
    const profile = wrapPiAiProvider(prov, { model: { id: "gpt-2" } });
    expect(profile.id).toBe("openai:gpt-2");
    expect(profile.model).toBe("gpt-2");
  });

  it("wrapPiAiProvider throws when the provider has no models and none is given", () => {
    const prov = makeModelProvider("empty", [], { apiKeyResolve: () => "k" });
    expect(() => wrapPiAiProvider(prov)).toThrow(/no models/);
  });

  it("wrapPiAiProvider resolves apiKey via apiKeyFor callback", () => {
    const prov = makeModelProvider("groq", ["m1"], { apiKeyResolve: () => undefined });
    const profile = wrapPiAiProvider(prov, { apiKeyFor: (id) => (id === "groq" ? "key-groq" : undefined) });
    expect(profile.health()).toBe("Healthy");
  });

  it("wrapAllPiAiProviders wraps every provider (one profile each, first model)", () => {
    const providers = [
      makeModelProvider("anthropic", ["claude"], { apiKeyResolve: () => "k" }),
      makeModelProvider("openai", ["gpt"], { apiKeyResolve: () => "k" }),
      makeModelProvider("groq", ["llama"], { apiKeyResolve: () => "k" }),
    ];
    const profiles = wrapAllPiAiProviders(providers);
    expect(profiles).toHaveLength(3);
    expect(profiles.map((p) => p.id)).toEqual(["anthropic:claude", "openai:gpt", "groq:llama"]);
  });

  it("wrapAllPiAiProviders skips providers with no models", () => {
    const providers = [
      makeModelProvider("anthropic", ["claude"], { apiKeyResolve: () => "k" }),
      makeModelProvider("empty", [], { apiKeyResolve: () => "k" }),
    ];
    const profiles = wrapAllPiAiProviders(providers);
    expect(profiles.map((p) => p.id)).toEqual(["anthropic:claude"]);
  });

  it("wrapAllPiAiProviders with skipUnconfigured drops unconfigured providers", () => {
    const providers = [
      makeModelProvider("anthropic", ["claude"], { apiKeyResolve: () => "k" }),
      makeModelProvider("unconfig", ["m"], { apiKeyResolve: () => undefined }),
    ];
    const profiles = wrapAllPiAiProviders(providers, { skipUnconfigured: true });
    expect(profiles.map((p) => p.id)).toEqual(["anthropic:claude"]);
  });

  it("wrapAllPiAiProviders respects the modelFilter", () => {
    const providers = [
      makeModelProvider("anthropic", ["claude"], { apiKeyResolve: () => "k" }),
      makeModelProvider("openai", ["gpt"], { apiKeyResolve: () => "k" }),
      makeModelProvider("groq", ["llama"], { apiKeyResolve: () => "k" }),
    ];
    const profiles = wrapAllPiAiProviders(providers, {
      modelFilter: (provId) => provId === "anthropic" || provId === "groq",
    });
    expect(profiles.map((p) => p.id).sort()).toEqual(["anthropic:claude", "groq:llama"]);
  });

  it("wrapped profiles stream correctly through profile.stream()", async () => {
    const prov = makeModelProvider("anthropic", ["claude"], { apiKeyResolve: () => "k" });
    const profile = wrapPiAiProvider(prov);
    const { events } = await profile.stream(emptyPrompt, emptyHistory);
    const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["anthropic:claude"]);
    const done = events.at(-1)!;
    expect(done.kind).toBe("done");
  });
});

describe("PiAiProviderBridge + ProviderRegistry — taint & discovery", () => {
  it("wrapped profiles register into ProviderRegistry and are returned by available()", async () => {
    const { ProviderRegistry } = await import("./registry.js");
    const providers = [
      {
        id: "anthropic",
        auth: { apiKey: { resolve: () => "k" } },
        getModels: () => [{ id: "claude", api: "anthropic-messages" }],
        async *streamSimple(): AsyncGenerator<TestEvent> { yield { type: "done", message: { content: [], usage: { input: 0, output: 0 } } }; },
      },
      {
        id: "openai",
        auth: { apiKey: { resolve: () => "k" } },
        getModels: () => [{ id: "gpt", api: "openai-responses" }],
        async *streamSimple(): AsyncGenerator<TestEvent> { yield { type: "done", message: { content: [], usage: { input: 0, output: 0 } } }; },
      },
    ];
    const profiles = wrapAllPiAiProviders(providers);
    const registry = new ProviderRegistry({ cooldownMs: 1000 });
    for (const p of profiles) registry.register(p);
    expect(registry.all()).toHaveLength(2);
    expect(registry.available().map((p) => p.id).sort()).toEqual(["anthropic:claude", "openai:gpt"]);
  });

  it("tainted wrapped profiles are skipped by available() until cooldown expires", async () => {
    const { ProviderRegistry } = await import("./registry.js");
    const { setTimeProvider } = await import("@my-agent/core");
    let clock = 1_700_000_000_000;
    const realWall = () => Date.now();
    const realMono = () => (typeof performance !== "undefined" ? performance.now() * 1000 : Date.now());
    setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => clock });
    try {
      const prov = {
        id: "anthropic",
        auth: { apiKey: { resolve: () => "k" } },
        getModels: () => [{ id: "claude", api: "anthropic-messages" }],
        async *streamSimple(): AsyncGenerator<TestEvent> { yield { type: "done" }; },
      };
      const [profile] = wrapAllPiAiProviders([prov]);
      const registry = new ProviderRegistry({ cooldownMs: 1000 });
      registry.register(profile!);
      expect(registry.available()).toHaveLength(1);
      registry.taint("anthropic:claude", "auth");
      expect(registry.available()).toHaveLength(0);
      expect(registry.eligible("anthropic:claude")).toBe(false);
      clock += 2000; // cooldown (1000ms) expires
      expect(registry.eligible("anthropic:claude")).toBe(true);
      expect(registry.available()).toHaveLength(1);
    } finally {
      setTimeProvider({ nowWallclock: realWall, nowMonotonic: realMono });
    }
  });

  it("registry health reflects wrapped-profile availability", async () => {
    const { ProviderRegistry } = await import("./registry.js");
    const providers = [
      {
        id: "deepseek",
        auth: { apiKey: { resolve: () => "k" } },
        getModels: () => [{ id: "deepseek-chat", api: "openai-completions" }],
        async *streamSimple(): AsyncGenerator<TestEvent> { yield { type: "done" }; },
      },
      {
        id: "groq",
        auth: { apiKey: { resolve: () => "k" } },
        getModels: () => [{ id: "llama", api: "openai-completions" }],
        async *streamSimple(): AsyncGenerator<TestEvent> { yield { type: "done" }; },
      },
    ];
    const profiles = wrapAllPiAiProviders(providers);
    const registry = new ProviderRegistry();
    expect(registry.health()).toBe("Failed"); // empty
    for (const p of profiles) registry.register(p);
    expect(registry.health()).toBe("Healthy");
    registry.taint("deepseek:deepseek-chat", "quota");
    expect(registry.health()).toBe("Degraded"); // 1 of 2 available
  });
});
