# Phase 4: PiInProcessRuntime + PiEventNormalizer

> Depends on: Phase 1 (intercom package), Phase 2 (SPI types), Phase 3 (pi event spike)
> Estimated: 4h
> Spec reference: §2.1 (PiInProcessRuntime + PiInProcessSession), §3 (normalizer), §5.3 (buildAgentEnv)

## Objective

Create the primary agent runtime that wraps pi's `createAgentSession` in the uniform `AgentRuntime` / `RuntimeSession` SPI. This is the runtime all gateway sessions use by default. Includes the event normalizer that maps pi's event format to the uniform `AgentEvent` union.

**Key deliverable:** `PiInProcessRuntime` can start a pi session, send prompts, stream uniform events, compact context, and dispose — all through the SPI interface defined in Phase 2.

## Deliverables

| File | Purpose |
|---|---|
| `packages/print/src/runtimes/pi-in-process.ts` | PiInProcessRuntime + PiInProcessSession |
| `packages/print/src/runtimes/pi-event-normalizer.ts` | PiEventNormalizer (pi events → AgentEvent) |
| `packages/print/src/runtimes/build-env.ts` | buildAgentEnv() |
| `packages/print/src/runtimes/pi-event-normalizer.test.ts` | [unit] normalizer tests |
| `packages/print/src/runtimes/pi-in-process-runtime.test.ts` | [smoke] runtime tests |

## Implementation Steps

### Step 0: Hoist dreamCycle to shared-instances.ts (F-8 fix)

> **PREREQUISITE** — must be done before PiInProcessRuntime is constructed.

`dreamCycle` is currently created inside `runWebServer()` scope in `main.ts:609-610`.
It must be hoisted to `shared-instances.ts` so `PiRuntimeDeps` can receive it.

```typescript
// packages/print/src/shared-instances.ts
import { DreamCycle } from "@my-agent/memory";

// ... existing shared instances ...

export const dreamCycle = new DreamCycle({ brain });
```

Then update all 3 consumption sites to import from shared-instances:
1. `main.ts:610` → `import { dreamCycle } from "./shared-instances.js"`
2. `agent/src/index.ts:302` → use shared instance
3. `mya-bridge.ts:348` fallback → use shared instance

### Step 1: Create buildAgentEnv (`build-env.ts`)

Reads auth config and maps provider credentials to environment variables that pi and subprocess runtimes need.

```typescript
// packages/print/src/runtimes/build-env.ts
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

interface AuthCredential {
  type: "api_key" | "oauth";
  key?: string;
}

interface AuthConfig {
  [providerId: string]: AuthCredential;
  env?: Record<string, string>;
}

function loadAuthConfig(): AuthConfig {
  const authPath = join(homedir(), ".mya", "agent", "auth.json");
  try {
    const raw = readFileSync(authPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function buildAgentEnv(): Record<string, string> {
  const auth = loadAuthConfig();
  const env: Record<string, string> = {};

  for (const [providerId, credential] of Object.entries(auth)) {
    if (credential && typeof credential === "object" && credential.type === "api_key" && credential.key) {
      // Map providerId to standard env key (e.g., anthropic → ANTHROPIC_API_KEY)
      const envKey = `${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      env[envKey] = credential.key;
    }
  }

  if (auth.env) Object.assign(env, auth.env);

  // IC3: PI_CODING_AGENT_DIR must point to mya's agent dir (shared with intercom)
  env.PI_CODING_AGENT_DIR = join(homedir(), ".mya", "agent");

  return env;
}
```

### Step 2: Create PiEventNormalizer (`pi-event-normalizer.ts`)

Maps pi's event types to the uniform `AgentEvent` union.

> **Phase 3 spike de-risk:** Verify ALL event types and payload fields against actual pi output before finalizing mappings. The table below is based on spec assumptions.

```typescript
// packages/print/src/runtimes/pi-event-normalizer.ts
import type { AgentEvent } from "@my-agent/core";
// R9-1 fix: normalizer is PURE — no nowWallclock needed

interface PiSessionLike {
  readonly model?: { id: string };
  readonly thinkingLevel?: string;
}

interface AccumulatedUsage {
  tokensIn: number;
  tokensOut: number;
}

