/**
 * @my-agent/ai — provider registry + mock adapter tests (no real HTTP).
 */
import { describe, it, expect, afterEach } from "vitest";
import { ProviderRegistry } from "./registry.js";
import { MockProvider, textMock } from "./mock.js";
import type { MockTrace } from "./mock.js";
import { generatePkce, verifyPkce, LoopbackServer } from "./oauth.js";
import { parseModelRoutingFromMeta, SMALL_MODEL_HINTS, BIG_MODEL_HINTS, getModelTierConfigPath } from "./model-routing.js";

describe("ProviderRegistry", () => {
  it("register + all", () => {
    const reg = new ProviderRegistry();
    const mock = textMock("hello from mock", "mock-test");
    reg.register(mock);
    expect(reg.all().length).toBe(1);
    expect(reg.all()[0]!.id).toContain("mock");
  });

  it("register throws on duplicate", () => {
    const reg = new ProviderRegistry();
    reg.register(textMock("a", "dup-id"));
    expect(() => reg.register(textMock("b", "dup-id"))).toThrow(/already registered/);
  });
});

describe("textMock provider", () => {
  it("has correct id and model", () => {
    const mock = textMock("response", "custom-model");
    expect(mock.model).toBe("custom-model");
    expect(mock.id).toContain("mock");
  });

  it("health returns Healthy", () => {
    const mock = textMock("response", "mock-id");
    expect(mock.health()).toBe("Healthy");
  });

  it("stream returns events", async () => {
    const mock = textMock("hello world", "mock-id");
    const result = await mock.stream({ stable: "", context: "", volatile: "" }, { append: () => {}, entries: () => [] } as never);
    expect(result.events.length).toBeGreaterThan(0);
  });
});

// ── MockProvider (direct class, arbitrary traces) ──

describe("MockProvider", () => {
  const emptyHistory = { append: () => {}, entries: () => [] } as never;
  const emptyPrompt = { stable: "", context: "", volatile: "" };

  it("adopts id and model from the trace", () => {
    const trace: MockTrace = { id: "trace-42", model: "replay-model", events: [] };
    const mock = new MockProvider(trace);
    expect(mock.id).toBe("trace-42");
    expect(mock.model).toBe("replay-model");
  });

  it("replays the trace's events in order, including tool calls", async () => {
    const trace: MockTrace = {
      id: "t",
      model: "m",
      events: [
        { kind: "text", text: "a" },
        { kind: "tool_calls", calls: [{ id: "c1", name: "run", args: { x: 1 } }] },
        { kind: "done", usage: { input: 2, output: 3 } },
      ],
    };
    const { events } = await new MockProvider(trace).stream(emptyPrompt, emptyHistory);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(["text", "tool_calls", "done"]);
  });

  it("returns a fresh copy on each call (mutation-safe)", async () => {
    const trace: MockTrace = { id: "t", model: "m", events: [{ kind: "text", text: "x" }] };
    const mock = new MockProvider(trace);
    const first = await mock.stream(emptyPrompt, emptyHistory);
    first.events.push({ kind: "text", text: "injected" });
    const second = await mock.stream(emptyPrompt, emptyHistory);
    expect(second.events).toHaveLength(1);
  });

  it("returns an empty events array for an empty trace", async () => {
    const mock = new MockProvider({ id: "t", model: "m", events: [] });
    const { events } = await mock.stream(emptyPrompt, emptyHistory);
    expect(events).toEqual([]);
  });

  it("health is always Healthy", () => {
    expect(new MockProvider({ id: "t", model: "m", events: [] }).health()).toBe("Healthy");
  });
});

// ── verifyPkce ──

