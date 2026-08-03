// packages/print/src/runtimes/claude.ts

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import * as readline from "node:readline";
import type {
  AgentEvent, AgentRuntime, AgentCapabilities, CompactionResult,
  ModelInfo, RuntimeSession, SessionState, StartOpts, ThinkingLevel, PromptOpts,
} from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";

// ─── Event Normalizer ─────────────────────────────────────────────────────────

export class ClaudeEventNormalizer {
  static parseLine(line: string): AgentEvent | null {
    // M2 note: result type returns { _type: "usage" } as any for internal usage extraction.
    // Callers must check (event as any)._type === "usage" before treating as AgentEvent.
    let obj: any;
    try { obj = JSON.parse(line); } catch { return null; }

    switch (obj.type) {
      case "assistant":
        if (obj.message?.content?.[0]?.text) {
          return { type: "text", delta: obj.message.content[0].text };
        }
        if (obj.message?.content?.[0]?.type === "tool_use") {
          const tc = obj.message.content[0];
          return { type: "tool_call", toolCallId: tc.id ?? "", name: tc.name ?? "", args: tc.input ?? {} };
        }
        return null;

      case "result":
        // HIGH-1 fix: return typed UsageUpdate instead of invalid AgentEvent cast
        if (obj.usage) {
          return { _type: "usage", tokensIn: obj.usage.input_tokens ?? 0, tokensOut: obj.usage.output_tokens ?? 0, costUsd: obj.cost } as any;
        }
        return null;

      case "tool_result":
        return { type: "tool_result", toolCallId: obj.tool_use_id ?? "", output: typeof obj.content === "string" ? obj.content : JSON.stringify(obj.content ?? ""), error: obj.is_error ?? false };

      default:
        return null;
    }
  }
}

// ─── Runtime + Session ─────────────────────────────────────────────────────────

export class ClaudeRuntime implements AgentRuntime {
  readonly runtimeType = "claude";
  readonly displayName = "Claude CLI (subprocess)";
  private availableCache: boolean | null = null;
  private availableCacheTime = 0;
  private static readonly AVAILABLE_TTL_MS = 60_000;

  isAvailable(): boolean {
    // HIGH-2 fix: cache result for 60s to avoid blocking event loop on every router call
    const now = nowWallclock();
    if (this.availableCache !== null && now - this.availableCacheTime < ClaudeRuntime.AVAILABLE_TTL_MS) {
      return this.availableCache;
    }
    try {
      const result = spawnSync("claude", ["--version"], { stdio: "pipe", timeout: 5000 });
      this.availableCache = result.status === 0;
      this.availableCacheTime = now;
      return this.availableCache;
    } catch {
      this.availableCache = false;
      this.availableCacheTime = now;
      return false;
    }
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    return new ClaudeSession(opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "claude-sonnet-4-20250514", provider: "anthropic", contextWindow: 200_000, maxTokens: 8192, reasoning: false },
      { id: "claude-opus-4-20250514", provider: "anthropic", contextWindow: 200_000, maxTokens: 8192, reasoning: true },
    ];
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: false, hasHeadless: true,
      supportsTools: true, supportsResume: true,
      supportsCompaction: false, supportsImages: true,
      supportsThinking: false,
      execution: "subprocess", maxContextWindow: 200_000,
      injectionMethod: "stdin-prompt",
    };
  }

  costPerMTokens() { return { input: 3, output: 15 }; }
}

export class ClaudeSession implements RuntimeSession {
  readonly executionModel = "subprocess" as const;
  get sessionId(): string { return this.opts.sessionId; }
  get runtimeType(): string { return "claude"; }

  private child: ChildProcess | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  private readonly createdAt = nowWallclock();
  private modelId: string;
  private busy = false;
  private promptQueue: Array<{ fn: () => Promise<void>; reject: (e: Error) => void }> = [];
  private sessionDir: string;
  private lastUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  private disposed = false;

  constructor(private opts: StartOpts) {
    this.modelId = opts.modelId ?? "claude-sonnet-4-20250514";
    const contextHash = createHash("md5").update(`${opts.sessionId}:${opts.cwd}`).digest("hex").slice(0, 12);
    this.sessionDir = join(opts.agentDir, "sessions", "claude", contextHash);
    mkdirSync(this.sessionDir, { recursive: true });
  }

