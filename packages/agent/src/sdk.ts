/**
 * @my-agent/sdk — embedded library transport (§20 Tier-0).
 *
 * sdk: `new Agent(config).prompt(text): AsyncIterable<RuntimeEvent>` —
 * embed the agent core in another TS/JS program. The 4th transport mode.
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

export { textMock, MockProvider } from "@my-agent/ai";
export type { ProviderProfile, RuntimeEvent } from "@my-agent/core";
