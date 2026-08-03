# mya Multi-Agent Platform — Spec v7 (Final)

> 7 independent reviewer rounds, ~85 findings addressed.
> API layer verified clean across 18 reviews.
> Remaining items are integration-level — marked ⚠️ IMPL for coding phase.

## Changelog (v6 → v7)

### Fixed in spec (code bugs)

| # | Sev | Fix |
|---|---|---|
| C1 | 🔴 | `idleSince = 0` in acquire() → `Date.now()` (sessions were immediately sweepable) |
| C2 | 🔴 | Add turn_end/error emission in catch when `prompt()` throws (consumers hung waiting for turn_end) |
| H4 | 🟡 | `getState().contextPct` — use `piSession.getContextUsage()` instead of hardcoded 0 |
| H5 | 🟡 | ClaudeSession: use `'close'` event (not `'exit'`) for turn_end — exit fires before stdout consumed |
| M1 | 🟢 | acquire(): validate agentType mismatch on existing session (throw if different runtime requested) |
| M2 | 🟢 | release(): check busy, reject if in-flight (prevent orphaned prompt) |
| M4 | 🟢 | Static ModelRuntime: key by agentDir (Map<string, ModelRuntime>, not single field) |

### Updated implementation notes

| # | Change |
|---|---|
| IC3 | **Decision made**: Option (b) — register pi-intercom as second extension alongside mya-bridge in DefaultResourceLoader. Drop MYA_BROKER_SOCKET (doesn't exist). Pi-intercom self-manages socket via PI_CODING_AGENT_DIR. |
| IC3a | `MyaBridgeOptions.broker` field **not needed** — pi-intercom owns its own IntercomClient internally |
| IC3b | `RuntimeSession.inject()` — pi-intercom already injects via `pi.sendCustomMessage()`. Remove duplicate inject() from spec. |
| IC4 | `BrokerClient` = `IntercomClient` from pi-intercom. Import directly. |
| IC4a | `BrokerMessage` — use pi-intercom's types directly (`SessionInfo`, `Message` from its types.ts). Fix field paths. |
| IC5 | `SmartRouter`, `PromptEnricher`, `CostTracker`, `buildAgentEnv`, `SessionStore` — **new components created in their respective phases**. Define stub interfaces for Phase 5. |

---

## 1. AgentRuntime SPI

### 1.1 Types

```typescript
// packages/core/src/runtime-spi.ts

import type { Model, Api } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// IC11: our own CompactionResult (pi's has required summary/firstKeptEntryId)
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
  // IC3a: broker field removed — pi-intercom manages its own client
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
   * BLOCKING for in-process (pi, mya-native). Returns after process exit for subprocess (claude).
   * Guarantees: emits turn_start at start, turn_end at completion (even on failure).
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

> **IC3b note**: `inject()` removed from RuntimeSession. Pi-intercom handles message injection
> internally via `pi.sendCustomMessage()` when registered as a second extension.
> Subprocess agents (Claude) receive broker messages as new prompts via the adapter's prompt() call.

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

```typescript
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";

  // M4 fix: key by agentDir (not single static field)
  private static modelRuntimes = new Map<string, ModelRuntime>();
  private agentDir: string;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  private async getModelRuntime(): Promise<ModelRuntime> {
    let rt = PiInProcessRuntime.modelRuntimes.get(this.agentDir);
    if (!rt) {
      const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      rt = await ModelRuntime.create({
        authPath: join(this.agentDir, "auth.json"),
        modelsPath: join(this.agentDir, "models.json"),
      });
      PiInProcessRuntime.modelRuntimes.set(this.agentDir, rt);
    }
    return rt;
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const { createMyaBridge } = await import("./mya-bridge.js");

    // IC3: register BOTH mya-bridge AND pi-intercom as extensions.
    // Pi-intercom self-manages its own IntercomClient + socket via PI_CODING_AGENT_DIR.
    // No broker field on MyaBridgeOptions needed.
    const myaBridge = createMyaBridge({
      auditLog, secretStore, hooks, skillStore, cron,
      brain, memory, retrievalEngine, lifecycleManager, sqliteMemory,
      dreamCycle, wallet, sync, collab, packageHost,
      council, mcp, mcpConfigs, channels, roleRegistry, achievements,
    });

    // IC3: pi-intercom loaded as second extension
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

    const sessionOpts: Record<string, unknown> = {
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      resourceLoader,
      modelRuntime: await this.getModelRuntime(),
    };
    if (model) sessionOpts.model = model;

    const { session } = await createAgentSession(sessionOpts);
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

  constructor(private piSession: PiAgentSession, private opts: StartOpts) {
    this.piSession.subscribe((event: unknown) => {
      const e = event as { type: string };

      // Accumulate usage from message_end events
      if (e.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.usage) {
          this.accumulatedUsage.tokensIn += msg.usage.input ?? 0;
          this.accumulatedUsage.tokensOut += msg.usage.output ?? 0;
        }
      }

      const agentEvent = PiEventNormalizer.toAgentEvent(event, this.piSession, this.accumulatedUsage);
      if (agentEvent) {
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        this.listeners.forEach(l => l(agentEvent));
      }
    });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    this.accumulatedUsage = { tokensIn: 0, tokensOut: 0 };

    // Emit turn_start before await (guaranteed 1:1 with turn_end)
    this.emit({
      type: "turn_start",
      model: this.piSession.model?.id ?? "unknown",
      sessionId: this.opts.sessionId,
    });

    try {
      await this.piSession.prompt(text, {
        streamingBehavior: opts?.streamingBehavior ?? "followUp",
      });
      // prompt() resolved = turn complete. agent_settled → turn_end emitted by normalizer.
    } catch (e) {
      // C2 fix: emit error + turn_end on failure so consumers don't hang
      this.emit({ type: "error", message: String(e), recoverable: false });
      this.emit({ type: "turn_end", tokensIn: this.accumulatedUsage.tokensIn, tokensOut: this.accumulatedUsage.tokensOut });
      throw e;
    }
  }

  async setModel(model: Model<Api>): Promise<void> {
    await this.piSession.setModel(model);
    this.emit({ type: "model_changed", model: model.id });
  }

  setThinking(level: ThinkingLevel): void {
    this.piSession.setThinkingLevel(level);
  }

  async compact(): Promise<CompactionResult> {
    const result = await this.piSession.compact();
    return {
      tokensBefore: result.tokensBefore ?? 0,
      tokensAfter: result.estimatedTokensAfter ?? 0,
      strategy: "native",
    };
  }

  getState(): SessionState {
    // H4 fix: use getContextUsage() for real contextPct
    const usage = this.piSession.getContextUsage?.();
    return {
      model: this.piSession.model?.id ?? "unknown",
      thinking: this.piSession.thinkingLevel,
      status: this.piSession.isIdle ? "idle" : "thinking",
      tokensIn: this.accumulatedUsage.tokensIn,
      tokensOut: this.accumulatedUsage.tokensOut,
      // H4 fix: real context percentage (was hardcoded 0 → compaction never fired)
      contextPct: usage?.percent ?? 0,
      contextWindow: usage?.contextWindow ?? 200_000,
      costUsd: 0,
      startedAt: this.createdAt,
      lastActivity: Date.now(),
    };
  }

  isIdle(): boolean { return this.piSession.isIdle; }

  async dispose(): Promise<void> {
    try { this.piSession.dispose(); } catch {}
  }

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

### 2.2 ClaudeRuntime

> ⚠️ Claude CLI NOT installed. All flags UNVERIFIED. Phase 9 = spike first.

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

    try {
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: this.child!.stdout });
        rl.on("line", (line) => {
          if (this.abortController?.signal.aborted) return;
          const event = ClaudeEventNormalizer.parseLine(line);
          if (event) this.emit(event);
        });

        // H5 fix: use 'close' (not 'exit') — fires AFTER all stdout is consumed
        let exitCode: number | null = null;
        this.child!.on("exit", (code) => { exitCode = code; });
        this.child!.on("close", () => {
          if (exitCode !== null && exitCode !== 0 && !this.abortController?.signal.aborted) {
            this.emit({ type: "error", message: `Claude exited with code ${exitCode}`, recoverable: false });
          }
          this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
          resolve();
        });
      });
    } catch (e) {
      // C2 fix: emit error + turn_end on failure
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
    return {
      model: this.modelId, thinking: "medium",
      status: this.busy ? "thinking" : "idle",
      tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200_000,
      costUsd: 0, startedAt: this.createdAt, lastActivity: Date.now(),
    };
  }
  isIdle(): boolean { return !this.busy; }
}
```

### 2.3 MyaNativeRuntime

(Same as v6 — uses `agent.run(text, sink)`. Verified correct.)

---

## 3. Event Normalization Layer

### 3.1 PiEventNormalizer

(Same as v6 — turn_start from prompt(), agent_settled→turn_end, tool_execution_update/end, no bash_execution_update.)

### 3.2-3.3 Claude/Mya Normalizers

(Same as v6 — verified correct.)

---

## 4. mya Broker

### 4.1 IC3 Decision: pi-intercom as second extension

```
DefaultResourceLoader({
  extensionFactories: [
    { name: "mya-bridge", factory: myaBridge },
    { name: "pi-intercom", factory: piIntercomFactory },  // ← self-manages socket
  ],
})
```

Pi-intercom internally:
1. On `session_start`: calls `spawnBrokerIfNeeded(brokerCommand, brokerArgs)` (from config.json)
2. Connects to `~/.mya/agent/intercom/broker.sock` (derived from `PI_CODING_AGENT_DIR`)
3. Registers `intercom` tool for agent-to-agent messaging
4. Injects inbound messages via `pi.sendCustomMessage()` with `triggerTurn: true`

**No MYA_BROKER_SOCKET env var. No BrokerClientFactory. No broker field on MyaBridgeOptions.**

### 4.2 Package: IC9 — pi-intercom → packages/intercom/

> ⚠️ IMPL: Move pi-intercom source to `packages/intercom/src/`. Add `srcSubpaths` override in bundle.mjs.
> Must verify pi extension discovery still works (pi-intercom has `"pi": { "extensions": ["./index.ts"] }` in package.json).

---

## 5. Smart Router

> ⚠️ IC5: New component — define in Phase 8.

```typescript
// Stub interface for Phase 5 compatibility (full impl in Phase 8)
interface SmartRouter {
  select(input: { prompt: string; agentOverride?: string; modelOverride?: string }): Promise<{ runtime: AgentRuntime; reason: string }>;
}
```

---

## 6. Shared Infrastructure

### 6.1 PromptEnricher

> ⚠️ IC5: New component — define in Phase 7.

```typescript
// Stub interface for Phase 5 compatibility
interface PromptEnricher {
  enrich(prompt: string, ctx: EnrichContext): Promise<string>;
  capture(output: string, ctx: EnrichContext): Promise<void>;
}

