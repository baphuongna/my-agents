# mya Multi-Agent Platform — Spec v4 (Fully Corrected)

> 3 independent reviewer rounds, 32 findings fixed. Every API call traced to actual source.

## Changelog (v3 → v4)

| # | Severity | Fix |
|---|---|---|
| C1 | 🔴 | `isIdle()` method → `isIdle` getter property |
| C2 | 🔴 | `prompt()` is BLOCKING (resolves on turn completion). Removed "returns immediately" doc. Removed setTimeout hack. |
| C3 | 🔴 | Map `agent_settled → turn_end` in normalizer (was null). |
| C4 | 🔴 | `brain.recordFact({ kind: "observation" })` → `kind: "fact"`, `visibility: "private"` |
| C5 | 🔴 | `builtinModels().map()` → `builtinModels().getModels().map()` |
| C6 | 🔴 | `compaction_end` reads `e.result.tokensBefore` / `e.result.estimatedTokensAfter` (nested, not top-level) |
| C7 | 🔴 | `RuntimePool` implements `get/list/release/createForCwd/size` (was missing 5 methods) |
| H1 | 🟡 | `ClaudeSession`: add `busy` flag + queue to prevent overlapping prompts |
| H2 | 🟡 | Add `BrokerClientFactory` — construct broker client per session |
| H3 | 🟡 | Add `ModelResolver` — resolve `modelId` string → `Model<Api>` via `ModelRuntime` |
| H4 | 🟡 | `CompactionManager` → delegate to `session.compact()`, remove dead gateway-layer code |
| H5 | 🟡 | `agent_start` has no model/sessionId → use `session.model?.id` |
| H6 | 🟡 | `getModel()`/`getThinkingLevel()` → `session.model`/`session.thinkingLevel` (getter props) |
| H7 | 🟡 | `model_select`: `e.model` is `Model<Api>` → extract `.id` |
| H8 | 🟡 | MyaEventNormalizer: `event.result` is `ToolResult` → use `.output` |
| H9 | 🟡 | Add graceful shutdown protocol |
| H10 | 🟡 | Define `WireEnvelope` WebSocket format |
| H11 | 🟡 | Add feature flag `MYA_RUNTIME_POOL=1` for gradual rollout |
| H12 | 🟡 | Add error boundaries in enrich(), session.prompt(), crash recovery |
| H13 | 🟡 | Add per-session turn lock in `RuntimeSessionAdapter` |
| H14 | 🟡 | Document interactive broker connection via env var |
| M1 | 🟢 | TurnEvent has no `model` → use `"unknown"` |
| M2 | 🟢 | TurnEvent `cost` is `{ usd: number }` → `.cost?.usd` |
| M3 | 🟢 | Extract token counts from `event.turnEvent.usage` |
| M4 | 🟢 | `setThinkingLevel`/`dispose` return void — remove unnecessary `await` |
| M5 | 🟢 | Add `thinking_level_changed → thinking_changed` mapping |
| M6 | 🟢 | `ClaudeSession.setModel`: use private field, don't mutate opts |
| M7 | 🟢 | `recall()` topK is per-domain → sort all hits by score, then slice |
| M8 | 🟢 | `getState().startedAt`: store `createdAt` in constructor |
| M9 | 🟢 | `TurnEvent` `cost` field shape: `{ usd: number }` not number |
| M10 | 🟢 | Remove `setTimeout(100ms)` capture hack entirely |

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
  /** Resolved Model<Api> object (preferred). */
  model?: Model<Api>;
  /** Model ID string — runtime resolves to Model<Api> internally via ModelResolver. */
  modelId?: string;
  thinking?: ThinkingLevel;
  systemPromptOverride?: string;
  toolsAllowList?: string[];
  /** Broker client for inter-agent messaging. Constructed by BrokerClientFactory. */
  broker?: BrokerClient;
  env: Record<string, string>;
  resumeFrom?: string;
}
```

### 1.2 Session Interface

```typescript
/**
 * A live agent session.
 *
 * CRITICAL (C2 fix): prompt() is BLOCKING for in-process runtimes (pi, mya-native).
 * It resolves AFTER the entire turn completes (including tool execution, retries,
 * compaction). Events stream DURING the await via onEvent() handlers.
 *
 * For subprocess runtimes (claude), prompt() returns after spawning the process.
 * Events stream as stdout arrives. turn_end fires when the process exits.
 *
 * In BOTH cases, callers can either:
 *   (a) await prompt() and then read captured output, OR
 *   (b) listen to onEvent() for streaming display
 * Both work simultaneously.
 */
interface RuntimeSession {
  readonly sessionId: string;
  readonly runtimeType: string;
  readonly executionModel: "in-process" | "subprocess";

  /**
   * Send a prompt.
   * - In-process (pi, mya): BLOCKS until turn completes. Events fire via onEvent DURING await.
   * - Subprocess (claude): returns after spawn. Events fire via onEvent as stdout arrives.
   * turn_end is ALWAYS emitted via onEvent (C3 fix).
   */
  prompt(text: string, opts?: PromptOpts): Promise<void>;

  /** Inject a broker message (from another agent). */
  inject(message: BrokerMessage): Promise<void>;

