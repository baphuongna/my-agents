# mya Multi-Agent Orchestration Platform — Full Specification

> **Goal**: Maximum performance and effectiveness. mya manages multiple coding agents (pi, Claude Code, OpenCode, mya-native) through a uniform runtime abstraction, broker-based inter-agent messaging, and shared infrastructure (memory, auth, compaction, cost tracking). Each agent runs at peak capability — pi in-process with full features, others as optimized subprocesses.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                       mya Gateway (daemon)                      │
│                                                                │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Cron   │  │ Channels │  │ Launcher │  │  HTTP / WS     │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│       └────────────┼─────────────┼────────────────┘           │
│                    ▼             ▼                             │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                    Smart Router                           │ │
│  │  Task + model + capabilities + cost → select runtime      │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                           ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                AgentRuntime SPI                           │ │
│  │                                                          │ │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ PiInProcess     │  │ SubprocessRuntime            │   │ │
│  │  │ Runtime         │  │  ├─ ClaudeRuntime            │   │ │
│  │  │ createAgentSesn │  │  ├─ OpenCodeRuntime          │   │ │
│  │  │ sion() in-proc  │  │  └─ PiRpcRuntime (fallback)  │   │ │
│  │  │ 100% features   │  │                              │   │ │
│  │  └────────┬────────┘  └──────────┬───────────────────┘   │ │
│  │           │                      │                        │ │
│  │  ┌────────┴──────────────────────┴────────────────────┐   │ │
│  │  │           Event Normalization Layer                 │   │ │
│  │  │   ALL runtimes emit uniform AgentEvent stream       │   │ │
│  │  │   { turn_start, text, thinking, tool_call,          │   │ │
│  │  │     tool_result, turn_end, compaction, error }      │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                           ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              mya Broker (Unix socket)                     │ │
│  │  Inter-agent messaging · presence · mailbox               │ │
│  │  send / ask / reply · extension channels · rate limit     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                           ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Shared Infrastructure                                    │ │
│  │  Memory · Auth · Roles · Compaction · Cost · Sessions     │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
        │                │                │                │
        ▼                ▼                ▼                ▼
   ┌─────────┐     ┌───────────┐    ┌───────────┐    ┌───────────┐
   │ pi TUI  │     │  claude   │    │ opencode  │    │  mya CLI  │
   │(inherit)│     │   CLI     │    │   TUI     │    │  (print)  │
   └─────────┘     └───────────┘    └───────────┘    └───────────┘
```

---

## 1. AgentRuntime SPI

The central abstraction. Every agent — whether in-process or subprocess — implements this interface. The gateway, router, broker, and dashboard interact ONLY with `AgentRuntime` and `RuntimeSession`. They never import agent-specific code directly.

### 1.1 Runtime Interface

```typescript
// packages/core/src/runtime-spi.ts

/**
 * Factory for creating agent sessions. One instance per agent type,
 * registered at gateway startup.
 */
interface AgentRuntime {
  /** Unique identifier: "pi" | "claude" | "opencode" | "mya-native" */
  readonly runtimeType: string;

  /** Human-readable name for UI display. */
  readonly displayName: string;

  /** Create a new session. */
  start(opts: StartOpts): Promise<RuntimeSession>;

  /** Check if the agent binary / SDK is available on this machine. */
  isAvailable(): boolean;

  /** List models this runtime can serve. */
  listModels(): Promise<ModelInfo[]>;

  /** Declare capabilities. */
  capabilities(): AgentCapabilities;

  /** Authenticate / login (OAuth, API key). Optional. */
  login?(provider: string): Promise<void>;

  /** Get estimated cost per 1M tokens (for router cost-awareness). */
  costPerMTokens?(): { input: number; output: number };
}

interface StartOpts {
  cwd: string;
  agentDir: string;               // ~/.mya/agent
  sessionId: string;              // gateway-assigned UUID
  model?: string;
  thinking?: "low" | "medium" | "high";
  systemPromptOverride?: string;
  toolsAllowList?: string[];
  /** Broker client (for inter-agent messaging inside the session). */
  broker?: BrokerClient;
  /** Env vars from auth.json (provider keys, etc.). */
  env: Record<string, string>;
  /** Session file to resume (if agent supports it). */
  resumeFrom?: string;
}
```

### 1.2 Session Interface

```typescript
/**
 * A live agent session. Returned by runtime.start().
 * Emits uniform AgentEvent stream regardless of underlying agent.
 */
interface RuntimeSession {
  /** Gateway-assigned session ID. */
  readonly sessionId: string;

  /** Runtime that created this session. */
  readonly runtimeType: string;

  /**
   * Send a prompt and stream events until the turn settles.
   *
   * Implementations MUST:
   *   - Return an AsyncIterable immediately (do not block on first token)
   *   - Emit turn_start as the first event
   *   - Emit turn_end when the agent settles
   *   - Emit error if the agent crashes
   *
   * Gateway calls this and forwards events to WebSocket clients.
   */
  prompt(text: string, opts?: PromptOpts): AsyncIterable<AgentEvent>;

  /**
   * Inject a broker message into the session (from another agent).
   *
   * For in-process runtimes: direct call.
   * For subprocess runtimes: write to stdin or trigger new prompt.
   */
  inject(message: BrokerMessage): Promise<void>;

  /** Change the active model. */
  setModel(model: string): Promise<void>;

  /** Change thinking level. */
  setThinking(level: "low" | "medium" | "high"): Promise<void>;

  /** Trigger manual compaction. */
  compact(): Promise<CompactionResult>;

  /** Get session state (token count, context %, cost, status). */
  getState(): SessionState;

  /** Whether the session is currently processing a turn. */
  isIdle(): boolean;

  /** Dispose the session (kill process, free memory). */
  dispose(): Promise<void>;

  /** Subscribe to out-of-band events (presence, broker messages, errors). */
  onEvent(handler: (event: AgentEvent) => void): () => void;
}

interface PromptOpts {
  signal?: AbortSignal;
  images?: Array<{ data: string; mimeType: string }>;
  /** Streaming behavior hint. */
  streamingBehavior?: "followUp" | "streaming";
}

interface SessionState {
  model: string;
  thinking: string;
  status: "idle" | "thinking" | "tool:<name>";
  tokensIn: number;
  tokensOut: number;
  contextPct: number;           // 0-100
  contextWindow: number;        // model's max context
  costUsd: number;
  startedAt: number;
  lastActivity: number;
}

interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  strategy: "native" | "llm-summarize" | "truncate" | "continue-session";
}
```

### 1.3 Uniform Event Type

```typescript
/**
 * The ONLY event type the gateway and dashboard consume.
 * Every runtime normalizes its native events to this format.
 */
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