interface EnrichContext {
  sessionId: string;
  runtimeType: string;
  executionModel: "in-process" | "subprocess";
}
```

### 6.2 Compaction

```typescript
async function maybeCompact(session: RuntimeSession): Promise<void> {
  const state = session.getState();
  // H4 fix: contextPct now real (was always 0)
  if (state.contextPct > 70) {
    try { await session.compact(); } catch (e) { console.warn(`[compaction] failed: ${e}`); }
  }
}
```

### 6.3 CostTracker

> ⚠️ IC5: New component — define in Phase 12.

```typescript
// Stub interface for Phase 5 compatibility
interface CostTracker {
  record(sessionId: string, event: AgentEvent): void;
  getSessionCost(sessionId: string): { totalUsd: number; turns: number } | undefined;
}
```

### 6.4 AuthInjector

> ⚠️ IC5: New component — define in Phase 4.

```typescript
// Stub — full impl uses provider-registry
function buildAgentEnv(): Record<string, string>;
```

---

## 7. Gateway Integration

### 7.1 RuntimePool

> ⚠️ IC1: Must implement ALL methods gateway uses.
> ⚠️ IC6: Keep SessionMetaStore — don't duplicate metadata in pool entries.

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
      existing.idleSince = Date.now();  // C1 fix: was 0
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
      // M1 fix: validate agentType mismatch
      if (opts?.agentType && existing.runtimeType !== opts.agentType) {
        throw new Error(`Session ${sessionId} already exists as ${existing.runtimeType}, cannot reassign to ${opts.agentType}`);
      }
      existing.lastActivity = Date.now();
      existing.idleSince = Date.now();  // C1 fix: was 0
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
        if (entry) {
          entry.busy = busy;
          entry.lastActivity = Date.now();
          if (!busy) entry.idleSince = Date.now();
        }
      },
      () => {
        const entry = this.entries.get(sessionId);
        if (entry) entry.messageCount++;
      },
    );

    const entry: RuntimePoolEntry = {
      sessionId, session: adapter, runtimeType: runtime.runtimeType,
      busy: false, messageCount: 0,
      lastActivity: Date.now(), createdAt: Date.now(),
      idleSince: Date.now(),
    };
    this.entries.set(sessionId, entry);
    return { session: adapter, runtimeType: runtime.runtimeType };
  }

  get(sessionId: string): RuntimePoolEntry | undefined { return this.entries.get(sessionId); }
  list(): RuntimePoolEntry[] { return [...this.entries.values()]; }

  // M2 fix: check busy — don't kill in-flight sessions
  release(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    if (entry.busy) return false;  // M2: don't release busy sessions
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

```typescript
class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";
  private turnLock = Promise.resolve();

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    private onBusyChange?: (busy: boolean) => void,
    private onMessage?: () => void,
  ) {
    this.session.onEvent((event) => {
      if (event.type === "text") this.textBuffer += event.delta;
      this.costTracker.record(this.session.sessionId, event);
      this.listeners.forEach(l => l(event));
    });
  }

  async prompt(text: string, _options?: unknown): Promise<void> {
    const prev = this.turnLock;
    let release!: () => void;
    this.turnLock = new Promise<void>((r) => { release = r; });
    this.onBusyChange?.(true);

    try {
      await prev;

      let enriched = text;
      try {
        enriched = await this.enricher.enrich(text, {
          sessionId: this.session.sessionId,
          runtimeType: this.session.runtimeType,
          executionModel: this.session.executionModel,
        });
      } catch (e) { console.warn(`[adapter] enrich failed: ${e}`); }

      this.textBuffer = "";

      // C2 fix: session.prompt() may throw — catch to ensure busy cleared + release called
      try {
        await this.session.prompt(enriched);
        this.onMessage?.();
      } catch (e) {
        // Session already emitted error + turn_end internally (C2 fix in PiInProcessSession/ClaudeSession)
        // Just log — the error event was forwarded to listeners via onEvent
        console.warn(`[adapter] session.prompt failed: ${e}`);
        throw e;
      }

      if (this.textBuffer) {
        try {
          await this.enricher.capture(this.textBuffer, {
            sessionId: this.session.sessionId,
            runtimeType: this.session.runtimeType,
          });
        } catch (e) { console.warn(`[adapter] capture failed: ${e}`); }
      }
    } finally {
      this.onBusyChange?.(false);
      release();
    }
  }

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort(): void {
    void this.session.dispose().catch(() => {});
  }

  get sessionFile(): string | undefined { return undefined; }
  getState(): SessionState { return this.session.getState(); }
  getTextBuffer(): string { return this.textBuffer; }
}
```

### 7.3 WebSocket + Snapshot

```typescript
import { frame } from "@my-agent/gateway";

