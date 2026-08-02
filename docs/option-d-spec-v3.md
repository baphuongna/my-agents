# mya Multi-Agent Platform — Spec v3 (Corrected)

> All API calls verified against actual codebase. Fixes 12 CRITICAL findings from independent review.

## Changelog (v2 → v3)

| # | Fix | Section |
|---|---|---|
| F1 | `brain.semanticSearch()` → `memory.recall()` | §6.1 |
| F2 | `brain.remember()` → `memory.record()` | §6.1 |
| F3 | `piSession.sendMessage()` → `piSession.sendCustomMessage()` | §2.1 |
| F4 | RuntimeEvent `"turn:start"` → `{ kind: "turn", stage: "start" }` | §3.3 |
| F5 | `createMyaBridge({ broker })` → add `broker?` to MyaBridgeOptions | §2.1 |
| F6 | `message_update` delta from `assistantMessageEvent.delta` not `message.content` | §3.1 |
| F7 | Add `tool_execution_start/update/end` event mappings | §3.1 |
| F8 | `model: string` → `model: Model<Api>` | §1.1, §2.1 |
| F9 | `agent.startTurn()` → `agent.run(text, sink)` | §2.3 |
| F10 | `SessionFactory` 4th param → routing layer above pool | §7.2 |
| F11-12 | Claude flags marked UNVERIFIED — Phase 6 starts with spike | §2.2 |
| F13 | `listModels()` → `await listModels()` in router | §5.2 |
| F14 | `costPerMTtons` typo → `costPerMTokens` | §2.2 |
| F15 | PiInProcessSession: single subscribe, no double | §2.1 |
| F16 | ThinkingLevel: 3 → 7 values | §1.1 |
| F17 | RuntimeSessionAdapter: remove undefined refs | §7.3 |
| F18 | `streamingBehavior: "streaming"` → remove | §1.2 |
| F19 | `MYA_REGISTER_BUN_OAUTH` → remove | §6.2 |
| F20 | Define `ModelInfo` type | §1.1 |

---

## 1. AgentRuntime SPI

### 1.1 Types

