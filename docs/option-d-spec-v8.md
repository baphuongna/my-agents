# mya Multi-Agent Platform — Spec v8

> 8 reviewer rounds. This version fixes all 11 findings from round 5.
> Round 5 was NOT zero — 3 HIGH + 5 MEDIUM + 3 LOW found.

## Changelog (v7 → v8)

| # | Sev | Fix |
|---|---|---|
| F1 | 🔴 | Add `import type { AgentSession as PiAgentSession }` — was undefined type |
| F2 | 🟡 | Use `CreateAgentSessionOptions` typed object (not `Record<string, unknown>`) |
| C1 | 🟡 | turn_start/turn_end safety net: track `turnActive` flag, emit synthetic turn_end if agent_settled didn't fire |
| BA | 🔴 | ClaudeSession: re-add `'error'` handler (regression v6→v7 — spawn failure crashes) |
| BB | 🟡 | ClaudeSession: drain stderr (`child.stderr.on("data", () => {})`) to prevent pipe deadlock |
| BC | 🟡 | Broker injection unpaired turn_end: track `turnActive` in subscriber, emit synthetic turn_start if agent_settled arrives without prior turn_start |
| G1 | 🔴 | IC12 resolved: PiInProcessRuntime receives shared instances via constructor (not undefined module vars) |
| G2 | 🟡 | Remove stale broker references (broker-client-factory.test.ts, IC7, test case "broker disconnect") |
| G3 | 🟡 | Add `workdir?: string` to CronJob interface |
| G4 | 🟢 | Add concrete stub implementations for Phase 5 |
| C4 | 🟢 | Add `release(id, { force?: boolean })` option for stuck sessions |

---

## 1. AgentRuntime SPI

### 1.1 Types

```typescript
// packages/core/src/runtime-spi.ts

import type { Model, Api } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  strategy: "native" | "llm-summarize" | "truncate" | "continue-session" | "none";
}

interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface AgentCapabilities {
  hasInteractive: boolean;
  hasHeadless: boolean;
  supportsTools: boolean;
  supportsResume: boolean;
  supportsCompaction: boolean;
  supportsImages: boolean;
  supportsThinking: boolean;
  execution: "in-process" | "subprocess";
  maxContextWindow: number;
  injectionMethod: "extension" | "rpc" | "stdin-prompt" | "in-process-call";
}

interface AgentRuntime {
  readonly runtimeType: string;
  readonly displayName: string;
  start(opts: StartOpts): Promise<RuntimeSession>;
  isAvailable(): boolean;
  listModels(): Promise<ModelInfo[]>;
  capabilities(): AgentCapabilities;
  login?(provider: string): Promise<void>;
  costPerMTokens?(): { input: number; output: number };
}

interface StartOpts {
  cwd: string;
  agentDir: string;
  sessionId: string;
  model?: Model<Api>;
  modelId?: string;
  thinking?: ThinkingLevel;
  systemPromptOverride?: string;
  toolsAllowList?: string[];
  env: Record<string, string>;
  resumeFrom?: string;
}
```

### 1.2 Session Interface

```typescript
interface RuntimeSession {
  readonly sessionId: string;
  readonly runtimeType: string;
  readonly executionModel: "in-process" | "subprocess";

  /**
   * BLOCKING for in-process. Returns after process exit for subprocess.
   * Guarantees: emits turn_start at start, turn_end at completion (even on failure or early return).
   */
  prompt(text: string, opts?: PromptOpts): Promise<void>;

  setModel(model: Model<Api>): Promise<void>;
  setThinking(level: ThinkingLevel): void;
  compact(): Promise<CompactionResult>;
  getState(): SessionState;
  isIdle(): boolean;
  dispose(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): () => void;
}

interface PromptOpts {
  signal?: AbortSignal;
  images?: Array<{ data: string; mimeType: string }>;
  streamingBehavior?: "steer" | "followUp";
}

interface SessionState {
  model: string;
  thinking: string;
  status: "idle" | "thinking" | "tool:<name>";
  tokensIn: number;
  tokensOut: number;
  contextPct: number;
  contextWindow: number;
  costUsd: number;
  startedAt: number;
  lastActivity: number;
}
```