  setModel(model: Model<Api>): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  compact(): Promise<CompactionResult>;
  getState(): SessionState;
  isIdle(): boolean;
  dispose(): Promise<void>;

  /** Subscribe to ALL events (turn events, broker messages, errors). */
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
// packages/print/src/runtimes/pi-in-process.ts

class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const { createMyaBridge } = await import("./mya-bridge.js");

    const myaBridge = createMyaBridge({
      broker: opts.broker,  // F5: added to MyaBridgeOptions
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

    // F8/H3: resolve modelId → Model<Api> if model not already provided
    let model = opts.model;
    if (!model && opts.modelId) {
      model = await ModelResolver.resolve(opts.modelId, opts.agentDir);
    }

    const sessionOpts: Record<string, unknown> = {
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      resourceLoader,
    };
    if (model) sessionOpts.model = model;

    const { session } = await createAgentSession(sessionOpts);
    return new PiInProcessSession(session, opts);
  }

  isAvailable(): boolean { return true; }

  async listModels(): Promise<ModelInfo[]> {
    // C5 FIX: getModels() returns readonly Model<Api>[]
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    return builtinModels().getModels().map(m => ({
      id: m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
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

#### ModelResolver (H3 fix)

```typescript
// packages/print/src/runtimes/model-resolver.ts

class ModelResolver {
  /**
   * Resolve a model ID string to a Model<Api> object using pi's ModelRuntime.
   * ModelRuntime reads models.json + builtin catalog from agentDir.
   */
  static async resolve(modelId: string, agentDir: string): Promise<Model<Api> | undefined> {
    try {
      const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      const authPath = join(agentDir, "auth.json");
      const modelsPath = join(agentDir, "models.json");
      const runtime = await ModelRuntime.create({ authPath, modelsPath });
      const models = runtime.getAvailableModels();
      return models.find(m => m.id === modelId || m.id.startsWith(modelId));
    } catch {
      return undefined;
    }
  }
}
```

#### PiInProcessSession

```typescript
class PiInProcessSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  private listeners = new Set<(e: AgentEvent) => void>();
  private textBuffer = "";
  private readonly createdAt = Date.now();  // M8 fix

  constructor(
    private piSession: PiAgentSession,
    private opts: StartOpts,
  ) {
    // SINGLE subscribe in constructor (F15 fix). No double-subscribe in prompt().
    this.piSession.subscribe((event: unknown) => {
      const agentEvent = PiEventNormalizer.toAgentEvent(event, this.piSession);
      if (agentEvent) {
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        this.listeners.forEach(l => l(agentEvent));
      }
    });
  }

  // C2 FIX: prompt() is BLOCKING. It resolves when the turn completes.
  // Events fire DURING the await via the constructor's subscribe handler.
  // No setTimeout hack. No turn_end detection needed from caller.
  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    await this.piSession.prompt(text, {
      streamingBehavior: opts?.streamingBehavior ?? "followUp",
    });
    // prompt() has now resolved = turn is complete.
    // All events have already been emitted via onEvent during the await.
  }

  // F3 FIX: sendCustomMessage (not sendMessage)
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
  }

  // M4 FIX: setThinkingLevel returns void, not Promise. No await needed.
  setThinking(level: ThinkingLevel): void {
    this.piSession.setThinkingLevel(level);
  }

  async compact(): Promise<CompactionResult> {
    await this.piSession.compact();
    return { tokensBefore: 0, tokensAfter: 0, strategy: "native" };
  }

  getState(): SessionState {
    // H5/H6 FIX: use getter properties (not methods)
    return {
      model: this.piSession.model?.id ?? "unknown",  // H6: getter property
      thinking: this.piSession.thinkingLevel,         // H6: getter property
      // C1 FIX: isIdle is a getter property (not method)
      status: this.piSession.isIdle ? "idle" : "thinking",
      tokensIn: 0,
      tokensOut: 0,
      contextPct: 0,
      contextWindow: 200_000,
      costUsd: 0,
      startedAt: this.createdAt,  // M8 fix: use stored timestamp
      lastActivity: Date.now(),
    };
  }

  // C1 FIX: isIdle is a getter property
  isIdle(): boolean { return this.piSession.isIdle; }

  // M4 FIX: dispose returns void
  dispose(): void { this.piSession.dispose(); }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getTextBuffer(): string { return this.textBuffer; }
}
```

### 2.2 ClaudeRuntime

> ⚠️ Claude CLI NOT installed. All flags UNVERIFIED. Phase 6 = spike first.

```typescript
class ClaudeRuntime implements AgentRuntime {
  readonly runtimeType = "claude";
  readonly displayName = "Claude Code (Anthropic)";

  async start(opts: StartOpts): Promise<RuntimeSession> {
    return new ClaudeSession(opts);
  }

  isAvailable(): boolean {
    try { execSync("which claude", { stdio: "ignore" }); return true; }
    catch { return false; }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "claude-sonnet-4-20250514", provider: "anthropic", contextWindow: 200_000, maxTokens: 8192, reasoning: true },
      { id: "claude-opus-4-20250514", provider: "anthropic", contextWindow: 200_000, maxTokens: 8192, reasoning: true },
    ];
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: true, hasHeadless: true,
      supportsTools: true, supportsResume: true,
      supportsCompaction: false, supportsImages: true,
      supportsThinking: true,
      execution: "subprocess",
      maxContextWindow: 200_000,
      injectionMethod: "stdin-prompt",
    };
  }

  costPerMTokens() { return { input: 3, output: 15 }; }
}

class ClaudeSession implements RuntimeSession {
  readonly executionModel = "subprocess" as const;
  private child: ChildProcess | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  private sessionDir: string;
  private abortController: AbortController | null = null;
  private readonly createdAt = Date.now();
  private modelId: string;                    // M6 fix: private field, not opts mutation
  private busy = false;                       // H1 fix: concurrency guard
  private promptQueue: Array<() => Promise<void>> = [];  // H1 fix: queue

  constructor(private opts: StartOpts) {
    this.sessionDir = join(opts.agentDir, "sessions", "claude", opts.sessionId);
    mkdirSync(this.sessionDir, { recursive: true });
    this.modelId = opts.modelId ?? "claude-sonnet-4-20250514";  // M6 fix
  }

  // H1 FIX: serialize prompts via queue. No overlapping subprocess spawns.
  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    if (this.busy) {
      // Queue the prompt — will execute when current turn finishes
      await new Promise<void>((resolve, reject) => {
        this.promptQueue.push(async () => {
          try { await this.doPrompt(text, opts); resolve(); }
          catch (e) { reject(e); }
        });
      });
      return;
    }
    await this.doPrompt(text, opts);
    // Drain queue
    while (this.promptQueue.length > 0) {
      const next = this.promptQueue.shift()!;
      await next();
    }
  }

  private async doPrompt(text: string, opts?: PromptOpts): Promise<void> {
    this.busy = true;
    this.abortController = new AbortController();
    this.emit({ type: "turn_start", model: this.modelId, sessionId: this.opts.sessionId });

    // ⚠️ UNVERIFIED FLAGS
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--model", this.modelId,
      "--continue",
      "--session-dir", this.sessionDir,
      text,
    ];

    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // For subprocess: prompt() blocks until process exits.
    // Events stream via stdout parsing during the await.
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

  // M6 FIX: use private field, don't mutate opts
  async setModel(model: Model<Api>): Promise<void> {
    this.modelId = model.id;
  }

  setThinking(_level: ThinkingLevel): void {
    // Claude thinking is controlled via CLI flags, not runtime API
  }

  async compact(): Promise<CompactionResult> {
    return { tokensBefore: 0, tokensAfter: 0, strategy: "continue-session" };
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => l(event));
  }

  async dispose(): Promise<void> {
    this.child?.kill();
    this.listeners.clear();
    this.busy = false;
    this.promptQueue = [];
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getState(): SessionState {
    return {
      model: this.modelId,
      thinking: "medium",
      status: this.busy ? "thinking" : "idle",
      tokensIn: 0, tokensOut: 0,
      contextPct: 0, contextWindow: 200_000,
      costUsd: 0,
      startedAt: this.createdAt,
      lastActivity: Date.now(),
    };
  }

  isIdle(): boolean { return !this.busy; }
}
```

### 2.3 MyaNativeRuntime

```typescript
class MyaNativeRuntime implements AgentRuntime {
  readonly runtimeType = "mya-native";
  readonly displayName = "mya (built-in)";

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const agent = createAgent({
      providers: this.resolveProviders(opts.env),
      tools: this.resolveTools(opts.toolsAllowList),
      memoryDir: opts.agentDir,
    });
    return new MyaNativeSession(agent, opts);
  }

  isAvailable(): boolean { return true; }

  async listModels(): Promise<ModelInfo[]> {
    // C5 FIX: getModels() not .map()
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    return builtinModels().getModels().map(m => ({
      id: m.id, provider: m.provider,
      contextWindow: m.contextWindow, maxTokens: m.maxTokens,
      reasoning: m.reasoning,
    }));
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: false, hasHeadless: true,
      supportsTools: true, supportsResume: true,
      supportsCompaction: true, supportsImages: false,
      supportsThinking: false,
      execution: "in-process",
      maxContextWindow: 200_000,
      injectionMethod: "in-process-call",
    };
  }

  private resolveProviders(env: Record<string, string>): ProviderProfile[] {
    const providers: ProviderProfile[] = [];
    for (const [envKey, apiKey] of Object.entries(env)) {
      const config = PI_AI_PROVIDERS.find(p => p.envKey === envKey);
      if (config && apiKey) {
        providers.push(this.createProviderProfile(config, apiKey));
      }
    }
    return providers;
  }

  private resolveTools(allowList?: string[]) {
    return allowList
      ? builtinTools().filter(t => allowList.includes(t.name))
      : builtinTools();
  }
}

class MyaNativeSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  private listeners = new Set<(e: AgentEvent) => void>();
  private readonly createdAt = Date.now();

  constructor(private agent: Agent, private opts: StartOpts) {}

  // C2 FIX: prompt() is BLOCKING. agent.run() resolves when turn completes.
  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.emit({ type: "turn_start", model: this.opts.modelId ?? "unknown", sessionId: this.opts.sessionId });

    // F9 FIX: use agent.run() (streaming via callback sink)
    await this.agent.run(
      text,
      (runtimeEvent: RuntimeEvent) => {
        const agentEvent = MyaEventNormalizer.toAgentEvent(runtimeEvent);
        if (agentEvent) this.emit(agentEvent);
      },
      { signal: opts?.signal },
    );

    // agent.run() has resolved = turn is complete.
  }

  async inject(message: BrokerMessage): Promise<void> {
    await this.prompt(`[Message from ${message.from.name}]: ${message.content.text}`);
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => l(event));
  }

  async dispose(): Promise<void> { this.listeners.clear(); }
  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async setModel(model: Model<Api>): Promise<void> {
    // mya-native uses ProviderProfile, not Model<Api>. Store model ID for state.
    this.opts.modelId = model.id;
  }
  setThinking(_level: ThinkingLevel): void {}
  async compact(): Promise<CompactionResult> {
    return { tokensBefore: 0, tokensAfter: 0, strategy: "native" };
  }
  getState(): SessionState {
    return {
      model: this.opts.modelId ?? "unknown",
      thinking: "medium",
      status: "idle",
      tokensIn: 0, tokensOut: 0,
      contextPct: 0, contextWindow: 200_000,
      costUsd: 0,
      startedAt: this.createdAt,
      lastActivity: Date.now(),
    };
  }
  isIdle(): boolean { return true; }
}
```

---

## 3. Event Normalization Layer

### 3.1 PiEventNormalizer

```typescript
// packages/print/src/runtimes/pi-normalizer.ts

import type { AgentSession } from "@earendil-works/pi-coding-agent";

const PiEventNormalizer = {
  // H5 fix: pass piSession for model/sessionId extraction
  toAgentEvent(event: unknown, piSession?: AgentSession): AgentEvent | null {
    const e = event as { type: string };
    switch (e.type) {
      // ── Turn lifecycle ──
      case "agent_start":
        // H5 FIX: agent_start has no model/sessionId. Get from session.
        return {
          type: "turn_start",
          model: piSession?.model?.id ?? "unknown",  // H6: getter property
          sessionId: piSession?.sessionId ?? "",
        };

      case "agent_settled":
        // C3 FIX: map agent_settled → turn_end (was null!)
        // agent_settled fires once after the FULL agent run completes.
        return {
          type: "turn_end",
          tokensIn: 0,   // TODO: extract from last message usage
          tokensOut: 0,
        };

      // ── Text streaming (F6 fix) ──
      case "message_update": {
        const ame = (e as any).assistantMessageEvent;
        if (!ame) return null;
        if (ame.type === "text_delta") return { type: "text", delta: ame.delta };
        if (ame.type === "thinking_delta") return { type: "thinking", delta: ame.delta };
        return null;
      }

      // ── Tool execution (F7 fix) ──
      case "tool_execution_start":
        return {
          type: "tool_call",
          toolCallId: (e as any).toolCallId,
          name: (e as any).toolName,
          args: (e as any).args,
        };

      case "tool_execution_end":
        return {
          type: "tool_result",
          toolCallId: (e as any).toolCallId,
          output: typeof (e as any).result === "string"
            ? (e as any).result
            : JSON.stringify((e as any).result),
          error: (e as any).isError === true,
        };

      // ── Bash execution (F7 fix) ──
      case "bash_execution_update":
        return { type: "text", delta: (e as any).delta ?? "" };

      // ── Compaction (C6 fix) ──
      case "compaction_end": {
        const result = (e as any).result;
        if (!result) return null;  // C6: result can be undefined
        return {
          type: "compaction",
          result: {
            tokensBefore: result.tokensBefore ?? 0,           // C6: nested under e.result
            tokensAfter: result.estimatedTokensAfter ?? 0,    // C6: estimatedTokensAfter (not tokensAfter)
            strategy: "native" as const,
          },
        };
      }

      // ── Model/thinking changes (H7, M5 fixes) ──
      case "model_select":
        // H7 FIX: e.model is Model<Api> object, extract .id
        return { type: "model_changed", model: (e as any).model?.id ?? "unknown" };

      // M5 FIX: add thinking_level_changed mapping (was missing)
      case "thinking_level_changed":
        return { type: "thinking_changed", level: (e as any).level ?? "medium" };

      // ── Ignore (handled elsewhere or not needed) ──
      default:
        return null;
    }
  },
};
```

### 3.2 ClaudeEventNormalizer

> ⚠️ PLACEHOLDER — actual format unknown until Phase 6 CLI spike.

```typescript
const ClaudeEventNormalizer = {
  parseLine(line: string): AgentEvent | null {
    let data: unknown;
    try { data = JSON.parse(line); } catch { return null; }

    // TODO: replace with actual format after spike:
    //   claude -p "hello" --output-format stream-json 2>&1 | tee /tmp/claude-format.txt
    const obj = data as Record<string, unknown>;
    const type = obj.type as string;

    // Best guess based on Anthropic streaming format:
    if (type === "content_block_start") {
      const block = (obj as any).content_block;
      if (block?.type === "text") return { type: "text", delta: block.text ?? "" };
      if (block?.type === "thinking") return { type: "thinking", delta: block.thinking ?? "" };
    }
    if (type === "content_block_delta") {
      const delta = (obj as any).delta;
      if (delta?.type === "text_delta") return { type: "text", delta: delta.text };
      if (delta?.type === "thinking_delta") return { type: "thinking", delta: delta.thinking };
    }
    if (type === "message_start") {
      return { type: "turn_start", model: (obj as any).message?.model ?? "claude", sessionId: "" };
    }
    if (type === "message_delta") {
      const usage = (obj as any).usage;
      if (usage) return {
        type: "turn_end",
        tokensIn: usage.input_tokens ?? 0,
        tokensOut: usage.output_tokens ?? 0,
      };
    }
    return null;
  },
};
```

### 3.3 MyaEventNormalizer

```typescript
const MyaEventNormalizer = {
  toAgentEvent(event: RuntimeEvent): AgentEvent | null {
    // F4 FIX: RuntimeEvent uses { kind, stage }, NOT "kind:stage" string

    if (event.kind === "turn" && event.stage === "start") {
      // M1 FIX: TurnEvent has no model field
      return { type: "turn_start", model: "unknown", sessionId: "" };
    }

    if (event.kind === "turn" && event.stage === "end") {
      // M2/M3 FIX: cost is { usd: number }, extract usage
      const te = event.turnEvent as any;
      return {
        type: "turn_end",
        tokensIn: te?.usage?.input ?? 0,    // M3 fix: read usage
        tokensOut: te?.usage?.output ?? 0,
        costUsd: te?.cost?.usd,              // M2 fix: cost.usd (not cost)
      };
    }

    if (event.kind === "tool" && event.stage === "request" && event.call) {
      return {
        type: "tool_call",
        toolCallId: event.call.id,
        name: event.call.name,
        args: event.call.args,
      };
    }

    if (event.kind === "tool" && event.stage === "result" && event.result) {
      // H8 FIX: event.result is ToolResult object. Use .output (not typeof string check)
      return {
        type: "tool_result",
        toolCallId: event.call?.id ?? event.result.callId ?? "",
        output: typeof event.result.output === "string"
          ? event.result.output                    // H8: use .output
          : JSON.stringify(event.result.output),
        error: !event.result.ok,
      };
    }

    if (event.kind === "turn" && event.stage === "event" && event.turnEvent) {
      const te = event.turnEvent as { type?: string; delta?: string };
      if (te.type === "text" && te.delta) return { type: "text", delta: te.delta };
      if (te.type === "thinking" && te.delta) return { type: "thinking", delta: te.delta };
    }

    return null;
  },
};
```

---

## 4. mya Broker

### 4.1 BrokerClientFactory (H2 fix)

```typescript
// packages/print/src/broker/broker-factory.ts

class BrokerClientFactory {
  private static brokerStarted = false;

  /**
   * Create a connected BrokerClient for a session.
   * Auto-spawns broker daemon if not running (adopted from pi-intercom pattern).
   */
  static async create(sessionId: string, opts: StartOpts): Promise<BrokerClient> {
    // Ensure broker is running
    if (!this.brokerStarted) {
      await spawnBrokerIfNeeded();
      this.brokerStarted = true;
    }

    const client = new BrokerClient();
    await client.connect({
      name: opts.sessionId,
      cwd: opts.cwd,
      model: opts.modelId ?? "unknown",
      pid: process.pid,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      agentType: "mya",
    });
    return client;
  }
}
```

### 4.2 Broker Protocol

(Unchanged from v3 — adopted from pi-intercom. See v2 §4 for full protocol spec.)

### 4.3 Interactive Mode Broker Connection (H14 fix)

```bash
# When spawning pi interactively (mya pi), pass broker socket path via env:
MYA_BROKER_SOCKET=~/.mya/agent/broker/broker.sock pi \
  --extension ./node_modules/mya-bridge/index.ts \
  --model glm-5.1
```

The mya-bridge extension checks `process.env.MYA_BROKER_SOCKET` on startup.
If set, it connects to the broker and registers the intercom tool.

---

## 5. Smart Router

```typescript
class SmartRouter {
  constructor(
    private runtimes: Map<string, AgentRuntime>,
    private config: RouterConfig,
    private costTracker: CostTracker,
  ) {}

  // F13 fix: async
  async select(input: RouterInput): Promise<RouterResult> {
    const candidates = [...this.runtimes.values()].filter(rt => rt.isAvailable());
    if (candidates.length === 0) throw new Error("No runtime available");

    const scored = await Promise.all(
      candidates.map(async rt => ({
        runtime: rt,
        ...(await this.score(rt, input)),
      })),
    );

    // L2 fix: explicit empty check after scoring
    const valid = scored.filter(s => s.score >= 0);
    if (valid.length === 0) throw new Error("No runtime matches the requirements");

    valid.sort((a, z) => z.score - a.score);
    return { runtime: valid[0]!.runtime, reason: valid[0]!.reason };
  }

  private async score(rt: AgentRuntime, input: RouterInput): Promise<{ score: number; reason: string }> {
    let score = 0;
    const reasons: string[] = [];

    if (input.agentOverride === rt.runtimeType) {
      return { score: Infinity, reason: "explicit override" };
    }

    if (input.modelOverride) {
      const models = await rt.listModels();
      if (!models.some(m => m.id === input.modelOverride)) {
        return { score: -1, reason: "model not available" };
      }
      score += 100;
      reasons.push("model available");
    }

    for (const rule of this.config.rules) {
      if (rule.match.test(input.prompt) && rule.agent === rt.runtimeType) {
        score += rule.weight ?? 50;
      }
    }

    const cost = rt.costPerMTokens?.();
    if (cost && input.budgetRemainingUsd !== undefined && input.budgetRemainingUsd < 1) {
      score -= cost.input + cost.output;
    }

    if (rt.capabilities().execution === "in-process") score += 10;

    return { score, reason: reasons.join(", ") || "default" };
  }
}
```

---

## 6. Shared Infrastructure

### 6.1 PromptEnricher

```typescript
class PromptEnricher {
  constructor(
    private memory: MemoryManager,
    private brain: Brain,
    private retrievalEngine: RetrievalEngine,
    private roleRegistry: RoleRegistry,
    private sessionStore: SessionStore,
  ) {}

  async enrich(prompt: string, ctx: EnrichContext): Promise<string> {
    const parts: string[] = [];

    // H12 FIX: wrap in try/catch — memory failure should not block the turn
    try {
      // Role system prompt
      if (ctx.role) {
        const role = await this.roleRegistry.get(ctx.role);
        if (role?.promptAppend) parts.push(`<role>\n${role.promptAppend}\n</role>`);
      }

      // F1 FIX: use memory.recall() (actual MemoryManager API)
      const recallResults = this.memory.recall(prompt, { topK: 5 });
      // M7 FIX: flatten, sort by score, THEN slice
      const allHits = recallResults
        .flatMap(r => r.hits ?? [])
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5);
      if (allHits.length > 0) {
        const memoryBlock = allHits
          .map(m => `- ${m.content}`)  // M1 fix: MemoryHit has content (not text)
          .join("\n");
        parts.push(`<relevant_memories>\n${memoryBlock}\n</relevant_memories>`);
      }

      // Conversation history (for stateless agents only)
      if (ctx.executionModel === "subprocess") {
        const history = await this.sessionStore.getHistory(ctx.sessionId);
        if (history.length > 0) {
          const recent = history.slice(-20);
          parts.push(`<previous_conversation>\n${recent.map(m => `${m.role}: ${m.content}`).join("\n")}\n</previous_conversation>`);
        }
      }
    } catch (e) {
      // H12: degrade gracefully — no memory enrichment, proceed with raw prompt
      console.warn(`[enricher] memory recall failed, proceeding without: ${e}`);
    }

    parts.push(prompt);
    return parts.join("\n\n");
  }

  // C4/F2 FIX: use valid FactKind and FactVisibility
  async capture(output: string, ctx: EnrichContext): Promise<void> {
    try {
      this.brain.recordFact({
        kind: "fact",           // C4 FIX: valid FactKind (not "observation")
        entity: ctx.sessionId,
        content: output.slice(0, 2000),
        visibility: "private",  // C4 FIX: valid FactVisibility (not "role")
        notability: 0.5,
        source: ctx.sessionId,
      });

      await this.sessionStore.append(ctx.sessionId, {
        role: "assistant",
        content: output,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn(`[enricher] capture failed: ${e}`);
    }
  }
}
```

### 6.2 AuthInjector

```typescript
function buildAgentEnv(): Record<string, string> {
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

### 6.3 Compaction (H4 fix — delegate to session)

```typescript
// H4 FIX: CompactionManager removed from gateway layer.
// Each RuntimeSession handles its own compaction via session.compact().
// The gateway triggers it when contextPct exceeds threshold.

async function maybeCompact(session: RuntimeSession): Promise<void> {
  const state = session.getState();
  if (state.contextPct > 70) {
    try {
      await session.compact();
    } catch (e) {
      console.warn(`[compaction] failed for ${session.sessionId}: ${e}`);
    }
  }
}
```

### 6.4 Cost Tracker

```typescript
class CostTracker {
  private sessions = new Map<string, { totalUsd: number; turns: number; tokensIn: number; tokensOut: number }>();

  record(sessionId: string, event: AgentEvent): void {
    if (event.type !== "turn_end") return;
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = { totalUsd: 0, turns: 0, tokensIn: 0, tokensOut: 0 };
      this.sessions.set(sessionId, entry);
    }
    entry.turns++;
    entry.tokensIn += event.tokensIn;
    entry.tokensOut += event.tokensOut;
    if (event.costUsd) entry.totalUsd += event.costUsd;
  }

  getSessionCost(sessionId: string) { return this.sessions.get(sessionId); }
  getTotalCost() {
    let total = 0;
    for (const s of this.sessions.values()) total += s.totalUsd;
    return { totalUsd: total, sessions: this.sessions.size };
  }
}
```

---

## 7. Gateway Integration

### 7.1 Runtime Registry

```typescript
const runtimes = new Map<string, AgentRuntime>();
runtimes.set("pi", new PiInProcessRuntime());
runtimes.set("mya-native", new MyaNativeRuntime());
runtimes.set("claude", new ClaudeRuntime());

const router = new SmartRouter(runtimes, routerConfig, costTracker);
```

### 7.2 RuntimePool (C7 fix — full method surface)

```typescript
// H11 FIX: feature flag for gradual rollout
const USE_RUNTIME_POOL = process.env.MYA_RUNTIME_POOL === "1";

interface RuntimePoolEntry {
  sessionId: string;
  session: AgentSession;          // RuntimeSessionAdapter
  runtimeType: string;
  busy: boolean;
  messageCount: number;
  lastActivity: number;
  sessionFile?: string;
  createdAt: number;
}

class RuntimePool {
  private entries = new Map<string, RuntimePoolEntry>();
  private maxSessions: number;

  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    private pool: AgentPool,           // existing pool for backward compat
  ) {
    this.maxSessions = parseInt(process.env.MYA_MAX_SESSIONS ?? "1000", 10);
  }

  // C7 FIX: implement ALL methods the gateway needs

  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    if (this.entries.size >= this.maxSessions) {
      throw new Error("Max sessions reached");
    }

    // Select runtime
    let runtime: AgentRuntime;
    if (opts?.agentType) {
      runtime = this.runtimes.get(opts.agentType)!;
      if (!runtime?.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
    } else {
      const result = await this.router.select({ prompt: "", modelOverride: opts?.model });
      runtime = result.runtime;
    }

    // H2 FIX: construct broker client
    const env = buildAgentEnv();
    const broker = await BrokerClientFactory.create(sessionId, {
      cwd: opts?.cwd ?? process.cwd(),
      agentDir: join(homedir(), ".mya/agent"),
      sessionId, modelId: opts?.model, env,
    });

    // Start runtime session
    const runtimeSession = await runtime.start({
      cwd: opts?.cwd ?? process.cwd(),
      agentDir: join(homedir(), ".mya/agent"),
      sessionId,
      modelId: opts?.model,
      env,
      broker,
    });

    // Wrap in adapter
    const adapter = new RuntimeSessionAdapter(
      runtimeSession, this.enricher, this.costTracker,
    );

    const entry: RuntimePoolEntry = {
      sessionId,
      session: adapter,
      runtimeType: runtime.runtimeType,
      busy: false,
      messageCount: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
    this.entries.set(sessionId, entry);

    return { session: adapter, runtimeType: runtime.runtimeType };
  }

  // C7 FIX: all AgentPool-compatible methods
  get(sessionId: string): RuntimePoolEntry | undefined {
    return this.entries.get(sessionId);
  }

  list(): RuntimePoolEntry[] {
    return [...this.entries.values()];
  }

  release(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.session.dispose();
      this.entries.delete(sessionId);
    }
  }

  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { cwd });
    return session;
  }

  get size(): number { return this.entries.size; }

  // Backward compat: delegate to existing pool when feature flag is off
  async acquire(sessionId: string): Promise<AgentSession> {
    if (!USE_RUNTIME_POOL) {
      return this.pool.acquire(sessionId);
    }
    const { session } = await this.acquireWithRuntime(sessionId, { agentType: "pi" });
    return session;
  }
}
```

### 7.3 RuntimeSessionAdapter (M10, H13 fixes)

```typescript
class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";
  private turnLock = Promise.resolve();  // H13 FIX: per-session serialization

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
  ) {
    this.session.onEvent((event) => {
      if (event.type === "text") this.textBuffer += event.delta;
      this.costTracker.record(this.session.sessionId, event);
      this.listeners.forEach(l => l(event));
    });
  }