### 1.4 Capabilities

```typescript
interface AgentCapabilities {
  /** Can run interactively (owns terminal). */
  hasInteractive: boolean;
  /** Can run headless (print mode). */
  hasHeadless: boolean;
  /** Supports tool calls. */
  supportsTools: boolean;
  /** Supports session resume/restore. */
  supportsResume: boolean;
  /** Supports native compaction. */
  supportsCompaction: boolean;
  /** Supports image input. */
  supportsImages: boolean;
  /** Supports thinking/reasoning display. */
  supportsThinking: boolean;
  /** Execution model. */
  execution: "in-process" | "subprocess";
  /** Max context window (tokens). */
  maxContextWindow: number;
  /** How messages are injected for broker messaging. */
  injectionMethod: "extension" | "rpc" | "stdin-prompt" | "in-process-call";
}
```

---

## 2. Runtime Implementations

### 2.1 PiInProcessRuntime

Pi runs inside the gateway process. Direct access to `createAgentSession()`, full mya-bridge extension, zero IPC overhead.

```typescript
// packages/print/src/runtimes/pi-in-process.ts

class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: true,
      hasHeadless: true,
      supportsTools: true,
      supportsResume: true,
      supportsCompaction: true,
      supportsImages: true,
      supportsThinking: true,
      execution: "in-process",
      maxContextWindow: 200_000,
      injectionMethod: "in-process-call",
    };
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const { createAgentSession, DefaultResourceLoader } =
      await import("@earendil-works/pi-coding-agent");
    const { createMyaBridge } = await import("./mya-bridge.js");

    const myaBridge = createMyaBridge({
      broker: opts.broker,
      auditLog, secretStore, hooks, skillStore, cron,
      brain, memory, retrievalEngine, lifecycleManager,
      sqliteMemory, wallet, sync, collab, packageHost,
      council, mcp, mcpConfigs, channels, roleRegistry, achievements,
    });

    const resourceLoader = new DefaultResourceLoader({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      extensionFactories: [{ name: "mya-bridge", factory: myaBridge }],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      model: opts.model,
      resourceLoader,
    });

    return new PiInProcessSession(session, opts);
  }

  isAvailable(): boolean {
    return true;  // pi is an npm dependency, always available
  }

  async listModels(): Promise<ModelInfo[]> {
    return builtinModels().map(m => ({
      id: m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
    }));
  }

  costPerMTokens() {
    return { input: 3, output: 15 };  // placeholder — pi tracks internally
  }
}
```

#### PiInProcessSession

```typescript
class PiInProcessSession implements RuntimeSession {
  private listeners = new Set<(e: AgentEvent) => void>();

  constructor(
    private piSession: PiAgentSession,
    private opts: StartOpts,
  ) {
    // Subscribe to pi events → normalize → emit AgentEvent
    piSession.subscribe((event: unknown) => {
      const agentEvent = PiEventNormalizer.toAgentEvent(event);
      if (agentEvent) {
        this.listeners.forEach(l => l(agentEvent));
      }
    });
  }

  async *prompt(text: string, opts?: PromptOpts): AsyncIterable<AgentEvent> {
    const events: AgentEvent[] = [];
    const waiter = new Promise<void>((resolve) => {
      const unsub = this.piSession.subscribe((event: unknown) => {
        const ae = PiEventNormalizer.toAgentEvent(event);
        if (ae) events.push(ae);
        if ((event as { type: string }).type === "agent_settled") {
          unsub();
          resolve();
        }
      });
    });

    await this.piSession.prompt(text, {
      streamingBehavior: opts?.streamingBehavior ?? "followUp",
    });
    await waiter;

    yield* events;
  }

  async inject(message: BrokerMessage): Promise<void> {
    // In-process: call pi.sendMessage directly
    this.piSession.sendMessage({
      customType: "broker_message",
      content: `**From ${message.from.name}**\n\n${message.content.text}`,
      display: true,
    }, { triggerTurn: true });
  }

  async setModel(model: string) { await this.piSession.setModel(model); }
  async setThinking(level: string) { await this.piSession.setThinking(level); }
  async compact() { /* delegate to pi native compaction */ }

  getState(): SessionState {
    return PiStateExtractor.extract(this.piSession, this.opts);
  }

  isIdle(): boolean { return this.piSession.isIdle(); }

  async dispose() {
    try { await this.piSession.dispose(); } catch { /* best effort */ }
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
}
```

### 2.2 ClaudeRuntime

Claude Code CLI wrapper. Subprocess per session, `--continue` for stateful sessions.

```typescript
// packages/print/src/runtimes/claude.ts

class ClaudeRuntime implements AgentRuntime {
  readonly runtimeType = "claude";
  readonly displayName = "Claude Code (Anthropic)";

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: true,
      hasHeadless: true,
      supportsTools: true,
      supportsResume: true,         // via --continue / --resume
      supportsCompaction: false,    // Claude manages context internally
      supportsImages: true,
      supportsThinking: true,
      execution: "subprocess",
      maxContextWindow: 200_000,
      injectionMethod: "stdin-prompt",
    };
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    return new ClaudeSession(opts);
  }

  isAvailable(): boolean {
    try { execSync("which claude", { stdio: "ignore" }); return true; }
    catch { return false; }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "claude-sonnet-4-20250514", provider: "anthropic", contextWindow: 200_000 },
      { id: "claude-opus-4-20250514", provider: "anthropic", contextWindow: 200_000 },
      { id: "claude-haiku-3-5", provider: "anthropic", contextWindow: 200_000 },
    ];
  }

  costPerMTtons() { return { input: 3, output: 15 }; }
}
```

#### ClaudeSession