describe("verifyPkce", () => {
  it("returns true for a freshly generated verifier/challenge pair", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("returns false when the verifier does not match the challenge", () => {
    const { challenge } = generatePkce();
    expect(verifyPkce("wrong-verifier", challenge)).toBe(false);
  });

  it("returns false when the challenge is tampered", () => {
    const { verifier } = generatePkce();
    expect(verifyPkce(verifier, "not-the-real-challenge")).toBe(false);
  });
});

// ── parseModelRoutingFromMeta ──

describe("parseModelRoutingFromMeta", () => {
  it("builds routes from phases that declare a model", () => {
    const config = parseModelRoutingFromMeta(
      [{ title: "analyze", model: "big-model" }, { title: "draft", model: "small-model" }],
      "default-model",
    );
    expect(config.defaultModel).toBe("default-model");
    expect(config.routes).toEqual([
      { phasePattern: "analyze", model: "big-model" },
      { phasePattern: "draft", model: "small-model" },
    ]);
  });

  it("skips phases without a model field", () => {
    const config = parseModelRoutingFromMeta([{ title: "has", model: "m" }, { title: "none" }]);
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0]!.phasePattern).toBe("has");
  });

  it("returns only the defaultModel when phases are absent", () => {
    const config = parseModelRoutingFromMeta(undefined, "fallback");
    expect(config.routes).toEqual([]);
    expect(config.defaultModel).toBe("fallback");
  });

  it("routes use exact (non-regex) matching by default", () => {
    const config = parseModelRoutingFromMeta([{ title: "analyze", model: "m" }]);
    expect(config.routes[0]!.useRegex).toBeUndefined();
  });
});

// ── model-size hints ──

describe("SMALL_MODEL_HINTS / BIG_MODEL_HINTS", () => {
  it("exposes the expected small-model substrings", () => {
    expect(SMALL_MODEL_HINTS).toContain("mini");
    expect(SMALL_MODEL_HINTS).toContain("flash");
    expect(SMALL_MODEL_HINTS).toContain("haiku");
  });

  it("exposes the expected big-model substrings", () => {
    expect(BIG_MODEL_HINTS).toContain("opus");
    expect(BIG_MODEL_HINTS).toContain("pro");
  });

  it("the two hint sets are disjoint", () => {
    const overlap = SMALL_MODEL_HINTS.filter((h) => (BIG_MODEL_HINTS as readonly string[]).includes(h));
    expect(overlap).toEqual([]);
  });
});

// ── getModelTierConfigPath ──

describe("getModelTierConfigPath", () => {
  it("points at ~/.mya/model-tiers.json (user-level, never project-scoped)", () => {
    const p = getModelTierConfigPath();
    expect(p.endsWith(".mya/model-tiers.json")).toBe(true);
    expect(p).not.toContain("node_modules");
  });
});

// ── LoopbackServer ──

describe("LoopbackServer", () => {
  let server: LoopbackServer | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("starts on 127.0.0.1 with an ephemeral port and exposes the redirectUri", async () => {
    server = new LoopbackServer();
    const { port, redirectUri } = await server.start();
    expect(port).toBeGreaterThan(0);
    expect(redirectUri).toBe(`http://127.0.0.1:${port}/callback`);
    // NEVER binds 0.0.0.0 (§6.1).
    expect(redirectUri.startsWith("http://127.0.0.1")).toBe(true);
  });

  it("resolves waitForCallback with the code+state from the callback request", async () => {
    server = new LoopbackServer();
    const { redirectUri } = await server.start();
    const pending = server.waitForCallback();
    // Hit the callback path with code+state.
    const url = redirectUri + "?code=AC123&state=ST456";
    const resp = await fetch(url);
    expect(resp.status).toBe(200);
    const result = await pending;
    expect(result).toEqual({ code: "AC123", state: "ST456" });
  });

  it("returns 400 and HTML-escapes the error param (no reflected XSS)", async () => {
    server = new LoopbackServer();
    const { redirectUri } = await server.start();
    const url = redirectUri + "?error=<script>alert(1)</script>";
    const resp = await fetch(url);
    expect(resp.status).toBe(400);
    const body = await resp.text();
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("close() tears down the server (subsequent requests fail)", async () => {
    server = new LoopbackServer();
    const { redirectUri } = await server.start();
    server.close();
    server = undefined;
    await expect(fetch(redirectUri)).rejects.toThrow();
  });
});