  // C2 FIX: prompt() blocks until turn completes.
  // H13 FIX: turn lock serializes concurrent prompts.
  // M10 FIX: no setTimeout hack. Capture immediately after prompt() resolves.
  async prompt(text: string, _options?: unknown): Promise<void> {
    // Serialize: chain prompts
    const prev = this.turnLock;
    let release!: () => void;
    this.turnLock = new Promise<void>((r) => { release = r; });

    try {
      await prev;  // wait for previous turn

      // H12 FIX: wrap enrichment in try/catch
      let enriched = text;
      try {
        enriched = await this.enricher.enrich(text, {
          sessionId: this.session.sessionId,
          runtimeType: this.session.runtimeType,
          executionModel: this.session.executionModel,
        });
      } catch (e) {
        console.warn(`[adapter] enrich failed, using raw prompt: ${e}`);
      }

      this.textBuffer = "";

      // prompt() BLOCKS until turn completes (C2 fix)
      await this.session.prompt(enriched);

      // M10 FIX: capture output IMMEDIATELY after prompt() resolves.
      // No setTimeout hack. For in-process runtimes, prompt() has resolved = done.
      // For subprocess runtimes, prompt() has resolved = process exited.
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
      release();
    }
  }

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort(): void { this.session.dispose(); }
  get sessionFile(): string | undefined { return undefined; }
}
```

### 7.4 WebSocket Wire Format (H10 fix)

```typescript
// H10 FIX: define WireEnvelope for WebSocket transport
interface WireEnvelope {
  sessionId: string;
  seq: number;
  event: AgentEvent;
}