```typescript
class ClaudeSession implements RuntimeSession {
  private child: ChildProcess | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  private sessionDir: string;
  private abortController: AbortController | null = null;
  private state: SessionState;

  constructor(private opts: StartOpts) {
    this.sessionDir = join(opts.agentDir, "sessions", "claude", opts.sessionId);
    mkdirSync(this.sessionDir, { recursive: true });
    this.state = {
      model: opts.model ?? "claude-sonnet-4-20250514",
      thinking: "medium",
      status: "idle",
      tokensIn: 0, tokensOut: 0,
      contextPct: 0, contextWindow: 200_000,
      costUsd: 0,
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };
  }

  async *prompt(text: string, promptOpts?: PromptOpts): AsyncIterable<AgentEvent> {
    this.state.status = "thinking";
    this.abortController = new AbortController();

    yield { type: "turn_start", model: this.state.model, sessionId: this.opts.sessionId };

    const args = [
      "-p", "--output-format", "stream-json",
      "--model", this.state.model,
      "--continue",              // resume previous context (stateful)
      "--session-dir", this.sessionDir,
      text,
    ];

    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse Claude stream-json → AgentEvent
    const rl = readline.createInterface({ input: this.child.stdout });
    try {
      for await (const line of rl) {
        if (this.abortController.signal.aborted) break;
        const event = ClaudeEventNormalizer.parseLine(line);
        if (event) {
          this.updateState(event);
          yield event;
          this.listeners.forEach(l => l(event));
        }
      }
    } finally {
      this.state.status = "idle";
    }

    yield {
      type: "turn_end",
      tokensIn: this.state.tokensIn,
      tokensOut: this.state.tokensOut,
      costUsd: this.state.costUsd,
    };
  }

  async inject(message: BrokerMessage): Promise<void> {
    // For subprocess: inject as a new prompt with context
    const text = `[Message from ${message.from.name}]: ${message.content.text}`;
    for await (const _event of this.prompt(text)) {
      // events emitted via onEvent handlers
    }
  }

  async compact(): Promise<CompactionResult> {
    // Claude manages compaction internally via --continue
    return { tokensBefore: 0, tokensAfter: 0, strategy: "continue-session" };
  }

  async dispose() {
    this.child?.kill();
    this.listeners.clear();
  }

  // ... getState, isIdle, setModel, setThinking, onEvent ...
}
```

### 2.3 MyaNativeRuntime

Uses mya's own agent loop (`@my-agent/agent` + `runTurn()`) with pi-ai engine. Runs in-process. Always available as fallback.

```typescript
// packages/print/src/runtimes/mya-native.ts

class MyaNativeRuntime implements AgentRuntime {
  readonly runtimeType = "mya-native";
  readonly displayName = "mya (built-in)";

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: false,       // uses launcher, not full TUI
      hasHeadless: true,
      supportsTools: true,
      supportsResume: true,        // via session JSONL files
      supportsCompaction: true,    // custom compaction in @my-agent/core
      supportsImages: false,
      supportsThinking: false,
      execution: "in-process",
      maxContextWindow: 200_000,
      injectionMethod: "in-process-call",
    };
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const agent = createAgent({
      providers: this.resolveProviders(opts.env),
      tools: this.resolveTools(opts.toolsAllowList),
      memoryDir: opts.agentDir,
      systemPrompt: opts.systemPromptOverride,
    });
    return new MyaNativeSession(agent, opts);
  }

  isAvailable(): boolean { return true; }  // always — it's mya's own code

  async listModels(): Promise<ModelInfo[]> {
    return builtinModels().map(m => ({
      id: m.id, provider: m.provider,
      contextWindow: m.contextWindow, maxTokens: m.maxTokens,
    }));
  }

  private resolveProviders(env: Record<string, string>) {
    // Auto-detect from env vars (auth.json keys already set as env)
    const providers: ProviderProfile[] = [];
    for (const [envKey, apiKey] of Object.entries(env)) {
      const config = PI_AI_PROVIDERS.find(p => p.envKey === envKey);
      if (config && apiKey) {
        providers.push(new PiAiProviderProfile(config, apiKey));
      }
    }
    return providers;
  }

  private resolveTools(allowList?: string[]) {
    // Built-in tools + mya-bridge tools
    return allowList
      ? builtinTools().filter(t => allowList.includes(t.name))
      : builtinTools();
  }
}

class MyaNativeSession implements RuntimeSession {
  constructor(private agent: MyaAgent, private opts: StartOpts) {}

  async *prompt(text: string, promptOpts?: PromptOpts): AsyncIterable<AgentEvent> {
    yield { type: "turn_start", model: this.agent.model, sessionId: this.opts.sessionId };

    const handle = this.agent.startTurn({ prompt: text, model: this.opts.model });
    const events = handle.events(promptOpts?.signal);

    for await (const event of events) {
      const agentEvent = MyaEventNormalizer.toAgentEvent(event);
      if (agentEvent) yield agentEvent;
    }

    const result = await handle.done;
    yield {
      type: "turn_end",
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }

  async inject(message: BrokerMessage): Promise<void> {
    // In-process: start a new turn with the message
    const text = `[Message from ${message.from.name}]: ${message.content.text}`;
    for await (const _ of this.prompt(text)) { /* emit via handlers */ }
  }

  // ... compact, getState, isIdle, dispose, onEvent ...
}
```

---

## 3. Event Normalization Layer

Every runtime translates its native events to uniform `AgentEvent`. The gateway and dashboard only consume `AgentEvent`.

### 3.1 PiEventNormalizer

```typescript
// packages/print/src/runtimes/pi-normalizer.ts

const PI_TO_AGENT: Record<string, (event: any) => AgentEvent | null> = {
  agent_start: (e) => ({ type: "turn_start", model: e.model, sessionId: e.sessionId }),
  agent_end: () => null,  // handled by agent_settled
  agent_settled: () => null,  // signals turn_end (handled by session)

  message_start: () => null,
  message_update: (e) => {
    const textBlock = e.message?.content?.find((c: any) => c.type === "text");
    return textBlock?.text
      ? { type: "text", delta: textBlock.text }
      : null;
  },
  message_end: () => null,

  bash_execution_update: (e) => ({
    type: "tool_call",
    toolCallId: e.id ?? "bash",
    name: "bash",
    args: e.command,
  }),

  compaction_start: () => null,
  compaction_end: (e) => ({
    type: "compaction",
    result: {
      tokensBefore: e.tokensBefore ?? 0,
      tokensAfter: e.tokensAfter ?? 0,
      strategy: "native",
    },
  }),

  model_select: (e) => ({ type: "model_changed", model: e.model }),

  session_before_compact: () => null,
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

```typescript
// packages/print/src/runtimes/claude-normalizer.ts