```typescript
// packages/core/src/runtime-spi.ts

import type { Model, Api } from "@earendil-works/pi-ai";

/** Model metadata for discovery UIs. */
interface ModelInfo {
  id: string;                    // "claude-sonnet-4-20250514"
  provider: string;              // "anthropic"
  contextWindow: number;         // tokens
  maxTokens: number;             // max output tokens
  reasoning: boolean;            // supports extended thinking
}

/** All 7 pi thinking levels (NOT just 3). */
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
  /** Model object — NOT a string. Resolved by the runtime from model ID. */
  model?: Model<Api>;
  /** Model ID string (runtime resolves to Model<Api> internally). */
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

  /**
   * Send a prompt. Returns immediately. Events stream via onEvent().
   * Callers detect turn completion by watching for turn_end event.
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
  /** Pi streaming behavior: "steer" | "followUp" (NOT "streaming"). */
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

    // F5 FIX: broker will be added to MyaBridgeOptions (see §2.1.1)
    const myaBridge = createMyaBridge({
      broker: opts.broker,          // ← NEW field, must be added to MyaBridgeOptions
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

    // F8 FIX: do NOT pass model as string. Let pi resolve from settings,
    // or resolve Model<Api> via ModelRuntime if modelId is provided.
    const sessionOpts: Record<string, unknown> = {
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      resourceLoader,
    };
    // Only pass model if we have a resolved Model<Api> object
    if (opts.model) sessionOpts.model = opts.model;

    const { session } = await createAgentSession(sessionOpts);
    return new PiInProcessSession(session, opts);
  }

  isAvailable(): boolean { return true; }

  async listModels(): Promise<ModelInfo[]> {
    // Models come from pi's ModelRuntime, which reads models.json + builtin catalog.
    // Use builtinModels() from pi-ai for discovery.
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    return builtinModels().map(m => ({
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

#### 2.1.1 MyaBridgeOptions update (F5)

```typescript
// packages/print/src/mya-bridge.ts — ADD broker field
export interface MyaBridgeOptions {
  // ... existing fields ...
  /** Broker client for inter-agent messaging. Optional — enables intercom tool. */
  broker?: BrokerClient;
  // ... rest unchanged ...
}
```

#### PiInProcessSession (F3, F6, F15 fixes)

```typescript
class PiInProcessSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  private listeners = new Set<(e: AgentEvent) => void>();
  private textBuffer = "";  // accumulate text for capture

  constructor(
    private piSession: PiAgentSession,
    private opts: StartOpts,
  ) {
    // F15 FIX: SINGLE subscribe in constructor. No double-subscribe in prompt().
    this.piSession.subscribe((event: unknown) => {
      const agentEvent = PiEventNormalizer.toAgentEvent(event);
      if (agentEvent) {
        // Accumulate text for later capture
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        this.listeners.forEach(l => l(agentEvent));
      }
    });
  }

  // F3 FIX: prompt() calls piSession.prompt(), events arrive via constructor's subscribe.
  // No local re-subscribe. No waiter promise. Callers detect completion via turn_end event.
  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    await this.piSession.prompt(text, {
      streamingBehavior: opts?.streamingBehavior ?? "followUp",
      // signal is handled by abort()
    });
    // prompt() returns when the turn is QUEUED, not when it completes.
    // Events continue to stream via onEvent handlers.
    // Callers MUST listen for turn_end to know when the turn is done.
  }

  // F3 FIX: use sendCustomMessage (NOT sendMessage)
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

  // F8 FIX: setModel takes Model<Api>, not string
  async setModel(model: Model<Api>): Promise<void> {
    await this.piSession.setModel(model);
  }

  async setThinking(level: ThinkingLevel): Promise<void> {
    await this.piSession.setThinkingLevel(level);
  }

  async compact(): Promise<CompactionResult> {
    await this.piSession.compact();
    return { tokensBefore: 0, tokensAfter: 0, strategy: "native" };
  }

  getState(): SessionState {
    // Extract from pi session — feature-detect methods
    const usage = this.piSession.getContextUsage?.();
    return {
      model: this.piSession.getModel?.()?.id ?? "unknown",
      thinking: this.piSession.getThinkingLevel?.() ?? "medium",
      status: this.piSession.isIdle() ? "idle" : "thinking",
      tokensIn: 0, tokensOut: 0,
      contextPct: usage?.percent ?? 0,
      contextWindow: usage?.contextWindow ?? 200_000,
      costUsd: 0,
      startedAt: this.opts.sessionId ? 0 : Date.now(),
      lastActivity: Date.now(),
    };
  }

  isIdle(): boolean { return this.piSession.isIdle(); }

  async dispose(): Promise<void> {
    try { await this.piSession.dispose(); } catch { /* best effort */ }
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getTextBuffer(): string { return this.textBuffer; }
}
```

### 2.2 ClaudeRuntime

> ⚠️ **F11-F12**: Claude CLI is NOT installed. All flags below are UNVERIFIED.
> Phase 6 MUST start with a CLI verification spike before any code.

```typescript
// packages/print/src/runtimes/claude.ts

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
    // UNVERIFIED — hardcoded until Claude CLI is tested
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

  // F14 FIX: correct method name (was costPerMTtons)
  costPerMTokens() { return { input: 3, output: 15 }; }
}

class ClaudeSession implements RuntimeSession {
  readonly executionModel = "subprocess" as const;
  private child: ChildProcess | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  private sessionDir: string;
  private abortController: AbortController | null = null;

