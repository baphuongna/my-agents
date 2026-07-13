/**
 * pi-ai Provider bridge — wraps pi-ai's 30+ providers into ProviderProfile.
 *
 * pi-ai (vendored) provides 37+ provider adapters (Anthropic, OpenAI, Google,
 * Bedrock, Mistral, DeepSeek, Groq, Together, xAI, etc.). This bridge wraps
 * any pi-ai Provider into mya's ProviderProfile interface, converting:
 *
 *   SystemPrompt (stable+context+volatile) → pi-ai systemPrompt string
 *   History entries → pi-ai Message[]
 *   pi-ai AssistantMessageEventStream → mya StreamEvent[]
 *
 * Usage:
 *   const provider = new PiAiProviderBridge(piAiProvider, piAiModel);
 *   providers.register(provider);
 */
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";

// ── pi-ai type shims (avoid importing the full pi-ai runtime) ──

interface PiAiModel {
  id: string;
  api?: string;
}

interface PiAiMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | Array<{ type: string; text?: string }>;
}

interface PiAiContext {
  systemPrompt?: string;
  messages: PiAiMessage[];
  tools?: unknown[];
}

interface PiAiAssistantMessage {
  content?: Array<{ type: string; text?: string }>;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  usage?: { input?: number; output?: number };
  stopReason?: string;
}

interface PiAiEvent {
  type: "start" | "partial" | "done" | "error";
  partial?: PiAiAssistantMessage;
  message?: PiAiAssistantMessage;
}

interface PiAiProviderLike {
  readonly id: string;
  readonly name: string;
  streamSimple(
    model: PiAiModel,
    context: PiAiContext,
    options?: { apiKey?: string; signal?: AbortSignal },
  ): AsyncIterable<PiAiEvent>;
}

interface PiAiAuth {
  apiKey?: { resolve(): string | undefined };
}

interface PiAiProviderWithAuth extends PiAiProviderLike {
  readonly auth?: PiAiAuth;
}

export interface PiAiProviderBridgeOptions {
  provider: PiAiProviderWithAuth;
  model: PiAiModel;
  /** Override the resolved API key (else uses provider.auth.apiKey.resolve()). */
  apiKey?: string;
  /** Profile ID (defaults to `${provider.id}:${model.id}`). */
  id?: string;
}

export class PiAiProviderBridge implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private provider: PiAiProviderWithAuth;
  private piAiModel: PiAiModel;
  private apiKey: string;

  constructor(opts: PiAiProviderBridgeOptions) {
    this.provider = opts.provider;
    this.piAiModel = opts.model;
    this.model = opts.model.id;
    this.id = opts.id ?? `${opts.provider.id}:${opts.model.id}`;
    this.apiKey = opts.apiKey ?? opts.provider.auth?.apiKey?.resolve() ?? "";
  }

  health(): ComponentHealth {
    // If we have an API key, consider healthy. Let stream() surface failures.
    return this.apiKey ? "Healthy" : "Degraded";
  }

  async stream(
    prompt: SystemPrompt,
    history: History,
    _opts?: { tools?: readonly unknown[] },
  ): Promise<{ events: StreamEvent[] }> {
    // ── Convert SystemPrompt → systemPrompt string ──
    const systemPrompt = [prompt.stable, prompt.context, prompt.volatile]
      .filter(Boolean)
      .join("\n\n");

    // ── Convert History → pi-ai messages ──
    const messages: PiAiMessage[] = [];
    for (const entry of history.entries()) {
      const msg = convertHistoryEntry(entry);
      if (msg) messages.push(msg);
    }

    // If no history entries, include the system prompt as context
    const context: PiAiContext = {
      systemPrompt,
      messages,
    };

    // ── Stream from pi-ai provider ──
    const events: StreamEvent[] = [];
    let accumulatedText = "";
    let usage: { input?: number; output?: number } | undefined;

    try {
      const stream = this.provider.streamSimple(
        this.piAiModel,
        context,
        { apiKey: this.apiKey },
      );

      for await (const event of stream) {
        if (event.type === "partial" || event.type === "done") {
          const msg = event.partial ?? event.message;
          if (msg?.content) {
            // Extract text from content blocks
            const text = extractText(msg.content);
            if (text && text !== accumulatedText) {
              // pi-ai sends accumulated text per event → emit the delta
              const delta = text.slice(accumulatedText.length);
              if (delta) {
                events.push({ kind: "text", text: delta });
                accumulatedText = text;
              }
            }
          }
          // Collect tool calls
          if (msg?.toolCalls && msg.toolCalls.length > 0) {
            events.push({
              kind: "tool_calls",
              calls: msg.toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                args: tc.input,
              })),
            });
          }
          if (msg?.usage) usage = msg.usage;
        }

        if (event.type === "done") {
          events.push({
            kind: "done",
            usage: {
              input: usage?.input ?? 0,
              output: usage?.output ?? 0,
            },
            finish: "stop",
          });
        }

        if (event.type === "error") {
          events.push({
            kind: "error",
            error: {
              phase: "provider",
              recoverable: true,
              retries: 0,
              context: { detail: "pi-ai provider stream error" },
            },
          });
        }
      }

      // If no "done" event was emitted, synthesize one
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
        events: [
          {
            kind: "error",
            error: {
              phase: "provider" as const,
              recoverable: true,
              retries: 0,
              context: { detail: e instanceof Error ? e.message : String(e) },
            },
          },
        ],
      };
    }
  }
}

// ── Helpers ──

function convertHistoryEntry(entry: unknown): PiAiMessage | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as { role?: string; content?: unknown };

  const role = e.role === "assistant" ? "assistant" : e.role === "tool" ? "tool" : "user";

  if (typeof e.content === "string") {
    return { role, content: e.content };
  }

  if (Array.isArray(e.content)) {
    const text = e.content
      .map((c: { text?: string }) => (typeof c?.text === "string" ? c.text : ""))
      .join("");
    if (text) return { role, content: text };
  }

  return null;
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  }
  return "";
}
