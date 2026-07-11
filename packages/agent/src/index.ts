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
  ArrayHistory,
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
import { assemblePrompt, defaultStableTier } from "@my-agent/prompts";
import {
  ToolRegistry,
  builtinTools,
  runToolBatch,
  type ToolImpl,
} from "@my-agent/tools";
import { FileBackend, MemoryManagerImpl, Brain, ArchivistRole, GoalsRole, TypedGraph, KnowledgeSource, createRagfs, makeRagfsScanner, MemoryContextSource, type RagfsRouter } from "@my-agent/memory";
import { scan as scanContent } from "@my-agent/prompts";
import { HindsightReviewer, type HindsightResult } from "@my-agent/council";
import { SkillStore } from "@my-agent/skills";

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
  /** §10 advisor lane: a second-model critic that reviews each completed turn
   * and emits issues (auto-invoked after turn completion). */
  hindsight?: { reviewer: HindsightReviewer };
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
  /** §8 Brain (facts/takes/pages + dream-cycle phases). */
  brain: Brain;
  /** §8 ragfs unified-context-FS (scan-on-read wired). */
  ragfs: RagfsRouter;
  tools: ToolRegistry;
  /** Phase 31: skill store (for /skill-selector + /skills). */
  skillStore: SkillStore;
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
          model: process.env["MINIMAX_MODEL"] ?? config.model ?? "MiniMax-M3",
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
  memory.addRole(new ArchivistRole());
  const goalsRole = new GoalsRole();
  memory.addRole(goalsRole);

  // §8 Brain (facts/takes/pages + dream-cycle phases).
  const brain = new Brain();
  // Phase 31: skill store (for /skill-selector + /skills).
  const skillStore = new SkillStore();
  // §8 ragfs: unified-context-FS with the prompts scanner wired (R25-18 scan-on-read).
  const knowledgeGraph = new TypedGraph();
  const ragfs = createRagfs({
    scanner: makeRagfsScanner(scanContent),
    sources: [new KnowledgeSource(knowledgeGraph), new MemoryContextSource(memory)],
  });

  // ── tools ──
  const toolRegistry = new ToolRegistry();
  for (const t of config.tools ?? builtinTools) toolRegistry.register(t);
  // Build OpenAI-compatible function schemas (for native tool calling).
  const openAITools = buildOpenAITools(toolRegistry);

  // ── session + budget ──
  const budget = config.budget ?? freeBudget();
  // Compose the stable tier: identity + tools block. Tools are fixed for this
  // agent's lifetime (createAgent returns a fixed toolRegistry) → setting once
  // here keeps the prompt cache-stable.
  const stableTier = composeStableTier(config.stableTier ?? defaultStableTier(), toolRegistry);
  const session = createSession({ profiles: [...providers.all()], stableTier });
  // Replace the stub memory with the real manager.
  (session as { memory: unknown }).memory = memory;

  const toolExecutor: ToolExecutor = {
    execute: (calls, ctx) => runToolBatch(calls, ctx, toolRegistry),
  };

  // HIGH-2 (review): async turn lock — serializes concurrent prompt() calls.
  let turnLock = Promise.resolve();
  function withTurnLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = turnLock;
    let release!: () => void;
    turnLock = new Promise<void>((r) => (release = r));
    return prev.then(() => fn()).finally(release);
  }

  // CRITICAL-1 (review): extract the assistant's text response from RuntimeEvents
  // + append it to session.history. Without this, multi-turn conversation breaks
  // (the provider sees consecutive user messages with no assistant response).
  function appendAssistantToHistory(events: RuntimeEvent[]): void {
    const chunks: string[] = [];
    for (const e of events) {
      if (e.kind === "turn" && e.stage === "event" && e.turnEvent?.state === "Streaming") {
        const chunk = e.turnEvent.chunk;
        if (chunk && chunk.kind === "text") chunks.push(chunk.text);
      }
    }
    const text = chunks.join("");
    if (text.trim()) session.history.append({ role: "assistant", content: text });
  }

  async function startTurn(text: string, signal?: AbortSignal) {
    session.history.append({ role: "user", content: text });
    // Refresh memory snapshot, then assemble the cache-stable prompt (§5) BEFORE the turn.
    await memory.refresh();
    // Phase 14c: populate the goals block from the GoalsRole before assembly.
    const goalsBackend = memory.backends.find((b) => b.role === "goals");
    if (goalsBackend) {
      session.goalsBlock = await goalsRole.systemPromptBlock(goalsBackend);
    }
    assemblePrompt(session);
    return runTurn({
      session,
      budget,
      tools: toolExecutor,
      // §6 fallback chain injection (keeps core layering-clean).
      stream: (prompt, history, streamOpts) =>
        streamWithFallback(providers, prompt, history, streamOpts).then((r) =>
          "error" in r ? { error: r.error } : { events: r.events },
        ),
      toolSchemas: openAITools, // OpenAI-compatible function schemas (for native tool calling)
      signal,
    });
  }

  /** §10 advisor lane: after a turn completes, run the hindsight reviewer on
   * the turn's answer + emit issues as RuntimeEvent{kind:"log"}. Never throws —
   * a critic failure degrades to a logged warning (never blocks the turn). */
  async function runHindsight(text: string, events: RuntimeEvent[], emit: (e: RuntimeEvent) => void): Promise<void> {
    if (!config.hindsight) return;
    // reconstruct the assistant's answer text from streaming chunks. The agent
    // emits {kind:"turn", stage:"event", turnEvent:{state, chunk}} envelopes.
    const answer = events
      .map((e) => (e as { turnEvent?: { state?: string; chunk?: { kind?: string; text?: string } } }).turnEvent)
      .filter((te) => te?.state === "Streaming" && te.chunk?.kind === "text")
      .map((te) => te!.chunk!.text ?? "")
      .join("");
    if (!answer.trim()) return;
    try {
      const result: HindsightResult = await config.hindsight.reviewer.review(text, answer);
      emit({ kind: "log", level: result.approved ? "info" : "warn", message: `hindsight: ${result.summary}`, data: { issues: result.issues, approved: result.approved } } as RuntimeEvent);
    } catch (e) {
      emit({ kind: "log", level: "warn", message: `hindsight critic failed: ${(e as Error).message}` } as RuntimeEvent);
    }
  }

  /** §8 dream cycle: after a turn, feed the brain + seed the knowledge graph +
   * sync memory roles. Never throws — degrades to a logged warning. */
  async function runDreamCycle(): Promise<void> {
    try {
      // 1. Feed the conversation to the brain (conversation_facts_backfill).
      const history = session.history as ArrayHistory;
      const conversation = history.entries().map((e) => {
        const entry = e as { role?: string; content?: string };
        return { role: entry.role ?? "user", content: entry.content ?? "" };
      });
      brain.conversationFactsBackfill(conversation);
      // 2. Consolidate hot facts into takes.
      brain.consolidate();
      // 3. Seed the knowledge graph from the brain's zero-LLM backlinks.
      knowledgeGraph.ingestBacklinks(brain.backlinks());
      // 4. Set recentTurn for the archivist role, then sync memory roles.
      (session).recentTurn = conversation.slice(-20);
      await memory.syncAll({ session } as import("@my-agent/core").TurnContext);
    } catch (e) {
      // dream-cycle failure is non-fatal — but log it (review HIGH-2).
      console.warn(`dream-cycle failed (non-fatal): ${(e as Error).message}`);
    }
  }

  async function runOnce(text: string, signal?: AbortSignal): Promise<RuntimeEvent[]> {
    return withTurnLock(async () => {
    const collected: RuntimeEvent[] = [];
    const handle = await startTurn(text, signal);
    handle.on((e) => collected.push(e));
    await handle.done;
    // CRITICAL-1 (review): append the assistant response to history so
    // multi-turn conversations work (the provider needs alternating user/assistant).
    appendAssistantToHistory(collected);
    await runHindsight(text, collected, (e) => collected.push(e));
    void runDreamCycle(); // HIGH-1: fire-and-forget — don't block the response
    return collected;
    });
  }

  async function runLive(
    text: string,
    sink: (e: RuntimeEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return withTurnLock(async () => {
    const handle = await startTurn(text, signal);
    const events: RuntimeEvent[] = [];
    handle.on((e) => { sink(e); events.push(e); });
    await handle.done;
    appendAssistantToHistory(events);
    await runHindsight(text, events, sink);
    void runDreamCycle();
    });
  }

  return {
    prompt: (text, opts) => runOnce(text, opts?.signal),
    run: (text, sink, opts) => runLive(text, sink, opts?.signal),
    providers,
    memory,
    brain,
    ragfs,
    tools: toolRegistry,
    skillStore,
  };
}