function sendToWs(ws: WebSocket, sessionId: string, event: AgentEvent, seq: number): void {
  const envelope = frame({ sessionId, seq, event });
  if (ws.bufferedAmount > 1_000_000) {
    if (event.type !== "turn_end" && event.type !== "error") return;
  }
  ws.send(JSON.stringify(envelope));
}

// ⚠️ IC5: GET /sessions/:id/snapshot route must be added to gateway during Phase 12
function handleSnapshot(pool: RuntimePool, sessionId: string): { text: string; state: SessionState } | null {
  const entry = pool.get(sessionId);
  if (!entry) return null;
  const adapter = entry.session as RuntimeSessionAdapter;
  return { text: adapter.getTextBuffer(), state: adapter.getState() };
}
```

### 7.4 Graceful Shutdown

```typescript
async function gracefulShutdown(pool: RuntimePool, timeout = 30_000): Promise<void> {
  console.log("[shutdown] draining...");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pool.list().filter(e => e.busy).length === 0) break;
    await sleep(500);
  }
  pool.dispose();
  console.log("[shutdown] complete");
}
```

### 7.5 CronJob

> ⚠️ IC2: Add `agentType?` to CronJob interface + rewire cron execution in main.ts.

```typescript
interface CronJob {
  name: string;
  trigger: TriggerType;
  schedule: string;
  prompt: string;
  agentType?: string;  // ← IC2: NEW field
  deliveryTarget?: string;
}

