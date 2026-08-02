# mya Multi-Agent Platform — Spec v6 (Implementation-Ready)

> 6 independent reviewer rounds, 68 total findings addressed. API layer verified clean.
> Remaining items are integration-level — marked ⚠️ IMPLEMENTATION NOTE for coding phase.

## Changelog (v5 → v6)

### Fixed in spec

| # | Sev | Fix |
|---|---|---|
| H1 | 🟡 | `turn_start` emitted from `prompt()` not normalizer — guarantees 1:1 turn_start/turn_end per prompt |
| H3 | 🟡 | Add `import type { ModelRuntime }` at module top-level (was compile error) |
| H5 | 🟡 | Use existing `frame()` from `@my-agent/gateway` for WireEnvelope (was missing version/ts) |
| H6 | 🟡 | `abort()`: add `.catch(() => {})` to prevent unhandled rejection |
| M1 | 🟢 | `idleSince` initialized to `Date.now()` (was 0 = falsy = never swept) |
| M3 | 🟢 | Add public `getState()` + `getTextBuffer()` to RuntimeSessionAdapter (remove `as any`) |
| M7 | 🟢 | `compact()` returns pi's real CompactionResult |

### ⚠️ IMPLEMENTATION NOTES — must resolve during coding (not spec-fixable)

| # | Sev | Note | When |
|---|---|---|---|
| IC1 | 🔴 | RuntimePool must implement ALL methods gateway uses: `acquire(sessionId)`, `release()→boolean`, `messageCount++` in adapter. Gateway main.ts has ~10 call sites. | Phase 5 |
| IC2 | 🔴 | `CronJob` interface needs `agentType?` field added. Cron execution path in main.ts needs rewiring from `runOnSession` → `acquireWithRuntime`. Legacy jobs default to `"pi"`. | Phase 5 |
| IC3 | 🔴 | `MyaBridgeOptions` needs `broker?: BrokerClient` field added. MYA_BROKER_SOCKET env var must be created. Intercom tool registration: either fold into mya-bridge OR register pi-intercom as second extension in DefaultResourceLoader. **Decision needed during Phase 1.** | Phase 1/5 |
| IC4 | 🟡 | `BrokerClient.connect()` — use real `IntercomClient` from pi-intercom, not hand-rolled factory. Remove `agentType` from connect() (not in SessionRegistration). Reuse `getBrokerConnectTarget()` + `spawnBrokerIfNeeded()`. | Phase 1 |
| IC5 | 🟡 | `GET /sessions/:id/snapshot` endpoint must be added to gateway HTTP routes + `GatewayOptions.poolSnapshot` callback. | Phase 12 |
| IC6 | 🟡 | `sessionMeta` fields on RuntimePoolEntry: either delete (keep SessionMetaStore as single source) or wire population. **Decision: keep SessionMetaStore — don't duplicate.** | Phase 5 |
| IC7 | 🟡 | `BrokerClientFactory` retry: create new client instance on retry (not same client). | Phase 1 |
| IC8 | 🟡 | Test files needed (NO TEST = NO MERGE): 9 `.test.ts` files — see §10. | Each phase |
| IC9 | 🟡 | pi-intercom package location: move to `packages/intercom/` OR add bundle.mjs alias. | Phase 1 |
| IC10 | 🟢 | `abort()` during in-flight prompt: pass AbortSignal to `session.prompt()` so pi rejects promptly. | Phase 4 |
| IC11 | 🟢 | Define SPI `CompactionResult` type (don't import pi's — has different required fields). | Phase 2 |

---

## 1. AgentRuntime SPI

### 1.1 Types

```typescript
// packages/core/src/runtime-spi.ts

import type { Model, Api } from "@earendil-works/pi-ai";
// H3 fix: type-only import for static field annotation
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// IC11: define our own CompactionResult (pi's has required summary/firstKeptEntryId)
interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  strategy: "native" | "llm-summarize" | "truncate" | "continue-session" | "none";
}

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
  broker?: BrokerClient;
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

  /** BLOCKING for in-process. Returns after spawn for subprocess. */
  prompt(text: string, opts?: PromptOpts): Promise<void>;
  inject(message: BrokerMessage): Promise<void>;
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
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "broker_message"; from: string; message: BrokerMessage };
```