### 1.3 Uniform Event Type

```typescript
type AgentEvent =
  | { type: "turn_start"; model: string; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; output: string; error?: boolean }
  | { type: "turn_end"; tokensIn: number; tokensOut: number; costUsd?: number }
  | { type: "compaction"; result: CompactionResult }
  | { type: "model_changed"; model: string }
  | { type: "thinking_changed"; level: string }
  | { type: "error"; message: string; recoverable: boolean };
```

---

## 2. Runtime Implementations

### 2.1 PiInProcessRuntime

> G1 fix: shared instances passed via constructor, not undefined module vars.
> PiInProcessRuntime lives in `packages/print/src/runtimes/` (not core — needs mya-bridge).

```typescript
// packages/print/src/runtimes/pi-in-process.ts

import type { Model, Api } from "@earendil-works/pi-ai";
import type { ModelRuntime, AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";
// F1 fix: import PiAgentSession type (was undefined)

// G1 fix: receive shared instances via constructor
interface PiRuntimeDeps {
  agentDir: string;
  // These come from shared-instances.ts in main.ts
  auditLog: AuditLog;
  secretStore: SecretStore;
  hooks: HookRegistry;
  skillStore: SkillStore;
  cron: CronScheduler;
  brain: Brain;
  memory: MemoryFacade;
  retrievalEngine: RetrievalEngine;
  lifecycleManager: LifecycleManager;
  sqliteMemory: SqliteMemoryManager;
  dreamCycle: DreamCycle;
  wallet: Wallet;
  sync: SyncServer;
  collab: CollabRelay;
  packageHost: PackageHost;
  council: CouncilProvider;
  mcp: McpManager;
  mcpConfigs: McpServerConfig[];
  channels: ChannelRegistry;
  roleRegistry: RoleRegistry;
  achievements: AchievementsTracker;
}

class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";

  // M4 fix: Map keyed by agentDir
  private static modelRuntimes = new Map<string, ModelRuntime>();

  constructor(private deps: PiRuntimeDeps) {}

  private async getModelRuntime(): Promise<ModelRuntime> {
    let rt = PiInProcessRuntime.modelRuntimes.get(this.deps.agentDir);
    if (!rt) {
      const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      rt = await ModelRuntime.create({
        authPath: join(this.deps.agentDir, "auth.json"),
        modelsPath: join(this.deps.agentDir, "models.json"),
      });
      PiInProcessRuntime.modelRuntimes.set(this.deps.agentDir, rt);
    }
    return rt;
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const { createMyaBridge } = await import("../mya-bridge.js");

    // G1 fix: use deps, not undefined module vars
    const d = this.deps;
    const myaBridge = createMyaBridge({
      auditLog: d.auditLog, secretStore: d.secretStore, hooks: d.hooks,
      skillStore: d.skillStore, cron: d.cron, brain: d.brain,
      memory: d.memory, retrievalEngine: d.retrievalEngine,
      lifecycleManager: d.lifecycleManager, sqliteMemory: d.sqliteMemory,
      dreamCycle: d.dreamCycle, wallet: d.wallet, sync: d.sync,
      collab: d.collab, packageHost: d.packageHost, council: d.council,
      mcp: d.mcp, mcpConfigs: d.mcpConfigs, channels: d.channels,
      roleRegistry: d.roleRegistry, achievements: d.achievements,
    });

    // IC3: pi-intercom as second extension
    const piIntercomFactory = (await import("@my-agent/intercom")).default;

    const resourceLoader = new DefaultResourceLoader({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      extensionFactories: [
        { name: "mya-bridge", factory: myaBridge },
        { name: "pi-intercom", factory: piIntercomFactory },
      ],
    });
    await resourceLoader.reload();

    let model = opts.model;
    if (!model && opts.modelId) {
      const rt = await this.getModelRuntime();
      model = rt.getModels().find(m => m.id === opts.modelId || m.id.startsWith(opts.modelId!));
    }

    // F2 fix: use typed CreateAgentSessionOptions (not Record<string, unknown>)
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      resourceLoader,
      modelRuntime: await this.getModelRuntime(),
      ...(model ? { model } : {}),
    });

    return new PiInProcessSession(session, opts);
  }

  isAvailable(): boolean { return true; }

  async listModels(): Promise<ModelInfo[]> {
    const rt = await this.getModelRuntime();
    return rt.getModels().map(m => ({
      id: m.id, provider: m.provider,
      contextWindow: m.contextWindow, maxTokens: m.maxTokens,
      reasoning: m.reasoning,
    }));
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: true, hasHeadless: true,
      supportsTools: true, supportsResume: true,
      supportsCompaction: true, supportsImages: true,
      supportsThinking: true,
      execution: "in-process", maxContextWindow: 200_000,
      injectionMethod: "extension",
    };
  }

  costPerMTokens() { return { input: 3, output: 15 }; }
}
```

