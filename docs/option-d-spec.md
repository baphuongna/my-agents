# Option D — mya Orchestration Platform Specification

## Overview

mya is an **orchestration platform** that manages multiple coding agents (pi, Claude Code, OpenCode, custom). Each agent runs natively with its own TUI/loop/tools. mya provides the **broker, router, shared memory, channels, and scheduling** that connect them.

```
┌──────────────────────────────────────────────────────────┐
│                     mya daemon                            │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────────┐  │
│  │  Cron   │  │ Channels │  │  HTTP / WebSocket      │  │
│  │scheduler│  │(TG/Disc) │  │  Dashboard + Print API │  │
│  └────┬────┘  └────┬─────┘  └───────────┬────────────┘  │
│       └────────────┼────────────────────┘               │
│                    ▼                                     │
│  ┌────────────────────────────────────────────────────┐ │
│  │                Smart Router                         │ │
│  │   task → select agent → spawn/inject               │ │
│  └──────────────────────┬─────────────────────────────┘ │
│                         ▼                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │              mya Broker                             │ │
│  │   Unix socket · length-prefixed JSON                │ │
│  │   session registry · message routing · presence     │ │
│  │   send / ask / reply · attachments · mailbox        │ │
│  └──┬──────────┬──────────┬──────────┬────────────────┘ │
│     ▼          ▼          ▼          ▼                  │
│  ┌──────┐ ┌────────┐ ┌─────────┐ ┌──────────┐           │
│  │ pi   │ │ claude │ │ opencode│ │ mya-     │           │
│  │adapter│ │adapter │ │ adapter │ │ native   │           │
│  └──┬───┘ └───┬────┘ └────┬────┘ └───┬──────┘           │
│     │         │           │           │                  │
│  ┌──┴─────────┴───────────┴───────────┴──────────────┐  │
│  │           Shared Infrastructure                    │  │
│  │  Memory (brain) · Auth · Roles · Sessions · MCP    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌───────────┐  ┌───────────┐
    │  pi TUI │   │  claude   │  │ opencode  │
    │ (native)│   │   CLI     │  │   TUI     │
    └─────────┘   └───────────┘  └───────────┘
    own process    own process    own process
```

---

## 1. mya Broker

### 1.1 Design

