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
  nowWallclock,
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
import { randomBytes } from "node:crypto";
import {
  ToolRegistry,
  builtinTools,
  createComposioClient,
  registerComposioTools,
  runToolBatch,
  makeCodeExecTool,
  type ToolImpl,
} from "@my-agent/tools";
import { FileBackend, MemoryManagerImpl, Brain, ArchivistRole, GoalsRole, TypedGraph, KnowledgeSource, createRagfs, makeRagfsScanner, MemoryContextSource, type RagfsRouter, DreamCycle,
  archivistDomain, treeDomain, diffDomain, goalsDomain, syncDomain, graphDomain, conversationsDomain, searchDomain, sourcesDomain, entitiesDomain, storeDomain, toolsDomain, queueDomain,
} from "@my-agent/memory";
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
import { type ToolHookSink, type TelemetryExporter } from "@my-agent/core";
import { PiAiProviderBridge } from "@my-agent/ai";
import { createRequire } from "node:module";
import { createExporter } from "./exporters.js";

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
  /** A1: max tool rounds per turn (default 25). Caps the number of
   * provider→tool-call iterations before the loop aborts. */
  maxToolRounds?: number;
}

/** Subagent lifecycle status. */
export type SubagentStatus = "running" | "done" | "failed" | "aborted";

/**
 * Handle to a spawned subagent. Parent can read status, await output, abort.
 *
 * Subagent = a separate Session with isolated history, sharing providers/tools/brain.
 * One level only (no grandchildren). Auto-tracked by Agent.
 */