#### PiInProcessSession

```typescript
class PiInProcessSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  private listeners = new Set<(e: AgentEvent) => void>();
  private textBuffer = "";
  private readonly createdAt = Date.now();
  private accumulatedUsage = { tokensIn: 0, tokensOut: 0 };
  // C1 fix: track turn pairing for safety net
  private turnActive = false;

  // F1 fix: PiAgentSession type imported
  constructor(private piSession: PiAgentSession, private opts: StartOpts) {
    this.piSession.subscribe((event: unknown) => {
      const e = event as { type: string };

      // Accumulate usage
      if (e.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.usage) {
          this.accumulatedUsage.tokensIn += msg.usage.input ?? 0;
          this.accumulatedUsage.tokensOut += msg.usage.output ?? 0;
        }
      }

      // BC fix: detect agent_settled from broker injection (no prior turn_start)
      // If agent_settled arrives without turnActive, emit synthetic turn_start first
      if (e.type === "agent_settled" && !this.turnActive) {
        this.emit({
          type: "turn_start",
          model: this.piSession.model?.id ?? "unknown",
          sessionId: this.opts.sessionId,
        });
      }

      const agentEvent = PiEventNormalizer.toAgentEvent(event, this.piSession, this.accumulatedUsage);

      // C1 fix: track turn_end to clear turnActive
      if (agentEvent?.type === "turn_end") {
        this.turnActive = false;
      }

      if (agentEvent) {
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        this.listeners.forEach(l => l(agentEvent));
      }
    });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    this.accumulatedUsage = { tokensIn: 0, tokensOut: 0 };
    this.turnActive = true;  // C1 fix: mark turn active

    this.emit({
      type: "turn_start",
      model: this.piSession.model?.id ?? "unknown",
      sessionId: this.opts.sessionId,
    });

    try {
      await this.piSession.prompt(text, {
        streamingBehavior: opts?.streamingBehavior ?? "followUp",
      });

      // C1 fix: if prompt() returned but agent_settled never fired (extension command,
      // input handler, queue path), emit synthetic turn_end so consumers don't hang.
      if (this.turnActive) {
        this.turnActive = false;
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
        });
      }
    } catch (e) {
      this.turnActive = false;
      this.emit({ type: "error", message: String(e), recoverable: false });
      this.emit({ type: "turn_end", tokensIn: this.accumulatedUsage.tokensIn, tokensOut: this.accumulatedUsage.tokensOut });
      throw e;
    }
  }

  async setModel(model: Model<Api>): Promise<void> {
    await this.piSession.setModel(model);
    this.emit({ type: "model_changed", model: model.id });
  }

  setThinking(level: ThinkingLevel): void { this.piSession.setThinkingLevel(level); }

  async compact(): Promise<CompactionResult> {
    const result = await this.piSession.compact();
    return { tokensBefore: result.tokensBefore, tokensAfter: result.estimatedTokensAfter ?? 0, strategy: "native" };
  }

  getState(): SessionState {
    const usage = this.piSession.getContextUsage?.();
    return {
      model: this.piSession.model?.id ?? "unknown",
      thinking: this.piSession.thinkingLevel,
      status: this.piSession.isIdle ? "idle" : "thinking",
      tokensIn: this.accumulatedUsage.tokensIn,
      tokensOut: this.accumulatedUsage.tokensOut,
      contextPct: usage?.percent ?? 0,
      contextWindow: usage?.contextWindow ?? 200_000,
      costUsd: 0,
      startedAt: this.createdAt,
      lastActivity: Date.now(),
    };
  }

  isIdle(): boolean { return this.piSession.isIdle; }
  async dispose(): Promise<void> { try { this.piSession.dispose(); } catch {} }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getTextBuffer(): string { return this.textBuffer; }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => l(event));
  }
}
```