Adopted from [pi-intercom](https://github.com/nicobailon/pi-intercom). The broker is a standalone process that manages agent session registration and message routing over local IPC.

| Property | Value |
|---|---|
| Transport | Unix domain socket (Linux/Mac), named pipe (Windows) |
| Protocol | Length-prefixed JSON (4-byte BE length + JSON payload) |
| Max frame | 1 MiB |
| Auto-spawn | First agent connects → broker starts |
| Auto-shutdown | 0 sessions for 10s → broker exits |
| Location | `~/.mya/agent/broker/broker.sock` |
| PID file | `~/.mya/agent/broker/broker.pid` |
| Lock file | `~/.mya/agent/broker/broker.spawn.lock` |

### 1.2 Wire Protocol

All messages are JSON objects with a `type` field. Framing: `writeUInt32BE(len) + JSON`.

#### Client → Broker

```typescript
// Register a session
{ type: "register", session: SessionRegistration, sessionId?: string }

// Unregister
{ type: "unregister" }

// List sessions
{ type: "list", requestId: string }

// Send message (fire-and-forget)
{ type: "send", to: string, message: Message }

// Cancel a sent message
{ type: "cancel_message", messageId: string }

// Update presence (status, context usage)
{ type: "presence", name?: string, status?: string, model?: string, contextPct?: number | null }

// Health check
{ type: "health", requestId: string }
```

#### Broker → Client

```typescript
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

### 1.3 Types

```typescript
interface SessionRegistration {
  name?: string;           // human-readable, unique within broker
  cwd: string;             // working directory
  model: string;           // current model
  pid: number;             // process ID
  startedAt: number;       // epoch ms
  lastActivity: number;    // epoch ms
  status?: string;         // "idle" | "thinking" | "tool:<name>" | custom
  agentType: string;       // "pi" | "claude" | "opencode" | "mya-native" | custom
  capabilities?: AgentCapabilities;
}

interface SessionInfo extends SessionRegistration {
  id: string;              // UUID, assigned by broker
}

interface Message {
  id: string;              // UUID
  timestamp: number;       // epoch ms
  senderSequence: number;  // monotonic per sender
  replyTo?: string;        // message ID being replied to
  expectsReply?: boolean;  // true for "ask" pattern
  content: {
    text: string;
    attachments?: Attachment[];
  };
  // Diagnostic timestamps (filled by broker)
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

interface AgentCapabilities {
  hasTUI: boolean;
  hasPrintMode: boolean;
  hasRpcMode: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsSessionRestore: boolean;
  injectionMethod: "extension" | "stdin" | "rpc" | "in-process";
}
```

### 1.4 Message Routing

```
Agent A calls: send({ to: "worker", message: { content: { text: "do task 3" } } })
                                    │
                        Broker finds session named "worker"
                                    │
                                    ▼
Broker writes to Agent B socket: { type: "message", from: A_info, message: ... }
                                    │
                                    ▼
Agent B's adapter receives message → injects into agent session
```

**Resolution order**: exact session ID → exact name match → unique ID prefix. Ambiguous name = error (must use ID).

### 1.5 send vs ask

| Action | Blocking? | Timeout | Use case |
|---|---|---|---|
| `send` | No | — | Fire-and-forget (task delegation, notifications) |
| `ask` | Yes | 10 min (configurable) | Worker → supervisor question (blocks until reply) |
| `reply` | No | — | Reply to an `ask` (matched by `replyTo`) |

`ask` is implemented client-side: the sender's adapter sends a message with `expectsReply: true`, then blocks on a promise that resolves when a matching reply arrives. The broker routes the reply normally — it has no special ask/response mode.

### 1.6 Mailbox

Sessions that disconnect have their messages queued in a bounded in-memory mailbox (256 messages, 24h TTL). When a session with the same ID or (name + cwd) reconnects, queued messages are flushed. This supports short-lived CLI senders that exit before the answer arrives.

---

## 2. Agent Adapter SPI

Each agent type implements an adapter that connects to the broker and translates messages to/from the agent's native interface.

```typescript
// packages/core/src/agent-adapter.ts

interface AgentAdapter {
  readonly agentType: string;          // "pi" | "claude" | "opencode" | "mya-native"

  /** Start an interactive session (agent owns the terminal). */
  spawnInteractive(opts: SpawnOpts): ChildProcess;

  /** Start a headless session (subprocess, capture output). */
  spawnHeadless(opts: SpawnOpts): HeadlessSession;

  /** Connect a long-running process to the broker (for gateway sessions). */
  connectToBroker(opts: BrokerConnectOpts): BrokerSession;

  /** Check if the agent binary is available on this machine. */
  isAvailable(): boolean;

  /** List models (if the agent supports model discovery). */
  listModels?(): Promise<ModelInfo[]>;

  /** Get capabilities. */
  capabilities(): AgentCapabilities;
}

interface SpawnOpts {
  cwd: string;
  prompt?: string;
  model?: string;
  sessionFile?: string;
  systemPromptOverride?: string;
  env: Record<string, string>;
}

interface HeadlessSession {
  /** Stream output events until the process exits. */
  stream(): AsyncIterable<AgentOutput>;
  /** Kill the subprocess. */
  kill(): void;
  /** Process exit promise. */
  done: Promise<{ code: number; signal?: string }>;
}

type AgentOutput =
  | { type: "text"; delta: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; output: string; error?: boolean }
  | { type: "thinking"; delta: string }
  | { type: "done"; tokensIn: number; tokensOut: number; costUsd?: number }
  | { type: "error"; message: string };

interface BrokerSession {
  readonly sessionId: string;
  /** Inject a message into the agent session (from broker). */
  inject(message: Message): Promise<void>;
  /** Send the agent's response back through the broker. */
  onOutput(handler: (output: AgentOutput) => void): void;
  /** Dispose the session. */
  dispose(): Promise<void>;
}
```

---

## 3. Agent Adapters

### 3.1 Pi Adapter

Pi supports 3 injection methods. The adapter selects the best based on context.

#### Interactive mode

```typescript
// pi-adapter.ts — spawnInteractive()
spawnInteractive(opts: SpawnOpts): ChildProcess {
  // 1. Set env: PI_CODING_AGENT_DIR, auth keys, MYA_SKILL_SOURCE
  // 2. Spawn pi with mya-bridge extension
  // 3. stdio: inherit — pi owns terminal
  return spawn("pi", [
    "--extension", "mya-bridge",
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.prompt ? [opts.prompt] : []),
  ], {
    stdio: "inherit",
    env: { ...process.env, ...opts.env, PI_CODING_AGENT_DIR: "~/.mya/agent" },
    cwd: opts.cwd,
  });
}
```

#### Broker connection (gateway/dashboard)

```typescript
// pi-adapter.ts — connectToBroker()
// Pi has --mode rpc: JSON-RPC 2.0 over stdin/stdout.
// The adapter spawns pi in RPC mode and bridges broker messages ↔ RPC.

connectToBroker(opts: BrokerConnectOpts): BrokerSession {
  const child = spawn("pi", [
    "--mode", "rpc",
    "--extension", "mya-bridge",
    ...(opts.model ? ["--model", opts.model] : []),
  ], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
  });

  // Bridge: broker message → pi RPC prompt
  // Bridge: pi RPC output → broker (as reply or broadcast)
  return new PiBrokerSession(child, brokerClient);
}
```

Injection method: **RPC** (`pi --mode rpc`). The adapter writes JSON-RPC requests to pi's stdin, reads streaming responses from stdout.

#### Headless mode

```typescript
// pi-adapter.ts — spawnHeadless()
spawnHeadless(opts: SpawnOpts): HeadlessSession {
  const child = spawn("pi", [
    "--print", "--mode", "json",
    "--no-session",               // ephemeral
    ...(opts.model ? ["--model", opts.model] : []),
    opts.prompt!,
  ], { env: { ...process.env, ...opts.env }, cwd: opts.cwd });

  return {
    stream: () => this.parseJsonStream(child.stdout),
    kill: () => child.kill(),
    done: new Promise(resolve =>
      child.on("exit", (code, signal) => resolve({ code: code ?? 1, signal: signal ?? undefined }))
    ),
  };
}
```

### 3.2 Claude Adapter

Claude Code CLI supports `-p` (print mode) and interactive mode.

```typescript
// claude-adapter.ts
capabilities(): AgentCapabilities {
  return {
    hasTUI: true,
    hasPrintMode: true,
    hasRpcMode: false,         // ← Claude has no RPC mode
    supportsStreaming: true,
    supportsTools: true,
    supportsSessionRestore: true,
    injectionMethod: "stdin",  // ← pipe prompts to stdin
  };
}

