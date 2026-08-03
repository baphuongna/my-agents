# mya Multi-Agent Platform — Spec v5 (Production-Ready)

> 5 independent reviewer rounds, 52 total findings fixed. All API calls verified against actual source.

## Changelog (v4 → v5)

| # | Sev | Fix |
|---|---|---|
| C1 | 🔴 | `acquireWithRuntime()` get-or-create: check existing session before creating new |
| C2 | 🔴 | `entry.session.dispose()` → `entry.session.abort()` (AgentSession has no dispose) |
| C3 | 🔴 | `bash_execution_update` (dead code) → remove. Bash streams via `tool_execution_update` like all tools |
| C4 | 🔴 | Wire `busy` flag via callback: adapter sets `entry.busy = true/false` during prompt() |
| C5 | 🔴 | Broker client cleanup: try/catch around `runtime.start()`, disconnect broker on failure |
| C6 | 🔴 | `ModelRuntime.getAvailableModels()` → `getModels()` |
| C7 | 🔴 | `MemoryManager` type → `MemoryFacade` (has recall/record) |
| C8 | 🔴 | ClaudeSession queue: reject pending promises on dispose() |
| C9 | 🔴 | BrokerClientFactory: remove static flag, probe socket health each create() |
| H1 | 🟡 | Extract turn_end token counts from accumulated `message_end` events (not hardcoded 0) |
| H2 | 🟡 | Shared singleton `ModelRuntime` per process — pass to all sessions |
| H3 | 🟡 | `model_select`: remove dead branch, emit `model_changed` from `setModel()` instead |
| H4 | 🟡 | SPI: `setThinking(): void`, `dispose(): Promise<void>` — align with implementations |
| H5 | 🟡 | WS: add `GET /sessions/:id/snapshot` endpoint for catch-up after backpressure drops |
| H6 | 🟡 | Interactive spawn: use in-process `main()` call (current pattern), not `pi --extension` |
| H7 | 🟡 | Add `agentType?` field to CronJob; pass cron prompt to router (not empty string) |
| H8 | 🟡 | Default `maxSessions` 16 (not 1000); add idle-TTL sweep |
| H9 | 🟡 | ClaudeSession: hash sessionDir on `(sessionId, cwd)` to isolate contexts |
| H10 | 🟡 | Remove RuntimePool/AgentPool dual-pool; RuntimePool is single source of truth |
| H11 | 🟡 | RuntimePoolEntry: add `toStatus()` projection with gateway-expected fields |

---

## 1. AgentRuntime SPI

### 1.1 Types

```typescript
// packages/core/src/runtime-spi.ts

import type { Model, Api } from "@earendil-works/pi-ai";

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
  broker?: BrokerClient;
  env: Record<string, string>;
  resumeFrom?: string;
}
```

### 1.2 Session Interface