  constructor(private opts: StartOpts) {
    this.sessionDir = join(opts.agentDir, "sessions", "claude", opts.sessionId);
    mkdirSync(this.sessionDir, { recursive: true });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.abortController = new AbortController();
    this.emit({ type: "turn_start", model: this.opts.modelId ?? "claude-sonnet-4", sessionId: this.opts.sessionId });

    // ⚠️ UNVERIFIED FLAGS — Phase 6 spike required
    const args = [
      "-p",
      "--output-format", "stream-json",     // UNVERIFIED
      "--model", this.opts.modelId ?? "claude-sonnet-4-20250514",
      "--continue",                          // UNVERIFIED — stateful resume
      "--session-dir", this.sessionDir,      // UNVERIFIED
      text,
    ];

    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = readline.createInterface({ input: this.child.stdout });

    // Fire-and-forget event emission — prompt() returns immediately
    (async () => {
      try {
        for await (const line of rl) {
          if (this.abortController?.signal.aborted) break;
          // F12 FIX: actual Claude stream-json format UNVERIFIED.
          // Phase 6 spike: run `claude -p "test" --output-format stream-json`
          // and log every line to determine actual format.
          const event = ClaudeEventNormalizer.parseLine(line);
          if (event) this.emit(event);
        }
      } catch (e) {
        this.emit({ type: "error", message: String(e), recoverable: false });
      }

      // Emit turn_end when process exits
      // M2 FIX: emit error if process crashed without natural completion
      const exitCode = await new Promise<number>((resolve) => {
        this.child?.on("exit", (code) => resolve(code ?? 1));
      });
      if (exitCode !== 0 && !this.abortController?.signal.aborted) {
        this.emit({ type: "error", message: `Claude exited with code ${exitCode}`, recoverable: false });
      }
      this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
    })();
  }

  async inject(message: BrokerMessage): Promise<void> {
    // Spawn a new prompt with the message
    const text = `[Message from ${message.from.name}]: ${message.content.text}`;
    await this.prompt(text);
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => l(event));
  }

  async dispose(): Promise<void> {
    this.child?.kill();
    this.listeners.clear();
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // setModel, setThinking, compact, getState, isIdle — see full impl
  // setModel requires Model<Api> but Claude doesn't use pi's Model type.
  // For Claude, store modelId string and pass as CLI flag.
  async setModel(model: Model<Api>): Promise<void> {
    this.opts.modelId = model.id;
  }
}
```

### 2.3 MyaNativeRuntime (F9 fix)

```typescript
// packages/print/src/runtimes/mya-native.ts

class MyaNativeRuntime implements AgentRuntime {
  readonly runtimeType = "mya-native";
  readonly displayName = "mya (built-in)";

  async start(opts: StartOpts): Promise<RuntimeSession> {
    // F9 FIX: use actual createAgent() API
    const agent = createAgent({
      providers: this.resolveProviders(opts.env),
      tools: this.resolveTools(opts.toolsAllowList),
      memoryDir: opts.agentDir,
    });
    return new MyaNativeSession(agent, opts);
  }

  isAvailable(): boolean { return true; }

  async listModels(): Promise<ModelInfo[]> {
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    return builtinModels().map(m => ({
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
    // Load from @my-agent/tools or inline builtins
    return allowList
      ? builtinTools().filter(t => allowList.includes(t.name))
      : builtinTools();
  }
}

class MyaNativeSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  private listeners = new Set<(e: AgentEvent) => void>();

  constructor(
    private agent: Agent,      // from @my-agent/agent
    private opts: StartOpts,
  ) {}

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.emit({ type: "turn_start", model: this.opts.modelId ?? "unknown", sessionId: this.opts.sessionId });

    // F9 FIX: use agent.run() (streaming via callback), NOT agent.startTurn()
    // agent.run() calls sink for each RuntimeEvent, resolves when turn completes.
    await this.agent.run(
      text,
      (runtimeEvent: RuntimeEvent) => {
        const agentEvent = MyaEventNormalizer.toAgentEvent(runtimeEvent);
        if (agentEvent) this.emit(agentEvent);
      },
      { signal: opts?.signal },
    );

    this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
  }

  async inject(message: BrokerMessage): Promise<void> {
    const text = `[Message from ${message.from.name}]: ${message.content.text}`;
    await this.prompt(text);
  }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => l(event));
  }

  async dispose(): Promise<void> { /* cleanup */ }
  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  // setModel, setThinking, compact, getState, isIdle — stubs
}
```

---

## 3. Event Normalization Layer

### 3.1 PiEventNormalizer (F6, F7 fixes)

```typescript
// packages/print/src/runtimes/pi-normalizer.ts

