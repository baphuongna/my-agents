/**
 * pi-ai Provider bridge — wraps pi-ai's 30+ providers into ProviderProfile.
 *
 * pi-ai event protocol (real, from vendored/pi-ai/dist/types.d.ts):
 *   start → text_start → text_delta* → text_end → toolcall_* → done/error
 *
 * This bridge consumes the actual event types and converts them to mya StreamEvent.
 */
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";

// ── Real pi-ai event types (from vendored/pi-ai/dist/types.d.ts) ──

interface PiAiToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface PiAiContent {
  type: "text" | "thinking" | "toolCall";
  text?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface PiAiUsage {
  input: number;
  output: number;
  cacheRead?: number;
}

interface PiAiAssistantMessage {
  content: PiAiContent[];
  usage: PiAiUsage;
  stopReason?: string;
}

interface PiAiEvent {
  type: "start" | "text_start" | "text_delta" | "text_end" | "thinking_start" | "thinking_delta" | "thinking_end" | "toolcall_start" | "toolcall_delta" | "toolcall_end" | "done" | "error";
  delta?: string;
  content?: string;
  toolCall?: PiAiToolCall;
  partial?: PiAiAssistantMessage;
  message?: PiAiAssistantMessage;
  reason?: string;
}

interface PiAiContext {
  systemPrompt?: string;
  messages: Array<{ role: string; content: string | PiAiContent[] }>;
  tools?: unknown[];
}

interface PiAiProviderLike {
  readonly id: string;
  streamSimple(
    model: { id: string; api?: string },
    context: PiAiContext,
    options?: { apiKey?: string; signal?: AbortSignal },
  ): AsyncIterable<PiAiEvent>;
}

interface PiAiAuth {
  apiKey?: { resolve(): string | undefined };
}

export interface PiAiProviderBridgeOptions {
  provider: PiAiProviderLike & { auth?: PiAiAuth };
  model: { id: string; api?: string };
  apiKey?: string;
  id?: string;
}

export class PiAiProviderBridge implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private provider: PiAiProviderBridgeOptions["provider"];
  private piAiModel: { id: string; api?: string };
  private _apiKey: string;

  constructor(opts: PiAiProviderBridgeOptions) {
    this.provider = opts.provider;
    this.piAiModel = opts.model;
    this.model = opts.model.id;
    this.id = opts.id ?? `${opts.provider.id}:${opts.model.id}`;
    this._apiKey = opts.apiKey ?? opts.provider.auth?.apiKey?.resolve() ?? "";
  }

  private get apiKey(): string {
    // Lazy resolution for credential rotation (OAuth refresh).
    return this._apiKey || this.provider.auth?.apiKey?.resolve() || "";
  }

  health(): ComponentHealth {
    return this.apiKey ? "Healthy" : "Degraded";
  }

  async stream(
    prompt: SystemPrompt,
    history: History,
    opts?: { tools?: readonly unknown[] },
  ): Promise<{ events: StreamEvent[] }> {
    const systemPrompt = [prompt.stable, prompt.context, prompt.volatile]
      .filter(Boolean)
      .join("\n\n");

    const messages = convertHistory(history);
    const context: PiAiContext = { systemPrompt, messages };

    const events: StreamEvent[] = [];
    let usage: PiAiUsage | undefined;

    try {
      const stream = this.provider.streamSimple(this.piAiModel, context, {
        apiKey: this.apiKey,
      });

      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            // Incremental text — emit the delta directly.
            if (event.delta) events.push({ kind: "text", text: event.delta });
            break;

          case "text_end":
            // Some providers don't send text_delta — fall back to full content.
            if (event.content && events.filter((e) => e.kind === "text").length === 0) {
              events.push({ kind: "text", text: event.content });
            }
            break;

          case "toolcall_end":
            // Tool call completed — emit as tool_calls event.
            if (event.toolCall) {
              events.push({
                kind: "tool_calls",
                calls: [{
                  id: event.toolCall.id,
                  name: event.toolCall.name,
                  args: event.toolCall.arguments,
                }],
              });
            }
            break;

          case "done": {
            // Terminal event — collect usage + finish reason.
            const msg = event.message;
            usage = msg?.usage;

            // Also check content for any tool calls we might have missed.
            if (msg?.content) {
              for (const c of msg.content) {
                if (c.type === "toolCall" && c.id && c.name) {
                  // Only add if not already emitted
                  const already = events.some(
                    (e) => e.kind === "tool_calls" && e.calls.some((tc) => tc.id === c.id),
                  );
                  if (!already) {
                    events.push({
                      kind: "tool_calls",
                      calls: [{ id: c.id, name: c.name, args: c.arguments ?? {} }],
                    });
                  }
                }
              }
            }

            const finishMap: Record<string, "stop" | "length" | "tool"> = {
              stop: "stop",
              length: "length",
              toolUse: "tool",
            };
            events.push({
              kind: "done",
              usage: {
                input: usage?.input ?? 0,
                output: usage?.output ?? 0,
                ...(usage?.cacheRead ? { cacheRead: usage.cacheRead } : {}),
              },
              finish: finishMap[event.reason ?? "stop"] ?? "stop",
            });
            break;
          }

          case "error":
            events.push({
              kind: "error",
              error: {
                phase: "provider",
                recoverable: true,
                retries: 0,
                context: { detail: "pi-ai provider stream error" },
              },
            });
            break;
        }
      }

      // Synthesize done if missing
      if (!events.some((e) => e.kind === "done" || e.kind === "error")) {
        events.push({
          kind: "done",
          usage: { input: 0, output: 0 },
          finish: "stop",
        });
      }

      return { events };
    } catch (e) {
      return {
        events: [{
          kind: "error",
          error: {
            phase: "provider" as const,
            recoverable: true,
            retries: 0,
            context: { detail: e instanceof Error ? e.message : String(e) },
          },
        }],
      };
    }
  }
}

// ── History conversion ──

function convertHistory(history: History): PiAiContext["messages"] {
  const msgs: PiAiContext["messages"] = [];
  for (const entry of history.entries()) {
    const msg = convertHistoryEntry(entry);
    if (msg) msgs.push(msg);
  }
  return msgs;
}

function convertHistoryEntry(entry: unknown): PiAiContext["messages"][number] | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as { role?: string; content?: unknown };

  const role = e.role === "assistant" ? "assistant" : "user";
  if (typeof e.content === "string") return { role, content: e.content };
  if (Array.isArray(e.content)) {
    const text = e.content
      .map((c: { text?: string }) => (typeof c?.text === "string" ? c.text : ""))
      .join("");
    if (text) return { role, content: text };
  }
  return null;
}