export class PiEventNormalizer {
  /**
   * Convert a pi event to a uniform AgentEvent.
   * Returns null for events that have no AgentEvent mapping.
   */
  static toAgentEvent(
    rawEvent: unknown,
    session: PiSessionLike,
    usage: AccumulatedUsage,
  ): AgentEvent | null {
    const e = rawEvent as { type: string; [key: string]: unknown };

    switch (e.type) {
      // Turn lifecycle
      case "agent_start":
        return null; // turn_start emitted by prompt() directly

      case "agent_settled":
        return {
          type: "turn_end",
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
        };

      // Message streaming
      case "message_start":
        return null; // no AgentEvent equivalent

      case "message_update": {
        // R9-5 fix: coerce delta to string (may be object from pi)
        const rawDelta = (e as any).delta ?? (e as any).assistantMessageEvent?.delta;
        const delta = typeof rawDelta === "string" ? rawDelta : (rawDelta?.text ?? rawDelta?.thinking ?? "");
        if (!delta) return null;

        // Check if this is thinking or text
        if ((e as any).role === "thinking" || (e as any).assistantMessageEvent?.type === "thinking") {
          return { type: "thinking", delta };
        }
        return { type: "text", delta };
      }

      case "message_end":
        return null; // usage already accumulated in PiInProcessSession.subscribe()

      // Tool execution
      case "tool_execution_start":
        return {
          type: "tool_call",
          toolCallId: (e as any).toolCallId ?? (e as any).id ?? "",
          name: (e as any).name ?? (e as any).toolName ?? "",
          args: (e as any).args ?? (e as any).input ?? {},
        };

      case "tool_execution_update":
        return {
          type: "tool_result",
          toolCallId: (e as any).toolCallId ?? (e as any).id ?? "",
          output: typeof (e as any).output === "string"
            ? (e as any).output
            : JSON.stringify((e as any).output ?? (e as any).result ?? ""),
          error: (e as any).error ?? false,
        };

      // Compaction
      case "compaction_start":
        return null; // no AgentEvent for compaction start (or emit compaction with placeholder)

      case "compaction_end":
        return {
          type: "compaction",
          result: {
            tokensBefore: (e as any).tokensBefore ?? 0,
            tokensAfter: (e as any).tokensAfter ?? (e as any).estimatedTokensAfter ?? 0,
            strategy: "native",
          },
        };

      // Model changes
      case "model_select":
        return { type: "model_changed", model: (e as any).model ?? (e as any).modelId ?? "" };

      case "thinking_level_changed":
        return { type: "thinking_changed", level: (e as any).level ?? "" };

      // Errors
      case "error":
        return {
          type: "error",
          message: (e as any).message ?? String(e),
          recoverable: (e as any).recoverable ?? false,
        };

      // Bash execution (subset of tool events)
      case "bash_execution_update":
        return null; // handled by tool_execution_update if applicable

      default:
        return null;
    }
  }
}
```

### Step 3: Create PiInProcessRuntime (`pi-in-process.ts`)

```typescript
// packages/print/src/runtimes/pi-in-process.ts