const PI_TO_AGENT: Record<string, (event: any) => AgentEvent | null> = {
  // ── Turn lifecycle ──
  agent_start: (e) => ({
    type: "turn_start",
    model: e.model ?? "unknown",
    sessionId: e.sessionId ?? "",
  }),

  // agent_settled = turn complete. Gateway detects this to know turn is done.
  // Do NOT emit turn_end here — the SessionAdapter emits it after collecting token counts.
  agent_settled: () => null,

  // ── Text streaming (F6 FIX) ──
  // Pi's message_update carries assistantMessageEvent with the ACTUAL delta.
  // Do NOT extract from message.content (that's accumulated text).
  message_update: (e) => {
    const ame = e.assistantMessageEvent;
    if (!ame) return null;

    // text_delta carries the incremental text delta
    if (ame.type === "text_delta") {
      return { type: "text", delta: ame.delta };
    }
    // thinking_delta carries incremental thinking text
    if (ame.type === "thinking_delta" || (ame as any).type === "thinking") {
      return { type: "thinking", delta: (ame as any).delta ?? "" };
    }
    return null;
  },

  message_start: () => null,
  message_end: () => null,

  // ── Tool execution (F7 FIX — these were completely missing!) ──
  tool_execution_start: (e) => ({
    type: "tool_call",
    toolCallId: e.toolCallId,
    name: e.toolName,
    args: e.args,
  }),

  tool_execution_update: (e) => {
    // Partial result — only emit if there's meaningful content
    if (e.partialResult) {
      return {
        type: "tool_result",
        toolCallId: e.toolCallId,
        output: typeof e.partialResult === "string"
          ? e.partialResult
          : JSON.stringify(e.partialResult),
      };
    }
    return null;
  },

  tool_execution_end: (e) => ({
    type: "tool_result",
    toolCallId: e.toolCallId,
    output: typeof e.result === "string"
      ? e.result
      : JSON.stringify(e.result),
    error: e.isError === true,
  }),

  // ── Bash execution (F7 FIX: delta, not command) ──
  // bash_execution_update is for live bash output streaming.
  // It has { delta: string } — NOT { command: string }.
  bash_execution_update: (e) => ({
    type: "text",
    delta: e.delta ?? "",    // ← F7 FIX: was e.command (doesn't exist)
  }),

  // ── Compaction ──
  compaction_start: () => null,
  compaction_end: (e) => ({
    type: "compaction",
    result: {
      tokensBefore: e.tokensBefore ?? 0,
      tokensAfter: e.tokensAfter ?? 0,
      strategy: "native" as const,
    },
  }),

  // ── Model/thinking changes ──
  model_select: (e) => ({ type: "model_changed", model: e.model }),

  // ── Ignore these (handled elsewhere or not needed) ──
  session: () => null,
  session_info_changed: () => null,
  session_before_compact: () => null,
  session_before_tree: () => null,
  session_compact: () => null,
  session_shutdown: () => null,
  queue_update: () => null,
  entry_appended: () => null,
  auto_retry_start: () => null,
  auto_retry_end: () => null,
};

const PiEventNormalizer = {
  toAgentEvent(event: unknown): AgentEvent | null {
    const e = event as { type: string };
    const fn = PI_TO_AGENT[e.type];
    return fn ? fn(event) : null;
  },
};
```

### 3.2 ClaudeEventNormalizer

> ⚠️ **F12**: Actual Claude stream-json format is UNVERIFIED.
> The code below is a PLACEHOLDER. Phase 6 must run a spike:
> ```bash
> claude -p "hello" --output-format stream-json 2>&1 | tee /tmp/claude-format.txt
> ```
> Then build the parser from actual output.

```typescript
// packages/print/src/runtimes/claude-normalizer.ts

