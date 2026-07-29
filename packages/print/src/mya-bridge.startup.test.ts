/**
 * Role-at-startup test: when initialRole is set, the role overlay is applied
 * at bridge initialization (tool filter + model + currentRole set).
 *
 * Also tests initialTask injection via sendUserMessage on session_start.
 *
 * [unit]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock isolation ─────────────────────────────────────────────────────────
const { TMP_HOME, mockRoles } = vi.hoisted(() => ({
  TMP_HOME: `/tmp/mya-bridge-startup-test-${process.pid}`,
  mockRoles: new Map<string, any>(),
}));

vi.mock("node:os", () => ({ homedir: () => TMP_HOME }));

vi.mock("@my-agent/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@my-agent/core")>();
  return {
    ...actual,
    getRolesDir: () => `${TMP_HOME}/.mya/roles`,
    loadRoles: () => ({
      list: () => [...mockRoles.values()],
      getDefault: () => mockRoles.get("default") ?? { name: "default", description: "general" },
      get: (n: string) => mockRoles.get(n),
      has: (n: string) => mockRoles.has(n),
    }),
  };
});

// Mock role-subagent-spawn to avoid view SPI side effects
vi.mock("./role-subagent-spawn.js", () => ({
  spawnRoleSubagent: vi.fn(),
  focusRoleSubagentView: vi.fn(),
  forgetViewHandle: vi.fn(),
}));

// Mock gw-auth
vi.mock("./gw-auth.js", () => ({
  authHeaders: () => ({}),
  readGwToken: () => undefined,
  withAuth: (h: Record<string, string>) => h,
}));

import { createMyaBridge, type MyaPiApi } from "./mya-bridge.js";

/** Capturing pi that records setActiveTools/setModel/sendUserMessage calls. */
function makeCapturingPi(opts: { fullTools: string[] }) {
  const events = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> | void }>();
  const toolCalls: string[][] = [];
  const modelCalls: Array<{ id: string }> = [];
  const sentMessages: string[] = [];

  const pi: MyaPiApi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const arr = events.get(event) ?? [];
      arr.push(handler);
      events.set(event, arr);
    },
    registerTool() {},
    registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> | void }) {
      commands.set(name, options as never);
    },
    registerShortcut() {},
    getActiveTools() { return [...opts.fullTools]; },
    setActiveTools(t: string[]) { toolCalls.push([...t]); },
    async setModel(m: { id: string }) { modelCalls.push(m); return true; },
    modelRegistry: { getAll: () => [{ id: "MiniMax-M3" }, { id: "claude-opus" }] },
    sendUserMessage(content: string | unknown[]) {
      sentMessages.push(typeof content === "string" ? content : JSON.stringify(content));
    },
  };

  return { pi, events, commands, toolCalls, modelCalls, sentMessages };
}