// Legacy compat: undefined agentType → "pi"
async function executeCronJob(pool: RuntimePool, job: CronJob, sessionId: string): Promise<void> {
  const { session } = await pool.acquireWithRuntime(sessionId, {
    agentType: job.agentType ?? "pi",
    prompt: job.prompt,
    cwd: job.workdir ?? process.cwd(),
  });
  await session.prompt(job.prompt);
}
```

---

## 8. Execution Paths

(Same as v6.)

---

## 9. Implementation Phases

| Phase | Scope | Key Implementation Notes |
|---|---|---|
| **1** | Broker: pi-intercom → packages/intercom/ | IC9: package move. Verify pi discovery. spawnBrokerIfNeeded needs (command, args). |
| **2** | AgentRuntime SPI + types + tests | IC11: define CompactionResult. |
| **3** | Spike: log pi events | Verify all event types + payloads. |
| **4** | PiInProcessRuntime + normalizer | IC10: AbortSignal. IC5: buildAgentEnv. M4: ModelRuntime keyed by agentDir. |
| **5** | RuntimePool + adapter + gateway | IC1: ALL pool methods. IC2: cron rewire. IC6: SessionMetaStore. IC5: stub SmartRouter/PromptEnricher/CostTracker. |
| **6** | MyaNativeRuntime | |
| **7** | PromptEnricher (full) | MemoryFacade.recall + brain.recordFact. |
| **8** | SmartRouter (full) | Async scoring. |
| **9** | Spike: Claude CLI | Verify ALL flags. |
| **10** | ClaudeRuntime | H5: close event. C2: error+turn_end on failure. |
| **11** | Broker inter-agent messaging | Pi-intercom handles injection. |
| **12** | CostTracker + dashboard + snapshot | IC5: snapshot route. |
| **13** | Shutdown + idle sweep + E2E | |

---

## 10. Required Test Files

> ⚠️ IC8: NO TEST = NO MERGE.

| Test File | Phase | Tier | Key Cases |
|---|---|---|---|
| `runtime-spi.test.ts` | 2 | [unit] | AgentEvent union; StartOpts shapes |
| `pi-event-normalizer.test.ts` | 4 | [unit] | agent_settled→turn_end once; tool_execution_update→tool_result; message_end usage |
| `pi-in-process-runtime.test.ts` | 4 | [smoke] | ModelRuntime keyed by agentDir; listModels(); setModel→model_changed; contextPct from getContextUsage |
| `runtime-pool.test.ts` | 5 | [unit] | get-or-create; agentType mismatch error; maxSessions; idle sweep (idleSince≠0); release busy→false; broker disconnect on fail |
| `runtime-session-adapter.test.ts` | 5 | [unit] | enrich→prompt→capture; busy toggle; turnLock; abort→dispose; messageCount++; prompt throw→turn_end emitted |
| `claude-session.test.ts` | 10 | [real] | skipIf(!claude); overlap queue; dispose rejects; close event (not exit); error→turn_end |
| `broker-client-factory.test.ts` | 1 | [smoke] | retry new client; isolated PI_CODING_AGENT_DIR per test |
| `cron-agent-type.test.ts` | 5 | [unit] | legacy job→pi; explicit agentType |
| `gateway-snapshot.test.ts` | 12 | [unit] | snapshot returns text+state; 404 unknown |

---

## 11. Verification Checklist

| Check | How | Phase |
|---|---|---|
| Pi event types | subscribe + log 1 turn | 3 |
| 1 turn_start per prompt() | Check: prompt emits turn_start, agent_settled emits turn_end | 4 |
| turn_end emitted on failure | Trigger pi error, verify turn_end fires | 4 |
| tool_execution_update fires | Check log | 3 |
| message_end.usage has tokens | Check assistant message_end | 3 |
| isIdle is getter | `typeof piSession.isIdle === "boolean"` | 4 |
| model is getter | `piSession.model?.id` | 4 |
| getContextUsage() exists | `piSession.getContextUsage()` | 3 |
| getModels() returns array | `Array.isArray(rt.getModels())` | 4 |
| MemoryFacade.recall | Inspect shape | 7 |
| brain.recordFact | `recordFact({kind:"fact", visibility:"private"})` | 7 |
| Claude CLI flags | Install + log stream-json | 9 |
| ClaudeSession close (not exit) | Verify all stdout consumed before turn_end | 10 |
| idleSince ≠ 0 after acquire | Acquire, check entry.idleSince > 0 | 5 |
| release(busy) → false | Acquire + prompt, release during prompt → false | 5 |

---

## 12. Implementation Notes Summary

All items below are documented decisions/constraints for the coding phase. They cannot be resolved in the spec — they require actual code changes to existing files.

| # | Note | Phase | Status |
|---|---|---|---|
| IC1 | RuntimePool must implement ALL pool methods gateway uses (~10 call sites in main.ts) | 5 | ⚠️ Code |
| IC2 | CronJob.agentType field + cron execution rewire in main.ts | 5 | ⚠️ Code |
| IC3 | **Decided**: pi-intercom as second extension. No MYA_BROKER_SOCKET. No broker on MyaBridgeOptions. | 1 | ✅ Decided |
| IC4 | Use IntercomClient from pi-intercom directly. BrokerMessage = pi-intercom types. | 1 | ⚠️ Code |
| IC5 | SmartRouter, PromptEnricher, CostTracker, buildAgentEnv — new components, stub for Phase 5 | 5/7/8/12 | ⚠️ Code |
| IC6 | Keep SessionMetaStore as single metadata source | 5 | ✅ Decided |
| IC7 | BrokerClientFactory retry: new client instance | 1 | ✅ In spec |
| IC8 | 9 test files required | Each | ⚠️ Code |
| IC9 | pi-intercom → packages/intercom/src/ + bundle.mjs override | 1 | ⚠️ Code |
| IC10 | AbortSignal wiring for abort during prompt | 4 | ⚠️ Code |
| IC11 | Define own CompactionResult type | 2 | ✅ In spec |
| IC12 | Gateway main.ts construction: how router/runtimes/enricher are built at startup, 17 shared instances DI | 5 | ⚠️ Code |