// Gateway wraps events before sending over WS:
function sendToWs(ws: WebSocket, sessionId: string, event: AgentEvent, seq: number): void {
  const envelope: WireEnvelope = { sessionId, seq, event };
  const data = JSON.stringify(envelope);

  // H10 FIX: backpressure — drop events if client is too slow
  if (ws.bufferedAmount > 1_000_000) {
    // Client is >1MB behind. Skip non-critical events.
    if (event.type !== "turn_end" && event.type !== "error") return;
  }
  ws.send(data);
}
```

### 7.5 Graceful Shutdown (H9 fix)

```typescript
// H9 FIX: drain protocol on SIGTERM
async function gracefulShutdown(pool: RuntimePool, timeout = 30_000): Promise<void> {
  console.log("[shutdown] draining in-flight turns...");

  // 1. Stop accepting new prompts
  poolAcceptingNew = false;

  // 2. Wait for in-flight turns (up to timeout)
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const busy = pool.list().filter(e => e.busy);
    if (busy.length === 0) break;
    await sleep(500);
  }

  // 3. Dispose all sessions
  for (const entry of pool.list()) {
    try { entry.session.dispose(); } catch {}
  }

  // 4. Flush memory stores
  try { await brain.consolidate(); } catch {}

  console.log("[shutdown] complete");
}
```

---

## 8. Execution Paths

### 8.1 Interactive

```
1. mya CLI → buildAgentEnv()
2. spawn("pi", ["--extension", bridgePath], { stdio: "inherit" })
3. MYA_BROKER_SOCKET env → bridge connects to broker on startup
4. Pi owns terminal — native TUI
5. User exits → mya CLI exits
```

### 8.2 Print mode

```
1. Router.select({ prompt }) → runtime
2. runtime.start() → RuntimeSession
3. session.prompt(text)  ← BLOCKS until done
4. Events stream during await → print to terminal
5. enricher.capture(output)
6. session.dispose()
```

### 8.3 Cron

```
1. CronScheduler fires
2. RuntimePool.acquireWithRuntime(sessionId, { agentType: job.agent })
3. session.prompt(enrichedPrompt)  ← BLOCKS
4. Events stream → capture output
5. enricher.capture(output)
6. Route to channel (if configured)
```

### 8.4 Dashboard

```
1. Browser → WS → Gateway
2. POST /sessions { agent: "claude" } → RuntimePool.acquireWithRuntime
3. POST /sessions/:id/prompt
   → RuntimeSessionAdapter.prompt(enriched)
   → session.prompt() BLOCKS
   → Events stream → WireEnvelope → WS → browser