spawnInteractive(opts: SpawnOpts): ChildProcess {
  return spawn("claude", [
    ...(opts.model ? ["--model", opts.model] : []),
  ], {
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
  });
}

spawnHeadless(opts: SpawnOpts): HeadlessSession {
  const child = spawn("claude", [
    "-p",
    "--output-format", "stream-json",
    ...(opts.model ? ["--model", opts.model] : []),
    opts.prompt!,
  ], { env: { ...process.env, ...opts.env }, cwd: opts.cwd });

  return {
    stream: () => this.parseClaudeStream(child.stdout),
    kill: () => child.kill(),
    done: exitPromise(child),
  };
}

// Broker connection: Claude has no RPC mode.
// Use stateless adapter: spawn per message, maintain history in gateway.
connectToBroker(opts: BrokerConnectOpts): BrokerSession {
  return new StatelessBrokerSession(this, opts);
}
```

### 3.3 OpenCode Adapter

Same pattern as Claude — CLI-based, no RPC mode. Uses `opencode` binary.

### 3.4 mya-native Adapter

Uses `@my-agent/agent` (mya's own agent loop) + pi-ai engine. Runs in-process — no subprocess.

```typescript
// mya-native-adapter.ts
capabilities(): AgentCapabilities {
  return {
    hasTUI: false,              // uses pi TUI or launcher
    hasPrintMode: true,
    hasRpcMode: false,
    supportsStreaming: true,
    supportsTools: true,
    supportsSessionRestore: true,
    injectionMethod: "in-process",  // ← direct function call
  };
}

