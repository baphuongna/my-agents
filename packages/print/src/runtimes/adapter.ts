// packages/print/src/runtimes/adapter.ts

import type { AgentSession } from "@my-agent/agent";
import type {
  RuntimeSession, PromptEnricher, CostTracker,
  SessionState, EnrichContext, PromptOpts,
} from "@my-agent/core";

export class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";
  private turnLock = Promise.resolve();
  private unsubscribeSession?: () => void;

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    private onBusyChange?: (busy: boolean) => void,
    private onMessage?: () => void,
  ) {
    // MED-1 fix: set runtime type for correct per-runtime cost rates
    if ('setRuntimeType' in costTracker) {
      (costTracker as any).setRuntimeType(session.sessionId, session.runtimeType);
    }
    // MED-2 fix: save unsubscribe for cleanup
    this.unsubscribeSession = this.session.onEvent((event) => {
      if (event.type === "text") this.textBuffer += event.delta;
      try { this.costTracker.record(this.session.sessionId, event); } catch {}
      this.listeners.forEach(l => { try { l(event); } catch (e) { console.warn("[runtime] listener error:", e); } });
    });
  }

  async prompt(text: string, options?: unknown): Promise<void> {
    const prev = this.turnLock;
    let release!: () => void;
    this.turnLock = new Promise<void>((r) => { release = r; });
    try {
      await prev;
      this.onBusyChange?.(true); // M1 fix: set busy AFTER acquiring lock

      const ctx: EnrichContext = {
        sessionId: this.session.sessionId,
        runtimeType: this.session.runtimeType,
        executionModel: this.session.executionModel,
      };

      let enriched = text;
      try {
        enriched = await this.enricher.enrich(text, ctx);
      } catch (e) {
        console.warn(`[adapter] enrich failed: ${e}`);
      }

      this.textBuffer = "";

      try {
        // MED-11 fix: forward PromptOpts to underlying session
        await this.session.prompt(enriched, options as PromptOpts);
        this.onMessage?.();
      } catch (e) {
        console.warn(`[adapter] session.prompt failed: ${e}`);
        throw e;
      }

      if (this.textBuffer) {
        try {
          await this.enricher.capture(this.textBuffer, ctx);
        } catch (e) {
          console.warn(`[adapter] capture failed: ${e}`);
        }
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

  abort(): void {
    this.unsubscribeSession?.();
    this.listeners.clear();
    this.onBusyChange?.(false); void this.session.dispose().catch(() => {});
  }

  get sessionFile(): string | undefined { return undefined; }

  getState(): SessionState {
    return this.session.getState();
  }

  getTextBuffer(): string { return this.textBuffer; }
}