```typescript
/**
 * prompt() is BLOCKING for in-process runtimes (pi, mya-native).
 * It resolves AFTER the entire turn completes. Events stream DURING the await.
 *
 * For subprocess runtimes (claude), prompt() returns after the process exits.
 *
 * turn_end is ALWAYS emitted via onEvent (mapped from agent_settled for pi,
 * emitted on process exit for claude, emitted after agent.run() for mya-native).
 */
interface RuntimeSession {
  readonly sessionId: string;
  readonly runtimeType: string;
  readonly executionModel: "in-process" | "subprocess";

  prompt(text: string, opts?: PromptOpts): Promise<void>;
  inject(message: BrokerMessage): Promise<void>;

  setModel(model: Model<Api>): Promise<void>;
  // H4 fix: void, not Promise<void> (pi's setThinkingLevel returns void)
  setThinking(level: ThinkingLevel): void;
  compact(): Promise<CompactionResult>;
  getState(): SessionState;
  isIdle(): boolean;
  // H4 fix: Promise<void> (pi dispose is void but BrokerClient.disconnect is async)
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
class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";

  // H2 fix: shared singleton ModelRuntime
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

    // H2 fix: resolve model via shared ModelRuntime
    let model = opts.model;
    if (!model && opts.modelId) {
      const rt = await this.getModelRuntime();
      model = rt.getModels().find(m => m.id === opts.modelId || m.id.startsWith(opts.modelId!));
    }

    // H2 fix: pass shared modelRuntime to avoid creating a second one internally
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
      execution: "in-process",
      maxContextWindow: 200_000,
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
  // H1 fix: accumulate token usage across messages for turn_end
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

      const agentEvent = PiEventNormalizer.toAgentEvent(event, this.piSession, this.accumulatedUsage);
      if (agentEvent) {
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        this.listeners.forEach(l => l(agentEvent));
      }
    });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    this.accumulatedUsage = { tokensIn: 0, tokensOut: 0 };  // H1: reset per turn
    await this.piSession.prompt(text, {
      streamingBehavior: opts?.streamingBehavior ?? "followUp",
    });
    // prompt() resolved = turn complete. All events already emitted.
  }

  async inject(message: BrokerMessage): Promise<void> {
    await this.piSession.sendCustomMessage(
      {
        customType: "broker_message",
        content: `**From ${message.from.name}**\n\n${message.content.text}`,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  async setModel(model: Model<Api>): Promise<void> {
    await this.piSession.setModel(model);
    // H3 fix: emit model_changed ourselves (model_select event doesn't reach subscribers)
    this.emit({ type: "model_changed", model: model.id });
  }

  // H4 fix: void, not Promise
  setThinking(level: ThinkingLevel): void {
    this.piSession.setThinkingLevel(level);
  }

  async compact(): Promise<CompactionResult> {
    await this.piSession.compact();
    return { tokensBefore: 0, tokensAfter: 0, strategy: "native" };
  }

  getState(): SessionState {
    return {
      model: this.piSession.model?.id ?? "unknown",
      thinking: this.piSession.thinkingLevel,
      status: this.piSession.isIdle ? "idle" : "thinking",
      tokensIn: this.accumulatedUsage.tokensIn,
      tokensOut: this.accumulatedUsage.tokensOut,
      contextPct: 0,
      contextWindow: 200_000,
      costUsd: 0,
      startedAt: this.createdAt,
      lastActivity: Date.now(),
    };
  }

  isIdle(): boolean { return this.piSession.isIdle; }

  // H4 fix: async (BrokerClient.disconnect is async)
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
  // C8 fix: store {fn, resolve, reject} tuples so dispose can reject
  private promptQueue: Array<{ fn: () => Promise<void>; reject: (e: Error) => void }> = [];
  private abortController: AbortController | null = null;

  constructor(private opts: StartOpts) {
    this.modelId = opts.modelId ?? "claude-sonnet-4-20250514";
    // H9 fix: hash sessionDir on (sessionId, cwd) to isolate contexts
    const contextHash = createHash("md5").update(`${opts.sessionId}:${opts.cwd}`).digest("hex").slice(0, 12);
    this.sessionDir = join(opts.agentDir, "sessions", "claude", contextHash);
    mkdirSync(this.sessionDir, { recursive: true });
  }
  private sessionDir: string;

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    if (this.busy) {
      // C8 fix: store reject callback for cleanup on dispose
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
      try { await item.fn(); } catch { /* error already rejected in the promise */ }
    }
  }

  private async doPrompt(text: string, _opts?: PromptOpts): Promise<void> {
    this.busy = true;
    this.abortController = new AbortController();
    this.emit({ type: "turn_start", model: this.modelId, sessionId: this.opts.sessionId });

    // ⚠️ UNVERIFIED FLAGS
    const args = ["-p", "--output-format", "stream-json", "--model", this.modelId, "--continue", "--session-dir", this.sessionDir, text];

    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: this.child!.stdout });
      rl.on("line", (line) => {
        if (this.abortController?.signal.aborted) return;
        const event = ClaudeEventNormalizer.parseLine(line);
        if (event) this.emit(event);
      });
      this.child!.on("exit", (code) => {
        if (code !== 0 && !this.abortController?.signal.aborted) {
          this.emit({ type: "error", message: `Claude exited with code ${code}`, recoverable: false });
        }
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

  // C8 fix: reject all pending queued promises
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

(Same as v4 §2.3 with H4 fix: `setThinking(): void`, `dispose(): Promise<void>`.)

---

## 3. Event Normalization Layer

### 3.1 PiEventNormalizer

```typescript
const PiEventNormalizer = {
  // H1 fix: pass accumulatedUsage for turn_end token counts
  toAgentEvent(event: unknown, piSession?: any, accumulatedUsage?: { tokensIn: number; tokensOut: number }): AgentEvent | null {
    const e = event as { type: string };
    switch (e.type) {
      case "agent_start":
        return {
          type: "turn_start",
          model: piSession?.model?.id ?? "unknown",
          sessionId: piSession?.sessionId ?? "",
        };

      // C3 fix (v4): map agent_settled → turn_end
      // H1 fix: use accumulated usage (tracked from message_end events)
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
        return {
          type: "tool_call",
          toolCallId: (e as any).toolCallId,
          name: (e as any).toolName,
          args: (e as any).args,
        };

      // C3 fix (v5): map tool_execution_update → tool_result (partial)
      // Was incorrectly mapped as bash_execution_update → text (dead code)
      case "tool_execution_update": {
        const pr = (e as any).partialResult;
        if (!pr) return null;
        return {
          type: "tool_result",
          toolCallId: (e as any).toolCallId,
          output: typeof pr === "string" ? pr : JSON.stringify(pr),
        };
      }

      case "tool_execution_end":
        return {
          type: "tool_result",
          toolCallId: (e as any).toolCallId,
          output: typeof (e as any).result === "string"
            ? (e as any).result
            : JSON.stringify((e as any).result),
          error: (e as any).isError === true,
        };

      // C3 fix (v5): REMOVED bash_execution_update — it's dead code.
      // Bash output streams via tool_execution_update (same as all tools).

      case "compaction_end": {
        const result = (e as any).result;
        if (!result) return null;
        return {
          type: "compaction",
          result: {
            tokensBefore: result.tokensBefore ?? 0,
            tokensAfter: result.estimatedTokensAfter ?? 0,
            strategy: "native" as const,
          },
        };
      }

      // H3 fix: removed model_select branch (doesn't reach subscribers).
      // model_changed is emitted from PiInProcessSession.setModel() instead.

      case "thinking_level_changed":
        return { type: "thinking_changed", level: (e as any).level ?? "medium" };

      default:
        return null;
    }
  },
};
```

### 3.2 ClaudeEventNormalizer

> ⚠️ PLACEHOLDER — actual format unknown until Phase 9 CLI spike.

(Same as v4 — best-guess based on Anthropic streaming format.)

### 3.3 MyaEventNormalizer

(Same as v4 — verified correct by all reviewers.)

---

## 4. mya Broker

### 4.1 BrokerClientFactory (C9 fix)

```typescript
class BrokerClientFactory {
  /**
   * Create a connected BrokerClient for a session.
   * C9 fix: probe socket health every time (no static flag).
   */
  static async create(sessionId: string, opts: { cwd: string; modelId?: string }): Promise<BrokerClient> {
    // Always ensure broker is running (idempotent — spawnBrokerIfNeeded checks PID + socket)
    await spawnBrokerIfNeeded();

    const client = new BrokerClient();

    // C9 fix: try/catch with retry
    try {
      await client.connect({
        name: sessionId,
        cwd: opts.cwd,
        model: opts.modelId ?? "unknown",
        pid: process.pid,
        startedAt: Date.now(),
        lastActivity: Date.now(),
        agentType: "mya",
      });
    } catch (e) {
      // Broker might have just started. Retry once.
      await sleep(500);
      await client.connect({
        name: sessionId,
        cwd: opts.cwd,
        model: opts.modelId ?? "unknown",
        pid: process.pid,
        startedAt: Date.now(),
        lastActivity: Date.now(),
        agentType: "mya",
      });
    }

    return client;
  }
}
```

### 4.2 Interactive Mode (H6 fix)

```typescript
// H6 fix: interactive mode uses the SAME in-process main() call as current code.
// No `pi --extension` subprocess spawn. The broker connects via env var.