export type { ToolImpl };

/** One-line description per tool name (the catalog the model sees in the prompt). */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "read a file's contents (ReadOnly)",
  write: "write content to a file (overwrite; WorkspaceWrite)",
  edit: "replace exact text in a file (ambiguity-guarded; WorkspaceWrite)",
  replace: "hash-anchored line-range replace with stale-anchor detection (WorkspaceWrite)",
  bash: "run a shell command via /bin/bash (DangerFullAccess — requires approval)",
  glob: "find files matching a glob pattern under a cwd (ReadOnly)",
  grep: "search file contents for a regex under a cwd (ReadOnly)",
  code: "run a JS or Python script that can round-trip-call tools via stdin/stdout JSON-RPC (DangerFullAccess)",
  codegraph: "list files related to a given path (import-graph file relevance; ReadOnly)",
};

/** Render the tools block: name + 1-line description per registered tool. */
function renderToolsBlock(registry: ToolRegistry): string {
  const lines = ["## Tools (invoke by name when needed)"];
  for (const meta of registry.list()) {
    const desc = TOOL_DESCRIPTIONS[meta.name] ?? meta.name;
    lines.push(`- **${meta.name}** — ${desc}`);
  }
  return lines.join("\n");
}

/** Build OpenAI-compatible function schemas from the tool registry (for native tool calling). */
function buildOpenAITools(registry: ToolRegistry): import("@my-agent/core").OpenAITool[] {
  const descs = TOOL_DESCRIPTIONS;
  return registry.list().map((meta) => ({
    type: "function" as const,
    function: {
      name: meta.name,
      description: descs[meta.name] ?? meta.name,
      parameters: meta.args,
    },
  }));
}

/** Compose identity + tools block into the stable tier. */
function composeStableTier(identity: string, registry: ToolRegistry): string {
  return `${identity}\n\n${renderToolsBlock(registry)}`;
}