const ClaudeEventNormalizer = {
  parseLine(line: string): AgentEvent | null {
    let data: unknown;
    try { data = JSON.parse(line); } catch { return null; }

    const obj = data as Record<string, unknown>;

    // Claude stream-json formats (verified against CLI docs):
    switch (obj.type as string) {
      case "text":
        return { type: "text", delta: obj.text as string };

      case "tool_use":
        return {
          type: "tool_call",
          toolCallId: obj.id as string,
          name: obj.name as string,
          args: obj.input,
        };

      case "tool_result":
        return {
          type: "tool_result",
          toolCallId: obj.tool_use_id as string,
          output: obj.content as string,
          error: obj.is_error === true,
        };

      case "message_start":
        return { type: "turn_start", model: obj.model as string, sessionId: "" };

      case "message_delta":
        // Contains usage info
        return null;  // token counting handled separately

      case "message_stop":
        return {
          type: "turn_end",
          tokensIn: (obj.usage?.input_tokens as number) ?? 0,
          tokensOut: (obj.usage?.output_tokens as number) ?? 0,
          costUsd: undefined,  // calculated by CostTracker
        };

      case "thinking":
        return { type: "thinking", delta: obj.thinking as string };

      default:
        return null;
    }
  },
};
```

### 3.3 MyaEventNormalizer

```typescript
// Translates @my-agent/core RuntimeEvent → AgentEvent
const RUNTIME_TO_AGENT: Record<string, (e: RuntimeEvent) => AgentEvent | null> = {
  "turn:start": (e) => e.turnEvent
    ? { type: "turn_start", model: e.turnEvent.model ?? "unknown", sessionId: "" }
    : null,
  "turn:end": (e) => e.turnEvent
    ? { type: "turn_end", tokensIn: 0, tokensOut: 0, costUsd: e.turnEvent.cost }
    : null,
  "tool:request": (e) => e.call
    ? { type: "tool_call", toolCallId: e.call.id, name: e.call.name, args: e.call.args }
    : null,
  "tool:result": (e) => e.result
    ? { type: "tool_result", toolCallId: e.call?.id ?? "", output: JSON.stringify(e.result), error: false }
    : null,
};
```

---

## 4. mya Broker

Adopted from [pi-intercom](https://github.com/nicobailon/pi-intercom). Standalone process managing agent session registration and message routing over local IPC.

### 4.1 Design

| Property | Value |
|---|---|
| Transport | Unix domain socket (Linux/Mac), named pipe (Windows) |
| Protocol | Length-prefixed JSON (4-byte BE length + JSON payload) |
| Max frame | 1 MiB |
| Max sessions | 128 |
| Rate limit | 240 token bucket, 120/s refill |
| Auto-spawn | First client connects → broker starts |
| Auto-shutdown | 0 sessions for 10s → broker exits |
| Location | `~/.mya/agent/broker/broker.sock` |
| PID file | `~/.mya/agent/broker/broker.pid` |
| Spawn lock | `~/.mya/agent/broker/broker.spawn.lock` |
| Mailbox | 256 messages, 24h TTL |
| Registration timeout | 1s (unregistered connections dropped) |

### 4.2 Wire Protocol

```typescript
// ── Client → Broker ──

{ type: "register", session: SessionRegistration, sessionId?: string }
{ type: "unregister" }
{ type: "list", requestId: string }
{ type: "send", to: string, message: Message }
{ type: "cancel_message", messageId: string }
{ type: "presence", name?, status?, model?, contextPct? }
{ type: "health", requestId: string }

// ── Broker → Client ──

{ type: "registered", sessionId: string, features: string[] }
{ type: "sessions", requestId: string, sessions: SessionInfo[] }
{ type: "message", from: SessionInfo, message: Message }
{ type: "delivered", messageId: string }
{ type: "delivery_failed", messageId: string, reason: string }
{ type: "session_joined", session: SessionInfo }
{ type: "session_left", sessionId: string }
{ type: "presence_update", session: SessionInfo }
{ type: "health_ok", requestId: string, protocol: string, version: number }
{ type: "error", error: string }
```

### 4.3 Types

```typescript
interface SessionRegistration {
  name?: string;
  cwd: string;
  model: string;
  pid: number;
  startedAt: number;
  lastActivity: number;
  status?: string;
  agentType: string;
  capabilities?: AgentCapabilities;
}

interface Message {
  id: string;
  timestamp: number;
  senderSequence: number;
  replyTo?: string;
  expectsReply?: boolean;
  content: {
    text: string;
    attachments?: Attachment[];
  };
  brokerReceivedAt?: number;
  brokerDeliveredAt?: number;
  receiverReceivedAt?: number;
  injectedAt?: number;
}

interface Attachment {
  type: "file" | "snippet" | "context";
  name: string;
  content: string;
  language?: string;
}
```

### 4.4 Communication Patterns

| Pattern | Blocking? | Timeout | Use case |
|---|---|---|---|
| `send` | No | — | Fire-and-forget (task delegation) |
| `ask` | Yes | 10 min (configurable via `MYA_BROKER_ASK_TIMEOUT_MS`) | Worker → supervisor question |
| `reply` | No | — | Reply to an `ask` (matched by `replyTo`) |

`ask` is implemented client-side: sender sends `expectsReply: true`, blocks on a promise that resolves when a matching reply arrives. Broker routes the reply normally.

### 4.5 Security

- Unix socket permissions: `0o600` (owner read/write only)
- Directory permissions: `0o700`
- `trustedLocal` flag set for same-user connections
- Rate limiting prevents abuse
- No remote connections (same-machine only by design)

### 4.6 Broker as Extension Channel

Other mya extensions can use the broker for non-conversational coordination (state management, pub/sub). Adopted from pi-intercom's extension channel pattern:

```typescript
// Register an extension channel
broker.registerExtension({
  namespace: "mya/cron-coordination",
  ownerEligible: true,
  onReady: (channel) => { /* publish/subscribe */ },
  onEvent: (event) => { /* handle events */ },
});
```

Features:
- One owner per namespace (elected by broker)
- Compare-and-swap state commits (revisioned)
- 16 KiB max payload per message
- 64 KiB max state per namespace
- Messages don't enter agent transcript or trigger turns

---

## 5. Smart Router

Selects the best runtime for a task based on multiple factors.

### 5.1 Router Interface

```typescript
// packages/print/src/router.ts

class SmartRouter {
  constructor(
    private runtimes: Map<string, AgentRuntime>,
    private config: RouterConfig,
    private memory: Brain,
    private costTracker: CostTracker,
  ) {}

  select(task: RouterInput): RouterResult {
    const candidates = this.filterAvailable(task);
    if (candidates.length === 0) {
      throw new Error("No runtime available for this task");
    }

    // Score each candidate
    const scored = candidates.map(rt => ({
      runtime: rt,
      score: this.score(rt, task),
    }));

    scored.sort((a, z) => z.score - a.score);
    return { runtime: scored[0].runtime, reason: scored[0].reason };
  }
}

interface RouterInput {
  prompt: string;
  agentOverride?: string;       // explicit --agent flag
  modelOverride?: string;       // explicit --model flag
  historyLength?: number;       // for context window awareness
  channelSource?: string;       // "telegram" | "dashboard" | "cron" | "cli"
  budgetRemainingUsd?: number;
}