describe("[unit] role-at-startup (initialRole)", () => {
  beforeEach(() => {
    mockRoles.clear();
    mockRoles.set("default", { name: "default", description: "general purpose" });
    mockRoles.set("coder", {
      name: "coder",
      description: "code-focused",
      toolsAllowed: ["read", "write", "edit", "bash", "grep"],
      modelPrefer: "claude-opus",
    });
    mockRoles.set("reviewer", {
      name: "reviewer",
      description: "read-only review",
      toolsAllowed: ["read", "grep"],
    });
  });

  it("applies the role overlay at init when initialRole is set", () => {
    const full = ["read", "write", "edit", "bash", "grep", "find", "browser_navigate"];
    const s = makeCapturingPi({ fullTools: full });

    createMyaBridge({ initialRole: "coder" })(s.pi);

    // Tool filter applied synchronously during init
    expect(s.toolCalls.length).toBeGreaterThanOrEqual(1);
    const applied = s.toolCalls[0]!;
    expect(applied.sort()).toEqual(["bash", "edit", "grep", "read", "write"]);
    expect(applied).not.toContain("find");
    expect(applied).not.toContain("browser_navigate");
  });

  it("does NOT apply any role at init when initialRole is absent", () => {
    const s = makeCapturingPi({ fullTools: ["read", "write"] });
    createMyaBridge({})(s.pi);
    expect(s.toolCalls.length).toBe(0);
  });

  it("handles unknown initialRole gracefully (no crash, no tool change)", () => {
    const s = makeCapturingPi({ fullTools: ["read", "write"] });
    expect(() => createMyaBridge({ initialRole: "nonexistent" })(s.pi)).not.toThrow();
    expect(s.toolCalls.length).toBe(0);
  });

  it("applies the default role when initialRole is 'default'", () => {
    const s = makeCapturingPi({ fullTools: ["read", "write"] });
    createMyaBridge({ initialRole: "default" })(s.pi);
    // default role has no tool restrictions → all tools pass through
    expect(s.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(s.toolCalls[0]!.sort()).toEqual(["read", "write"]);
  });
});

describe("[unit] task-at-startup (initialTask)", () => {
  it("auto-injects the task via sendUserMessage on session_start", () => {
    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({ initialTask: "Refactor the auth module" })(s.pi);

    // Fire session_start event
    const handlers = s.events.get("session_start")!;
    expect(handlers.length).toBeGreaterThan(0);
    handlers.forEach((h) => void h({}, { sessionManager: { getSessionId: () => "test-sess" } }));

    expect(s.sentMessages).toContain("Refactor the auth module");
  });

  it("does NOT inject a task when initialTask is absent", () => {
    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({})(s.pi);

    const handlers = s.events.get("session_start")!;
    handlers.forEach((h) => void h({}, { sessionManager: { getSessionId: () => "test-sess" } }));

    expect(s.sentMessages.length).toBe(0);
  });

  it("injects the task only once (not on subsequent session_start events)", () => {
    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({ initialTask: "Do thing" })(s.pi);

    const handlers = s.events.get("session_start")!;
    // Fire session_start twice
    handlers.forEach((h) => void h({}, {}));
    handlers.forEach((h) => void h({}, {}));

    expect(s.sentMessages.length).toBe(1);
  });

  it("combines initialRole + initialTask (role applied + task injected)", () => {
    mockRoles.clear();
    mockRoles.set("default", { name: "default", description: "g" });
    mockRoles.set("coder", { name: "coder", description: "c", toolsAllowed: ["read", "bash"] });

    const s = makeCapturingPi({ fullTools: ["read", "write", "bash", "grep"] });
    createMyaBridge({ initialRole: "coder", initialTask: "Write tests" })(s.pi);

    // Role applied
    expect(s.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(s.toolCalls[0]!.sort()).toEqual(["bash", "read"]);

    // Task injected
    const handlers = s.events.get("session_start")!;
    handlers.forEach((h) => void h({}, {}));
    expect(s.sentMessages).toContain("Write tests");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Phase 2: subagent task-status reporting
// ═════════════════════════════════════════════════════════════════════════

describe("[unit] subagent status reporting (gatewaySessionId)", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("POSTs 'working' on turn_start when --gateway-session is set", async () => {
    process.argv = ["node", "mya", "--gateway-session", "s-test"];
    const fetchCalls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string) ?? "" });
      return { ok: true, status: 200 } as Response;
    });

    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({})(s.pi);

    const handlers = s.events.get("turn_start")!;
    handlers.forEach((h) => void h({ turnIndex: 0 }, {}));

    // Wait for async fetch to resolve
    await new Promise((r) => setTimeout(r, 20));

    const statusCall = fetchCalls.find((c) => c.url.includes("/pool/session/s-test/status"));
    expect(statusCall).toBeDefined();
    expect(statusCall!.method).toBe("POST");
    expect(JSON.parse(statusCall!.body)).toEqual({ status: "working" });
  });

  it("POSTs 'done' on agent_settled when --gateway-session is set", async () => {
    process.argv = ["node", "mya", "--gateway-session", "s-done"];
    const fetchCalls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), body: (init?.body as string) ?? "" });
      return { ok: true, status: 200 } as Response;
    });

    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({})(s.pi);

    const handlers = s.events.get("agent_settled")!;
    handlers.forEach((h) => void h({}, {}));

    await new Promise((r) => setTimeout(r, 20));

    const statusCall = fetchCalls.find((c) => c.url.includes("/pool/session/s-done/status"));
    expect(statusCall).toBeDefined();
    expect(JSON.parse(statusCall!.body)).toEqual({ status: "done" });
  });

  it("does NOT report when --gateway-session is absent (top-level session)", async () => {
    process.argv = ["node", "mya"];
    const fetchCalls: Array<{ url: string }> = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls.push({ url: String(url) });
      return { ok: true, status: 200 } as Response;
    });

    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({})(s.pi);

    // Fire any turn_start handlers (there may be none — status hooks are gated)
    const turnHandlers = s.events.get("turn_start");
    turnHandlers?.forEach((h) => void h({ turnIndex: 0 }, {}));

    await new Promise((r) => setTimeout(r, 20));

    // No status-reporting calls at all
    expect(fetchCalls.filter((c) => c.url.includes("/pool/session/") && c.url.includes("/status"))).toHaveLength(0);
    // agent_settled handler is NOT registered (gatewaySessionId is falsy)
    expect(s.events.has("agent_settled")).toBe(false);
  });

  it("never crashes when gateway is unreachable (best-effort)", async () => {
    process.argv = ["node", "mya", "--gateway-session", "s-fail"];
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    const s = makeCapturingPi({ fullTools: ["read"] });
    createMyaBridge({})(s.pi);

    const handlers = s.events.get("turn_start")!;
    // Should not throw — void discards the rejected promise
    expect(() => handlers.forEach((h) => void h({ turnIndex: 0 }, {}))).not.toThrow();

    await new Promise((r) => setTimeout(r, 20));
    // No assertion needed — survival is the test
  });
});