spawnHeadless(opts: SpawnOpts): HeadlessSession {
  const agent = createAgent({
    providers: this.resolveProviders(),
    tools: this.resolveTools(opts.tools),
    memoryDir: opts.agentDir,
  });

  return {
    stream: async function* () {
      const handle = agent.startTurn({ prompt: opts.prompt!, model: opts.model });
      for await (const event of handle.events()) {
        yield normalizeRuntimeEvent(event);
      }
    },
    kill: () => agent.abort(),
    done: Promise.resolve({ code: 0 }),
  };
}
```

---

## 4. Execution Paths

### Path A: CLI direct (no gateway daemon)

#### A1. Interactive: `mya pi` / `mya claude`

```
1. mya CLI reads ~/.mya/agent/auth.json → sets env vars
2. Router identifies agent: "pi" → PiAdapter
3. PiAdapter.spawnInteractive({ cwd, env }) → child_process.spawn("pi", [...], { stdio: "inherit" })
4. pi process takes over terminal — full TUI, tools, auth
5. mya-bridge extension injected via --extension flag
6. pi connects to broker (if running) for inter-agent messaging
7. User exits pi → mya CLI exits
```

Gateway not involved. No HTTP. Direct subprocess.

#### A2. Print mode: `mya -p "task"`

```
1. mya CLI reads auth → sets env
2. Router.select("task") → selects best agent (default: pi)
3. Adapter.spawnHeadless({ prompt: "task" })
4. Capture stdout JSON stream → normalize → print to terminal
5. Optional: brain.remember(output)
6. Process exits
```

Gateway not involved. Subprocess, output to stdout.

```
$ mya -p "refactor auth.ts"
▸ read packages/gateway/src/index.ts
▸ edit packages/gateway/src/index.ts
Done. Removed 12 lines of dead code.

$ mya -p "review security" --agent claude
▸ Analyzing auth model...
Found 2 issues: timing attack in token comparison, missing CSRF on /config.
```

### Path B: Via gateway daemon

Gateway is the always-on orchestrator (systemd). Used by cron, channels, dashboard.

#### B1. Cron trigger

```
1. CronScheduler fires job at scheduled time
   job = { prompt: "security scan", agent: "pi", schedule: "0 9 * * *", channel: "telegram" }

2. Gateway enriches prompt:
   - brain.recall(prompt) → inject relevant memories
   - role system prompt (if role configured)
   → enrichedPrompt = "<memories>\n...\n</memories>\n\nsecurity scan"

3. Router.select(enrichedPrompt, { agent: "pi" }) → PiAdapter

4. PiAdapter.spawnHeadless({ prompt: enrichedPrompt })
   → spawn("pi", ["--print", "--json", enrichedPrompt])
   → AsyncIterable<AgentOutput>

5. Capture text output:
   - brain.remember({ content: output, source: "cron:job-id" })
   - Store result in cron job history

6. Route result:
   - If channel configured: ChannelSender.send("telegram", output)
   - Else: store in job history (viewable via mya cron list)
```

#### B2. Channel message (Telegram/Discord)

```
1. Telegram webhook → Gateway HTTP handler
2. Parse: { chat_id, text: "check auth.ts for bugs" }
3. Find/create session for chat_id (session persists per channel user)
4. Enrich: brain.recall(text) + conversation history (from session store)
5. Router.select(text) → agent (default: pi, configurable per channel)
6. Adapter.spawnHeadless({ prompt: enriched })
   → capture output (strip ANSI for Telegram)
7. brain.remember(output)
8. Telegram API → reply to user
```

Channel → agent routing config:

```json
// ~/.mya/channels/telegram.json
{
  "botToken": "...",
  "defaultAgent": "pi",
  "agentOverrides": {
    "#security": "claude",
    "#research": "pi"
  }
}
```

#### B3. Dashboard (web UI)

```
1. Browser → WebSocket → Gateway
2. POST /sessions → create session
   Gateway selects adapter based on user choice or router