interface RouterResult {
  runtime: AgentRuntime;
  reason: string;
}
```

### 5.2 Scoring Algorithm

```typescript
private score(rt: AgentRuntime, input: RouterInput): { score: number; reason: string } {
  let score = 0;
  const caps = rt.capabilities();
  const reasons: string[] = [];

  // 1. Explicit override = instant win
  if (input.agentOverride === rt.runtimeType) {
    return { score: Infinity, reason: "explicit override" };
  }

  // 2. Model availability
  if (input.modelOverride) {
    const models = rt.listModels();
    const hasModel = models.some(m => m.id === input.modelOverride);
    if (!hasModel) return { score: -1, reason: "model not available" };
    score += 100;
    reasons.push("model available");
  }

  // 3. Config rules (regex match, weighted)
  for (const rule of this.config.rules) {
    if (rule.match.test(input.prompt) && rule.agent === rt.runtimeType) {
      score += rule.weight ?? 50;
      reasons.push(`rule: ${rule.match}`);
    }
  }

  // 4. Capabilities bonus
  if (caps.supportsCompaction && (input.historyLength ?? 0) > 50) {
    score += 20;
    reasons.push("compaction for long session");
  }
  if (caps.supportsImages && /image|screenshot|diagram/i.test(input.prompt)) {
    score += 30;
    reasons.push("image support");
  }

  // 5. Cost penalty (lower cost = higher score)
  const cost = rt.costPerMTokens?.();
  if (cost && input.budgetRemainingUsd !== undefined && input.budgetRemainingUsd < 1) {
    score -= cost.input + cost.output;
    reasons.push("cost penalty (low budget)");
  }

  // 6. Channel default
  if (input.channelSource) {
    const channelDefault = this.config.channelDefaults?.[input.channelSource];
    if (channelDefault === rt.runtimeType) {
      score += 40;
      reasons.push(`channel default for ${input.channelSource}`);
    }
  }

  // 7. Execution preference (in-process > subprocess for performance)
  if (caps.execution === "in-process") {
    score += 10;
    reasons.push("in-process (fast)");
  }

  return { score, reason: reasons.join(", ") };
}
```

### 5.3 Config

```json
// ~/.mya/agent/router.json
{
  "defaultAgent": "pi",
  "rules": [
    { "match": "refactor|typescript|rust|napi", "agent": "pi", "weight": 80 },
    { "match": "review|security|audit|vulnerab", "agent": "claude", "weight": 70 },
    { "match": "research|browse|search", "agent": "pi", "weight": 40 },
    { "match": "diagram|image|screenshot", "agent": "pi", "weight": 30 }
  ],
  "channelDefaults": {
    "telegram": "pi",
    "discord": "claude",
    "cron": "mya-native"
  }
}
```

---

## 6. Shared Infrastructure

### 6.1 Memory (Cross-Agent Brain)

Works at the **prompt enrichment layer** — before spawning any agent:

```typescript
// packages/print/src/prompt-enricher.ts

class PromptEnricher {
  constructor(
    private brain: Brain,
    private roleRegistry: RoleRegistry,
    private sessionStore: SessionStore,
  ) {}

  async enrich(prompt: string, ctx: EnrichContext): Promise<string> {
    const parts: string[] = [];

    // 1. Role system prompt
    if (ctx.role) {
      const role = await this.roleRegistry.get(ctx.role);
      if (role?.promptAppend) {
        parts.push(`<role>\n${role.promptAppend}\n</role>`);
      }
    }

    // 2. Relevant memories (semantic search)
    const memories = this.brain.semanticSearch(prompt, { limit: 5 });
    if (memories.length > 0) {
      const memoryBlock = memories
        .map(m => `- [${new Date(m.createdAt).toISOString()}] ${m.content}`)
        .join("\n");
      parts.push(`<relevant_memories>\n${memoryBlock}\n</relevant_memories>`);
    }

    // 3. Conversation history (for stateless agents only)
    if (ctx.executionModel === "subprocess") {
      const history = await this.sessionStore.getHistory(ctx.sessionId);
      const compacted = await this.compactHistory(history, ctx);
      if (compacted) {
        parts.push(`<previous_conversation>\n${compacted}\n</previous_conversation>`);
      }
    }

    // 4. AGENTS.md context (if in project directory)
    if (ctx.agentsMd) {
      parts.push(`<project_context>\n${ctx.agentsMd}\n</project_context>`);
    }

    parts.push(prompt);
    return parts.join("\n\n");
  }

  async capture(output: string, ctx: EnrichContext): Promise<void> {
    // Store in brain for future recall
    this.brain.recordFact({
      content: output.slice(0, 2000),  // cap stored content
      tags: ["auto-capture", ctx.runtimeType],
      confidence: 0.7,
    });

    // Store in session history
    await this.sessionStore.append(ctx.sessionId, {
      role: "assistant",
      content: output,
      timestamp: Date.now(),
    });
  }
}
```

### 6.2 Auth (Shared Credential Store)

```typescript
// packages/print/src/auth-injector.ts

function buildAgentEnv(): Record<string, string> {
  const auth = loadAuthConfig();  // ~/.mya/agent/auth.json
  const env: Record<string, string> = {};

  // Provider credentials → env vars (engine-driven mapping)
  for (const [providerId, credential] of Object.entries(auth)) {
    if (credential.type === "api_key" && credential.key) {
      const envKeys = providerRegistry.getAllEnvKeys(providerId);
      for (const key of envKeys) env[key] = credential.key;
    }
  }

  // Custom env section (CAMOFOX_URL, MINIMAX_MODEL, etc.)
  if (auth.env) Object.assign(env, auth.env);

  // Pi-specific
  env.PI_CODING_AGENT_DIR = join(homedir(), ".mya/agent");

  // Register OAuth + Bedrock for pi (bundled agents)
  env.MYA_REGISTER_BUN_OAUTH = "1";

  return env;
}
```

### 6.3 Compaction Manager

Multi-strategy compaction for stateless agent sessions.

```typescript
// packages/print/src/compaction.ts

class CompactionManager {
  constructor(
    private tokenCounter: TokenCounter,
    private llmSummarizer?: LlmSummarizer,
  ) {}

