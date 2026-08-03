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
    });

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
  private accumulatedUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 as number | undefined };
  private turnActive = false;

  private unsubscribePi: (() => void) | null = null;

  constructor(private piSession: PiAgentSession, private opts: StartOpts) {
    this.unsubscribePi = this.piSession.subscribe((event: unknown) => {
      const e = event as { type: string };

      if (e.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.usage) {
          this.accumulatedUsage.tokensIn += msg.usage.input ?? 0;
          this.accumulatedUsage.tokensOut += msg.usage.output ?? 0;
        }
      }

      // BC fix: detect agent_settled from broker injection (no prior turn_start)
      if (e.type === "agent_settled" && !this.turnActive) {
        this.turnActive = true; // L14 fix: mark active so agent_settled pairs correctly
        this.emit({
          type: "turn_start",
          model: this.piSession.model?.id ?? "unknown",
          sessionId: this.opts.sessionId,
        });
      }

      const agentEvent = PiEventNormalizer.toAgentEvent(event, this.accumulatedUsage);

      if (agentEvent?.type === "turn_end") {
        this.turnActive = false;
      }

      if (agentEvent) {
        if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
        this.emit(agentEvent);
      }
    });
  }

  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    this.accumulatedUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    this.turnActive = true;

    this.emit({
      type: "turn_start",
      model: this.piSession.model?.id ?? "unknown",
      sessionId: this.opts.sessionId,
    });

    try {
      await this.piSession.prompt(text, {
        streamingBehavior: opts?.streamingBehavior ?? "followUp",
      });

      if (this.turnActive) {
        this.turnActive = false;
        this.emit({
          type: "turn_end",
          tokensIn: this.accumulatedUsage.tokensIn,
          tokensOut: this.accumulatedUsage.tokensOut,
        });
      }
    } catch (e) {
      // L15 fix: always emit error+turn_end, even if agent_settled already fired
      this.emit({ type: "error", message: String(e), recoverable: false });
      if (this.turnActive) {
        this.turnActive = false;
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
      costUsd: this.accumulatedUsage.costUsd ?? 0,
      startedAt: this.createdAt,
      lastActivity: nowWallclock(),
    };
  }

  isIdle(): boolean { return this.piSession.isIdle; }

  async dispose(): Promise<void> {
    this.unsubscribePi?.();
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