3. Two session modes:

   ┌─ RPC session (pi only) ─────────────────────────────────┐
   │ Gateway spawns: pi --mode rpc --extension mya-bridge     │
   │ Long-running process, JSON-RPC over stdin/stdout        │
   │                                                         │
   │ User types message in dashboard:                        │
   │   POST /sessions/:id/prompt                             │
   │     → adapter writes RPC prompt to pi stdin             │
   │     → pi streams response via stdout                    │
   │     → adapter normalizes → WebSocket → browser          │
   │                                                         │
   │ Session state lives in pi process (fast, stateful)      │
   └─────────────────────────────────────────────────────────┘

   ┌─ Stateless session (claude, opencode, mya-native) ──────┐
   │ Gateway maintains conversation history in SQLite         │
   │                                                         │
   │ User types message in dashboard:                        │
   │   POST /sessions/:id/prompt                             │
   │     → gateway builds context: history + new message     │
   │     → adapter.spawnHeadless({ prompt: context })        │
   │     → capture output → WebSocket → browser              │
   │     → gateway updates history in SQLite                 │
   │                                                         │
   │ No long-running process (crash-safe, universal)         │
   └─────────────────────────────────────────────────────────┘

4. WebSocket /events → stream AgentOutput → browser
5. Session dispose → kill process (RPC) or no-op (stateless)
```

#### B4. Broker-mediated inter-agent messaging

```
Scenario: Dashboard session "planner" (pi) delegates to session "worker" (claude)

1. Planner (pi TUI or dashboard) calls:
   mya broker send({ to: "worker", message: "implement retry logic" })

2. Broker routes to "worker" session

3. Worker's adapter receives message:
   - pi adapter: pi.sendMessage({ content: "...", triggerTurn: true })
   - claude adapter: spawnHeadless({ prompt: message + history })
   - mya-native: agent.startTurn({ prompt: message })

4. Worker processes → sends reply via broker:
   mya broker send({ to: "planner", replyTo: originalMsgId, message: "done" })

5. Planner receives reply → continues working
```

---

## 5. Smart Router

```typescript
// packages/print/src/router.ts

class SmartRouter {
  constructor(
    private adapters: Map<string, AgentAdapter>,
    private config: RouterConfig,
  ) {}

  select(task: string, opts?: { agent?: string }): AgentAdapter {
    // 1. Explicit override
    if (opts?.agent) {
      const adapter = this.adapters.get(opts.agent);
      if (adapter?.isAvailable()) return adapter;
      throw new Error(`Agent "${opts.agent}" not available`);
    }

    // 2. Config-based routing rules (extensible)
    for (const rule of this.config.rules) {
      if (rule.match.test(task)) {
        const adapter = this.adapters.get(rule.agent);
        if (adapter?.isAvailable()) return adapter;
      }
    }

    // 3. Default agent
    const defaultAdapter = this.adapters.get(this.config.defaultAgent);
    if (defaultAdapter?.isAvailable()) return defaultAdapter;

    // 4. First available
    for (const adapter of this.adapters.values()) {
      if (adapter.isAvailable()) return adapter;
    }
    throw new Error("No agent available");
  }
}
```

Config:

```json
// ~/.mya/agent/router.json
{
  "defaultAgent": "pi",
  "rules": [
    { "match": "code|refactor|typescript|rust", "agent": "pi" },
    { "match": "review|security|audit", "agent": "claude" },
    { "match": "research|browse|search", "agent": "pi" }
  ]
}
```

---

## 6. Shared Infrastructure

### 6.1 Memory (cross-agent brain)

Memory works at the **prompt enrichment layer** — before spawning any agent:

```typescript
// packages/print/src/prompt-enricher.ts

