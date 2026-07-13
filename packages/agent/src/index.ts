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
// Phase 1-6 wiring: audit + secrets (Phase 1), hooks (Phase 2), x402 + dap (Phases 3-4),
// pkg (Phase 5), tts (Phase 6). Cron is a gateway-side concern but imported here so
// the @my-agent/cron package is part of the agent's resolved dependency set.
import { AuditLog } from "@my-agent/audit";
import { SecretStore, makeSecretRedactor } from "@my-agent/secrets";
import { CronScheduler } from "@my-agent/cron";
import { makePaidFetchTool, Wallet } from "@my-agent/x402";
import { makeDebugTool } from "@my-agent/dap";
import { PackageHost } from "@my-agent/pkg";
import { speak } from "@my-agent/tts";
import type { ToolHookSink } from "@my-agent/core";

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
  // ── Phase 1-6 wiring (each optional → backward-compatible) ──
  /** Phase 1: explicit tamper-evident audit log. If absent, an identity-redacting
   * AuditLog is constructed (with the secret-store redactor when secretStore is set). */
  auditLog?: AuditLog;
  /** Phase 1: secret store used both to redact audit payloads AND to resolve API keys
   * before falling back to process.env (see createAgent). */
  secretStore?: SecretStore;
  /** Phase 2: pre/post-tool hook sink (§7). Forwarded into runTurn → tools dispatch. */
  hooks?: ToolHookSink;
  /** Phase 3: x402 wallet. When present, a `paid_fetch` tool is registered. */
  wallet?: Wallet;
  /** Phase 4: DAP debug-adapter connection config. When present, a `debug` tool is registered. */
  dapConnect?: { connect: unknown };
  /** Phase 5: extension/package host (for runtime-loaded skills + extensions). */
  extensionHost?: PackageHost;
  /** Phase 6: fire-and-forget TTS narration of each completed assistant turn. */
  tts?: boolean;
  /** Shared skill store. If absent, a fresh empty SkillStore is created.
   * Pass a pre-discovered store to share skills across agent instances. */
  skillStore?: SkillStore;
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
  /** Phase 1: tamper-evident audit log (forwarded to runTurn → tools dispatch). */
  readonly audit: AuditLog;
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
    // Keys resolved via secretStore when available, else process.env.
    // secretStore.resolve() is fail-closed (throws if missing) — catch → undefined.
    const tryResolve = (ref: string): string | undefined => {
      if (!config.secretStore) return process.env[ref];
      try { return config.secretStore.resolve({ from: "env", ref }); }
      catch { return process.env[ref]; }
    };
    const minimaxKey = tryResolve("MINIMAX_API_KEY");
    const openaiKey = tryResolve("OPENAI_API_KEY");
    if (minimaxKey) {
      providers.register(
        new OpenAIAdapter({
          model: process.env["MINIMAX_MODEL"] ?? config.model ?? "MiniMax-M3",
          baseUrl: process.env["MINIMAX_BASE_URL"] ?? "https://api.minimax.io/v1",
          apiKey: minimaxKey,
          id: "minimax",
        }),
      );
    }
    if (openaiKey) {
      providers.register(
        new OpenAIAdapter({
          model: config.model ?? "gpt-4o-mini",
          baseUrl: config.openaiBaseUrl,
          id: "openai",
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
  // Use shared store from config if provided (enables cross-agent skill sharing).
  const skillStore = config.skillStore ?? new SkillStore();
  // §8 ragfs: unified-context-FS with the prompts scanner wired (R25-18 scan-on-read).
  const knowledgeGraph = new TypedGraph();
  const ragfs = createRagfs({
    scanner: makeRagfsScanner(scanContent),
    sources: [new KnowledgeSource(knowledgeGraph), new MemoryContextSource(memory)],
  });

  // ── tools ──
  const toolRegistry = new ToolRegistry();
  for (const t of config.tools ?? builtinTools) toolRegistry.register(t);
  // Phase 3: paid_fetch tool (x402) — registers only when a wallet is supplied.
  if (config.wallet) toolRegistry.register(makePaidFetchTool(config.wallet));
  // Phase 4: debug tool (DAP) — narrow-cast via Parameters<...>[0] so we never use `as any`.
  if (config.dapConnect) {
    toolRegistry.register(makeDebugTool(config.dapConnect as unknown as Parameters<typeof makeDebugTool>[0]));
  }
  // Phase 1: tamper-evident audit log (identity-redacted unless a secretStore is wired).
  // Resolved BEFORE the toolExecutor so it can be forwarded into runTurn (E).
  const audit: AuditLog = config.auditLog ?? (() => {
    if (!config.secretStore) return new AuditLog();
    // makeSecretRedactor returns a 1-arg (payload) function; the audit Redactor
    // slot expects a 2-arg (kind, payload) function. Adapt with a thin lambda.
    const redact = makeSecretRedactor(config.secretStore);
    return new AuditLog((_kind, payload) => redact(payload));
  })();
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
    const text = extractAssistantText(events);
    if (text.trim()) session.history.append({ role: "assistant", content: text });
  }

  async function startTurn(text: string, signal?: AbortSignal) {
    session.history.append({ role: "user", content: text });
    // P0-perf: refresh memory snapshot + fetch the goals block IN PARALLEL.
    // Previously these were serial: 6 backend reads followed by a 7th (goals).
    // Promise.all collapses them into a single round-trip of work.
    const goalsBackend = memory.backends.find((b) => b.role === "goals");
    const [, goalsBlock] = await Promise.all([
      memory.refresh(),
      goalsBackend ? goalsRole.systemPromptBlock(goalsBackend) : Promise.resolve(""),
    ]);
    session.goalsBlock = goalsBlock;
    // assemblePrompt is memoized — first call only. (§5)
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
      // Phase 1: forward audit (audit is the closure variable from createAgent).
      audit,
      // Phase 2: forward pre/post-tool hook sink.
      hooks: config.hooks,
      signal,
    });
  }

  /** §10 advisor lane: after a turn completes, run the hindsight reviewer on
   * the turn's answer + emit issues as RuntimeEvent{kind:"log"}. Never throws —
   * a critic failure degrades to a logged warning (never blocks the turn). */
  async function runHindsight(text: string, events: RuntimeEvent[], emit: (e: RuntimeEvent) => void): Promise<void> {
    if (!config.hindsight) return;
    const answer = extractAssistantText(events);
    if (!answer.trim()) return;
    try {
      const result: HindsightResult = await config.hindsight.reviewer.review(text, answer);
      emit({ kind: "log", level: result.approved ? "info" : "warn", message: `hindsight: ${result.summary}`, data: { issues: result.issues, approved: result.approved } } as RuntimeEvent);
    } catch (e) {
      emit({ kind: "log", level: "warn", message: `hindsight critic failed: ${(e as Error).message}` } as RuntimeEvent);
    }
  }

  /** Phase 6: best-effort TTS narration of the completed assistant turn. Never throws
   * (the .catch absorbs speak failures — TTS must NEVER block the response). */
  function runTts(events: RuntimeEvent[]): void {
    if (!config.tts) return;
    const answer = extractAssistantText(events);
    if (!answer.trim()) return;
    void speak(answer).catch(() => { /* TTS is best-effort */ });
  }

  /** §8 dream cycle: after a turn, feed the brain + seed the knowledge graph +
   * sync memory roles. Never throws — degrades to a logged warning. */
  async function runDreamCycle(): Promise<void> {
    // Issue #9: each phase isolated so one failure doesn't block others.
    const safe = async (name: string, fn: () => void | Promise<void>) => {
      try { await fn(); }
      catch (e) { console.warn(`dream-cycle phase "${name}" failed (non-fatal): ${(e as Error).message}`); }
    };
    const history = session.history as ArrayHistory;
    const conversation = history.entries().map((e) => {
      const entry = e as { role?: string; content?: string };
      return { role: entry.role ?? "user", content: entry.content ?? "" };
    });
    await safe("backfill", () => { brain.conversationFactsBackfill(conversation); });
    await safe("consolidate", () => { brain.consolidate(); });
    await safe("ingest-backlinks", () => { knowledgeGraph.ingestBacklinks(brain.backlinks()); });
    await safe("sync-memory", async () => {
      (session).recentTurn = conversation.slice(-20);
      await memory.syncAll({ session } as import("@my-agent/core").TurnContext);
    });
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
    // Issue #5: Hindsight now fire-and-forget (don't block response).
    // Hindsight is a critic — its result is informational, not blocking.
    runHindsight(text, collected, (e) => collected.push(e));
    runTts(collected); // Phase 6: fire-and-forget TTS narration (best-effort).
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
    // Issue #5: Hindsight now fire-and-forget.
    runHindsight(text, events, sink);
    runTts(events); // Phase 6: fire-and-forget TTS narration (best-effort).
    void runDreamCycle();
    });
  }

  return {
    prompt: (text, opts) => runOnce(text, opts?.signal),
    run: (text, sink, opts) => runLive(text, sink, opts?.signal),
    providers,
    memory,
    brain,
    audit,
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

/** Reconstruct the assistant's answer text from streaming chunks. The agent
 * emits {kind:"turn", stage:"event", turnEvent:{state, chunk}} envelopes — this
 * joins every text chunk in turn order. Shared by appendAssistantToHistory
 * (history bookkeeping), runHindsight (critic input), and runTts (narration). */
function extractAssistantText(events: RuntimeEvent[]): string {
  const chunks: string[] = [];
  for (const e of events) {
    if (e.kind === "turn" && e.stage === "event" && e.turnEvent?.state === "Streaming") {
      const chunk = e.turnEvent.chunk;
      if (chunk && chunk.kind === "text") chunks.push(chunk.text);
    }
  }
  return chunks.join("");
}
export * from "./sdk.js";
export * from "./subagents/index.js";

// AgentPool — manages multiple pi AgentSession instances (used by gateway)
export { AgentPool, type AgentPoolOptions, type AgentSessionEntry, type AgentSession, type SessionFactory } from "./pool.js";
