/**
 * @my-agent/agent — the assembly point.
 *
 * createAgent(config) wires memory + provider registry + tool registry + prompt
 * assembly into a ready-to-run Agent. This is where the §3 layering converges:
 * the transport modes (print/sdk) depend on THIS, not on the individual packages.
 *
 * Auto-config heuristics (zero-config when possible):
 *   - providers: explicit list, OR MiniMax (MINIMAX_API_KEY), then OpenAI
 *     (OPENAI_API_KEY), then a mock fallback (agent always runs).
 *   - memory: FileBackend(dir) if memoryDir given, else in-memory.
 *   - tools: explicit list, OR the 6 builtins (read/write/edit/bash/glob/grep).
 *
 * Source: §3 Architecture (layering), §20 Tier-1 capability wiring.
 */
import {
  createBudget,
  createSession,
  freeBudget,
  runTurn,
  type BudgetConfig,
  type ProviderProfile,
  type RuntimeEvent,
  type ToolExecutor,
} from "@my-agent/core";
import {
  OpenAIAdapter,
  ProviderRegistry,
  streamWithFallback,
  textMock,
} from "@my-agent/ai";
import { assemblePrompt } from "@my-agent/prompts";
import {
  ToolRegistry,
  builtinTools,
  runToolBatch,
  type ToolImpl,
} from "@my-agent/tools";
import { FileBackend, MemoryManagerImpl } from "@my-agent/memory";

export interface AgentConfig {
  /** Explicit provider list. If absent: OpenAI (if key) + mock fallback. */
  providers?: ProviderProfile[];
  /** OpenAI model (used when auto-configuring the OpenAI adapter). */
  model?: string;
  /** OpenAI baseUrl override (OpenRouter / Together / local). */
  openaiBaseUrl?: string;
  /** Directory for durable (FileBackend) memory. If absent: in-memory only. */
  memoryDir?: string;
  /** Explicit tool list. If absent: the 6 builtins. */
  tools?: ToolImpl[];
  /** Budget. If absent: freeBudget (unlimited). */
  budget?: BudgetConfig;
  /** Stable-tier identity text override. */
  stableTier?: string;
}

export interface Agent {
  /** Run one turn; resolves with the full RuntimeEvent[] (collected). */
  prompt(text: string, opts?: { signal?: AbortSignal }): Promise<RuntimeEvent[]>;
  /** Subscribe to a live run; returns an unsub + the done promise (true streaming). */
  run(
    text: string,
    sink: (e: RuntimeEvent) => void,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  /** Underlying registries (for inspection / extension). */
  providers: ProviderRegistry;
  memory: MemoryManagerImpl;
  tools: ToolRegistry;
}

/** Build a fully-wired Agent. */
export function createAgent(config: AgentConfig = {}): Agent {
  // ── providers ──
  const providers = new ProviderRegistry();
  if (config.providers) {
    for (const p of config.providers) providers.register(p);
  } else {
    // Auto-config: MiniMax (if MINIMAX_API_KEY), then OpenAI (if OPENAI_API_KEY),
    // else a mock echo fallback (agent always runs).
    if (process.env["MINIMAX_API_KEY"]) {
      providers.register(
        new OpenAIAdapter({
          model: process.env["MINIMAX_MODEL"] ?? config.model ?? "MiniMax-Text-01",
          baseUrl: process.env["MINIMAX_BASE_URL"] ?? "https://api.minimax.io/v1",
          apiKey: process.env["MINIMAX_API_KEY"],
        }),
      );
    }
    if (process.env["OPENAI_API_KEY"]) {
      providers.register(
        new OpenAIAdapter({
          model: config.model ?? "gpt-4o-mini",
          baseUrl: config.openaiBaseUrl,
        }),
      );
    }
    // Always register a mock fallback so the agent runs without a key.
    providers.register(textMock("(no provider configured — mock echo)", "mock-fallback"));
  }

  // ── memory ──
  const memory = new MemoryManagerImpl();
  if (config.memoryDir) {
    // Register durable FileBackends FIRST so ensureDefault fills the rest in-memory.
    memory.register(new FileBackend("archivist", config.memoryDir));
    memory.register(new FileBackend("goals", config.memoryDir));
  }
  memory.ensureDefault(["working", "archivist", "tree", "diff", "goals", "sync"]);

  // ── tools ──
  const toolRegistry = new ToolRegistry();
  for (const t of config.tools ?? builtinTools) toolRegistry.register(t);

  // ── session + budget ──
  const budget = config.budget ?? freeBudget();
  const session = createSession({
    profiles: [...providers.all()],
    stableTier: config.stableTier,
  });
  // Replace the stub memory with the real manager.
  (session as { memory: unknown }).memory = memory;

  const toolExecutor: ToolExecutor = {
    execute: (calls, ctx) => runToolBatch(calls, ctx, toolRegistry),
  };

  async function startTurn(text: string, signal?: AbortSignal) {
    session.history.append({ role: "user", content: text });
    // Refresh memory snapshot, then assemble the cache-stable prompt (§5) BEFORE the turn.
    await memory.refresh();
    assemblePrompt(session);
    return runTurn({
      session,
      budget,
      tools: toolExecutor,
      // §6 fallback chain injection (keeps core layering-clean).
      stream: (prompt, history) =>
        streamWithFallback(providers, prompt, history).then((r) =>
          "error" in r ? { error: r.error } : { events: r.events },
        ),
      signal,
    });
  }

  async function runOnce(text: string, signal?: AbortSignal): Promise<RuntimeEvent[]> {
    const collected: RuntimeEvent[] = [];
    const handle = await startTurn(text, signal);
    handle.on((e) => collected.push(e));
    await handle.done;
    return collected;
  }

  async function runLive(
    text: string,
    sink: (e: RuntimeEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const handle = await startTurn(text, signal);
    handle.on(sink);
    await handle.done;
  }

  return {
    prompt: (text, opts) => runOnce(text, opts?.signal),
    run: (text, sink, opts) => runLive(text, sink, opts?.signal),
    providers,
    memory,
    tools: toolRegistry,
  };
}

export type { ToolImpl };