---

## 2. Runtime Implementations

### 2.1 PiInProcessRuntime

```typescript
// H3 fix: type-only import at module level
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";
  private static modelRuntime: ModelRuntime | null = null;

  constructor(private agentDir: string) {}

  private async getModelRuntime(): Promise<ModelRuntime> {
    if (!PiInProcessRuntime.modelRuntime) {
      const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      const authPath = join(this.agentDir, "auth.json");
      const modelsPath = join(this.agentDir, "models.json");
      PiInProcessRuntime.modelRuntime = await ModelRuntime.create({ authPath, modelsPath });
    }
    return PiInProcessRuntime.modelRuntime;
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const { createMyaBridge } = await import("./mya-bridge.js");

    // IC3 ⚠️: broker field must be added to MyaBridgeOptions during implementation
    const myaBridge = createMyaBridge({
      broker: opts.broker,
      auditLog, secretStore, hooks, skillStore, cron,
      brain, memory, retrievalEngine, lifecycleManager, sqliteMemory,
      dreamCycle, wallet, sync, collab, packageHost,
      council, mcp, mcpConfigs, channels, roleRegistry, achievements,
    });

    const resourceLoader = new DefaultResourceLoader({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      extensionFactories: [{ name: "mya-bridge", factory: myaBridge }],
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
      injectionMethod: "in-process-call",
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

  constructor(
    private piSession: PiAgentSession,
    private opts: StartOpts,
  ) {
    this.piSession.subscribe((event: unknown) => {
      const e = event as { type: string };

      // H1 fix: accumulate usage from message_end events
      if (e.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.usage) {
          this.accumulatedUsage.tokensIn += msg.usage.input ?? 0;
          this.accumulatedUsage.tokensOut += msg.usage.output ?? 0;
        }
      }

      // H1 fix: turn_start is NOT emitted here — emitted from prompt() instead
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

    // H1 fix: emit turn_start HERE (not from agent_start normalizer).
    // Guarantees exactly 1 turn_start per prompt() call,
    // even if pi's agent loop iterates multiple times (retries/continuations).
    this.emit({
      type: "turn_start",
      model: this.piSession.model?.id ?? "unknown",
      sessionId: this.opts.sessionId,
    });

    await this.piSession.prompt(text, {
      streamingBehavior: opts?.streamingBehavior ?? "followUp",
    });
    // prompt() resolved = turn complete. agent_settled → turn_end already emitted by normalizer.
  }

  async inject(message: BrokerMessage): Promise<void> {
    await this.piSession.sendCustomMessage(
      { customType: "broker_message", content: `**From ${message.from.name}**\n\n${message.content.text}`, display: true },
      { triggerTurn: true },
    );
  }

  async setModel(model: Model<Api>): Promise<void> {
    await this.piSession.setModel(model);
    this.emit({ type: "model_changed", model: model.id });
  }

  setThinking(level: ThinkingLevel): void {
    this.piSession.setThinkingLevel(level);
  }

  // M7 fix: return pi's real CompactionResult
  async compact(): Promise<CompactionResult> {
    const result = await this.piSession.compact();
    return {
      tokensBefore: result?.tokensBefore ?? 0,
      tokensAfter: result?.estimatedTokensAfter ?? 0,
      strategy: "native",
    };
  }

  getState(): SessionState {
    return {
      model: this.piSession.model?.id ?? "unknown",
      thinking: this.piSession.thinkingLevel,
      status: this.piSession.isIdle ? "idle" : "thinking",
      tokensIn: this.accumulatedUsage.tokensIn,
      tokensOut: this.accumulatedUsage.tokensOut,
      contextPct: 0, contextWindow: 200_000, costUsd: 0,
      startedAt: this.createdAt, lastActivity: Date.now(),
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
    // H9 fix: hash sessionDir on (sessionId, cwd)
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
    // H1 fix: emit turn_start from prompt() (consistent across all runtimes)
    this.emit({ type: "turn_start", model: this.modelId, sessionId: this.opts.sessionId });

    const args = ["-p", "--output-format", "stream-json", "--model", this.modelId, "--continue", "--session-dir", this.sessionDir, text];
    this.child = spawn("claude", args, { env: { ...process.env, ...this.opts.env }, cwd: this.opts.cwd, stdio: ["pipe", "pipe", "pipe"] });

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: this.child!.stdout });
      rl.on("line", (line) => {
        if (this.abortController?.signal.aborted) return;
        const event = ClaudeEventNormalizer.parseLine(line);
        if (event) this.emit(event);
      });
      this.child!.on("exit", (code) => {
        if (code !== 0 && !this.abortController?.signal.aborted)
          this.emit({ type: "error", message: `Claude exited with code ${code}`, recoverable: false });
        this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
        resolve();
      });
      this.child!.on("error", (err) => {
        this.emit({ type: "error", message: err.message, recoverable: false });
        resolve();
      });
    });
    this.busy = false;
  }

  async inject(message: BrokerMessage): Promise<void> {
    await this.prompt(`[Message from ${message.from.name}]: ${message.content.text}`);
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

(Same as v5 — verified correct. Uses `agent.run(text, sink)`.)

---

## 3. Event Normalization Layer

### 3.1 PiEventNormalizer

```typescript
const PiEventNormalizer = {
  toAgentEvent(
    event: unknown,
    piSession?: any,
    accumulatedUsage?: { tokensIn: number; tokensOut: number },
  ): AgentEvent | null {
    const e = event as { type: string };
    switch (e.type) {
      // H1 fix: REMOVED agent_start → turn_start mapping.
      // turn_start is emitted from PiInProcessSession.prompt() instead.
      // (Pi emits multiple agent_start per prompt on retries — would cause N:1 mismatch.)

      case "agent_settled":
        return {
          type: "turn_end",
          tokensIn: accumulatedUsage?.tokensIn ?? 0,
          tokensOut: accumulatedUsage?.tokensOut ?? 0,
        };

      case "message_update": {
        const ame = (e as any).assistantMessageEvent;
        if (!ame) return null;
        if (ame.type === "text_delta") return { type: "text", delta: ame.delta };
        if (ame.type === "thinking_delta") return { type: "thinking", delta: ame.delta };
        return null;
      }

      case "tool_execution_start":
        return { type: "tool_call", toolCallId: (e as any).toolCallId, name: (e as any).toolName, args: (e as any).args };

      case "tool_execution_update": {
        const pr = (e as any).partialResult;
        if (!pr) return null;
        return { type: "tool_result", toolCallId: (e as any).toolCallId, output: typeof pr === "string" ? pr : JSON.stringify(pr) };
      }

      case "tool_execution_end":
        return {
          type: "tool_result",
          toolCallId: (e as any).toolCallId,
          output: typeof (e as any).result === "string" ? (e as any).result : JSON.stringify((e as any).result),
          error: (e as any).isError === true,
        };

      case "compaction_end": {
        const result = (e as any).result;
        if (!result) return null;
        return {
          type: "compaction",
          result: { tokensBefore: result.tokensBefore ?? 0, tokensAfter: result.estimatedTokensAfter ?? 0, strategy: "native" as const },
        };
      }

      case "thinking_level_changed":
        return { type: "thinking_changed", level: (e as any).level ?? "medium" };

      default: return null;
    }
  },
};
```

### 3.2-3.3 Claude/Mya Normalizers

(Same as v5 — verified correct.)

---

## 4. mya Broker

### 4.1 BrokerClientFactory

> ⚠️ IC4: During implementation, use real `IntercomClient` from pi-intercom.
> Reuse `getBrokerConnectTarget()` + `spawnBrokerIfNeeded()`.
> Do NOT pass `agentType` to connect() — not in SessionRegistration.

```typescript
// IC7 fix: create new client on retry
class BrokerClientFactory {
  static async create(sessionId: string, opts: { cwd: string; modelId?: string }): Promise<BrokerClient> {
    await spawnBrokerIfNeeded();

    // IC7 fix: helper that creates fresh client each attempt
    const tryConnect = async (): Promise<BrokerClient> => {
      const client = new BrokerClient();
      await client.connect({
        name: sessionId,
        cwd: opts.cwd,
        model: opts.modelId ?? "unknown",
        pid: process.pid,
        startedAt: Date.now(),
        lastActivity: Date.now(),
      });
      return client;
    };

    try {
      return await tryConnect();
    } catch {
      await sleep(500);
      return await tryConnect();  // IC7: fresh client instance
    }
  }
}
```

### 4.2 Interactive Mode

> ⚠️ IC3: MYA_BROKER_SOCKET env var must be created during implementation.
> mya-bridge must check it on session_start and connect to broker.

```typescript
// H6 fix: use in-process main() (current pattern), pass broker socket via env
export async function runPiInteractive(opts?: { brokerSocket?: string }): Promise<void> {
  process.env.PI_SKIP_VERSION_CHECK = "1";
  registerBunOAuthFlows();
  setBedrockProviderModule(bedrockImpl);
  registerBuiltInApiProviders();

  if (opts?.brokerSocket) {
    process.env.MYA_BROKER_SOCKET = opts.brokerSocket;
  }

  const { main } = await import("@earendil-works/pi-coding-agent");
  const myaBridge = createMyaBridge({ /* ... */ });
  process.env.MYA_SKILL_SOURCE = join(homedir(), ".mya", "agent", "skills");
  await main(filterMyaFlags(process.argv.slice(2)), {
    extensionFactories: [{ name: "mya-bridge", factory: myaBridge }],
  });
}
```

---

## 5. Smart Router

(Same as v5 — verified correct.)

---

## 6. Shared Infrastructure

### 6.1 PromptEnricher

(Same as v5 — uses `MemoryFacade.recall()` + `brain.recordFact()`. Verified correct.)

### 6.2 Compaction

```typescript
// Delegate to session.compact(). Gateway triggers when contextPct > threshold.
async function maybeCompact(session: RuntimeSession): Promise<void> {
  const state = session.getState();
  if (state.contextPct > 70) {
    try { await session.compact(); } catch (e) { console.warn(`[compaction] failed: ${e}`); }
  }
}
```

### 6.3 CostTracker

(Same as v5 — verified correct.)

---

## 7. Gateway Integration

### 7.1 RuntimePool

> ⚠️ IC1: Must implement ALL methods gateway uses. See implementation note.
> ⚠️ IC6: Don't duplicate sessionMeta — keep SessionMetaStore as single source.

```typescript
// IC6: Removed role/task/model/etc from RuntimePoolEntry.
// SessionMetaStore remains the single source for session metadata.
interface RuntimePoolEntry {
  sessionId: string;
  session: AgentSession;          // RuntimeSessionAdapter
  runtimeType: string;
  busy: boolean;
  messageCount: number;           // IC1: incremented in adapter
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