async function enrichPrompt(prompt: string, sessionId: string, role?: string): Promise<string> {
  const parts: string[] = [];

  // Role system prompt
  if (role) {
    const roleConfig = await roleRegistry.get(role);
    if (roleConfig?.promptAppend) parts.push(roleConfig.promptAppend);
  }

  // Relevant memories
  const memories = await brain.recall(prompt, { limit: 5 });
  if (memories.length > 0) {
    const memoryBlock = memories
      .map(m => `- [${m.timestamp}] ${m.summary}`)
      .join("\n");
    parts.push(`<relevant_memories>\n${memoryBlock}\n</relevant_memories>`);
  }

  // Conversation history (for stateless agents)
  const history = await sessionStore.getHistory(sessionId);
  if (history.length > 0) {
    parts.push(`<previous_conversation>\n${formatHistory(history)}\n</previous_conversation>`);
  }

  parts.push(prompt);
  return parts.join("\n\n");
}
```

After agent completes:

```typescript
async function captureOutput(output: string, sessionId: string): Promise<void> {
  await brain.remember({
    source: sessionId,
    content: output,
    tags: ["auto-capture"],
    timestamp: Date.now(),
  });
  await sessionStore.appendHistory(sessionId, { role: "assistant", content: output });
}
```

**Works with ANY agent** — enrichment happens before spawn, capture happens after exit. Agent doesn't need to know about mya's memory system.

### 6.2 Auth (shared credential store)

```typescript
// packages/print/src/auth-injector.ts

function buildAgentEnv(): Record<string, string> {
  const auth = loadAuthConfig();  // reads ~/.mya/agent/auth.json
  const env: Record<string, string> = {};

  // Map providerId → envKey (from provider registry, engine-driven)
  for (const [providerId, credential] of Object.entries(auth)) {
    if (credential.type === "api_key") {
      const envKey = providerRegistry.getEnvKey(providerId);
      if (envKey) env[envKey] = credential.key;
    }
  }

  // Custom env section
  if (auth.env) {
    Object.assign(env, auth.env);
  }

  // Pi-specific
  env.PI_CODING_AGENT_DIR = join(homedir(), ".mya/agent");

  return env;
}
```

Every spawned agent gets the same env vars. No per-agent auth config.

### 6.3 Session Store

For stateless agents (Claude, OpenCode), the gateway maintains conversation history:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL,
  cwd TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,        -- "user" | "assistant" | "tool"
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

For RPC agents (pi), session state lives in the pi process. Gateway only stores metadata.

---

## 7. Gateway Changes

### 7.1 Current → Option D

```typescript
// CURRENT (main.ts)
createSession: async (sessionId, _cwd, agentDir) => {
  const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
  const result = await createAgentSession({ cwd, agentDir, resourceLoader });
  return result.session;  // ← in-memory pi object
}

// OPTION D
createSession: async (sessionId, _cwd, agentDir, opts?) => {
  const adapter = router.select(opts?.prompt ?? "", { agent: opts?.agent });
  const session = adapter.connectToBroker({
    sessionId, cwd: _cwd, agentDir, model: opts?.model,
    env: buildAgentEnv(),
  });
  return session;  // ← BrokerSession (works with any agent)
}
```

### 7.2 Session prompt

```typescript
// Gateway handles prompt differently based on session type
async function handlePrompt(sessionId: string, text: string): AsyncIterable<AgentOutput> {
  const session = sessionStore.get(sessionId);

  // Enrich prompt with memory + history
  const enriched = await enrichPrompt(text, sessionId, session.role);

  // Stream output
  for await (const output of session.prompt(enriched)) {
    yield output;
  }

  // Capture result
  const fullOutput = collectText(outputs);
  await captureOutput(fullOutput, sessionId);
}
```

### 7.3 Gateway API (unchanged)

The HTTP/WS API doesn't change — callers still use:

```
POST   /sessions              → create session (with optional --agent)
POST   /sessions/:id/prompt   → send prompt, stream output
GET    /sessions              → list sessions
DELETE /sessions/:id          → dispose session
WS     /events                → subscribe to session events
GET    /status                → gateway health + agent list
```

New fields in responses:

```json
// GET /status
{
  "agents": [
    { "type": "pi", "available": true, "version": "0.83.0" },
    { "type": "claude", "available": false, "reason": "claude CLI not installed" },
    { "type": "mya-native", "available": true }
  ],
  "brokerSessions": 3
}

// POST /sessions
{ "agent": "claude", "model": "claude-sonnet-4-20250514" }
```

---

## 8. Broker Session Lifecycle

### 8.1 RPC session (pi)

```
POST /sessions → gateway spawns: pi --mode rpc
  ↓
pi connects to broker → registers as session "abc-123"
  ↓
Broker maintains session registry
  ↓
