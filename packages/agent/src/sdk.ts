/**
 * @my-agent/sdk — embedded library transport (§20 Tier-0).
 *
 * sdk: `new Agent(config).prompt(text): AsyncIterable<RuntimeEvent>` —
 * embed the agent core in another TS/JS program. The 4th transport mode.
 *
 * Issue #4: SDK now exposes the full createAgent feature set
 * (memory, tools, audit, hindsight, dream cycle, etc.) via `full` config.
 * The legacy minimal `AgentConfig` is preserved for backward compatibility.
 */
import {
  createSession,
  freeBudget,
  runTurn,
  type BudgetConfig,
  type ProviderProfile,
  type RuntimeEvent,
  type Session,
} from "@my-agent/core";
import { createAgent, type Agent as FullAgent, type AgentConfig as FullAgentConfig } from "./index.js";

export interface AgentConfig {
  profiles: ProviderProfile[];
  stableTier?: string;
  userMd?: string;
  budget?: BudgetConfig;
}

export class Agent {
  private session: Session;
  private budget: BudgetConfig;

  constructor(config: AgentConfig) {
    this.session = createSession({
      profiles: config.profiles,
      stableTier: config.stableTier,
      userMd: config.userMd,
    });
    this.budget = config.budget ?? freeBudget();
  }

  /** Run one turn; yields RuntimeEvents as they occur, resolves on terminal. */
  async *prompt(
    text: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncIterable<RuntimeEvent> {
    // Seed history with the user message.
    this.session.history.append({ role: "user", content: text });

    const queue: RuntimeEvent[] = [];
    let resolveWait!: () => void;
    let wait = new Promise<void>((r) => (resolveWait = r));
    let finished = false;

    const handle = runTurn({
      session: this.session,
      budget: this.budget,
      signal: opts.signal,
    });
    const unsub = handle.on((e) => {
      queue.push(e);
      resolveWait();
      wait = new Promise<void>((r) => (resolveWait = r));
    });

    void handle.done.then(() => {
      finished = true;
      resolveWait();
    });

    while (!finished || queue.length > 0) {
      if (queue.length === 0) await wait;
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    }
    unsub();
  }
}

/**
 * Issue #4: FullAgent wrapper — same AsyncIterable API as Agent
 * but uses the complete createAgent() (memory, tools, audit, etc.).
 * Use this when you need the full mya stack in your app.
 *
 * Example:
 *   import { FullAgent } from "@my-agent/agent/sdk";
 *   const a = new FullAgent({ model: "gpt-4o-mini", memoryDir: "./.mya" });
 *   for await (const e of a.prompt("hello")) console.log(e);
 */
export class FullAgentSDK {
  private agent: FullAgent;

  constructor(config: FullAgentConfig = {}) {
    this.agent = createAgent(config);
  }

  /** Run one turn; yields RuntimeEvents as they occur. */
  async *prompt(
    text: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncIterable<RuntimeEvent> {
    const events: RuntimeEvent[] = await this.agent.prompt(text, opts);
    for (const e of events) yield e;
  }

  /** Streaming version: events delivered as they arrive. */
  async *stream(
    text: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncIterable<RuntimeEvent> {
    const queue: RuntimeEvent[] = [];
    let resolveWait!: () => void;
    let wait = new Promise<void>((r) => (resolveWait = r));
    let finished = false;

    await this.agent.run(text, (e) => {
      queue.push(e);
      resolveWait();
      wait = new Promise<void>((r) => (resolveWait = r));
    }, opts);

    finished = true;
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  }

  /** Underlying full agent (for inspecting memory, audit, etc.). */
  get inner(): FullAgent {
    return this.agent;
  }
}

export { textMock, MockProvider } from "@my-agent/ai";
export type { ProviderProfile, RuntimeEvent } from "@my-agent/core";
export type { FullAgentConfig };