  async compact(
    history: Message[],
    runtime: AgentRuntime,
    contextWindow: number,
  ): Promise<{ messages: Message[]; result: CompactionResult }> {
    const totalTokens = this.tokenCounter.count(history);
    const threshold = contextWindow * 0.7;  // compact at 70%

    if (totalTokens < threshold) {
      return {
        messages: history,
        result: { tokensBefore: totalTokens, tokensAfter: totalTokens, strategy: "none" },
      };
    }

    // Strategy 1: Native compaction (pi, mya-native)
    if (runtime.capabilities().supportsCompaction) {
      return { messages: history, result: { tokensBefore: totalTokens, tokensAfter: totalTokens, strategy: "native" } };
    }

    // Strategy 2: Agent --continue (Claude)
    if (runtime.capabilities().supportsResume) {
      return { messages: history, result: { tokensBefore: totalTokens, tokensAfter: 0, strategy: "continue-session" } };
    }

    // Strategy 3: LLM summarization
    if (this.llmSummarizer) {
      const summary = await this.llmSummarizer.summarize(history);
      const compacted: Message[] = [
        { role: "system", content: `<conversation_summary>\n${summary}\n</conversation_summary>`, timestamp: Date.now() },
        ...history.slice(-5),  // keep last 5 messages verbatim
      ];
      const afterTokens = this.tokenCounter.count(compacted);
      return { messages: compacted, result: { tokensBefore: totalTokens, tokensAfter: afterTokens, strategy: "llm-summarize" } };
    }

    // Strategy 4: Truncate (emergency fallback)
    const truncated = history.slice(-10);
    const afterTokens = this.tokenCounter.count(truncated);
    return { messages: truncated, result: { tokensBefore: totalTokens, tokensAfter: afterTokens, strategy: "truncate" } };
  }
}
```

### 6.4 Cost Tracker

```typescript
// packages/print/src/cost-tracker.ts

class CostTracker {
  private sessions = new Map<string, SessionCost>();

  record(sessionId: string, event: AgentEvent): void {
    if (event.type !== "turn_end") return;
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = { sessionId, totalUsd: 0, turns: 0, tokensIn: 0, tokensOut: 0 };
      this.sessions.set(sessionId, entry);
    }
    entry.turns++;
    entry.tokensIn += event.tokensIn;
    entry.tokensOut += event.tokensOut;
    if (event.costUsd) entry.totalUsd += event.costUsd;
  }

  getSessionCost(sessionId: string): SessionCost | undefined {
    return this.sessions.get(sessionId);
  }

  getTotalCost(): { totalUsd: number; sessions: number } {
    let total = 0;
    for (const s of this.sessions.values()) total += s.totalUsd;
    return { totalUsd: total, sessions: this.sessions.size };
  }
}
```

### 6.5 Session Store (SQLite)

For stateless agents that need history persistence.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  runtime_type TEXT NOT NULL,
  cwd TEXT NOT NULL,
  model TEXT,
  role TEXT,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,        -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  tokens INTEGER,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
```

---

## 7. Gateway Integration

### 7.1 Runtime Registry

```typescript
// Gateway startup
const runtimes = new Map<string, AgentRuntime>();

// Register runtimes (order matters — first available is fallback)
runtimes.set("pi", new PiInProcessRuntime());
runtimes.set("mya-native", new MyaNativeRuntime());
runtimes.set("claude", new ClaudeRuntime());
// runtimes.set("opencode", new OpenCodeRuntime());  // when available

const router = new SmartRouter(runtimes, routerConfig, brain, costTracker);
const broker = new BrokerClient(brokerConfig);
const enricher = new PromptEnricher(brain, roleRegistry, sessionStore);
const compaction = new CompactionManager(tokenCounter, llmSummarizer);
```

### 7.2 Session Creation

```typescript
// Updated createSession — routes to runtime SPI
const pool = new AgentPool({
  maxSessions: 1000,
  idleTtlMs: 3_600_000,
  createSession: async (sessionId, cwd, agentDir, opts?: { agentType?: string }) => {
    // 1. Select runtime
    const runtime = opts?.agentType
      ? runtimes.get(opts.agentType)
      : router.select({ prompt: "", cwd }).runtime;
    if (!runtime) throw new Error(`Runtime not available`);

    // 2. Start runtime session
    const env = buildAgentEnv();
    const runtimeSession = await runtime.start({
      cwd, agentDir, sessionId,
      model: opts?.model,
      env,
      broker,
    });

    // 3. Wrap in AgentSession interface (for AgentPool compatibility)
    return new RuntimeSessionAdapter(runtimeSession, enricher, compaction, costTracker);
  },
});
```

### 7.3 RuntimeSessionAdapter

Bridges `RuntimeSession` (new SPI) to `AgentSession` (existing pool interface):

```typescript
class RuntimeSessionAdapter implements AgentSession {
  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private compaction: CompactionManager,
    private costTracker: CostTracker,
  ) {
    // Forward out-of-band events
    this.session.onEvent((event) => {
      this.listeners.forEach(l => l(event));
    });
  }

  private listeners = new Set<(e: unknown) => void>();

  async prompt(text: string, options?: unknown): Promise<void> {
    // 1. Enrich prompt (memory + history + role)
    const enriched = await this.enricher.enrich(text, {
      sessionId: this.session.sessionId,
      runtimeType: this.session.runtimeType,
      executionModel: this.session.executionModel,
    });

    // 2. Stream events to subscribers
    for await (const event of this.session.prompt(enriched)) {
      this.costTracker.record(this.session.sessionId, event);
      this.listeners.forEach(l => l(event));
    }

    // 3. Capture output
    const output = this.collectText();
    await this.enricher.capture(output, {
      sessionId: this.session.sessionId,
      runtimeType: this.session.runtimeType,
    });
  }

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort() { this.session.dispose(); }
  get sessionFile() { return undefined; }
  get sessionId() { return this.session.sessionId; }
}
```

### 7.4 Gateway API (enhanced)

New endpoints for multi-agent + broker:

```
# Existing (unchanged behavior, now routes via runtime SPI)
POST   /sessions                          → { agent?: string, model?: string }
POST   /sessions/:id/prompt               → stream AgentEvent[]
GET    /sessions                          → list with runtimeType
DELETE /sessions/:id                      → dispose

# New: agent management
GET    /agents                            → list runtimes + availability + capabilities
GET    /agents/:type/models               → models for specific runtime

# New: broker
GET    /broker/sessions                   → list broker-connected sessions
POST   /broker/send                       → { to, message }
POST   /broker/ask                        → { to, message } (blocking)

# New: cost
GET    /cost                              → { totalUsd, perSession, perRuntime }
```

---

## 8. Execution Paths

### 8.1 Interactive: `mya pi` / `mya claude`

```
1. mya CLI reads auth.json → builds env
2. Router or explicit flag identifies runtime
3. Runtime.spawnInteractive():
   - pi: spawn("pi", [...], { stdio: "inherit" })
   - claude: spawn("claude", [...], { stdio: "inherit" })
4. Agent owns terminal — native TUI
5. Agent connects to broker (if running) via mya-bridge tool
6. User exits → mya CLI exits
```

Gateway not involved. Direct subprocess.

### 8.2 Print mode: `mya -p "task"`