### 2.2 ClaudeSession

```typescript
class ClaudeSession implements RuntimeSession {
  readonly executionModel = "subprocess" as const;
  private child: ChildProcess | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  private readonly createdAt = Date.now();
  private modelId: string;
  private busy = false;
  private promptQueue: Array<{ fn: () => Promise<void>; reject: (e: Error) => void }> = [];
  private abortController: AbortController | null = null;
  private sessionDir: string;

  constructor(private opts: StartOpts) {
    this.modelId = opts.modelId ?? "claude-sonnet-4-20250514";
    const contextHash = createHash("md5").update(`${opts.sessionId}:${opts.cwd}`).digest("hex").slice(0, 12);
    this.sessionDir = join(opts.agentDir, "sessions", "claude", contextHash);
    mkdirSync(this.sessionDir, { recursive: true });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    if (this.busy) {
      await new Promise<void>((resolve, reject) => {
        this.promptQueue.push({
          fn: async () => { try { await this.doPrompt(text, opts); resolve(); } catch (e) { reject(e as Error); } },
          reject,
        });
      });
      return;
    }
    await this.doPrompt(text, opts);
    while (this.promptQueue.length > 0) {
      const item = this.promptQueue.shift()!;
      try { await item.fn(); } catch {}
    }
  }

  private async doPrompt(text: string, _opts?: PromptOpts): Promise<void> {
    this.busy = true;
    this.abortController = new AbortController();
    this.emit({ type: "turn_start", model: this.modelId, sessionId: this.opts.sessionId });

    const args = ["-p", "--output-format", "stream-json", "--model", this.modelId, "--continue", "--session-dir", this.sessionDir, text];
    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env }, cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // BB fix: drain stderr to prevent pipe deadlock
    this.child.stderr?.on("data", () => {});

    try {
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: this.child!.stdout });
        rl.on("line", (line) => {
          if (this.abortController?.signal.aborted) return;
          const event = ClaudeEventNormalizer.parseLine(line);
          if (event) this.emit(event);
        });

        let exitCode: number | null = null;
        this.child!.on("exit", (code) => { exitCode = code; });

        // H5 fix: close fires after ALL stdio consumed
        this.child!.on("close", () => {
          if (exitCode !== null && exitCode !== 0 && !this.abortController?.signal.aborted) {
            this.emit({ type: "error", message: `Claude exited with code ${exitCode}`, recoverable: false });
          }
          this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
          resolve();
        });

        // BA fix: re-add 'error' handler (was dropped in v7 — spawn failure crashes)
        this.child!.on("error", (err) => {
          this.emit({ type: "error", message: err.message, recoverable: false });
          this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
          resolve();
        });
      });
    } catch (e) {
      this.emit({ type: "error", message: String(e), recoverable: false });
      this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
      throw e;
    } finally {
      this.busy = false;
    }
  }

  async setModel(model: Model<Api>): Promise<void> { this.modelId = model.id; }
  setThinking(_level: ThinkingLevel): void {}
  async compact(): Promise<CompactionResult> { return { tokensBefore: 0, tokensAfter: 0, strategy: "continue-session" }; }

  async dispose(): Promise<void> {
    this.child?.kill();
    const err = new Error("Session disposed");
    for (const item of this.promptQueue) { item.reject(err); }
    this.promptQueue = [];
    this.listeners.clear();
    this.busy = false;
  }

  private emit(event: AgentEvent): void { this.listeners.forEach(l => l(event)); }
  onEvent(handler: (e: AgentEvent) => void): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  getState(): SessionState {
    return { model: this.modelId, thinking: "medium", status: this.busy ? "thinking" : "idle", tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200_000, costUsd: 0, startedAt: this.createdAt, lastActivity: Date.now() };
  }
  isIdle(): boolean { return !this.busy; }
}
```