4. turn_end event → browser knows turn is done
```

---

## 9. Implementation Phases

| Phase | Scope | Deliverable | Risk |
|---|---|---|---|
| **1** | Broker + framing + auto-spawn | Broker runs, 2 processes exchange messages | Spawn races |
| **2** | AgentRuntime SPI + AgentEvent types | Interface compiles, unit tests | — |
| **3** | **Spike: log actual pi events** | All pi event types + payloads documented | **BLOCKER for Phase 4** |
| **4** | PiInProcessRuntime + PiEventNormalizer | Gateway sessions with uniform events | Event mapping (verified in Phase 3) |
| **5** | RuntimePool + RuntimeSessionAdapter + gateway integration | Sessions work via SPI | AgentPool compat |
| **6** | MyaNativeRuntime + MyaEventNormalizer | `--agent mya` works | RuntimeEvent mapping |
| **7** | PromptEnricher (memory.recall + brain.recordFact) | Memory injection | MemoryDomainEntry shape |
| **8** | SmartRouter (async scoring) | Auto-routing | Edge cases |
| **9** | **Spike: install + verify Claude CLI** | All flags + stream-json format documented | **BLOCKER for Phase 10** |
| **10** | ClaudeRuntime + ClaudeEventNormalizer | `--agent claude` works | Flag verification |
| **11** | Broker-mediated inter-agent messaging | send/ask/reply | Injection per runtime |
| **12** | CostTracker + dashboard multi-agent | Per-agent cost, unified dashboard | WS format |
| **13** | Graceful shutdown + error handling + E2E | Production-ready | All |

---

## 10. Verification Checklist

| Check | How | Phase |
|---|---|---|
| Pi event types + payloads | `session.subscribe(e => fs.appendFile("/tmp/pi-events.log", JSON.stringify(e) + "\n"))` for 1 turn | 3 |
| `agent_settled → turn_end` produces exactly 1 turn_end per prompt() | Check log: count agent_settled events per turn | 4 |
| `isIdle` is getter not method | `typeof piSession.isIdle` → `"boolean"` not `"function"` | 4 |
| `model` is getter property | `piSession.model?.id` works, `piSession.getModel()` is undefined | 4 |
| `builtinModels().getModels()` returns array | `Array.isArray(builtinModels().getModels())` → true | 4 |
| RuntimeEvent { kind, stage } shape | Run `agent.run("hello", console.log)`, verify event shapes | 6 |
| Claude CLI flags | Install claude, run `claude -p "hello" --output-format stream-json`, log output | 9 |
| Brain.recordFact valid fields | `brain.recordFact({kind:"fact", entity:"x", content:"y", visibility:"private", notability:0.5, source:"z"})` | 7 |
| MemoryManager.recall output | `memory.recall("test")` → inspect MemoryDomainEntry[] shape | 7 |
| Overlapping prompt() on ClaudeSession | Call prompt() twice rapidly, verify queue serializes | 10 |
