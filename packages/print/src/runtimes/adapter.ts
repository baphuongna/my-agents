// packages/print/src/runtimes/adapter.ts

import type { AgentSession } from "@my-agent/agent";
import type {
  RuntimeSession, PromptEnricher, CostTracker,
  SessionState, EnrichContext,
} from "@my-agent/core";

export class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";
  private turnLock = Promise.resolve();

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    private onBusyChange?: (busy: boolean) => void,
    private onMessage?: () => void,
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
    this.onBusyChange?.(true);

    try {
      await prev;

      let enriched = text;
      try {
        const ctx: EnrichContext = {
          sessionId: this.session.sessionId,
          runtimeType: this.session.runtimeType,
          executionModel: this.session.executionModel,
        };
        enriched = await this.enricher.enrich(text, ctx);
      } catch (e) {
        console.warn(`[adapter] enrich failed: ${e}`);
      }

      this.textBuffer = "";

      try {
        await this.session.prompt(enriched);
        this.onMessage?.();
      } catch (e) {
        console.warn(`[adapter] session.prompt failed: ${e}`);
        throw e;
      }

      if (this.textBuffer) {
        try {
          const ctx: EnrichContext = {
            sessionId: this.session.sessionId,
            runtimeType: this.session.runtimeType,
            executionModel: this.session.executionModel,
          };
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
    void this.session.dispose().catch(() => {});
  }

  get sessionFile(): string | undefined { return undefined; }

  getState(): SessionState {
    return this.session.getState();
  }

  getTextBuffer(): string { return this.textBuffer; }
}
