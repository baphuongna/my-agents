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
    options?: { apiKey?: string; signal?: AbortSignal; reasoning?: string },
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
  /** Thinking/reasoning level: minimal|low|medium|high|xhigh|max */
  reasoning?: string;
}

export class PiAiProviderBridge implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private provider: PiAiProviderBridgeOptions["provider"];
  private piAiModel: { id: string; api?: string };
  private _apiKey: string;
  private _reasoning?: string;

  constructor(opts: PiAiProviderBridgeOptions) {
    this.provider = opts.provider;
    this.piAiModel = opts.model;
    this.model = opts.model.id;
    this.id = opts.id ?? `${opts.provider.id}:${opts.model.id}`;
    this._apiKey = opts.apiKey ?? opts.provider.auth?.apiKey?.resolve() ?? "";
    this._reasoning = opts.reasoning;
  }

  /** Set thinking/reasoning level at runtime. */
  setReasoning(level: string | undefined): void {
    this._reasoning = level;
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
        reasoning: this._reasoning,
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

// ── Multi-provider wrapping (§17: wrap ALL pi-ai providers into ProviderProfile) ──

/** A pi-ai provider with a sync model listing (the real `Provider` interface). */
export interface PiAiProviderWithModels extends PiAiProviderLike {
  /** Returns the provider's known models; `model.id` + `model.api` are used. */
  getModels(): ReadonlyArray<{ id: string; api?: string }>;
}

/** Options for wrapping a single pi-ai provider into a ProviderProfile. */
export interface WrapPiAiProviderOptions {
  /** Explicit API key (overrides provider.auth resolution). */
  apiKey?: string;
  /** Explicit model to use; otherwise the provider's first model is selected. */
  model?: { id: string; api?: string };
  /** Explicit profile id; otherwise `<providerId>:<modelId>`. */
  id?: string;
  /** Per-provider API-key resolver (overrides provider.auth). */
  apiKeyFor?: (providerId: string) => string | undefined;
  /** Thinking/reasoning level. */
  reasoning?: string;
}

/** Options for wrapping a list of pi-ai providers into ProviderProfile[]. */
export interface WrapAllPiAiProvidersOptions {
  /** Shared API key applied to every provider. */
  apiKey?: string;
  /** Per-provider API-key resolver (keyed by provider id). */
  apiKeyFor?: (providerId: string) => string | undefined;
  /** Filter which (providerId, modelId) pairs to wrap. */
  modelFilter?: (providerId: string, modelId: string) => boolean;
  /** Skip providers that resolve to no usable API key (default: false). */
  skipUnconfigured?: boolean;
  /** Shared reasoning level. */
  reasoning?: string;
}

function isProviderWithModels(p: PiAiProviderLike): p is PiAiProviderWithModels {
  return typeof (p as { getModels?: unknown }).getModels === "function";
}

/** Pick the first model id from a provider (best-effort). */
function firstModelId(provider: PiAiProviderLike): { id: string; api?: string } | undefined {
  if (isProviderWithModels(provider)) {
    const models = provider.getModels();
    const first = models[0];
    if (first) return { id: first.id, api: first.api };
  }
  return undefined;
}

/** Resolve an API key for a provider honouring explicit + per-provider overrides. */
function resolveApiKey(
  provider: PiAiProviderBridgeOptions["provider"],
  opts: { apiKey?: string; apiKeyFor?: (id: string) => string | undefined },
): string {
  return (
    opts.apiKey ??
    opts.apiKeyFor?.(provider.id) ??
    provider.auth?.apiKey?.resolve() ??
    ""
  );
}

/**
 * Wrap a single pi-ai provider into a `PiAiProviderBridge` (ProviderProfile).
 * Uses the provider's first model unless `opts.model` is given.
 */
export function wrapPiAiProvider(
  provider: PiAiProviderBridgeOptions["provider"],
  opts: WrapPiAiProviderOptions = {},
): PiAiProviderBridge {
  const model = opts.model ?? firstModelId(provider);
  if (!model) {
    throw new Error(`wrapPiAiProvider: provider '${provider.id}' has no models and no model was given`);
  }
  return new PiAiProviderBridge({
    provider,
    model,
    apiKey: resolveApiKey(provider, opts),
    id: opts.id,
    reasoning: opts.reasoning,
  });
}

/**
 * Wrap every pi-ai provider in `providers` into `ProviderProfile`s. Each
 * provider becomes one profile (using its first model). Providers with no
 * models — or unconfigured ones when `skipUnconfigured` is set — are skipped.
 */
export function wrapAllPiAiProviders(
  providers: ReadonlyArray<PiAiProviderBridgeOptions["provider"]>,
  opts: WrapAllPiAiProvidersOptions = {},
): PiAiProviderBridge[] {
  const out: PiAiProviderBridge[] = [];
  for (const provider of providers) {
    const model = firstModelId(provider);
    if (!model) continue; // provider has no models — skip
    if (opts.modelFilter && !opts.modelFilter(provider.id, model.id)) continue;
    const apiKey = resolveApiKey(provider, opts);
    if (opts.skipUnconfigured && !apiKey) continue;
    out.push(new PiAiProviderBridge({ provider, model, apiKey, reasoning: opts.reasoning }));
  }
  return out;
}