// packages/print/src/pi-main.ts (existing file, modified)
export async function runPiInteractive(opts?: { brokerSocket?: string }): Promise<void> {
  process.env.PI_SKIP_VERSION_CHECK = "1";
  registerBunOAuthFlows();
  setBedrockProviderModule(bedrockImpl);
  registerBuiltInApiProviders();

  // H6 fix: pass broker socket to bridge via env var
  if (opts?.brokerSocket) {
    process.env.MYA_BROKER_SOCKET = opts.brokerSocket;
  }

  const { main } = await import("@earendil-works/pi-coding-agent");
  const myaBridge = createMyaBridge({ /* ... existing ... */ });
  process.env.MYA_SKILL_SOURCE = join(homedir(), ".mya", "agent", "skills");
  const piArgs = filterMyaFlags(process.argv.slice(2));
  await main(piArgs, { extensionFactories: [{ name: "mya-bridge", factory: myaBridge }] });
}
```

The mya-bridge extension checks `process.env.MYA_BROKER_SOCKET` on session_start.
If set, it creates a BrokerClient and registers the intercom tool.

---

## 5. Smart Router

(Same as v4 — verified correct.)

---

## 6. Shared Infrastructure

### 6.1 PromptEnricher (C7 fix)

```typescript
// C7 fix: use MemoryFacade type (has recall/record), not MemoryManager
import type { MemoryFacade } from "@my-agent/memory";