### 2.3 MyaNativeRuntime

(Same as v7 — uses `agent.run(text, sink)`.)

---

## 3. Event Normalization

(Same as v7 — all mappings verified correct across 5 rounds.)

---

## 4. Broker

### IC3 Decision (unchanged from v7)

Pi-intercom as second extension. No MYA_BROKER_SOCKET. No BrokerClientFactory.
Pi-intercom self-manages via PI_CODING_AGENT_DIR.

### G2 fix: Removed stale references

- ~~`broker-client-factory.test.ts`~~ → removed from test plan
- ~~IC7 "BrokerClientFactory retry"~~ → removed from implementation notes
- ~~Test case "broker disconnect on fail"~~ → removed

---

## 5. Components (stubs + full interfaces)

### G4 fix: concrete stub implementations for Phase 5

```typescript
// packages/print/src/runtimes/stubs.ts

// Phase 5 stubs — replaced with real impls in later phases

export const stubRouter: SmartRouter = {
  async select(input) {
    // Phase 5: always return pi (default). Phase 8 adds scoring.
    const rt = this.runtimes.get(input.agentOverride ?? "pi");
    if (!rt) throw new Error("No runtime available");
    return { runtime: rt, reason: "stub default" };
  },
  runtimes: new Map(),  // populated at startup
} as any;

export const stubEnricher: PromptEnricher = {
  async enrich(prompt) { return prompt; },  // Phase 7 adds memory injection
  async capture() {},  // Phase 7 adds brain recording
};

export const stubCostTracker: CostTracker = {
  record() {},  // Phase 12 adds real tracking
  getSessionCost() { return undefined; },
};

export function buildAgentEnv(): Record<string, string> {
  // Phase 4 impl: reads auth.json, maps providerId → envKey
  const auth = loadAuthConfig();
  const env: Record<string, string> = {};
  for (const [providerId, credential] of Object.entries(auth)) {
    if (credential.type === "api_key" && credential.key) {
      const envKeys = providerRegistry.getAllEnvKeys(providerId);
      for (const key of envKeys) env[key] = credential.key;
    }
  }
  if (auth.env) Object.assign(env, auth.env);
  env.PI_CODING_AGENT_DIR = join(homedir(), ".mya/agent");
  return env;
}
```

---

## 6. Shared Infrastructure

### 6.1 PromptEnricher (Phase 7 full impl)

```typescript
interface PromptEnricher {
  enrich(prompt: string, ctx: EnrichContext): Promise<string>;
  capture(output: string, ctx: EnrichContext): Promise<void>;
}
```

(Full impl uses `MemoryFacade.recall()` + `brain.recordFact()` — Phase 7.)

### 6.2 Compaction

```typescript
async function maybeCompact(session: RuntimeSession): Promise<void> {
  const state = session.getState();
  if (state.contextPct > 70) {
    try { await session.compact(); } catch (e) { console.warn(`[compaction] failed: ${e}`); }
  }
}
```