```
1. Router.select({ prompt: "task" }) → best runtime
2. Runtime.start() → RuntimeSession
3. Session.prompt("task") → stream AgentEvent
4. Normalize events → print to terminal
5. brain.remember(output)
6. Dispose session
```

Gateway not involved for CLI print. Direct in-process or subprocess.

### 8.3 Cron trigger (via gateway)

```
1. CronScheduler fires job
2. Router.select({ prompt: job.prompt, agent: job.agent, channel: "cron" })
3. Pool creates session via runtime SPI
4. enricher.enrich(prompt) — memory + role injection
5. RuntimeSession.prompt(enrichedPrompt)
6. Stream AgentEvent → capture output
7. brain.remember(output)
8. Route result to channel (if configured)
```

### 8.4 Channel message (via gateway)

```
1. Telegram webhook → Gateway
2. Router.select({ prompt: message, channel: "telegram" })
3. Pool creates/acquires session
4. enricher.enrich(message) — memory + history
5. RuntimeSession.prompt(enriched)
6. Stream → collect text → strip ANSI
7. brain.remember(output)
8. Telegram reply
```

### 8.5 Dashboard (via gateway)

```
1. Browser → WebSocket → Gateway
2. POST /sessions { agent: "claude" }
   → Gateway creates RuntimeSession via SPI
   → Returns sessionId
3. POST /sessions/:id/prompt
   → enricher.enrich(text)
   → RuntimeSession.prompt(enriched)
   → Stream AgentEvent → WS → browser
4. AgentEvent is UNIFORM — browser renders same UI for all agents
5. Broker messages → RuntimeSession.inject() → WS event
```

### 8.6 Inter-agent messaging (via broker)

```
1. pi session (planner) calls intercom tool:
   intercom({ action: "send", to: "worker", message: "implement retry" })

2. mya-bridge tool → BrokerClient.send("worker", message)

3. Broker routes to Claude session (worker)

4. ClaudeSession.inject(message)
   → spawns: claude --continue -p "[Message from planner]: implement retry"
   → streams AgentEvents → broker reply when done

5. Broker routes reply back to planner

6. PiInProcessSession receives reply via pi.sendMessage()
```

---

## 9. File Structure

```
packages/
├── core/src/
│   ├── runtime-spi.ts              # AgentRuntime + RuntimeSession interfaces
│   ├── agent-event.ts              # Uniform AgentEvent type
│   └── broker/                     # Broker (adopted from pi-intercom)
│       ├── broker.ts               # Broker process (~1542 lines)
│       ├── client.ts               # BrokerClient (~630 lines)
│       ├── framing.ts              # Length-prefixed JSON (~120 lines)
│       ├── paths.ts                # Socket/pipe resolution (~200 lines)
│       └── spawn.ts                # Auto-spawn logic (~400 lines)
│
├── print/src/
│   ├── router.ts                   # SmartRouter (~400 lines)
│   ├── prompt-enricher.ts          # Memory + history injection (~200 lines)
│   ├── auth-injector.ts            # Auth → env vars (~100 lines)
│   ├── compaction.ts               # Multi-strategy compaction (~300 lines)
│   ├── cost-tracker.ts             # Per-session cost tracking (~200 lines)
│   ├── session-store.ts            # SQLite session history (~200 lines)
│   ├── token-counter.ts            # Token estimation (~100 lines)
│   ├── runtimes/
│   │   ├── pi-in-process.ts        # PiInProcessRuntime + Session (~400 lines)
│   │   ├── pi-normalizer.ts        # Pi events → AgentEvent (~200 lines)
│   │   ├── claude.ts               # ClaudeRuntime + Session (~500 lines)
│   │   ├── claude-normalizer.ts    # Claude JSON → AgentEvent (~200 lines)
│   │   ├── mya-native.ts           # MyaNativeRuntime + Session (~300 lines)
│   │   ├── mya-normalizer.ts       # RuntimeEvent → AgentEvent (~150 lines)
│   │   └── runtime-adapter.ts      # RuntimeSessionAdapter for AgentPool (~200 lines)
│   └── broker/
│       ├── broker-tool.ts          # mya-bridge intercom tool (~300 lines)
│       └── broker-cli.ts           # `mya broker` CLI commands (~200 lines)
│
├── gateway/src/
│   └── index.ts                    # Updated: runtime registry, new endpoints
│
tests/
├── broker/                         # Broker tests (~800 lines)
├── runtimes/                       # Runtime + normalizer tests (~1000 lines)
├── router/                         # Router scoring tests (~400 lines)
├── compaction/                     # Compaction strategy tests (~400 lines)
└── integration/                    # E2E: cron → router → runtime → broker (~800 lines)

~/.mya/agent/
├── auth.json                       # Shared credentials
├── broker/
│   ├── broker.sock
│   ├── broker.pid
│   └── broker.spawn.lock
├── router.json
├── brain.db                        # Shared memory
├── sessions.db                     # Session history (stateless agents)
└── sessions/
    ├── pi/                         # Pi session files
    ├── claude/                     # Claude session dirs (--continue)
    └── mya/                        # mya-native session JSONL
```

---

## 10. Implementation Phases

| Phase | Scope | Deliverable | Key Risk |
|---|---|---|---|
| **1** | Broker + framing + auto-spawn + client | 2 processes exchange messages via Unix socket | Spawn race conditions |
| **2** | AgentRuntime SPI + AgentEvent types + tests | Interface defined, compiles, unit tests pass | Interface stability |
| **3** | PiInProcessRuntime + PiEventNormalizer | Gateway sessions work with uniform events | Event mapping correctness |
| **4** | RuntimeSessionAdapter + gateway integration | Existing gateway features work through SPI | AgentPool compatibility |
| **5** | MyaNativeRuntime + MyaEventNormalizer | `--agent mya` works, events match format | runTurn → AgentEvent mapping |
| **6** | ClaudeRuntime + ClaudeEventNormalizer | `--agent claude` works, events normalized | Claude CLI flag verification |
| **7** | PromptEnricher + AuthInjector | Memory + role injection before every prompt | Brain API alignment |
| **8** | CompactionManager + TokenCounter | Sessions scale infinitely | Token estimation accuracy |
| **9** | SmartRouter + config | Auto-routing with scoring | Scoring edge cases |
| **10** | CostTracker + dashboard integration | Per-agent cost tracking, multi-agent dashboard | WS event format |
| **11** | Broker-mediated inter-agent messaging | send/ask/reply between agents | Injection per runtime |
| **12** | `mya broker` CLI + `mya agents` CLI | CLI commands for management | UX polish |
| **13** | Cold review + E2E tests + hardening | Full system verified | All of the above |

---

## 11. Component Estimates