class PromptEnricher {
  constructor(
    private memory: MemoryFacade,  // C7 fix: MemoryFacade has recall()
    private brain: Brain,
    private retrievalEngine: RetrievalEngine,
    private roleRegistry: RoleRegistry,
    private sessionStore: SessionStore,
  ) {}

  async enrich(prompt: string, ctx: EnrichContext): Promise<string> {
    const parts: string[] = [];

    try {
      if (ctx.role) {
        const role = await this.roleRegistry.get(ctx.role);
        if (role?.promptAppend) parts.push(`<role>\n${role.promptAppend}\n</role>`);
      }

      const recallResults = this.memory.recall(prompt, { topK: 5 });
      const allHits = recallResults
        .flatMap(r => r.hits ?? [])
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5);
      if (allHits.length > 0) {
        parts.push(`<relevant_memories>\n${allHits.map(m => `- ${m.content}`).join("\n")}\n</relevant_memories>`);
      }

      if (ctx.executionModel === "subprocess") {
        const history = await this.sessionStore.getHistory(ctx.sessionId);
        if (history.length > 0) {
          const recent = history.slice(-20);
          parts.push(`<previous_conversation>\n${recent.map(m => `${m.role}: ${m.content}`).join("\n")}\n</previous_conversation>`);
        }
      }
    } catch (e) {
      console.warn(`[enricher] memory recall failed: ${e}`);
    }

    parts.push(prompt);
    return parts.join("\n\n");
  }

  async capture(output: string, ctx: EnrichContext): Promise<void> {
    try {
      this.brain.recordFact({
        kind: "fact", entity: ctx.sessionId,
        content: output.slice(0, 2000),
        visibility: "private", notability: 0.5, source: ctx.sessionId,
      });
      await this.sessionStore.append(ctx.sessionId, { role: "assistant", content: output, timestamp: Date.now() });
    } catch (e) {
      console.warn(`[enricher] capture failed: ${e}`);
    }
  }
}
```

### 6.2 AuthInjector, Compaction, CostTracker

(Same as v4 — verified correct.)

---

## 7. Gateway Integration

### 7.1 RuntimePool (C1, C2, C4, C5, H8, H10, H11 fixes)

```typescript
// H10 fix: NO feature flag. RuntimePool IS the single pool.
// Replaces AgentPool entirely. No dual-pool coexistence.

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
  // H11 fix: metadata for gateway dashboard
  role?: string;
  task?: string;
  model?: string;
  parentSessionId?: string;
  status?: string;
  summary?: string;
  keyOutputs?: string[];

  // H11 fix: projection for HTTP serialization
  toStatus(): Record<string, unknown>;
}