### 6.3 CostTracker (Phase 12 full impl)

```typescript
interface CostTracker {
  record(sessionId: string, event: AgentEvent): void;
  getSessionCost(sessionId: string): { totalUsd: number; turns: number } | undefined;
}
```

---

## 7. Gateway Integration

### 7.1 RuntimePool

```typescript
interface RuntimePoolEntry {
  sessionId: string;
  session: AgentSession;
  runtimeType: string;
  busy: boolean;
  messageCount: number;
  lastActivity: number;
  sessionFile?: string;
  createdAt: number;
  idleSince: number;
}

class RuntimePool {
  private entries = new Map<string, RuntimePoolEntry>();
  private maxSessions = parseInt(process.env.MYA_MAX_SESSIONS ?? "16", 10);
  private idleTtlMs = 3_600_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
  ) {
    this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
    this.sweepTimer.unref?.();
  }

  async acquire(sessionId: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      existing.idleSince = Date.now();
      return existing.session;
    }
    const { session } = await this.acquireWithRuntime(sessionId, { agentType: "pi" });
    return session;
  }

  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      if (opts?.agentType && existing.runtimeType !== opts.agentType) {
        throw new Error(`Session ${sessionId} exists as ${existing.runtimeType}, cannot reassign to ${opts.agentType}`);
      }
      existing.lastActivity = Date.now();
      existing.idleSince = Date.now();
      return { session: existing.session, runtimeType: existing.runtimeType };
    }

    if (this.entries.size >= this.maxSessions) {
      this.sweepIdle();
      if (this.entries.size >= this.maxSessions) throw new Error("Max sessions reached");
    }

    let runtime: AgentRuntime;
    if (opts?.agentType) {
      runtime = this.runtimes.get(opts.agentType)!;
      if (!runtime?.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
    } else {
      const result = await this.router.select({ prompt: opts?.prompt ?? "", modelOverride: opts?.model });
      runtime = result.runtime;
    }

    const env = buildAgentEnv();
    const runtimeSession = await runtime.start({
      cwd: opts?.cwd ?? process.cwd(),
      agentDir: join(homedir(), ".mya/agent"),
      sessionId, modelId: opts?.model, env,
    });

    const adapter = new RuntimeSessionAdapter(
      runtimeSession, this.enricher, this.costTracker,
      (busy: boolean) => {
        const entry = this.entries.get(sessionId);
        if (entry) { entry.busy = busy; entry.lastActivity = Date.now(); if (!busy) entry.idleSince = Date.now(); }
      },
      () => { const entry = this.entries.get(sessionId); if (entry) entry.messageCount++; },
    );

    this.entries.set(sessionId, {
      sessionId, session: adapter, runtimeType: runtime.runtimeType,
      busy: false, messageCount: 0, lastActivity: Date.now(), createdAt: Date.now(), idleSince: Date.now(),
    });

    return { session: adapter, runtimeType: runtime.runtimeType };
  }

  get(sessionId: string): RuntimePoolEntry | undefined { return this.entries.get(sessionId); }
  list(): RuntimePoolEntry[] { return [...this.entries.values()]; }

  // C4 fix: add force option for stuck sessions
  release(sessionId: string, opts?: { force?: boolean }): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    if (entry.busy && !opts?.force) return false;
    void Promise.resolve(entry.session.abort()).catch(() => {});
    this.entries.delete(sessionId);
    return true;
  }

  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { cwd });
    return session;
  }

  get size(): number { return this.entries.size; }

  private sweepIdle(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.busy) continue;
      if (now - entry.idleSince > this.idleTtlMs) {
        void Promise.resolve(entry.session.abort()).catch(() => {});
        this.entries.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const entry of this.entries.values()) {
      void Promise.resolve(entry.session.abort()).catch(() => {});
    }
    this.entries.clear();
  }
}
```

