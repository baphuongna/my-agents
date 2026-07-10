/**
 * MockProvider — deterministic replay of StreamEvent[] from a golden trace (R29-6/M1).
 * No network. Identical input → identical output (drift grader / tests replay this).
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

export class MockProvider implements ProviderProfile {
  readonly id: string;
  readonly model: string;

  constructor(private trace: MockTrace) {
    this.id = trace.id;
    this.model = trace.model;
  }

  async stream(
    _prompt: SystemPrompt,
    _history: History,
    _opts?: { tools?: readonly import("@my-agent/core").OpenAITool[] },
  ): Promise<{ events: StreamEvent[] }> {
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