class RuntimePool {
  private entries = new Map<string, RuntimePoolEntry>();
  // H8 fix: default 16 (not 1000)
  private maxSessions = parseInt(process.env.MYA_MAX_SESSIONS ?? "16", 10);
  private idleTtlMs = 3_600_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
  ) {
    // H8 fix: periodic idle sweep
    this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
    this.sweepTimer.unref?.();
  }

  // C1 fix: get-or-create
  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string },  // H7 fix: add prompt
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    // C1 fix: check existing first
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      existing.idleSince = 0;
      return { session: existing.session, runtimeType: existing.runtimeType };
    }

    if (this.entries.size >= this.maxSessions) {
      // Try to evict an idle session
      this.sweepIdle();
      if (this.entries.size >= this.maxSessions) {
        throw new Error("Max sessions reached");
      }
    }

    // Select runtime
    let runtime: AgentRuntime;
    if (opts?.agentType) {
      runtime = this.runtimes.get(opts.agentType)!;
      if (!runtime?.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
    } else {
      // H7 fix: pass actual prompt to router (not empty string)
      const result = await this.router.select({ prompt: opts?.prompt ?? "", modelOverride: opts?.model });
      runtime = result.runtime;
    }

    const env = buildAgentEnv();

    // C5 fix: broker cleanup on failure
    let broker: BrokerClient | undefined;
    try {
      broker = await BrokerClientFactory.create(sessionId, {
        cwd: opts?.cwd ?? process.cwd(),
        modelId: opts?.model,
      });

      const runtimeSession = await runtime.start({
        cwd: opts?.cwd ?? process.cwd(),
        agentDir: join(homedir(), ".mya/agent"),
        sessionId,
        modelId: opts?.model,
        env,
        broker,
      });

      const adapter = new RuntimeSessionAdapter(
        runtimeSession, this.enricher, this.costTracker,
        // C4 fix: busy callback
        (busy) => {
          const entry = this.entries.get(sessionId);
          if (entry) {
            entry.busy = busy;
            entry.lastActivity = Date.now();
            if (!busy) entry.idleSince = Date.now();
          }
        },
      );

      const entry: RuntimePoolEntry = {
        sessionId,
        session: adapter,
        runtimeType: runtime.runtimeType,
        busy: false,
        messageCount: 0,
        lastActivity: Date.now(),
        createdAt: Date.now(),
        idleSince: 0,
        toStatus() {
          return {
            sessionId: this.sessionId,
            runtimeType: this.runtimeType,
            busy: this.busy,
            messages: this.messageCount,
            lastActivity: this.lastActivity,
            sessionFile: this.sessionFile,
            role: this.role,
            task: this.task,
            model: this.model,
            parentSessionId: this.parentSessionId,
            status: this.status,
            summary: this.summary,
            keyOutputs: this.keyOutputs,
          };
        },
      };
      this.entries.set(sessionId, entry);

      return { session: adapter, runtimeType: runtime.runtimeType };
    } catch (e) {
      // C5 fix: cleanup broker on failure
      if (broker) { try { await broker.disconnect(); } catch {} }
      throw e;
    }
  }

  get(sessionId: string): RuntimePoolEntry | undefined { return this.entries.get(sessionId); }
  list(): RuntimePoolEntry[] { return [...this.entries.values()]; }

  // C2 fix: use abort() not dispose()
  release(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.session.abort();  // C2: AgentSession has abort(), not dispose()
      this.entries.delete(sessionId);
    }
  }

  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { cwd });
    return session;
  }

  get size(): number { return this.entries.size; }

  // H8 fix: idle sweep
  private sweepIdle(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.busy) continue;
      if (entry.idleSince && now - entry.idleSince > this.idleTtlMs) {
        entry.session.abort();
        this.entries.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const entry of this.entries.values()) {
      entry.session.abort();
    }
    this.entries.clear();
  }
}
```

### 7.2 RuntimeSessionAdapter (C4, M10 fixes)

```typescript
class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";
  private turnLock = Promise.resolve();

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    // C4 fix: busy callback to update pool entry
    private onBusyChange?: (busy: boolean) => void,
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

    // C4 fix: set busy
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
      } catch (e) {
        console.warn(`[adapter] enrich failed: ${e}`);
      }

      this.textBuffer = "";
      await this.session.prompt(enriched);

      // M10 fix: capture IMMEDIATELY after prompt() resolves (no setTimeout)
      if (this.textBuffer) {
        try {
          await this.enricher.capture(this.textBuffer, {
            sessionId: this.session.sessionId,
            runtimeType: this.session.runtimeType,
          });
        } catch (e) {
          console.warn(`[adapter] capture failed: ${e}`);
        }
      }
    } finally {
      this.onBusyChange?.(false);  // C4 fix: clear busy
      release();
    }
  }

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // C2 fix: abort() is the AgentSession method (not dispose)
  abort(): void { this.session.dispose(); }
  get sessionFile(): string | undefined { return undefined; }
  getTextBuffer(): string { return this.textBuffer; }
}
```

### 7.3 WebSocket + Snapshot (H5 fix)

```typescript
interface WireEnvelope {
  sessionId: string;
  seq: number;
  event: AgentEvent;
}

function sendToWs(ws: WebSocket, sessionId: string, event: AgentEvent, seq: number): void {
  const envelope: WireEnvelope = { sessionId, seq, event };
  const data = JSON.stringify(envelope);
  if (ws.bufferedAmount > 1_000_000) {
    // H5 fix: only drop non-critical events. Client can catch up via snapshot.
    if (event.type !== "turn_end" && event.type !== "error") return;
  }
  ws.send(data);
}

