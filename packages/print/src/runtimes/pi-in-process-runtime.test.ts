// [unit] PiInProcessRuntime.start — verifies the runtime wires extensions,
// model selection, toolsAllowList, and bindExtensions (session_start).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PiInProcessRuntime, type PiRuntimeDeps } from "./pi-in-process.js";

// Mock the pi-coding-agent module (createAgentSession + DefaultResourceLoader)
// and mya-bridge so start() can run without a real pi session.
const mockCreateAgentSession = vi.fn();
const mockReload = vi.fn(async () => {});
const mockBindExtensions = vi.fn(async () => {});
const mockSession = {
  sessionId: "s1",
  bindExtensions: mockBindExtensions,
  subscribe: vi.fn(() => () => {}),
  prompt: vi.fn(async () => {}),
  dispose: vi.fn(() => {}),
};
const mockModelRuntime = {
  getModels: vi.fn(() => [{ id: "claude-sonnet-4", provider: "anthropic", contextWindow: 200000, maxTokens: 8192, reasoning: false }]),
};

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: (opts: any) => mockCreateAgentSession(opts),
  DefaultResourceLoader: class {
    public extensionFactories: any[];
    constructor(private opts: any) { this.extensionFactories = opts.extensionFactories ?? []; }
    async reload() { await mockReload(); }
    getExtensions() { return []; }
  },
  ModelRuntime: { create: async () => mockModelRuntime },
}));

vi.mock("../mya-bridge.js", () => ({
  createMyaBridge: () => (pi: unknown) => { void pi; },
}));

// Deps factory — all PiRuntimeDeps fields as no-op stubs.
function makeDeps(): PiRuntimeDeps {
  return {
    agentDir: "/tmp/agent",
    auditLog: {}, secretStore: {}, hooks: {}, skillStore: {}, cron: {},
    brain: {}, memory: {}, retrievalEngine: {}, lifecycleManager: {}, sqliteMemory: {},
    dreamCycle: {}, wallet: {}, sync: {}, collab: {}, packageHost: {},
    council: {}, mcp: {}, mcpConfigs: [], channels: {}, roleRegistry: {}, achievements: {},
  };
}

describe("[unit] PiInProcessRuntime.start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAgentSession.mockResolvedValue({ session: mockSession, extensionsResult: [] });
    mockReload.mockResolvedValue(undefined);
    mockBindExtensions.mockResolvedValue(undefined);
  });

  it("creates session with mya-bridge + pi-intercom extensions", async () => {
    const rt = new PiInProcessRuntime(makeDeps());
    await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {} });

    expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
    const opts = mockCreateAgentSession.mock.calls[0]![0];
    // resourceLoader must carry both extension factories
    expect(opts.resourceLoader).toBeDefined();
    expect((opts.resourceLoader as any).extensionFactories).toHaveLength(2);
    const names = (opts.resourceLoader as any).extensionFactories.map((f: any) => f.name);
    expect(names).toContain("mya-bridge");
    expect(names).toContain("pi-intercom");
  });

  it("calls bindExtensions({mode:'print'}) so bridge session hooks activate", async () => {
    const rt = new PiInProcessRuntime(makeDeps());
    await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {} });

    expect(mockBindExtensions).toHaveBeenCalledTimes(1);
    expect((mockBindExtensions.mock.calls[0] as unknown[])[0]).toEqual({ mode: "print" });
  });

  it("passes toolsAllowList into createAgentSession tools", async () => {
    const rt = new PiInProcessRuntime(makeDeps());
    await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {}, toolsAllowList: ["read", "bash"] });

    const opts = mockCreateAgentSession.mock.calls[0]![0];
    expect(opts.tools).toEqual(["read", "bash"]);
  });

  it("omits tools key when toolsAllowList absent", async () => {
    const rt = new PiInProcessRuntime(makeDeps());
    await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {} });

    const opts = mockCreateAgentSession.mock.calls[0]![0];
    expect(opts.tools).toBeUndefined();
  });

  it("resolves modelId via ModelRuntime.getModels prefix match", async () => {
    const rt = new PiInProcessRuntime(makeDeps());
    await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {}, modelId: "claude-sonnet" });

    const opts = mockCreateAgentSession.mock.calls[0]![0];
    expect(opts.model).toBeDefined();
    expect(opts.model.id).toBe("claude-sonnet-4");
  });

  it("start returns a RuntimeSession-compatible session", async () => {
    const rt = new PiInProcessRuntime(makeDeps());
    const session = await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {} });
    expect(session.sessionId).toBe("s1");
    expect(session.runtimeType).toBe("pi");
  });

  it("bindExtensions failure is non-fatal (best-effort)", async () => {
    mockBindExtensions.mockRejectedValue(new Error("bind failed"));
    const rt = new PiInProcessRuntime(makeDeps());
    const session = await rt.start({ cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {} });
    expect(session.sessionId).toBe("s1");
  });
});