POST /sessions/abc-123/prompt → adapter writes RPC to pi stdin
  ↓
pi processes → streams output via stdout → adapter normalizes → WS
  ↓
Broker message arrives → adapter injects via RPC → pi processes
  ↓
DELETE /sessions/abc-123 → adapter kills pi process → broker session_left
```

### 8.2 Stateless session (claude)

```
POST /sessions → gateway creates session record in SQLite
  ↓
No process spawned yet — session is "virtual"
  ↓
POST /sessions/abc-123/prompt
  → gateway reads history from SQLite
  → enriches: memories + history + prompt
  → spawn: claude -p "enriched prompt"
  → capture output → stream via WS
  → store assistant response in SQLite
  → kill process
  ↓
Broker message arrives → queued in gateway → delivered on next prompt
  ↓
DELETE /sessions/abc-123 → delete SQLite record
```

---

## 9. File Structure

```
packages/
├── core/src/
│   ├── agent-adapter.ts          # AgentAdapter interface
│   ├── agent-output.ts           # AgentOutput types
│   └── broker/                   # Broker (adopted from pi-intercom)
│       ├── broker.ts             # Broker process
│       ├── client.ts             # BrokerClient
│       ├── framing.ts            # Length-prefixed JSON
│       ├── paths.ts              # Socket resolution
│       └── spawn.ts              # Auto-spawn logic
│
├── print/src/
│   ├── router.ts                 # SmartRouter
│   ├── prompt-enricher.ts        # Memory + history injection
│   ├── auth-injector.ts          # Auth → env vars
│   ├── adapters/
│   │   ├── pi-adapter.ts         # Pi (RPC + print + interactive)
│   │   ├── claude-adapter.ts     # Claude Code CLI
│   │   ├── opencode-adapter.ts   # OpenCode CLI
│   │   └── mya-native-adapter.ts # @my-agent/agent in-process
│   └── session-store.ts          # SQLite session history (stateless agents)
│
├── gateway/src/
│   └── index.ts                  # Updated createSession → uses adapter SPI
│
~/.mya/agent/
├── auth.json                     # Shared credentials
├── broker/
│   ├── broker.sock               # Unix socket
│   ├── broker.pid                # PID file
│   └── broker.spawn.lock         # Auto-spawn lock
├── router.json                   # Routing rules
├── brain.db                      # Shared memory (SQLite)
└── sessions.db                   # Session history (SQLite)
```

---

## 10. User Experience

### 10.1 Commands

```bash
# ── Interactive (each agent uses its own TUI) ──
mya                        # launcher → select agent → spawn
mya pi                     # pi TUI directly
mya claude                 # Claude Code CLI directly
mya opencode               # OpenCode TUI directly

# ── Print mode (one-shot, any agent) ──
mya -p "refactor auth.ts"                    # router selects (default: pi)
mya -p "review security" --agent claude      # explicit
mya -p "write tests" --agent pi --model glm-5.1

# ── Broker ──
mya broker status          # show connected sessions
mya broker send --to worker "task 3 done"    # send message
mya broker ask --to planner "which API?"     # blocking ask

# ── Cron ──
mya cron add "0 9 * * *" "daily scan" --agent claude
mya cron list                                   # jobs + agent + last result