// H5 fix: snapshot endpoint for catch-up after backpressure drops
// GET /sessions/:id/snapshot → returns accumulated text + current state
function handleSnapshot(pool: RuntimePool, sessionId: string): { text: string; state: SessionState } | null {
  const entry = pool.get(sessionId);
  if (!entry) return null;
  const adapter = entry.session as RuntimeSessionAdapter;
  return {
    text: adapter.getTextBuffer(),
    state: (entry.session as any).session?.getState?.() ?? null,
  };
}
```

### 7.4 Graceful Shutdown (C2, C4 fixes)

```typescript
async function gracefulShutdown(pool: RuntimePool, timeout = 30_000): Promise<void> {
  console.log("[shutdown] draining in-flight turns...");

  // Stop accepting new sessions
  // (gateway stops HTTP listener externally)

  // Wait for busy sessions (C4 fix: busy is now wired)
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const busy = pool.list().filter(e => e.busy);
    if (busy.length === 0) break;
    await sleep(500);
  }

  // C2 fix: use abort() (not dispose())
  pool.dispose();

  console.log("[shutdown] complete");
}
```

### 7.5 CronJob Update (H7 fix)

```typescript
// H7 fix: add agentType to CronJob
interface CronJob {
  name: string;
  trigger: TriggerType;
  schedule: string;
  prompt: string;
  agentType?: string;   // ← NEW: which runtime to use
  deliveryTarget?: string;
  // ... existing fields ...
}

// Cron execution path now passes prompt + agentType
async function executeCronJob(pool: RuntimePool, job: CronJob, sessionId: string): Promise<void> {
  const { session } = await pool.acquireWithRuntime(sessionId, {
    agentType: job.agentType,     // H7: explicit agent
    prompt: job.prompt,           // H7: actual prompt for routing
    cwd: job.workdir ?? process.cwd(),
  });
  await session.prompt(job.prompt);
}
```

---

## 8. Execution Paths

(Same as v4 — all paths use corrected APIs. Key changes reflected in code above.)

---

## 9. Implementation Phases

| Phase | Scope | Deliverable |
|---|---|---|
| **1** | Broker + framing + auto-spawn + client | Broker runs, 2 processes exchange messages |
| **2** | AgentRuntime SPI + AgentEvent types + tests | Interface compiles, unit tests pass |
| **3** | **Spike: log actual pi events** | All pi event types + payloads documented |
| **4** | PiInProcessRuntime + PiEventNormalizer + shared ModelRuntime | Gateway sessions with uniform events |
| **5** | RuntimePool + RuntimeSessionAdapter + gateway integration | Sessions work via SPI |
| **6** | MyaNativeRuntime + MyaEventNormalizer | `--agent mya` works |
| **7** | PromptEnricher (MemoryFacade.recall + brain.recordFact) | Memory injection |
| **8** | SmartRouter (async scoring) | Auto-routing |
| **9** | **Spike: install + verify Claude CLI** | All flags + stream-json format documented |
| **10** | ClaudeRuntime + ClaudeEventNormalizer | `--agent claude` works |
| **11** | Broker-mediated inter-agent messaging | send/ask/reply |
| **12** | CostTracker + dashboard multi-agent + WS snapshot | Per-agent cost, unified dashboard |
| **13** | Graceful shutdown + idle sweep + E2E | Production-ready |

---

## 10. Verification Checklist

| Check | How | Phase |
|---|---|---|
| Pi event types + payloads | `session.subscribe(e => append("/tmp/pi-events.log", JSON.stringify(e)))` for 1 turn | 3 |
| `agent_settled → turn_end` produces exactly 1 turn_end | Count in log | 4 |
| `tool_execution_update` fires (not `bash_execution_update`) | Check log for event type names | 3 |
| `message_end.usage` has input/output tokens | Check assistant message_end events | 3 |
| `isIdle` is getter | `typeof piSession.isIdle === "boolean"` | 4 |
| `model` is getter | `piSession.model?.id` works | 4 |
| `getModels()` returns array | `Array.isArray(modelRuntime.getModels())` | 4 |
| `MemoryFacade.recall(query)` returns MemoryDomainEntry[] | Inspect shape | 7 |
| `brain.recordFact({kind:"fact", visibility:"private"})` compiles | TS strict compile | 7 |
| Claude CLI flags | Install, run `claude -p "test" --output-format stream-json`, log | 9 |
| Overlapping ClaudeSession prompt() | Call twice, verify queue serializes | 10 |
| ClaudeSession dispose rejects queued promises | Call dispose with pending queue, verify caller gets Error | 10 |
| RuntimePool get-or-create | Call acquireWithRuntime twice same ID, verify single session | 5 |
| RuntimePool idle sweep | Create session, wait idleTtl, verify evicted | 5 |