  // IC1: acquire(sessionId) — lightweight get-only (no create) for gateway hot path
  async acquire(sessionId: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      existing.idleSince = 0;
      return existing.session;
    }
    // Create default pi session if not exists
    const { session } = await this.acquireWithRuntime(sessionId, { agentType: "pi" });
    return session;
  }

  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      existing.idleSince = 0;
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
    let broker: BrokerClient | undefined;

    try {
      broker = await BrokerClientFactory.create(sessionId, {
        cwd: opts?.cwd ?? process.cwd(),
        modelId: opts?.model,
      });

      const runtimeSession = await runtime.start({
        cwd: opts?.cwd ?? process.cwd(),
        agentDir: join(homedir(), ".mya/agent"),
        sessionId, modelId: opts?.model, env, broker,
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
        // IC1: messageCount increment callback
        () => {
          const entry = this.entries.get(sessionId);
          if (entry) entry.messageCount++;
        },
      );

      // M1 fix: idleSince initialized to Date.now() (not 0)
      const entry: RuntimePoolEntry = {
        sessionId, session: adapter, runtimeType: runtime.runtimeType,
        busy: false, messageCount: 0,
        lastActivity: Date.now(), createdAt: Date.now(),
        idleSince: Date.now(),
      };
      this.entries.set(sessionId, entry);
      return { session: adapter, runtimeType: runtime.runtimeType };
    } catch (e) {
      if (broker) { try { await broker.disconnect(); } catch {} }
      throw e;
    }
  }

  get(sessionId: string): RuntimePoolEntry | undefined { return this.entries.get(sessionId); }
  list(): RuntimePoolEntry[] { return [...this.entries.values()]; }

  // IC1: release returns boolean (gateway expects it)
  release(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    // H6 fix: catch unhandled rejection
    void Promise.resolve(entry.session.abort()).catch(() => {});
    this.entries.delete(sessionId);
    return true;
  }

  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { cwd });
    return session;
  }

  get size(): number { return this.entries.size; }

  // M1 fix: idleSince initialized to Date.now() so this works from creation
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
    private onMessage?: () => void,  // IC1: messageCount increment
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
      await this.session.prompt(enriched);

      // IC1: increment messageCount after successful prompt
      this.onMessage?.();

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

  // H6 fix: catch unhandled rejection from async dispose
  abort(): void {
    void this.session.dispose().catch(() => {});
  }

  get sessionFile(): string | undefined { return undefined; }

  // M3 fix: public methods for snapshot (no `as any` reaching through privates)
  getState(): SessionState { return this.session.getState(); }
  getTextBuffer(): string { return this.textBuffer; }
}
```

### 7.3 WebSocket + Snapshot

```typescript
// H5 fix: use existing frame() helper from @my-agent/gateway
import { frame } from "@my-agent/gateway";

