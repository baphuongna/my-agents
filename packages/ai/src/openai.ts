/**
 * OpenAI-compatible provider adapter (§6, Tier 1).
 *
 * Works with OpenAI + any OpenAI-compatible endpoint (via baseUrl override:
 * OpenRouter, Together, local llama.cpp, etc.). Streaming via SSE.
 *
 * Message conversion (SystemPrompt + History → OpenAI messages):
 *   - system: stable + context tiers (concatenated; injection-scanned upstream)
 *   - volatile: appended as a trailing system block (env/day/memory)
 *   - history entries: role-tagged (user/assistant/tool)
 *
 * Source: §6 Provider Abstraction. Tool-call parsing is minimal (Tier 1); the
 * §6 tool-call repair module handles malformed deltas.
 */
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
  TokenUsage,
} from "@my-agent/core";

export interface OpenAIAdapterOptions {
  apiKey?: string; // defaults to OPENAI_API_KEY env
  baseUrl?: string; // defaults to https://api.openai.com/v1
  model: string;
  id?: string;
}

interface OpenAIStreamDelta {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAIAdapter implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: OpenAIAdapterOptions) {
    this.id = opts.id ?? `openai:${opts.model}`;
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  health(): ComponentHealth {
    return this.apiKey ? "Healthy" : "Degraded";
  }

  async stream(
    prompt: SystemPrompt,
    history: History,
    opts?: { tools?: readonly import("@my-agent/core").OpenAITool[] },
  ): Promise<{ events: StreamEvent[] }> {
    if (!this.apiKey) {
      return {
        events: [
          {
            kind: "error",
            error: {
              phase: "auth",
              recoverable: false,
              retries: 0,
              context: { reason: "OPENAI_API_KEY not set" },
            },
          },
        ],
      };
    }

    const messages = toMessages(prompt, history);
    let resp: Response;
    const body: Record<string, unknown> = { model: this.model, messages, stream: true, stream_options: { include_usage: true } };
    if (opts?.tools && opts.tools.length > 0) body["tools"] = opts.tools;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { events: [netError(e)] };
    }

    if (resp.status === 401 || resp.status === 403) {
      return { events: [authError(resp.status)] };
    }
    if (resp.status === 429) {
      return { events: [quotaError("rate_limited")] };
    }
    if (!resp.ok || !resp.body) {
      return { events: [netError(new Error(`HTTP ${resp.status}`))] };
    }

    return { events: await parseSSE(resp.body) };
  }
}

/** Convert SystemPrompt + History → OpenAI chat messages. */
function toMessages(prompt: SystemPrompt, history: History): unknown[] {
  const msgs: unknown[] = [];
  // System block: stable + context.
  const systemText = [prompt.stable, prompt.context].filter(Boolean).join("\n\n");
  if (systemText) msgs.push({ role: "system", content: systemText });
  // History turns.
  for (const entry of history.entries()) {
    if (isMsg(entry)) msgs.push(entry);
  }
  // Volatile (env/day/memory) as a trailing system block.
  if (prompt.volatile) msgs.push({ role: "system", content: prompt.volatile });
  return msgs;
}

function isMsg(v: unknown): v is { role: string; content: unknown } {
  return typeof v === "object" && v !== null && "role" in v && "content" in v;
}

/** Parse an SSE stream into StreamEvent[]. */
async function parseSSE(body: ReadableStream<Uint8Array>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: TokenUsage = { input: 0, output: 0 };
  let lastFinish: string | undefined;
  const pendingTools: Map<string, { id: string; name: string; args: string }> = new Map();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: OpenAIStreamDelta;
        try {
          chunk = JSON.parse(data) as OpenAIStreamDelta;
        } catch {
          continue;
        }
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
          };
        }
        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;
        if (finishReason) lastFinish = finishReason;
        if (delta?.content) {
          events.push({ kind: "text", text: delta.content });
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            pendingTools.set(tc.id, {
              id: tc.id,
              name: tc.function.name,
              args: tc.function.arguments ?? "",
            });
          }
        }
      }
    }
  } catch (e) {
    return [
      ...events,
      {
        kind: "error",
        error: {
          phase: "stream",
          recoverable: true,
          retries: 0,
          context: { reason: e instanceof Error ? e.message : String(e) },
        },
      },
    ];
  }

  if (pendingTools.size > 0) {
    events.push({
      kind: "tool_calls",
      calls: [...pendingTools.values()].map((t) => ({
        id: t.id,
        name: t.name,
        args: safeParseArgs(t.args),
      })),
    });
  }
  events.push({ kind: "done", usage, finish: normalizeFinish(lastFinish) });
  return events;
}

function safeParseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // let the repair module handle it
  }
}

function authError(status: number): StreamEvent {
  return {
    kind: "error",
    error: {
      phase: "auth",
      recoverable: false,
      retries: 0,
      context: { reason: `HTTP ${status}: invalid credentials` },
    },
  };
}
function quotaError(reason: string): StreamEvent {
  return {
    kind: "error",
    error: { phase: "quota", recoverable: true, retries: 0, context: { reason } },
  };
}
function netError(e: unknown): StreamEvent {
  return {
    kind: "error",
    error: {
      phase: "provider",
      recoverable: true,
      retries: 0,
      context: { reason: e instanceof Error ? e.message : String(e) },
    },
  };
}

/** Map OpenAI finish_reason → the §4 done.finish vocabulary. */
function normalizeFinish(reason: string | undefined): "stop" | "length" | "tool" | "error" {
  switch (reason) {
    case "length": return "length";
    case "tool_calls": return "tool";
    case "content_filter": return "error";
    default: return "stop"; // "stop" | null | undefined
  }
}
