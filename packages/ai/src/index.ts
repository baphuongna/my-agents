/**
 * @my-agent/ai — provider abstraction (Tier 0 stub).
 *
 * Concrete provider adapters (Anthropic, OpenAI, etc.) land in Tier 1.
 * Tier 0 ships only the MockProvider: canned-replay of StreamEvent[] from a
 * golden trace, no network (R29-6/M1).
 */
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
  TokenUsage,
} from "@my-agent/core";

export interface MockTrace {
  id: string;
  model: string;
  events: StreamEvent[];
}

/**
 * MockProvider — replays a fixed stream of events. Identical input → identical
 * output (deterministic), so the drift grader + tests can replay golden traces.
 */
export class MockProvider implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private cursor = 0;

  constructor(private trace: MockTrace) {
    this.id = trace.id;
    this.model = trace.model;
  }

  async stream(
    _prompt: SystemPrompt,
    _history: History,
  ): Promise<{ events: StreamEvent[] }> {
    // Deterministic replay — reset cursor each call so the same trace replays.
    this.cursor = 0;
    return { events: [...this.trace.events] };
  }

  health(): ComponentHealth {
    return "Healthy";
  }
}

/** Convenience: a provider that emits a single text + done. */
export function textMock(
  text: string,
  model = "mock-1",
  usage: TokenUsage = { input: 1, output: 1 },
): MockProvider {
  return new MockProvider({
    id: `mock-${model}`,
    model,
    events: [
      { kind: "text", text },
      { kind: "done", usage },
    ],
  });
}

export type { ProviderProfile, StreamEvent } from "@my-agent/core";
