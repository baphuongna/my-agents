// packages/print/src/runtimes/pi-in-process.ts

import { join } from "node:path";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { ModelRuntime, AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";

import type {
  AgentRuntime, RuntimeSession, StartOpts, AgentEvent,
  ModelInfo, ThinkingLevel, AgentCapabilities, CompactionResult,
  SessionState, PromptOpts,
} from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";

import { PiEventNormalizer } from "./pi-event-normalizer.js";

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
  dreamCycle: any;
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

  // M4 fix: ModelRuntime keyed by agentDir
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
      model = rt.getModels().find((m: any) => m.id === opts.modelId || m.id.startsWith(opts.modelId!));
    }

    const { session } = await createAgentSession({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      resourceLoader,
      modelRuntime: await this.getModelRuntime(),
      ...(model ? { model } : {}),
      // Phase 5 wiring: cron sessions get a restricted tool allowlist
      // (cronSessionToolConfig) — previously dropped when AgentPool was replaced.
      ...(opts.toolsAllowList ? { tools: opts.toolsAllowList } : {}),
    });

    // Phase 5 wiring (matches previous AgentPool.createSession): emit
    // session_start + bind extension mode so mya-bridge hooks capture the
    // session ID and role-subagent reporting works. Without this, bridge
    // session-scoped hooks never activate.
    try {
      await (session as unknown as { bindExtensions: (opts?: unknown) => Promise<void> }).bindExtensions({ mode: "print" });
    } catch { /* best-effort — extension bind is non-fatal */ }

    return new PiInProcessSession(session, opts);
  }

  isAvailable(): boolean { return true; }

  async listModels(): Promise<ModelInfo[]> {
    const rt = await this.getModelRuntime();
    return rt.getModels().map((m: any) => ({
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

export class PiInProcessSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  get sessionId(): string { return this.opts.sessionId; }
  get runtimeType(): string { return "pi"; }

  private listeners = new Set<(e: AgentEvent) => void>();
  private textBuffer = "";
  private readonly createdAt = nowWallclock();
  private accumulatedUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  private turnActive = false;
  private turnClosed = false; // M1 fix: guards late agent_settled after our turn already closed
  private disposed = false;
  // Fix 2: track pending tool names (parallel-safe — Map theo toolCallId)
  private pendingToolNames = new Map<string, string>();

  private unsubscribePi: (() => void) | null = null;

  constructor(private piSession: PiAgentSession, private opts: StartOpts) {
    this.unsubscribePi = this.piSession.subscribe((event: unknown) => {
      const e = event as { type: string };

      if (e.type === "agent_settled") {
        // Fix 2: clear pending tool map at turn boundary (agent_settled fires every turn end incl. abort)
        this.pendingToolNames.clear();
        // M1 fix: late/duplicate agent_settled after our turn closed (success/error) must not re-emit
        if (this.turnClosed) return;
        if (!this.turnActive) {
          // BC fix: broker-injected turn (no prior prompt()) — synthesize start
          this.emit({
            type: "turn_start",
            model: this.piSession.model?.id ?? "unknown",
            sessionId: this.opts.sessionId,
          });
        }
        this.turnActive = false;
        this.turnClosed = true;
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
          ...((this.accumulatedUsage.costUsd ?? 0) > 0 ? { costUsd: this.accumulatedUsage.costUsd } : {}),
        });
        return;
      }

      if (e.type === "message_end") {
        // M2 fix: only accumulate usage while a turn is active (agent_settled closes the turn)
        const msg = (event as any).message;
        if (this.turnActive && msg?.role === "assistant" && msg?.usage) {
          this.accumulatedUsage.tokensIn += msg.usage.input ?? 0;
          this.accumulatedUsage.tokensOut += msg.usage.output ?? 0;
          this.accumulatedUsage.costUsd = (this.accumulatedUsage.costUsd ?? 0) + ((msg.usage as any)?.cost?.total ?? 0);
        }
      }

      const agentEvent = PiEventNormalizer.toAgentEvent(event, this.accumulatedUsage);

      if (agentEvent) {
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        // Fix 2: track tool call names (parallel-safe — Map theo toolCallId; guard CHỈ map-op, không return sớm)
        if (agentEvent.type === "tool_call" && agentEvent.toolCallId && agentEvent.name) {
          this.pendingToolNames.set(agentEvent.toolCallId, agentEvent.name);
        } else if (agentEvent.type === "tool_result" && agentEvent.toolCallId) {
          this.pendingToolNames.delete(agentEvent.toolCallId);
        }
        this.emit(agentEvent);
      }
    });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    if (this.disposed) throw new Error("Session disposed");
    this.textBuffer = "";
    this.accumulatedUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    this.turnActive = true;
    this.turnClosed = false;
    // Fix 2 (R7-2): clear pending tool map at prompt entry — agent_settled may not fire
    // on prompt() success/catch paths (safety-net test) → stale "tool:bash" leak otherwise
    this.pendingToolNames.clear();

    this.emit({
      type: "turn_start",
      model: this.piSession.model?.id ?? "unknown",
      sessionId: this.opts.sessionId,
    });

    // Fix 1: wire AbortSignal → piSession.abort() (upstream prompt() does NOT accept signal — V1)
    const signal = opts?.signal;
    if (signal?.aborted) {
      // R1-3/R2-5: AbortSignal không replay abort event. Nếu ĐÃ aborted trước khi vào
      // prompt (queue sau turnLock / trong enrich) → short-circuit NGAY: không gọi
      // piSession.prompt (piSession đang idle, abort() chả abort gì).
      // turn_start đã emit ở trên → đóng turn rỗng để caller thấy empty/aborted.
      this.turnActive = false;
      this.turnClosed = true;
      this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
      return;
    }
    const onAbort = () => {
      // V3: abort() resolve prompt() (không reject) — vẫn cần signal handler
      // vì pi không nhận signal qua PromptOptions
      void this.piSession.abort().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await this.piSession.prompt(text, {
        streamingBehavior: opts?.streamingBehavior ?? "followUp",
      });

      if (this.turnActive) {
        this.turnActive = false;
        this.turnClosed = true; // M1 fix: late agent_settled must not re-emit turn_end
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
          ...((this.accumulatedUsage.costUsd ?? 0) > 0 ? { costUsd: this.accumulatedUsage.costUsd } : {}),
        });
      }
    } catch (e) {
      // L15 fix: always emit error+turn_end, even if agent_settled already fired
      this.emit({ type: "error", message: String(e), recoverable: false });
      if (this.turnActive) {
        this.turnActive = false;
        this.turnClosed = true; // M1 fix: late agent_settled must not re-emit turn_end
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
          ...((this.accumulatedUsage.costUsd ?? 0) > 0 ? { costUsd: this.accumulatedUsage.costUsd } : {}),
        });
      }
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
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
    const usage = this.piSession.getContextUsage?.();
    const pendingTools = [...new Set(this.pendingToolNames.values())];
    return {
      model: this.piSession.model?.id ?? "unknown",
      thinking: this.piSession.thinkingLevel,
      // Fix 2: status "tool:<names>" khi có tool đang chạy (parallel-safe, dedupe)
      status: this.piSession.isIdle ? "idle"
        : pendingTools.length > 0 ? `tool:${pendingTools.join(",")}` as SessionState["status"]
        : "thinking",
      tokensIn: this.accumulatedUsage.tokensIn,
      tokensOut: this.accumulatedUsage.tokensOut,
      contextPct: usage?.percent ?? 0,
      contextWindow: usage?.contextWindow ?? 200_000,
      costUsd: this.accumulatedUsage.costUsd ?? 0,
      startedAt: this.createdAt,
      lastActivity: nowWallclock(),
    };
  }

  isIdle(): boolean { return this.piSession.isIdle; }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribePi?.();
    this.unsubscribePi = null;
    this.listeners.clear();
    try { this.piSession.dispose(); } catch (e) { console.warn("[pi] dispose failed:", e); }
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  getTextBuffer(): string { return this.textBuffer; }

  private emit(event: AgentEvent): void {
    this.listeners.forEach(l => { try { l(event); } catch (e) { console.warn("[runtime] listener error:", e); } });
  }
}
