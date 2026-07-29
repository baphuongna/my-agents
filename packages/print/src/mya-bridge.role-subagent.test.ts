/**
 * Tests for F7 (installFailureReporter) and F11 (spawn-role-subagent role
 * validation) — both logic-layer fixes in mya-bridge.ts.
 *
 * [unit]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock isolation ─────────────────────────────────────────────────────────
const { TMP_HOME, mockRoles } = vi.hoisted(() => ({
  TMP_HOME: `/tmp/mya-bridge-role-subagent-test-${process.pid}`,
  mockRoles: new Map<string, { name: string; description: string }>(),
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

// Mock role-subagent-spawn to avoid real view SPI + capture spawnRoleSubagent
const mockSpawnRoleSubagent = vi.hoisted(() => vi.fn());
vi.mock("./role-subagent-spawn.js", () => ({
  spawnRoleSubagent: mockSpawnRoleSubagent,
  focusRoleSubagentView: vi.fn(),
  closeRoleSubagentView: vi.fn(),
  forgetViewHandle: vi.fn(),
  waitRoleSubagent: vi.fn(),
}));

// Mock gw-auth to avoid reading real token files
vi.mock("./gw-auth.js", () => ({
  authHeaders: () => ({}),
  readGwToken: () => undefined,
  withAuth: (h: Record<string, string>) => h,
}));

import { installFailureReporter, createMyaBridge, type MyaPiApi } from "./mya-bridge.js";

// ══════════════════════════════════════════════════════════════════════════
// F7: installFailureReporter — best-effort 'failed' status on crash
// ══════════════════════════════════════════════════════════════════════════

describe("[unit] installFailureReporter (F7)", () => {
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    onSpy = vi.spyOn(process, "on").mockImplementation(() => process);
  });

  afterEach(() => {
    onSpy.mockRestore();
  });

  it("is a no-op when sessionId is undefined", () => {
    installFailureReporter(undefined);
    expect(onSpy).not.toHaveBeenCalled();
  });

  it("registers beforeExit + uncaughtException handlers when sessionId is set", () => {
    installFailureReporter("s-test");

    const events = onSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain("beforeExit");
    expect(events).toContain("uncaughtException");
  });

  it("beforeExit handler reports 'failed' status to the gateway", async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
      return { ok: true } as Response;
    });

    installFailureReporter("s-crash");

    // Find the beforeExit handler and call it
    const beforeExitCall = onSpy.mock.calls.find((c) => c[0] === "beforeExit");
    expect(beforeExitCall).toBeDefined();
    const handler = beforeExitCall![1] as () => void;
    handler();

    // Wait for the fire-and-forget reportSubagentStatus to complete
    await vi.waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));

    const statusCall = fetchCalls.find((c) => c.url.includes("/pool/session/s-crash/status"));
    expect(statusCall).toBeDefined();
    expect(JSON.parse(statusCall!.body)).toEqual({ status: "failed" });
  });

  it("uncaughtException handler reports 'failed' status to the gateway", async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
      return { ok: true } as Response;
    });

    installFailureReporter("s-uncaught");

    // Find the uncaughtException handler and call it
    const uncaughtCall = onSpy.mock.calls.find((c) => c[0] === "uncaughtException");
    expect(uncaughtCall).toBeDefined();
    const handler = uncaughtCall![1] as (err: unknown) => void;
    // Pass an error (handler should report, not throw)
    handler(new Error("boom"));

    await vi.waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));

    const statusCall = fetchCalls.find((c) => c.url.includes("/pool/session/s-uncaught/status"));
    expect(statusCall).toBeDefined();
    expect(JSON.parse(statusCall!.body)).toEqual({ status: "failed" });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F11: spawn-role-subagent tool — role validation before spawning
// ══════════════════════════════════════════════════════════════════════════

/** Capturing pi that records tool registrations. */
function makeCapturingPi() {
  const tools: Array<Record<string, unknown>> = [];
  const pi: MyaPiApi = {
    on() {},
    registerTool(tool: unknown) { tools.push(tool as Record<string, unknown>); },
    registerCommand() {},
    registerShortcut() {},
  };
  return { pi, tools };
}

describe("[unit] spawn-role-subagent tool role validation (F11)", () => {
  let pi: MyaPiApi;
  let tools: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    mockSpawnRoleSubagent.mockReset();
    // Seed roles: default always exists + a "coder" role
    mockRoles.clear();
    mockRoles.set("default", { name: "default", description: "general" });
    mockRoles.set("coder", { name: "coder", description: "writes code" });

    const c = makeCapturingPi();
    pi = c.pi;
    tools = c.tools;
    createMyaBridge({})(pi);
  });

  /** Get the spawn-role-subagent tool's execute function. */
  function getSpawnToolExecute(): (id: string, params: { role: string; task: string; model?: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const tool = tools.find((t) => t.name === "spawn-role-subagent");
    expect(tool, "spawn-role-subagent tool not registered").toBeDefined();
    return tool!.execute as (id: string, params: { role: string; task: string; model?: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  }

  it("returns an error for an unknown role (does NOT spawn)", async () => {
    const execute = getSpawnToolExecute();
    const result = await execute("call-1", { role: "nonexistent", task: "do stuff" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/role 'nonexistent' not found/i);
    expect(mockSpawnRoleSubagent).not.toHaveBeenCalled();
  });

  it("spawns normally for a known role", async () => {
    mockSpawnRoleSubagent.mockResolvedValue({
      sessionId: "s-new",
      handle: { backendId: "tmux", ref: "1" },
    });
    const execute = getSpawnToolExecute();
    const result = await execute("call-2", { role: "coder", task: "write tests" });

    expect(result.isError).toBeUndefined();
    expect(mockSpawnRoleSubagent).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawnRoleSubagent.mock.calls[0]![0];
    expect(callArgs.role).toBe("coder");
    expect(callArgs.task).toBe("write tests");
  });

  it("spawns normally for 'default' role (no registry lookup needed)", async () => {
    mockSpawnRoleSubagent.mockResolvedValue({
      sessionId: "s-def",
      handle: { backendId: "tmux", ref: "2" },
    });
    const execute = getSpawnToolExecute();
    const result = await execute("call-3", { role: "default", task: "general work" });

    expect(result.isError).toBeUndefined();
    expect(mockSpawnRoleSubagent).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawnRoleSubagent.mock.calls[0]![0];
    expect(callArgs.role).toBe("default");
  });
});