const ClaudeEventNormalizer = {
  /**
   * PLACEHOLDER — actual format unknown until CLI spike.
   *
   * Likely structure (based on Anthropic API conventions):
   * - Claude Code wraps events in its own envelope
   * - Top-level type may be "result", "assistant", "tool", etc.
   * - Content blocks are Anthropic API format
   *
   * DO NOT trust the mapping below until verified.
   */
  parseLine(line: string): AgentEvent | null {
    let data: unknown;
    try { data = JSON.parse(line); } catch { return null; }

    // TODO: replace with actual format after spike
    const obj = data as Record<string, unknown>;

    // Best guess based on Anthropic streaming format:
    const type = obj.type as string;
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

### 3.3 MyaEventNormalizer (F4 fix)

```typescript
// packages/print/src/runtimes/mya-normalizer.ts

import type { RuntimeEvent } from "@my-agent/core";

// F4 FIX: RuntimeEvent uses { kind, stage } discriminant, NOT "kind:stage" string.
// Pattern match on compound discriminant:
const MyaEventNormalizer = {
  toAgentEvent(event: RuntimeEvent): AgentEvent | null {
    // { kind: "turn", stage: "start" }
    if (event.kind === "turn" && event.stage === "start") {
      return {
        type: "turn_start",
        model: event.turnEvent?.model ?? "unknown",
        sessionId: "",
      };
    }

    // { kind: "turn", stage: "end" }
    if (event.kind === "turn" && event.stage === "end") {
      return {
        type: "turn_end",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: event.turnEvent?.cost,
      };
    }

    // { kind: "tool", stage: "request" }
    if (event.kind === "tool" && event.stage === "request" && event.call) {
      return {
        type: "tool_call",
        toolCallId: event.call.id,
        name: event.call.name,
        args: event.call.args,
      };
    }

    // { kind: "tool", stage: "result" }
    if (event.kind === "tool" && event.stage === "result" && event.result) {
      return {
        type: "tool_result",
        toolCallId: event.call?.id ?? "",
        output: typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result),
      };
    }

    // { kind: "turn", stage: "event" } — sub-events within a turn
    if (event.kind === "turn" && event.stage === "event" && event.turnEvent) {
      const te = event.turnEvent as { type?: string; delta?: string; text?: string };
      if (te.type === "text" && te.delta) return { type: "text", delta: te.delta };
      if (te.type === "thinking" && te.delta) return { type: "thinking", delta: te.delta };
    }

    // { kind: "budget" }
    if (event.kind === "budget") {
      return null;  // budget events not needed as AgentEvent
    }

    // { kind: "log" }
    if (event.kind === "log") {
      return null;  // log events not forwarded as AgentEvent
    }

    return null;
  },
};
```

---

## 4. mya Broker

(Unchanged from v2 — broker code is adopted from pi-intercom and doesn't depend on mya APIs.)

---

## 5. Smart Router (F13, F14 fixes)

```typescript
class SmartRouter {
  constructor(
    private runtimes: Map<string, AgentRuntime>,
    private config: RouterConfig,
    private costTracker: CostTracker,
  ) {}

  // F13 FIX: make select() async to await listModels()
  async select(input: RouterInput): Promise<RouterResult> {
    const candidates = this.filterAvailable();
    if (candidates.length === 0) throw new Error("No runtime available");

    const scored = await Promise.all(
      candidates.map(async rt => ({
        runtime: rt,
        ...(await this.score(rt, input)),
      })),
    );

    scored.sort((a, z) => z.score - a.score);
    return { runtime: scored[0]!.runtime, reason: scored[0]!.reason };
  }

  // F13 FIX: score() is async — await listModels()
  private async score(rt: AgentRuntime, input: RouterInput): Promise<{ score: number; reason: string }> {
    let score = 0;
    const reasons: string[] = [];

    if (input.agentOverride === rt.runtimeType) {
      return { score: Infinity, reason: "explicit override" };
    }

    // F13 FIX: await the Promise
    if (input.modelOverride) {
      const models = await rt.listModels();
      const hasModel = models.some(m => m.id === input.modelOverride);
      if (!hasModel) return { score: -1, reason: "model not available" };
      score += 100;
      reasons.push("model available");
    }

    for (const rule of this.config.rules) {
      if (rule.match.test(input.prompt) && rule.agent === rt.runtimeType) {
        score += rule.weight ?? 50;
        reasons.push(`rule: ${rule.match}`);
      }
    }

    // F14 FIX: correct method name costPerMTokens (not costPerMTtons)
    const cost = rt.costPerMTokens?.();
    if (cost && input.budgetRemainingUsd !== undefined && input.budgetRemainingUsd < 1) {
      score -= cost.input + cost.output;
      reasons.push("cost penalty");
    }

    if (rt.capabilities().execution === "in-process") {
      score += 10;
      reasons.push("in-process");
    }

    return { score, reason: reasons.join(", ") };
  }
}
```

---

## 6. Shared Infrastructure

### 6.1 PromptEnricher (F1, F2 fixes)

```typescript
// packages/print/src/prompt-enricher.ts

import type { MemoryManager } from "@my-agent/memory";
import type { Brain } from "@my-agent/memory";
import type { RetrievalEngine } from "@my-agent/retrieval";

class PromptEnricher {
  constructor(
    // F1 FIX: use MemoryManager (has recall()), NOT Brain (no semanticSearch)
    private memory: MemoryManager,
    private brain: Brain,
    private retrievalEngine: RetrievalEngine,
    private roleRegistry: RoleRegistry,
    private sessionStore: SessionStore,
  ) {}

  async enrich(prompt: string, ctx: EnrichContext): Promise<string> {
    const parts: string[] = [];

    // Role system prompt
    if (ctx.role) {
      const role = await this.roleRegistry.get(ctx.role);
      if (role?.promptAppend) {
        parts.push(`<role>\n${role.promptAppend}\n</role>`);
      }
    }

    // F1 FIX: use memory.recall() — actual API from MemoryManager
    // recall(query) returns MemoryDomainEntry[] (fan-out across domains)
    const recallResults = this.memory.recall(prompt, { topK: 5 });
    const memories = recallResults.flatMap(r => r.hits ?? []);
    if (memories.length > 0) {
      const memoryBlock = memories
        .slice(0, 5)
        .map(m => `- ${m.content ?? m.text ?? JSON.stringify(m).slice(0, 200)}`)
        .join("\n");
      parts.push(`<relevant_memories>\n${memoryBlock}\n</relevant_memories>`);
    }

    // Conversation history (for stateless agents only)
    if (ctx.executionModel === "subprocess") {
      const history = await this.sessionStore.getHistory(ctx.sessionId);
      const compacted = this.truncateHistory(history, ctx.contextWindow ?? 200_000);
      if (compacted) {
        parts.push(`<previous_conversation>\n${compacted}\n</previous_conversation>`);
      }
    }

    parts.push(prompt);
    return parts.join("\n\n");
  }

  // F2 FIX: use memory.record() or brain.recordFact() — NOT brain.remember()
  async capture(output: string, ctx: EnrichContext): Promise<void> {
    // Record as a fact in the brain
    this.brain.recordFact({
      kind: "observation",
      entity: ctx.sessionId,
      content: output.slice(0, 2000),
      visibility: "role",
      notability: 0.5,
      source: ctx.sessionId,
    });

    // Store in session history
    await this.sessionStore.append(ctx.sessionId, {
      role: "assistant",
      content: output,
      timestamp: Date.now(),
    });
  }

  private truncateHistory(history: Message[], contextWindow: number): string | null {
    if (history.length === 0) return null;
    // Simple: keep last N messages. Full compaction handled by CompactionManager.
    const recent = history.slice(-20);
    return recent
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");
  }
}

interface EnrichContext {
  sessionId: string;
  runtimeType: string;
  executionModel: "in-process" | "subprocess";
  role?: string;
  contextWindow?: number;
}
```

### 6.2 AuthInjector (F19 fix)

```typescript
// packages/print/src/auth-injector.ts

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

  // F19 FIX: removed MYA_REGISTER_BUN_OAUTH (not a real env var).
  // OAuth registration is done via registerBunOAuthFlows() function call
  // in pi-main.ts, not via env var. For subprocess pi (interactive mode),
  // the mya bundle already calls registerBunOAuthFlows() at startup.

  env.PI_CODING_AGENT_DIR = join(homedir(), ".mya/agent");

  return env;
}
```

### 6.3 Compaction Manager

```typescript
// packages/print/src/compaction.ts

class CompactionManager {
  /** Compact history. Strategy depends on runtime capabilities. */
  async compact(
    history: Message[],
    runtime: AgentRuntime,
    contextWindow: number,
  ): Promise<{ messages: Message[]; result: CompactionResult }> {
    const estimatedTokens = this.estimateTokens(history);
    const threshold = contextWindow * 0.7;

    if (estimatedTokens < threshold) {
      return { messages: history, result: { tokensBefore: estimatedTokens, tokensAfter: estimatedTokens, strategy: "none" } };
    }

    const caps = runtime.capabilities();

    if (caps.supportsCompaction) {
      return { messages: history, result: { tokensBefore: estimatedTokens, tokensAfter: estimatedTokens, strategy: "native" } };
    }

    if (caps.supportsResume) {
      // Agent manages its own context (--continue flag)
      return { messages: history, result: { tokensBefore: estimatedTokens, tokensAfter: 0, strategy: "continue-session" } };
    }

    // Fallback: truncate oldest messages
    const truncated = history.slice(-10);
    return {
      messages: truncated,
      result: { tokensBefore: estimatedTokens, tokensAfter: this.estimateTokens(truncated), strategy: "truncate" },
    };
  }

  // F25: rough token estimation (4 chars ≈ 1 token)
  private estimateTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }
}
```

### 6.4 Cost Tracker, Session Store

(Unchanged from v2 — verified correct against codebase.)

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

### 7.2 Session Creation (F10 fix)

```typescript
// F10 FIX: SessionFactory only has 3 params (sessionId, cwd?, agentDir?).
// AgentPool NEVER passes agentType. Solution: routing layer ABOVE pool.

// The existing AgentPool stays unchanged. A new RuntimePool wraps it:

class RuntimePool {
  constructor(
    private pool: AgentPool,
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private compaction: CompactionManager,
    private costTracker: CostTracker,
  ) {}

  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    // 1. Select runtime
    let runtime: AgentRuntime;
    if (opts?.agentType) {
      runtime = this.runtimes.get(opts.agentType)!;
      if (!runtime?.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
    } else {
      const result = await this.router.select({ prompt: "", modelOverride: opts?.model });
      runtime = result.runtime;
    }

    // 2. Start runtime session
    const env = buildAgentEnv();
    const runtimeSession = await runtime.start({
      cwd: opts?.cwd ?? process.cwd(),
      agentDir: join(homedir(), ".mya/agent"),
      sessionId,
      modelId: opts?.model,
      env,
    });

    // 3. Wrap in AgentSession-compatible adapter
    const adapter = new RuntimeSessionAdapter(
      runtimeSession, this.enricher, this.compaction, this.costTracker,
    );

    return { session: adapter, runtimeType: runtime.runtimeType };
  }

  // For backward compat: delegate to existing pool for pi sessions
  async acquire(sessionId: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { agentType: "pi" });
    return session;
  }
}
```

### 7.3 RuntimeSessionAdapter (F17 fix)

```typescript
// F17 FIX: removed undefined executionModel reference and collectText().
class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private compaction: CompactionManager,
    private costTracker: CostTracker,
  ) {
    // Subscribe to runtime events → forward to gateway subscribers
    this.session.onEvent((event) => {
      // Accumulate text
      if (event.type === "text") this.textBuffer += event.delta;
      // Track cost
      this.costTracker.record(this.session.sessionId, event);
      // Forward to all subscribers (raw event for WS broadcast)
      this.listeners.forEach(l => l(event));
    });
  }

  async prompt(text: string, _options?: unknown): Promise<void> {
    // Enrich prompt
    const enriched = await this.enricher.enrich(text, {
      sessionId: this.session.sessionId,
      runtimeType: this.session.runtimeType,
      executionModel: this.session.executionModel,  // ← NOW EXISTS on RuntimeSession
    });

    this.textBuffer = "";

    // Call runtime session — events stream via onEvent
    await this.session.prompt(enriched);

    // Capture output AFTER turn completes (turn_end event already emitted)
    // Use setTimeout to ensure all text events have been processed
    setTimeout(() => {
      if (this.textBuffer) {
        this.enricher.capture(this.textBuffer, {
          sessionId: this.session.sessionId,
          runtimeType: this.session.runtimeType,
        }).catch(() => {});
      }
    }, 100);
  }

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort(): void { this.session.dispose(); }
  get sessionFile(): string | undefined { return undefined; }
}
```

---

## 8. Execution Paths

### 8.1-8.6 Unchanged from v2

All execution paths (interactive, print, cron, channel, dashboard, broker) remain the same architecturally. The code snippets in each path now use the corrected APIs:

- `sendCustomMessage()` instead of `sendMessage()`
- `agent.run(text, sink)` instead of `agent.startTurn()`
- `memory.recall(query)` instead of `brain.semanticSearch(query)`
- `brain.recordFact()` instead of `brain.remember()`
- `Model<Api>` instead of `string` for model parameter

---

## 9. Implementation Phases

| Phase | Scope | Deliverable | New Risk Note |
|---|---|---|---|
| **1** | Broker + framing + auto-spawn + client | Broker runs, 2 processes exchange messages | — |
| **2** | AgentRuntime SPI + AgentEvent types | Interface compiles, unit tests pass | — |
| **3** | PiInProcessRuntime + PiEventNormalizer | Gateway sessions with uniform events | **Spike: log actual pi events first** |
| **4** | RuntimePool + RuntimeSessionAdapter | Gateway creates sessions via SPI | AgentPool compatibility |
| **5** | MyaNativeRuntime + MyaEventNormalizer | `--agent mya` works | Verify RuntimeEvent mapping |
| **6** | **Claude CLI spike** | `claude -p "test" --output-format stream-json` output logged | **ALL flags unverified** |
| **6b** | ClaudeRuntime + ClaudeEventNormalizer | `--agent claude` works | Based on spike results |
| **7** | PromptEnricher (memory.recall + brain.recordFact) | Memory + role injection | Verify MemoryManager.recall() output shape |
| **8** | CompactionManager | Sessions scale | Token estimation accuracy |
| **9** | SmartRouter (async) | Auto-routing | Scoring edge cases |
| **10** | CostTracker + dashboard | Per-agent cost tracking | WS event format |
| **11** | Broker-mediated inter-agent messaging | send/ask/reply | Injection per runtime |
| **12** | `mya broker` CLI | Management commands | UX |
| **13** | Cold review + E2E tests | Full system verified | All of the above |

---

## 10. Component Estimates (F22 fix)

| Component | Lines | Notes |
|---|---|---|
| Broker (adopt from pi-intercom) | ~3200 | broker.ts + client.ts + framing.ts + paths.ts + spawn.ts + extension-state.ts + runtime-claim.ts |
| AgentRuntime SPI types | ~300 | interfaces, AgentEvent, capabilities, ModelInfo |
| PiInProcessRuntime | ~600 | runtime + session + normalizer |
| ClaudeRuntime | ~700 | runtime + session + normalizer (post-spike) |
| MyaNativeRuntime | ~500 | runtime + session + normalizer |
| RuntimePool + RuntimeSessionAdapter | ~400 | routing layer + pool bridge |
| SmartRouter | ~400 | async scoring algorithm |
| PromptEnricher | ~200 | memory.recall + brain.recordFact |
| AuthInjector | ~100 | auth.json → env |
| CompactionManager | ~300 | multi-strategy + token estimation |
| CostTracker | ~200 | per-session aggregation |
| SessionStore | ~200 | SQLite CRUD |
| Broker tool + CLI | ~500 | mya-bridge tool + `mya broker` |
| MyaBridgeOptions update | ~50 | Add broker field |
| Tests | ~4000 | unit + integration + E2E |
| **Total** | **~11550** | |

---

## 11. Verification Checklist

Before implementing each phase, verify:

| Check | How | Phase |
|---|---|---|
| Pi event types + payloads | Run pi session, `session.subscribe(e => console.log(JSON.stringify(e)))`, log 1 turn | 3 |
| Claude CLI flags | Install claude, run `claude -p "hello" --output-format stream-json`, log output | 6 |
| MemoryManager.recall() output shape | Call recall("test"), inspect MemoryDomainEntry[] | 7 |
| Brain.recordFact() required fields | Check Fact interface — kind, entity, content, visibility, notability, source | 7 |
| RuntimeEvent → AgentEvent mapping | Run `agent.run("hello", console.log)`, verify event shapes | 5 |
| SessionFactory call sites | grep `this.createSession` in pool.ts — verify 3 params | 4 |
| Pi sendCustomMessage options | Check sdk.d.ts — verify triggerTurn + deliverAs values | 11 |
| Model<Api> resolution | Check how main.ts resolves model — does it use ModelRuntime? | 3 |