export interface SubagentHandle {
  /** Unique subagent id (random hex). */
  readonly id: string;
  /** The goal/prompt passed to spawnSubagent. */
  readonly goal: string;
  /** Unix ms when subagent was spawned. */
  readonly startedAt: number;
  /** Optional tool restriction. */
  readonly allowedTools?: string[];
  /** Current lifecycle status. */
  status: SubagentStatus;
  /** Collected output text (assistant response). Empty until done. */
  output: string;
  /** Error message if status === "failed". */
  error?: string;
  /** Unix ms when subagent finished (done/failed/aborted). */
  endedAt?: number;
  /**
   * Mark as aborted AND cancel the underlying turn (via AbortSignal).
   * Status becomes "aborted"; output collected so far is preserved.
   */
  abort(): void;
  /** Promise resolving with output when subagent finishes. */
  wait(): Promise<string>;
  /**
   * Async iterator over assistant text chunks as they stream in.
   * Yields each chunk; iteration ends when subagent finishes.
   */
  stream(): AsyncIterable<string>;
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
  /**
   * Spawn a subagent for a focused task. Returns a handle to track lifecycle
   * (running/done/failed/aborted), read output, and abort.
   */
  spawnSubagent(goal: string, options?: { allowedTools?: string[]; signal?: AbortSignal }): SubagentHandle;
  /** List all subagents (active + completed). */
  listSubagents(): SubagentHandle[];
  /** Get a specific subagent by id. */
  getSubagent(id: string): SubagentHandle | undefined;
  /** Kill a subagent (mark aborted, remove from pool). Returns true if found. */
  killSubagent(id: string): boolean;
  /** Kill all subagents. Returns number killed. */
  killAllSubagents(): number;
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
  /** Telemetry exporter (OTel / Langfuse / Noop). */
  telemetryExporter: TelemetryExporter;
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
          model: process.env["MINIMAX_MODEL"] ?? config.model ?? "auto",
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
    // ── Auto-detect pi-ai providers from env vars ──
    // Skip providers already explicitly registered (e.g. minimax, openai above).
    const existingIds = new Set(providers.all().map((p) => p.id));
    for (const bridge of autoDetectPiAiProviders(tryResolve)) {
      if (!existingIds.has(bridge.id)) providers.register(bridge);
    }
    // Always register a mock fallback so the agent runs without a key.
    providers.register(textMock("(no provider configured — mock echo)", "mock-fallback"));
  }

  // ── memory ──
  // §8 Brain (facts/takes/pages + dream-cycle phases).
  const brain = new Brain();
  let activeTurns = 0;
  const dreamCycle = new DreamCycle({
    brain,
    provider: providers.all()[0],
    isIdle: () => activeTurns === 0,
  });
  dreamCycle.start();
  // C-8 fix: wire Brain + DreamCycle + 13 domains into MemoryManager via withBrain()
  // R5-10 fix: pass persistenceDir so BrainStore is enabled (was not passed →
  // Brain facts were process-local, lost on restart).
  // R5-9 fix: pass FileBackend instances via roleBackends (registered BEFORE
  // ensureDefault) so durable markdown backends actually take effect. Previously
  // register() threw on duplicate (default already installed) and was swallowed.
  const roleBackends = config.memoryDir
    ? (() => {
        const dir = config.memoryDir!;
        return (["archivist", "goals", "working", "tree"] as const).map((r) => new FileBackend(r, dir));
      })()
    : undefined;
  const memory = MemoryManagerImpl.withBrain({
    brain,
    dreamCycle,
    domains: [
      archivistDomain, treeDomain, diffDomain, goalsDomain, syncDomain,
      graphDomain, conversationsDomain, searchDomain, sourcesDomain,
      entitiesDomain, storeDomain, toolsDomain, queueDomain,
    ],
    persistenceDir: config.memoryDir,
    roleBackends,
  });
  if (config.memoryDir) {
  }
  // Tier-3: wire previously-dead domains (sources + store + goals).
  storeDomain.wireManager(memory);
  sourcesDomain.wireSource(new MemoryContextSource(memory));
  for (const backend of memory.backends) {
    if (backend.role === "goals") { goalsDomain.wireStore(backend); break; }
  }
  memory.addRole(new ArchivistRole());
  const goalsRole = new GoalsRole();
  memory.addRole(goalsRole);
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
  // C-6 fix: auto-register Composio tools when COMPOSIO_API_KEY is set
  {
    const composioClient = createComposioClient();
    if (composioClient) {
      // NOTE (B5, documented): Composio registration is fire-and-forget — its
      // async-fetched tools MAY miss the openAITools + stableTier snapshot below
      // and not reach the model surface for the first turn. The root fix is to
      // make createAgent async, but that requires an SDK API change
      // (FullAgentSDK constructor → async factory) + ~30 call sites — tracked as
      // a separate refactor, not this batch. Composio is opt-in (COMPOSIO_API_KEY)
      // and usually resolves before the first user turn, so impact is low.
      registerComposioTools(toolRegistry, composioClient, process.env.COMPOSIO_ACCOUNT_ID ?? "").catch(() => { /* best-effort */ });
    }
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
  // R5-5 fix: include skills index in the stable tier (was only in print/mya-bridge).
  const skillBlock = skillStore.index().length > 0 ? skillStore.renderIndexBlock() : undefined;
  const stableTier = composeStableTier(config.stableTier ?? defaultStableTier(), toolRegistry, skillBlock);
  const session = createSession({ profiles: [...providers.all()], stableTier });
  // Replace the stub memory with the real manager.
  (session as { memory: unknown }).memory = memory;

  const toolExecutor: ToolExecutor = {
    execute: (calls, ctx) => runToolBatch(calls, ctx, toolRegistry),
  };

  // R6-1 fix: register code-execution bridge tool (was implemented but never wired).
  // The bridge spawns node/python child processes with bidirectional JSON-RPC
  // to call back into agent tools. Uses the dispatch _ctx directly (no ctxSource needed).
  if (!config.tools) {
    try {
      const codeTool = makeCodeExecTool(toolExecutor);
      if (codeTool) toolRegistry.register(codeTool);
    } catch { /* best-effort — bridge may be unavailable */ }
  }

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
      // R5-4 fix: wire compressHistory (was never injected → compression never ran
      // in the agent SDK path). Truncate to first + last 30 entries on length-finish.
      compressHistory: (history) => {
        const entries = history.entries();
        if (entries.length <= 40) return;
        const arr = (history as unknown as { _entries?: unknown[] })._entries;
        if (Array.isArray(arr)) {
          const keep = [arr[0], ...arr.slice(-39)];
          arr.length = 0;
          arr.push(...keep);
        }
      },
      signal,
      // A1: forward maxToolRounds from config (default 25 in loop.ts).
      maxToolRounds: config.maxToolRounds,
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

  // ─── Subagent spawning ────────────────────────────────────────────────────
  // A subagent is a separate Session with isolated history, sharing profiles/tools/brain.
  // Pattern: parent calls spawnSubagent(goal) → gets a handle. Subagent runs
  // independently. Parent can list/get/kill via the handle map.

  const subagents = new Map<string, SubagentHandle>();

  /** Run a single turn on a subagent session. Mirrors runOnce but on a foreign session.
   * Throws if the turn ended in Failed state (e.g. provider error) or signal aborted.
   * Output is captured into `collectedOutput` (live, by chunks). */
  async function runSubagentTurn(
    subSession: ReturnType<typeof createSession>,
    text: string,
    signal: AbortSignal | undefined,
    onChunk: (chunk: string) => void,
    collectedOutput: { text: string },
    subBudget: BudgetConfig, // R3-1: isolated child budget
  ): Promise<RuntimeEvent[]> {
    subSession.history.append({ role: "user", content: text });
    const goalsBackend = memory.backends.find((b) => b.role === "goals");
    const [, goalsBlock] = await Promise.all([
      memory.refresh(),
      goalsBackend ? goalsRole.systemPromptBlock(goalsBackend) : Promise.resolve(""),
    ]);
    subSession.goalsBlock = goalsBlock;
    assemblePrompt(subSession);
    const handle = await runTurn({
      session: subSession,
      budget: subBudget,
      tools: toolExecutor,
      stream: (prompt, history, streamOpts) =>
        streamWithFallback(providers, prompt, history, streamOpts).then((r) =>
          "error" in r ? { error: r.error } : { events: r.events },
        ),
      toolSchemas: openAITools,
      audit,
      hooks: config.hooks,
      // A1: forward maxToolRounds to subagent path too (cold-verify finding).
      maxToolRounds: config.maxToolRounds,
      signal,
    });
    const collected: RuntimeEvent[] = [];
    handle.on((e) => {
      collected.push(e);
      // Stream + accumulate text chunks
      const ev = e as { kind?: string; turnEvent?: { state?: string; chunk?: { kind?: string; text?: string } } };
      if (
        ev.kind === "turn" &&
        ev.turnEvent?.state === "Streaming" &&
        ev.turnEvent.chunk?.kind === "text" &&
        ev.turnEvent.chunk.text
      ) {
        const chunk = ev.turnEvent.chunk.text;
        collectedOutput.text += chunk;
        onChunk(chunk);
      }
    });
    const result = await handle.done;
    if (result && typeof result === "object" && "state" in result && result.state === "Failed") {
      const err = (result as { error?: { context?: { reason?: string } } }).error;
      const reason = err?.context?.reason ?? "subagent turn failed";
      throw new Error(reason);
    }
    if (signal?.aborted) throw new Error("aborted");
    // Append assistant response to subagent history (for multi-turn support).
    const answer = extractAssistantText(collected);
    if (answer.trim()) subSession.history.append({ role: "assistant", content: answer });
    return collected;
  }

  /**
   * Spawn a subagent to handle a focused task. Returns a handle for tracking
   * and controlling the subagent's lifecycle. The subagent has its own
   * session/history, but shares providers, tools, brain, memory with the parent.
   */
  function spawnSubagent(
    goal: string,
    options?: { allowedTools?: string[]; signal?: AbortSignal },
  ): SubagentHandle {
    const id = `sub-${randomBytes(4).toString("hex")}`;
    const toolLine = options?.allowedTools?.length
      ? `\nAllowed tools: ${options.allowedTools.join(", ")}\nUse only these tools.`
      : "";
    const systemOverlay = `[SUBAGENT — focused task]\n${toolLine}\nGoal: ${goal}\n\nWhen done, output the final answer prefixed with "<DONE>".`;
    const subSession = createSession({
      profiles: [...providers.all()],
      stableTier: systemOverlay,
    });

    // Combine external signal with our internal abort signal.
    const ac = new AbortController();
    // (handle + signal wiring done below after handle is created)

    // Streaming queue: chunks arrive asynchronously; stream() reads them.
    const chunkQueue: string[] = [];
    const streamWaiters: Array<(v: IteratorResult<string>) => void> = [];
    let streamDone = false;
    let streamError: Error | null = null;
    function pushChunk(chunk: string): void {
      if (streamWaiters.length > 0) {
        streamWaiters.shift()!({ value: chunk, done: false });
      } else {
        chunkQueue.push(chunk);
      }
    }
    function signalStreamEnd(err?: Error): void {
      streamDone = true;
      streamError = err ?? null;
      // If error, reject any waiting consumers. Otherwise end gracefully.
      if (err) {
        while (streamWaiters.length > 0) {
          streamWaiters.shift()!(Promise.reject(err) as unknown as IteratorResult<string>);
        }
      } else {
        while (streamWaiters.length > 0) {
          streamWaiters.shift()!({ value: undefined as unknown as string, done: true });
        }
      }
    }

    // Live output collector — captures partial output even on abort/fail
    const collectedOutput = { text: "" };

    let completionPromise: Promise<string>;
    const handle: SubagentHandle = {
      id,
      goal,
      startedAt: nowWallclock(),
      allowedTools: options?.allowedTools,
      status: "running",
      output: "",
      abort: () => {
        if (handle.status === "running") {
          // Real mid-stream abort via AbortController (signals to runTurn).
          ac.abort();
          handle.status = "aborted";
          handle.endedAt = nowWallclock();
        }
      },
      wait: () => completionPromise,
      stream: () => ({
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<string>> {
              if (streamError) return Promise.reject(streamError);
              if (chunkQueue.length > 0) {
                return Promise.resolve({ value: chunkQueue.shift()!, done: false });
              }
              if (streamDone) return Promise.resolve({ value: undefined as unknown as string, done: true });
              return new Promise((resolve) => streamWaiters.push(resolve));
            },
          };
        },
      }),
    };

    // Now wire external signal to update handle status
    if (options?.signal) {
      if (options.signal.aborted) {
        ac.abort();
        handle.status = "aborted";
        handle.endedAt = nowWallclock();
      } else {
        options.signal.addEventListener("abort", () => {
          ac.abort();
          if (handle.status === "running") {
            handle.status = "aborted";
            handle.endedAt = nowWallclock();
          }
        }, { once: true });
      }
    }
    subagents.set(id, handle);

    completionPromise = (async () => {
      // R3-1 fix: derive a child budget so subagent spending is isolated.
      // Previously parent + all subagents shared the SAME BudgetConfig root.
      const childAlloc = budget.unlimited ? 0 : Math.max(1, budget.remaining() * 0.25);
      const childBudget = budget.deriveChild(childAlloc);
      try {
        await runSubagentTurn(subSession, goal, ac.signal, pushChunk, collectedOutput, childBudget);
        handle.output = collectedOutput.text;
        signalStreamEnd();
        if (handle.status === "aborted") return handle.output;
        handle.status = "done";
        handle.endedAt = nowWallclock();
        return handle.output;
      } catch (e) {
        const err = e as Error;
        handle.error = err.message;
        handle.output = collectedOutput.text; // preserve partial output
        signalStreamEnd(err);
        // Status was set by abort() (external) OR stays "running" (internal error)
        if (handle.status === "running") handle.status = "failed";
        handle.endedAt = nowWallclock();
        return handle.output;
      } finally {
        // R3-1 fix: ALWAYS refund unused pre-charge (§21 CC2).
        if (childBudget.id) budget.releasePrecharge(childBudget.id);
      }
    })();
    // Auto-cleanup: remove completed subagents after 60s (prevents memory leak)
    // while keeping them visible long enough for listSubagents()/getSubagent().
    void completionPromise.finally(() => {
      setTimeout(() => {
        if (subagents.get(id) === handle) subagents.delete(id);
      }, 60_000).unref?.();
    });
    return handle;
  }

  /** List all subagents (active + completed). */
  function listSubagents(): SubagentHandle[] {
    return [...subagents.values()];
  }

  /** Get a specific subagent by id. */
  function getSubagent(id: string): SubagentHandle | undefined {
    return subagents.get(id);
  }

  /** Kill a subagent (mark aborted, remove from pool). Returns true if found. */
  function killSubagent(id: string): boolean {
    const h = subagents.get(id);
    if (!h) return false;
    h.abort();
    subagents.delete(id);
    return true;
  }

  /** Kill all subagents. Used on shutdown / cleanup. Returns number killed. */
  function killAllSubagents(): number {
    let n = 0;
    for (const h of subagents.values()) {
      if (h.status === "running") {
        h.abort();
        n++;
      }
    }
    subagents.clear();
    return n;
  }

  // C-9 fix: instantiate telemetry exporter (OTel/Langfuse) at agent init
  const telemetryExporter = createExporter();

  return {
    prompt: (text, opts) => { activeTurns++; return runOnce(text, opts?.signal).finally(() => activeTurns--); },
    run: (text, sink, opts) => { activeTurns++; return runLive(text, sink, opts?.signal).finally(() => activeTurns--); },
    providers,
    memory,
    brain,
    audit,
    ragfs,
    tools: toolRegistry,
    skillStore,
    telemetryExporter,
    spawnSubagent,
    listSubagents,
    getSubagent,
    killSubagent,
    killAllSubagents,
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

/** Compose identity + tools block (+ optional skills) into the stable tier. */
function composeStableTier(identity: string, registry: ToolRegistry, skillBlock?: string): string {
  const base = `${identity}\n\n${renderToolsBlock(registry)}`;
  // R5-5 fix: include skills index in the agent's stable tier (was only in mya-bridge).
  return skillBlock ? `${base}\n\n${skillBlock}` : base;
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
export { OtelExporter, LangfuseExporter, createExporter } from "./exporters.js";

// AgentPool — manages multiple pi AgentSession instances (used by gateway)
export { AgentPool, type AgentPoolOptions, type AgentSessionEntry, type AgentSession, type SessionFactory } from "./pool.js";

// ── pi-ai auto-detection ──

/** Known pi-ai provider configs: env var → provider module + default model + API type.
 * API types (forwarded to pi-ai's streamSimple model.api):
 *   anthropic-messages, openai-completions, openai-responses, azure-openai-responses,
 *   openai-codex-responses, google-generative-ai, google-vertex, mistral-conversations,
 *   bedrock-converse-stream.
 * Multi-API providers pick the most common default.
 * Source: vendored/pi-ai/dist/providers/*.js + env-api-keys.js (35 text providers). */
export const PI_AI_PROVIDERS: Array<{ envKey: string; providerId: string; defaultModel: string; defaultApi: string }> = [
  // ── anthropic-messages API ──
  { envKey: "ANTHROPIC_API_KEY", providerId: "anthropic", defaultModel: "claude-sonnet-4-20250514", defaultApi: "anthropic-messages" },
  { envKey: "MINIMAX_API_KEY", providerId: "minimax", defaultModel: "MiniMax-M3", defaultApi: "anthropic-messages" },
  { envKey: "MINIMAX_CN_API_KEY", providerId: "minimax-cn", defaultModel: "abab6.5s-chat", defaultApi: "anthropic-messages" },
  { envKey: "KIMI_API_KEY", providerId: "kimi-coding", defaultModel: "moonshot-v1-auto", defaultApi: "anthropic-messages" },
  { envKey: "AI_GATEWAY_API_KEY", providerId: "vercel-ai-gateway", defaultModel: "gpt-4o-mini", defaultApi: "anthropic-messages" },
  // ── openai-responses API ──
  { envKey: "OPENAI_API_KEY", providerId: "openai", defaultModel: "gpt-4o-mini", defaultApi: "openai-responses" },
  { envKey: "OPENAI_API_KEY", providerId: "openai-codex", defaultModel: "codex-mini-latest", defaultApi: "openai-codex-responses" },
  { envKey: "AZURE_OPENAI_API_KEY", providerId: "azure-openai-responses", defaultModel: "gpt-4o", defaultApi: "azure-openai-responses" },
  // ── openai-completions API (OpenAI-compatible) ──
  { envKey: "DEEPSEEK_API_KEY", providerId: "deepseek", defaultModel: "deepseek-chat", defaultApi: "openai-completions" },
  { envKey: "GROQ_API_KEY", providerId: "groq", defaultModel: "llama-3.3-70b-versatile", defaultApi: "openai-completions" },
  { envKey: "XAI_API_KEY", providerId: "xai", defaultModel: "grok-3", defaultApi: "openai-completions" },
  { envKey: "TOGETHER_API_KEY", providerId: "together", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", defaultApi: "openai-completions" },
  { envKey: "MOONSHOT_API_KEY", providerId: "moonshotai", defaultModel: "moonshot-v1-auto", defaultApi: "openai-completions" },
  { envKey: "MOONSHOT_API_KEY", providerId: "moonshotai-cn", defaultModel: "moonshot-v1-auto", defaultApi: "openai-completions" },
  { envKey: "OPENROUTER_API_KEY", providerId: "openrouter", defaultModel: "anthropic/claude-3.5-sonnet", defaultApi: "openai-completions" },
  { envKey: "CEREBRAS_API_KEY", providerId: "cerebras", defaultModel: "llama3.1-70b", defaultApi: "openai-completions" },
  { envKey: "NVIDIA_API_KEY", providerId: "nvidia", defaultModel: "meta/llama-3.1-70b-instruct", defaultApi: "openai-completions" },
  { envKey: "HF_TOKEN", providerId: "huggingface", defaultModel: "meta-llama/Llama-3.1-70B-Instruct", defaultApi: "openai-completions" },
  { envKey: "CLOUDFLARE_API_KEY", providerId: "cloudflare-workers-ai", defaultModel: "@cf/meta/llama-3.1-70b-instruct", defaultApi: "openai-completions" },
  { envKey: "ZAI_API_KEY", providerId: "zai", defaultModel: "glm-4", defaultApi: "openai-completions" },
  { envKey: "ZAI_CODING_CN_API_KEY", providerId: "zai-coding-cn", defaultModel: "glm-4", defaultApi: "openai-completions" },
  { envKey: "ANT_LING_API_KEY", providerId: "ant-ling", defaultModel: "ant-ling-1", defaultApi: "openai-completions" },
  { envKey: "XIAOMI_API_KEY", providerId: "xiaomi", defaultModel: "mimo-7b", defaultApi: "openai-completions" },
  { envKey: "XIAOMI_TOKEN_PLAN_CN_API_KEY", providerId: "xiaomi-token-plan-cn", defaultModel: "mimo-7b", defaultApi: "openai-completions" },
  { envKey: "XIAOMI_TOKEN_PLAN_AMS_API_KEY", providerId: "xiaomi-token-plan-ams", defaultModel: "mimo-7b", defaultApi: "openai-completions" },
  { envKey: "XIAOMI_TOKEN_PLAN_SGP_API_KEY", providerId: "xiaomi-token-plan-sgp", defaultModel: "mimo-7b", defaultApi: "openai-completions" },
  // ── Google / Vertex (custom APIs) ──
  { envKey: "GEMINI_API_KEY", providerId: "google", defaultModel: "gemini-2.0-flash", defaultApi: "google-generative-ai" },
  { envKey: "GOOGLE_CLOUD_API_KEY", providerId: "google-vertex", defaultModel: "gemini-2.0-flash", defaultApi: "google-vertex" },
  // ── Mistral (custom API) ──
  { envKey: "MISTRAL_API_KEY", providerId: "mistral", defaultModel: "mistral-large-latest", defaultApi: "mistral-conversations" },
  // ── Amazon Bedrock (ambient AWS auth) ──
  { envKey: "AWS_ACCESS_KEY_ID", providerId: "amazon-bedrock", defaultModel: "anthropic.claude-3-sonnet", defaultApi: "bedrock-converse-stream" },
  // ── Multi-API providers (pick most common default) ──
  { envKey: "FIREWORKS_API_KEY", providerId: "fireworks", defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct", defaultApi: "anthropic-messages" },
  { envKey: "COPILOT_GITHUB_TOKEN", providerId: "github-copilot", defaultModel: "gpt-4o", defaultApi: "openai-completions" },
  { envKey: "CLOUDFLARE_API_KEY", providerId: "cloudflare-ai-gateway", defaultModel: "gpt-4o-mini", defaultApi: "openai-completions" },
  { envKey: "OPENCODE_API_KEY", providerId: "opencode", defaultModel: "gpt-4o", defaultApi: "openai-completions" },
  { envKey: "OPENCODE_API_KEY", providerId: "opencode-go", defaultModel: "gpt-4o", defaultApi: "openai-completions" },
];

/** Auto-detect pi-ai providers from env vars and return bridge adapters. */
function autoDetectPiAiProviders(
  tryResolve: (ref: string) => string | undefined,
): PiAiProviderBridge[] {
  const bridges: PiAiProviderBridge[] = [];
  // Synchronous require in ESM via createRequire (static import for Node compat).
  let requireFn: NodeRequire;
  try { requireFn = createRequire(import.meta.url); }
  catch { return bridges; }
  for (const cfg of PI_AI_PROVIDERS) {
    const apiKey = tryResolve(cfg.envKey);
    if (!apiKey) continue;
    try {
      const mod = requireFn(`../../vendored/pi-ai/dist/providers/${cfg.providerId}.js`);
      const ProviderClass = mod.default ?? mod[Object.keys(mod).find((k) => k.toLowerCase().includes("provider")) ?? ""] ?? Object.values(mod)[0];
      if (typeof ProviderClass !== "function") continue;
      const provider = new ProviderClass({ apiKey });
      // HIGH-1 fix: handle AWS_ACCESS_KEY_ID, *_KEY_ID, *_SECRET_ACCESS_KEY patterns
      const modelEnvKey = cfg.envKey
        .replace(/_(API_KEY|API_KEY_ID|TOKEN|KEY_ID|SECRET_ACCESS_KEY)$/, "_MODEL");
      const modelId = process.env[modelEnvKey] ?? cfg.defaultModel;
      const model = { id: modelId, api: cfg.defaultApi };
      bridges.push(new PiAiProviderBridge({ provider, model, apiKey, id: cfg.providerId, reasoning: process.env["MYA_THINKING_LEVEL"] }));
    } catch {
      // Provider module not found or init failed — skip silently.
    }
  }
  return bridges;
}