### 7.2 RuntimeSessionAdapter

(Same as v7 — verified correct. C2 fix present.)

### 7.3-7.4 WebSocket, Shutdown

(Same as v7 — verified correct.)

### 7.5 CronJob

```typescript
// G3 fix: add workdir field
interface CronJob {
  name: string;
  trigger: TriggerType;
  schedule: string;
  prompt: string;
  agentType?: string;
  deliveryTarget?: string;
  workdir?: string;  // ← G3 fix: was missing (real CronJob has it)
}

async function executeCronJob(pool: RuntimePool, job: CronJob, sessionId: string): Promise<void> {
  const { session } = await pool.acquireWithRuntime(sessionId, {
    agentType: job.agentType ?? "pi",
    prompt: job.prompt,
    cwd: job.workdir ?? process.cwd(),  // G3 fix: workdir now in interface
  });
  await session.prompt(job.prompt);
}
```

---

## 8-9. Execution Paths, Phases

(Same as v7.)

---

## 10. Required Test Files

| Test File | Phase | Tier | Key Cases |
|---|---|---|---|
| `runtime-spi.test.ts` | 2 | [unit] | AgentEvent union; StartOpts shapes |
| `pi-event-normalizer.test.ts` | 4 | [unit] | agent_settled→turn_end; tool_execution_update; message_end usage |
| `pi-in-process-runtime.test.ts` | 4 | [smoke] | ModelRuntime keyed by agentDir; listModels; setModel→model_changed; contextPct; turn_start/turn_end on extension command; broker injection turn pairing |
| `runtime-pool.test.ts` | 5 | [unit] | get-or-create; agentType mismatch; maxSessions; idle sweep; release busy→false; release force→true |
| `runtime-session-adapter.test.ts` | 5 | [unit] | enrich→prompt→capture; busy toggle; turnLock; abort→dispose; messageCount++; prompt throw→turn_end |
| `claude-session.test.ts` | 10 | [real] | skipIf(!claude); overlap queue; dispose rejects; close event; error handler; stderr drain |
| `cron-agent-type.test.ts` | 5 | [unit] | legacy→pi; explicit agentType; workdir field |
| `gateway-snapshot.test.ts` | 12 | [unit] | snapshot text+state; 404 |

---

## 11. Verification Checklist

| Check | Phase |
|---|---|
| turn_start/turn_end 1:1 (including extension commands) | 4 |
| turn_end emitted on failure | 4 |
| turn_start emitted on broker injection (unpaired agent_settled) | 4 |
| contextPct from getContextUsage | 4 |
| ClaudeSession error handler fires on spawn failure | 10 |
| ClaudeSession stderr drained (no deadlock) | 10 |
| ClaudeSession close event (not exit) | 10 |
| idleSince > 0 after acquire | 5 |
| release(force) works on busy session | 5 |
| PiAgentSession type imported | 4 |

---

## 12. Implementation Notes

| # | Note | Phase | Status |
|---|---|---|---|
| IC1 | RuntimePool must implement ALL pool methods gateway uses | 5 | ⚠️ Code |
| IC2 | CronJob.agentType + cron execution rewire | 5 | ⚠️ Code |
| IC3 | pi-intercom as second extension (decided) | 1 | ✅ Decided |
| IC5 | SmartRouter/PromptEnricher/CostTracker full impls | 7/8/12 | ⚠️ Code |
| IC6 | SessionMetaStore single source (decided) | 5 | ✅ Decided |
| IC8 | 8 test files required | Each | ⚠️ Code |
| IC9 | pi-intercom → packages/intercom/src/ | 1 | ⚠️ Code |
| IC10 | AbortSignal for abort during prompt | 4 | ⚠️ Code |
| IC11 | CompactionResult defined locally | 2 | ✅ In spec |
| IC12 | G1 fix: PiRuntimeDeps interface — shared instances via constructor | 5 | ✅ In spec |