| Component | Lines | Notes |
|---|---|---|
| Broker (adopt from pi-intercom) | ~2900 | broker.ts + client.ts + framing.ts + paths.ts + spawn.ts |
| AgentRuntime SPI types | ~300 | interfaces, AgentEvent, capabilities |
| PiInProcessRuntime | ~600 | runtime + session + normalizer |
| ClaudeRuntime | ~700 | runtime + session + normalizer |
| MyaNativeRuntime | ~450 | runtime + session + normalizer |
| RuntimeSessionAdapter | ~200 | bridge SPI → AgentPool |
| SmartRouter | ~400 | scoring algorithm + config |
| PromptEnricher | ~200 | memory + role + history |
| AuthInjector | ~100 | auth.json → env |
| CompactionManager | ~300 | multi-strategy |
| CostTracker | ~200 | per-session aggregation |
| SessionStore | ~200 | SQLite CRUD |
| TokenCounter | ~100 | tiktoken estimation |
| Broker tool + CLI | ~500 | mya-bridge tool + `mya broker` commands |
| Tests | ~3400 | unit + integration + E2E |
| **Total** | **~10500** | |

---

## 12. What mya Already Has (Reuse)

| Component | Status | Changes Needed |
|---|---|---|
| Gateway HTTP/WS | ✅ Complete | Add /agents, /broker, /cost endpoints |
| AgentPool | ✅ Complete | Pass runtimeType to createSession |
| Cron scheduler | ✅ Complete | Add agentType to job config |
| Channels (TG/Disc) | ✅ Complete | Route through SmartRouter |
| Memory (Brain) | ✅ Complete | Add semanticSearch() method |
| Auth (auth.json) | ✅ Complete | Wrap in AuthInjector |
| Launcher | ✅ Complete | Add agent selector |
| Roles | ✅ Complete | Inject via PromptEnricher |
| MCP | ✅ Complete | Pass to PiInProcessRuntime env |
| @my-agent/agent | ✅ Complete | MyaNativeRuntime wraps it |
| @my-agent/core | ✅ Complete | runTurn for mya-native |
| Provider registry | ✅ Complete | Engine-driven, used by AuthInjector |
| Bundle dedup | ✅ Complete | Keeps singletons correct |

---

## 13. Limitations & Mitigations

| Limitation | Mitigation |
|---|---|
| Bridge tools (recall, remember) only work in pi interactive | PromptEnricher injects memories pre-spawn for all agents |
| Claude CLI flags unverified | Phase 6 starts with flag verification spike |
| Stateless sessions respawn per message (2-5s overhead) | `--continue` makes Claude stateful; mya-native is in-process |
| Output format varies per agent | Event normalization layer translates everything to AgentEvent |
| Session format incompatible across runtimes | Each runtime manages own sessions; SessionStore stores metadata |
| Agent binary must be installed | `mya agents install` wrapper + isAvailable() check |
| Same-machine only (Unix socket) | By design — remote agents = future TCP transport |
| Broker crash = messaging down | Auto-reconnect (adopted from pi-intercom) + gateway Restart=always |
| Cost tracking incomplete for subprocess agents | Parse turn_end tokensIn/tokensOut; estimate cost from model pricing |
| Tool call rendering differs per agent | Dashboard renders tool_call/tool_result uniformly from AgentEvent |

---

## 14. User Experience

### Commands

```bash
# ── Interactive (native TUI per agent) ──
mya                              # launcher → select agent → spawn
mya pi                           # pi TUI
mya claude                       # Claude Code CLI
mya opencode                     # OpenCode TUI

# ── Print mode (one-shot, any agent) ──
mya -p "refactor auth.ts"                           # router selects
mya -p "review security" --agent claude             # explicit
mya -p "write tests" --agent pi --model glm-5.1     # agent + model

# ── Broker ──
mya broker status                # connected sessions + presence
mya broker send --to worker "task 3 done"
mya broker ask --to planner "which API?"            # blocking

# ── Cron ──
mya cron add "0 9 * * *" "daily scan" --agent claude
mya cron list                    # jobs + agent + last result + cost

# ── Management ──
mya status                       # all agents: available? sessions? cost?
mya agents                       # list runtimes + capabilities + models
mya agents install claude        # npm install -g @anthropic-ai/claude-code
mya cost                         # total spend, per-session, per-runtime
```

### Dashboard

```
┌──────────────────────────────────────────────────────────┐
│  mya Dashboard                              [pi ▾]       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─ Agents ───────────────────────────────────────────┐ │
│  │ ● pi          Available · 38 models · in-process   │ │
│  │ ● mya-native  Available · 38 models · in-process   │ │
│  │ ○ claude      Not installed                        │ │
│  │ ○ opencode    Not installed                        │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Sessions ─────────────────────────────────────────┐ │
│  │ ● planner (pi)        idle · 42% ctx · $0.03       │ │
│  │ ● worker (claude)     thinking · 15% ctx · $0.12   │ │
│  │ + New session [pi ▾] [claude] [mya]                │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Chat (worker · claude) ───────────────────────────┐ │
│  │ User: implement retry logic                         │ │
│  │ Claude: I'll add retry to the API client...         │ │
│  │ [tool] read src/api/client.ts                       │ │
│  │ [tool] edit src/api/client.ts                       │ │
│  │ Claude: Added RetryPolicy type, 3 tests passing.    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Cost: $0.15 today · $2.30 this month                   │
│  > _____________________________________________ [Send]  │
└──────────────────────────────────────────────────────────┘
```

---

## 15. Comparison: Current vs This Spec

| Aspect | Current (pi engine only) | This Spec (multi-agent platform) |
|---|---|---|
| Agent backends | pi only | pi (in-process), Claude, OpenCode, mya-native |
| Pi feature completeness | 100% (in-process) | 100% (stays in-process) |
| Inter-agent messaging | ❌ | ✅ Broker (Unix socket, send/ask/reply) |
| Event format | pi raw events | Uniform AgentEvent (all agents) |
| Dashboard multi-agent | ❌ | ✅ Same UI for every agent |
| Memory (cross-agent) | ❌ | ✅ PromptEnricher + semanticSearch |
| Compaction | pi native only | Multi-strategy (native / --continue / LLM / truncate) |
| Smart routing | ❌ | ✅ Model + capability + cost aware |
| Cost tracking | ❌ | ✅ Per-session, per-runtime |
| Agent crash isolation | Shared process | Pi: shared. Others: separate process. |
| Broker presence | ❌ | ✅ Real-time status broadcasting |
| Code to maintain | ~0 (pi handles) | ~10500 lines |
| mya identity | "pi + tools" | Orchestration platform |