  async prompt(text: string, _opts?: PromptOpts): Promise<void> {
    if (this.busy) {
      await new Promise<void>((resolve, reject) => {
        this.promptQueue.push({
          fn: async () => { try { await this.doPrompt(text, _opts); resolve(); } catch (e) { reject(e as Error); } },
          reject,
        });
      });
      return;
    }
    await this.doPrompt(text, _opts);
    while (this.promptQueue.length > 0) {
      const item = this.promptQueue.shift()!;
      try { await item.fn(); } catch (e) { console.warn("[claude] queue drain error:", e); }
    }
  }

  private async doPrompt(text: string, _opts?: PromptOpts): Promise<void> {
    if (this.disposed) throw new Error("Session disposed"); this.busy = true;
    this.lastUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 }; // M2 fix: reset per prompt
    this.emit({ type: "turn_start", model: this.modelId, sessionId: this.opts.sessionId });

    const args = ["-p", "--output-format", "stream-json", "--model", this.modelId, "--continue", "--session-dir", this.sessionDir, "--", text];
    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env }, cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // BB fix: drain stderr to prevent pipe deadlock
    this.child.stderr?.on("data", (d: Buffer) => { if (process.env.DEBUG_CLAUDE) console.debug("[claude stderr]", d.toString().trim()); });

    try {
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: this.child!.stdout! });
        rl.on("line", (line) => {
          const event = ClaudeEventNormalizer.parseLine(line);
          if (!event) return;
          // R6-4 fix: catch _usage_update to update lastUsage
          if ((event as any)._type === "usage") {
            this.lastUsage.tokensIn = (event as any).tokensIn;
            this.lastUsage.tokensOut = (event as any).tokensOut;
            if ((event as any).costUsd !== undefined && (event as any).costUsd !== null) this.lastUsage.costUsd = (event as any).costUsd;
            return;
          }
          this.emit(event);
        });

        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let settled = false;
        this.child!.on("exit", (code, signal) => { exitCode = code; exitSignal = signal; });
        this.child!.on("close", () => {
          if (settled) return; settled = true;
          if ((exitCode !== null && exitCode !== 0) || exitSignal) {
            this.emit({ type: "error", message: `Claude exited with code ${exitCode}${exitSignal ? ` (signal ${exitSignal})` : ""}`, recoverable: false });
          }
          this.emit({ type: "turn_end", tokensIn: this.lastUsage.tokensIn, tokensOut: this.lastUsage.tokensOut, ...(this.lastUsage.costUsd > 0 ? { costUsd: this.lastUsage.costUsd } : {}) });
          resolve();
        });
        this.child!.on("error", (err) => {
          if (settled) return; settled = true;
          this.emit({ type: "error", message: err.message, recoverable: false });
          this.emit({ type: "turn_end", tokensIn: this.lastUsage.tokensIn, tokensOut: this.lastUsage.tokensOut, ...(this.lastUsage.costUsd > 0 ? { costUsd: this.lastUsage.costUsd } : {}) });
          resolve();
        });
      });
    } finally {
      this.disposed = true; this.busy = false;
    }
  }

  async setModel(model: any): Promise<void> { this.modelId = model.id; this.emit({ type: "model_changed", model: model.id }); }
  setThinking(_level: ThinkingLevel): void {}
  async compact(): Promise<CompactionResult> { return { tokensBefore: 0, tokensAfter: 0, strategy: "none" }; }
  getState(): SessionState {
    return { model: this.modelId, thinking: "off", status: this.busy ? "thinking" : "idle", tokensIn: this.lastUsage.tokensIn, tokensOut: this.lastUsage.tokensOut, contextPct: 0, contextWindow: 200_000, costUsd: this.lastUsage.costUsd, startedAt: this.createdAt, lastActivity: nowWallclock() };
  }
  isIdle(): boolean { return !this.busy; }

  async dispose(): Promise<void> {
    this.child?.kill();
    const err = new Error("Session disposed");
    for (const item of this.promptQueue) { item.reject(err); }
    this.promptQueue = [];
    this.listeners.clear();
    this.disposed = true; this.busy = false;
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(event: AgentEvent): void { this.listeners.forEach(l => { try { l(event); } catch (e) { console.warn("[runtime] listener error:", e); } }); }
}