import { join } from "node:path";
import { homedir } from "node:os";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { ModelRuntime, AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";

import type {
  AgentRuntime, RuntimeSession, StartOpts, AgentEvent,
  ModelInfo, ThinkingLevel, AgentCapabilities, CompactionResult,
  SessionState, PromptOpts,
} from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";  // R9-1 fix: value import for session timestamps

// G1 fix: shared instances passed via constructor
export interface PiRuntimeDeps {
  agentDir: string;
  auditLog: any;
  secretStore: any;
  hooks: any;
  skillStore: any;
  cron: any;
  brain: any;
  memory: any;
  retrievalEngine: any;
  lifecycleManager: any;
  sqliteMemory: any;
  dreamCycle: any;   // D1 fix: hoisted from runWebServer scope to shared-instances.ts
  wallet: any;
  sync: any;
  collab: any;
  packageHost: any;
  council: any;
  mcp: any;
  mcpConfigs: any[];
  channels: any;
  roleRegistry: any;
  achievements: any;
}

export class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";

  // M4 fix: ModelRuntime keyed by agentDir (not global singleton)
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

    // F2 fix: typed CreateAgentSessionOptions
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

### Step 4: Create PiInProcessSession (in same file)

```typescript
export class PiInProcessSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  get sessionId(): string { return this.opts.sessionId; }       // R7-2
  get runtimeType(): string { return "pi"; }                     // R7-2

  private listeners = new Set<(e: AgentEvent) => void>();
  private textBuffer = "";
  private readonly createdAt = nowWallclock()  // R5-7 fix: use core.time helper (AGENTS.md §18);
  private accumulatedUsage = { tokensIn: 0, tokensOut: 0 };
  private turnActive = false;  // C1 fix

  constructor(private piSession: PiAgentSession, private opts: StartOpts) {
    this.piSession.subscribe((event: unknown) => {
      const e = event as { type: string };

      // Accumulate usage from message_end
      if (e.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.usage) {
          this.accumulatedUsage.tokensIn += msg.usage.input ?? 0;
          this.accumulatedUsage.tokensOut += msg.usage.output ?? 0;
        }
      }

      // BC fix: detect agent_settled from broker injection (no prior turn_start)
      // R8-1: broker-injected turns report 0 tokens (snapshot-and-subtract is Phase 4 impl detail)
      if (e.type === "agent_settled" && !this.turnActive) {
        this.emit({
          type: "turn_start",
          model: this.piSession.model?.id ?? "unknown",
          sessionId: this.opts.sessionId,
        });
      }

      const agentEvent = PiEventNormalizer.toAgentEvent(
        event, this.piSession, this.accumulatedUsage
      );

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

      // C1 fix: if prompt() returned but agent_settled never fired
      // (extension command, input handler, queue path), emit synthetic turn_end
      if (this.turnActive) {
        this.turnActive = false;
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
        });
      }
    } catch (e) {
      // R8-4 fix: only emit turn_end if turn is still active
      if (this.turnActive) {
        this.turnActive = false;
        this.emit({ type: "error", message: String(e), recoverable: false });
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
        });
      }
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
    // C6 fix: ?? 0 on tokensBefore
    return {
      tokensBefore: result.tokensBefore ?? 0,
      tokensAfter: result.estimatedTokensAfter ?? 0,
      strategy: "native",
    };
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
      lastActivity: nowWallclock(),
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

### Step 5: Write tests

## Test Plan

### `pi-event-normalizer.test.ts` [unit]

| Case | Input | Expected |
|---|---|---|
| agent_settled → turn_end | `{type:"agent_settled"}` | `{type:"turn_end", tokensIn:0, tokensOut:0}` |
| message_update with delta | `{type:"message_update", delta:"hello"}` | `{type:"text", delta:"hello"}` |
| message_update thinking | `{type:"message_update", delta:"...", role:"thinking"}` | `{type:"thinking", delta:"..."}` |
| tool_execution_start | `{type:"tool_execution_start", id:"tc1", name:"bash", input:{cmd:"ls"}}` | `{type:"tool_call", toolCallId:"tc1", name:"bash", args:{cmd:"ls"}}` |
| tool_execution_update | `{type:"tool_execution_update", id:"tc1", output:"done"}` | `{type:"tool_result", toolCallId:"tc1", output:"done", error:false}` |
| compaction_end | `{type:"compaction_end", tokensBefore:1000, estimatedTokensAfter:500}` | `{type:"compaction", result:{tokensBefore:1000, tokensAfter:500, strategy:"native"}}` |
| model_select | `{type:"model_select", model:"claude-sonnet-4"}` | `{type:"model_changed", model:"claude-sonnet-4"}` |
| unknown event | `{type:"unknown_event"}` | `null` |
| usage accumulation | after 2 message_end events | turn_end tokensIn/tokensOut reflect sum |

### `pi-in-process-runtime.test.ts` [smoke]

| Case | How |
|---|---|
| ModelRuntime keyed by agentDir | Create 2 runtimes with different agentDir → 2 entries in static map |
| listModels returns ModelInfo[] | Call listModels(), verify array of ModelInfo |
| setModel → model_changed event | Subscribe, call setModel, verify model_changed emitted |
| contextPct from getContextUsage | Call getState(), verify contextPct field |
| turn_start/turn_end on extension command | Send prompt that triggers extension → verify synthetic turn_end |
| broker injection turn pairing | Subscribe, inject agent_settled without turn_start → verify synthetic turn_start |
| turnActive safety net | Prompt that doesn't produce agent_settled → verify turn_end still emitted |
| R8-4 catch guard | Mock piSession.prompt to throw → verify error + turn_end, no double |

## Acceptance Criteria

- [ ] `PiEventNormalizer.toAgentEvent()` maps all pi event types correctly (verified by Phase 3 spike)
- [ ] `PiInProcessSession.prompt()` emits turn_start at start, turn_end at completion
- [ ] turn_end emitted even when agent_settled doesn't fire (safety net)
- [ ] turn_end emitted on prompt failure (catch block, R8-4 guard)
- [ ] broker injection (agent_settled without turn_start) produces synthetic turn_start
- [ ] accumulatedUsage resets per prompt() call
- [ ] contextPct comes from getContextUsage()
- [ ] ModelRuntime is keyed by agentDir (shared across sessions with same dir)
- [ ] compact() returns CompactionResult with tokensBefore ?? 0
- [ ] dispose() doesn't throw
- [ ] buildAgentEnv() includes PI_CODING_AGENT_DIR
- [ ] IC10: AbortSignal forwarded to piSession.prompt() (if opts.signal provided — requires pi API support, verify in Phase 3 spike)
- [ ] PiAgentSession type imported (F1 fix)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| pi event types differ from spec | Phase 3 spike verifies BEFORE Phase 4 implementation |
| message_update delta field name varies | Normalizer checks both `.delta` and `.assistantMessageEvent.delta` |
| agent_settled fires before prompt() returns | turnActive flag + safety net handles both orderings |
| ModelRuntime singleton split in bundle | Already solved — bundle dedup ensures single instance |
| dreamCycle not yet hoisted to shared-instances.ts | Must be done in Phase 4 (or Phase 5) before PiInProcessRuntime is constructed |
| piSession.prompt signature mismatch | Phase 3 spike verifies exact API |

## Rollback

- Delete `packages/print/src/runtimes/pi-in-process.ts`
- Delete `packages/print/src/runtimes/pi-event-normalizer.ts`
- Delete `packages/print/src/runtimes/build-env.ts`
- Delete test files
- Gateway continues using existing AgentPool (no changes to gateway until Phase 5)