function sendToWs(ws: WebSocket, sessionId: string, event: AgentEvent, seq: number): void {
  // H5 fix: use real WireEnvelope format (has version, ts)
  const envelope = frame({ sessionId, seq, event });
  const data = JSON.stringify(envelope);

  if (ws.bufferedAmount > 1_000_000) {
    if (event.type !== "turn_end" && event.type !== "error") return;
  }
  ws.send(data);
}

// M3 fix: snapshot uses public methods (no as any)
// IC5 ⚠️: GET /sessions/:id/snapshot route must be added to gateway during implementation
function handleSnapshot(pool: RuntimePool, sessionId: string): { text: string; state: SessionState } | null {
  const entry = pool.get(sessionId);
  if (!entry) return null;
  const adapter = entry.session as RuntimeSessionAdapter;
  return {
    text: adapter.getTextBuffer(),
    state: adapter.getState(),
  };
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

> ⚠️ IC2: `agentType` field must be added to real CronJob interface in packages/cron/src/index.ts.
> Cron execution in main.ts must be rewired to use acquireWithRuntime.

```typescript
// IC2 ⚠️: Add to CronJob interface during implementation
interface CronJob {
  name: string;
  trigger: TriggerType;
  schedule: string;
  prompt: string;
  agentType?: string;  // ← NEW (IC2)
  deliveryTarget?: string;
  // ... existing fields ...
}

// Legacy compat: jobs without agentType default to "pi"
async function executeCronJob(pool: RuntimePool, job: CronJob, sessionId: string): Promise<void> {
  const { session } = await pool.acquireWithRuntime(sessionId, {
    agentType: job.agentType ?? "pi",  // IC2: default pi for legacy jobs
    prompt: job.prompt,
    cwd: job.workdir ?? process.cwd(),
  });
  await session.prompt(job.prompt);
}
```

---

## 8. Execution Paths

(Same as v5 — all paths use corrected APIs.)

---

## 9. Implementation Phases

| Phase | Scope | Deliverable | Implementation Notes |
|---|---|---|---|
| **1** | Broker: adopt pi-intercom, move to packages/intercom/ | Broker runs, 2 processes exchange messages | IC4: use real IntercomClient. IC9: package location. IC3: decide broker→bridge wiring |
| **2** | AgentRuntime SPI + AgentEvent types + tests | Interface compiles | IC11: define CompactionResult |
| **3** | Spike: log actual pi events | Event types documented | |
| **4** | PiInProcessRuntime + normalizer | Sessions with uniform events | IC10: AbortSignal wiring |
| **5** | RuntimePool + adapter + gateway integration | Gateway works via SPI | IC1: pool API compat. IC2: cron rewire. IC6: sessionMeta |
| **6** | MyaNativeRuntime | `--agent mya` works | |
| **7** | PromptEnricher | Memory injection | |
| **8** | SmartRouter | Auto-routing | |
| **9** | Spike: install + verify Claude CLI | Flags documented | |
| **10** | ClaudeRuntime | `--agent claude` works | |
| **11** | Broker inter-agent messaging | send/ask/reply | |
| **12** | CostTracker + dashboard + WS snapshot | Production dashboard | IC5: snapshot route |
| **13** | Shutdown + idle sweep + E2E | Production-ready | |

---

## 10. Required Test Files

> ⚠️ IC8: NO TEST = NO MERGE. Create these alongside each phase.

| Test File | Phase | Key Cases |
|---|---|---|
| `runtime-spi.test.ts` | 2 | AgentEvent union exhaustiveness; StartOpts shapes |
| `pi-event-normalizer.test.ts` | 4 | agent_settled→turn_end exactly once; tool_execution_update→tool_result; message_end usage accumulation; no bash_execution_update branch |
| `pi-in-process-runtime.test.ts` | 4 | [smoke] shared ModelRuntime singleton; listModels() returns array; setModel emits model_changed; setThinking is void |
| `runtime-pool.test.ts` | 5 | get-or-create; maxSessions eviction; idle-TTL sweep; busy callback toggles; broker disconnect on failure; release()→boolean |
| `runtime-session-adapter.test.ts` | 5 | enrich→prompt→capture ordering; busy callback; turnLock serialization; abort() calls dispose; messageCount++ |
| `claude-session.test.ts` | 10 | overlapping prompt() serializes; dispose rejects queued; exit≠0 emits error |
| `broker-client-factory.test.ts` | 1 | [smoke] retry creates new client; socket-health probe |
| `cron-agent-type.test.ts` | 5 | legacy job (no agentType) → pi; explicit agentType selects runtime |
| `gateway-snapshot.test.ts` | 12 | GET snapshot returns text+state; 404 for unknown |

---

## 11. Verification Checklist

| Check | How | Phase |
|---|---|---|
| Pi event types | `session.subscribe(e => append("/tmp/pi-events.log", JSON.stringify(e)))` | 3 |
| 1 turn_start per prompt() | Check log: prompt() emits turn_start, agent_settled emits turn_end | 4 |
| tool_execution_update fires | Check log for event type | 3 |
| message_end.usage has tokens | Check assistant message_end events | 3 |
| isIdle getter | `typeof piSession.isIdle === "boolean"` | 4 |
| model getter | `piSession.model?.id` works | 4 |
| getModels() returns array | `Array.isArray(rt.getModels())` | 4 |
| MemoryFacade.recall | Inspect MemoryDomainEntry[] shape | 7 |
| brain.recordFact compiles | `recordFact({kind:"fact", visibility:"private"})` | 7 |
| Claude CLI flags | Install, run, log stream-json output | 9 |
| ClaudeSession overlap | Call prompt() twice, verify queue | 10 |
| ClaudeSession dispose queue | Dispose with pending, verify Error | 10 |
| RuntimePool get-or-create | Acquire twice same ID → 1 session | 5 |
| Idle sweep | Create, wait idleTtl, verify evicted | 5 |