# ── Management ──
mya status                 # all agents: available? sessions? cost?
mya agents                 # list installed agents + capabilities
mya agents install claude  # wrapper for npm install -g
```

### 10.2 Dashboard

```
┌─────────────────────────────────────────────────┐
│  mya Dashboard                          [pi ▾]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Sessions:                                      │
│  ┌──────────────────────────────────────────┐  │
│  │ ● planner (pi)        idle · 42% ctx     │  │
│  │ ○ worker (claude)     thinking · 15% ctx │  │
│  │ + New session                            │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Agent: [pi ▾] [claude] [opencode] [mya]       │
│  Model: [glm-5.1 ▾]                             │
│                                                 │
│  ── Chat ──                                     │
│  User: refactor auth.ts                         │
│  pi: I'll start by reading the file...          │
│  [read] packages/gateway/src/index.ts           │
│  pi: Removed 12 lines of dead code.             │
│                                                 │
│  > _____________________________________ [Send] │
└─────────────────────────────────────────────────┘
```

---

## 11. Implementation Phases

| Phase | Scope | Deliverable | Est. |
|---|---|---|---|
| **1** | Broker SPI + framing + auto-spawn | Broker starts, 2 sessions can exchange messages | 3 days |
| **2** | Pi adapter (RPC + print + interactive) | `mya pi` + `mya -p "task"` work via broker | 3 days |
| **3** | Gateway integration (createSession → adapter SPI) | Dashboard sessions work with pi adapter | 2 days |
| **4** | Prompt enricher (memory + history injection) | Cron + channels inject memories before spawn | 2 days |
| **5** | mya-native adapter (@my-agent/agent + pi-ai) | `mya -p "task" --agent mya` works without pi | 3 days |
| **6** | Claude adapter (CLI wrapper) | `mya claude` + `mya -p --agent claude` work | 2 days |
| **7** | Smart router + config | Auto-routing based on task content | 1 day |
| **8** | Broker-mediated inter-agent messaging | `send` / `ask` / `reply` between agents | 3 days |
| **9** | Tests + cold review | Full E2E: cron → router → adapter → broker → reply | 3 days |

**Total: ~4 weeks**

---

## 12. What mya already has (reuse)

| Component | Status | Reuse |
|---|---|---|
| Gateway HTTP/WS | ✅ Complete | createSession → swap to adapter SPI |
| Cron scheduler | ✅ Complete | Add `--agent` flag + router call |
| Channels (TG/Disc) | ✅ Complete | Add router call before spawn |
| Memory (brain) | ✅ Complete | Wrap in prompt enricher |
| Auth (auth.json) | ✅ Complete | Wrap in auth injector |
| Launcher | ✅ Complete | Add agent selector |
| Roles | ✅ Complete | Inject via prompt enricher |
| MCP | ✅ Complete | Inject into pi adapter env |
| @my-agent/agent | ✅ Complete | mya-native adapter |
| @my-agent/core | ✅ Complete | runTurn for mya-native |

## 13. What needs building

| Component | Lines | Complexity |
|---|---|---|
| Broker (adopt from pi-intercom) | ~800 | Medium (well-documented reference) |
| AgentAdapter interface | ~150 | Low |
| PiAdapter | ~300 | Medium |
| ClaudeAdapter | ~250 | Medium |
| mya-native adapter | ~200 | Low |
| SmartRouter | ~150 | Low |
| PromptEnricher | ~150 | Low |
| AuthInjector | ~100 | Low |
| SessionStore (SQLite) | ~200 | Low |
| BrokerClient (for gateway) | ~300 | Medium |
| `mya broker` CLI commands | ~200 | Low |
| Tests | ~1000 | Medium |

**Total new code: ~4000 lines** (half is tests)

---

## 14. Limitations & Trade-offs

| Limitation | Mitigation |
|---|---|
| Interactive bridge tools (recall, remember) only work in pi | Headless mode injects memories via prompt enricher |
| Stateless agent sessions respawn per message (2-5s overhead) | RPC mode for pi avoids this; stateless is for other agents |
| Output format varies per agent | OutputNormalizer per adapter |
| Session format incompatible across agents | Each agent manages own sessions; gateway stores metadata |
| Agent binary must be installed | `mya agents install` wrapper + availability check |
| Same-machine only (Unix socket) | By design — remote agents would need TCP transport (future) |

---

## 15. Comparison: Current vs Option D

| Aspect | Current (pi engine) | Option D (orchestration) |
|---|---|---|
| Agent backends | pi only | pi, Claude, OpenCode, mya-native, custom |
| TUI | pi InteractiveMode (always) | Each agent's native TUI |
| Bridge tools in interactive | ✅ (via extension) | pi only (others: prompt injection) |
| Cross-agent memory | ❌ | ✅ (prompt enricher) |
| Agent crash isolation | Shared process | Separate processes |
| Agent updates | `npm update` (automatic) | Per-agent install |
| Gateway multi-agent | ❌ | ✅ |
| Code to maintain | ~0 (pi handles) | ~4000 lines new |
| mya identity | "pi + tools" | Orchestration platform |
