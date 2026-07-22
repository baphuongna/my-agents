/**
 * mya-bridge — pi InlineExtension that bridges mya packages into pi's TUI.
 *
 * This is THE integration point between mya's 29 packages and pi's InteractiveMode.
 *
 * Wired subsystems (every feature is ACTIVELY CALLED, not just registered):
 *
 * PROMPT INJECTION:
 * - Brain recall:     before_agent_start → inject relevant facts into system prompt
 * - Skills index:     before_agent_start → inject skill list so the LLM knows what's available
 * - Context note:     before_agent_start → mya availability note
 *
 * TOOL RESULT HOOKS:
 * - Output compress:  tool_result(bash) → compress large outputs (5-stage pipeline from hypa)
 * - LSP cascade:      tool_result(edit/write) → run diagnostics on impacted files (from pi-lens)
 *
 * PROVIDER HOOKS:
 * - Key rotation:     before_provider_headers → rotate API keys on 429/529 (from pi-soly)
 * - Adversarial:      agent_settled → best-effort N-reviewer code review (from pi-dyn-wf)
 *
 * COMPACTION:
 * - Ranked compact:   session_before_compact → block-scoring compaction (from pi-vcc)
 *
 * CUSTOM TOOLS:
 * - paid_fetch:       x402 wallet micropayment fetch
 * - hashline_edit:    hash-anchored edits (from pi-hashline-edit-pro)
 * - browser_*:        agent-browser local engine (navigate/snapshot/click/type/scroll/back/press/screenshot) —
 *                       routed through `runBrowserWithFallback` (Phase 5 orchestrator: camofox → cloud →
 *                       local → web_fetch universal floor)
 * - web_search/web_extract: multi-backend search/extract — routed through
 *                       `runSearchWithFallback` / `runExtractWithFallback`
 * - web_fetch:        universal HTTP→markdown floor — registered as standalone
 *                       first-class tool (always available, no browser/key needed)
 * - delegate_task:    subagent delegation
 * - MCP tools:        auto-registered from connected MCP servers
 *
 * LIFECYCLE:
 * - AuditLog:         tool_call/tool_result/turn_start/turn_end → Merkle log
 * - Brain:            turn_end → consolidate()
 * - Cron:             display-only via opts.cron; gateway is sole sweeper
 * - TTS:              message_end → speak() (MYA_TTS=1)
 * - Skills:           discovered from ~/.mya/skills/
 *
 * Slash commands: /audit, /secrets, /skills, /memory, /dream, /wallet, /eval, /sync,
 *   /collab, /acp, /workflow, /sign, /pkg, /council, /cron, /mcp, /channel, /mya-help
 */
import { nowWallclock, loadRoles, getRolesDir, type RoleRegistry, type RoleConfig, filterToolsForRole } from "@my-agent/core";
import { makePaidFetchTool } from "@my-agent/x402";
import { makeDebugTool } from "@my-agent/dap";
import { defaultHarness } from "@my-agent/eval";
import { speak } from "@my-agent/tts";
import { runWorkflow, runWorkflowSource, type WorkflowContext } from "@my-agent/workflows";
import { fileSha256, verifyTarball, type SigstoreBundle } from "@my-agent/signing";
import {
  compressCommandOutput,
  buildCodegraph,
  runCascade as _rc,
  registerWebTools,
  registerFetchTools,
  loadWebConfig,
  builtinTools,
  type ToolImpl,
} from "@my-agent/tools";
import { applyEdits, computeLineHashes } from "@my-agent/tools";
import { rankedCompact } from "@my-agent/prompts";
import { adversarialReview } from "@my-agent/council";
import { commandRegistry } from "./command-registry.js";
import {
  stripAvailableSkillsBlock,
  buildIndex,
  fingerprintSkills,
  formatCategorySummary,
  renderToolDescription,
  search,
  formatResults,
  scanSkillDirectory,
  type SkillIndex,
  type PiSkill,
} from "./skill-search/index.js";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AuditLog } from "@my-agent/audit";
import type { SecretStore } from "@my-agent/secrets";
import type { HookRegistry, McpManager, McpServerConfig, ChannelRegistry } from "@my-agent/gateway";
import type { SkillStore } from "@my-agent/skills";
import type { CronScheduler } from "@my-agent/cron";
import { makeCronTools } from "@my-agent/cron";
import type { Brain, MemoryFacade, RetrievalEngine, LifecycleManager, SqliteMemoryManager } from "@my-agent/memory";
import { autoCapture, DreamCycle } from "@my-agent/memory";
import type { Wallet } from "@my-agent/x402";
import type { AcpBridge } from "@my-agent/acp";
import type { SyncServer } from "@my-agent/sync";
import type { CollabRelay } from "@my-agent/collab";
import type { PackageHost } from "@my-agent/pkg";
import type { CouncilProvider } from "@my-agent/council";

export interface MyaBridgeOptions {
  auditLog?: AuditLog;
  secretStore?: SecretStore;
  hooks?: HookRegistry;
  skillStore?: SkillStore;
  cron?: CronScheduler;
  brain?: Brain;
  memory?: MemoryFacade;
  retrievalEngine?: RetrievalEngine;
  lifecycleManager?: LifecycleManager;
  sqliteMemory?: SqliteMemoryManager;
  /** DreamCycle for offline consolidation (uses SQLite when available). */
  dreamCycle?: DreamCycle;
  wallet?: Wallet;
  dapConnect?: { connect: { command: string; args?: string[] } };
  acp?: AcpBridge;
  sync?: SyncServer;
  collab?: CollabRelay;
  packageHost?: PackageHost;
  council?: CouncilProvider;
  mcp?: McpManager;
  mcpConfigs?: McpServerConfig[];
  channels?: ChannelRegistry;
  /** Role registry for role-based overlays (prompt + tools + model). */
  roleRegistry?: RoleRegistry;
  /** J2: Achievement tracker for stat-driven unlock. */
  achievements?: { recordStat: (key: string, increment?: number) => unknown };
  registerTools?: (pi: MyaPiApi) => void;
}

/** Minimal pi ExtensionAPI surface (duck-typed to avoid tight coupling). */
export interface MyaPiApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: unknown): void;
  registerShortcut(shortcut: string, options: unknown): void;
  // Role overlay surface — these live on ExtensionAPI (the `pi` handle),
  // NOT on ExtensionCommandContext (the `ctx` passed to command handlers).
  // Declared here so /role can apply tool/model overlay deterministically.
  getActiveTools?(): string[];
  setActiveTools?(toolNames: string[]): void;
  setModel?(model: { id: string; provider?: string }): Promise<boolean>;
  modelRegistry?: { getAll?(): Array<{ id: string; provider?: string }> };
}

function uiOf(ctx: unknown): { notify: (m: string, t?: string) => void } {
  return (ctx as { ui: { notify: (m: string, t?: string) => void } }).ui;
}

function registerSharedCommand(
  pi: MyaPiApi,
  name: string,
  description: string,
  handler: (args: string) => Promise<string> | string,
): void {
  pi.registerCommand(name, {
    description,
    handler: async (args: string, ctx: unknown) => {
      uiOf(ctx).notify(await handler(args), "info");
    },
  });
  commandRegistry.register({ name, description, handler: (args: string) => handler(args) });
}

/** Threshold for compressing bash output (~4K tokens). */
const COMPRESS_THRESHOLD_TOKENS = 4096;

export function createMyaBridge(opts: MyaBridgeOptions): (pi: MyaPiApi) => void {
  return (pi: MyaPiApi) => {
    let parentSessionId = "";

    // ═══════════════════════════════════════════════════════════════════
    // ROLES: track current role + apply overlay on each turn
    // ═══════════════════════════════════════════════════════════════════
    // A role is a lightweight overlay: prompt append + tool filter + model.
    // Roles share one brain (memory.db) but differ in persona + tools.
    // Pattern: pi-crew roles + Claude Code agent types.
    const roleRegistry = opts.roleRegistry;
    // BUG #5: re-scan ~/.mya/roles/ fresh on each /role call so the TUI sees
    // roles added/deleted by the launcher (separate process). The singleton
    // above is a fallback only.
    const freshRoles = (): RoleRegistry => loadRoles(getRolesDir());
    // Restart resets to default (intended: a stale restrictive role should
    // NOT persist across restarts and surprise the user). Switch via /role
    // during a session; next launch starts clean.
    let currentRole: RoleConfig | undefined = freshRoles().getDefault();
    // BUG #1: capture the original full tool set on first role switch so that
    // switching back to a permissive role RESTORES removed tools. Filtering
    // from getActiveTools() is one-way/destructive (removed tools never return).
    let originalTools: string[] | null = null;

    // ═══════════════════════════════════════════════════════════════════
    // DREAM CYCLE: periodic deep consolidation (every 4h when idle)
    // ═══════════════════════════════════════════════════════════════════
    // DreamCycle collects recent memories, summarizes them into episodic
    // memory, runs lifecycle (consolidate/degrade/purge), and reviews skills.
    // Uses SQLite when available, falls back to legacy Brain.
    // Pattern: mnemopi/agentmemory — on-demand + long-interval timer.
    // turn_end lifecycle() handles shallow consolidation every turn.
    // DreamCycle handles DEEP consolidation (summarize + dream summary).
    const dreamCycle = opts.dreamCycle ?? new DreamCycle({
      sqliteMemory: opts.sqliteMemory,
      brain: opts.brain,
      // skillCurator: not wired — SkillStore doesn't have review().
      // Skills review is best-effort; can be wired later via a proper adapter.
      isIdle: () => !pi, // always idle in TUI context (pi is active only during turns)
    });
    dreamCycle.start();

    // /dream slash command — on-demand deep consolidation (mnemopi pattern)
    registerSharedCommand(pi, "dream", "Run memory dream cycle (deep consolidation)", async () => {
      try {
        const r = await dreamCycle.dream();
        return `[dream] Consolidated ${r.memoriesConsolidated} memories, reviewed ${r.skillsReviewed} skills (${r.durationMs}ms).\nSummary: ${r.summary.slice(0, 200)}`;
      } catch (e) {
        return `[dream] Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    });

    // Phase 5 governance: /mem-trust <id> [up|down] — feedback-driven trust (hermes holographic).
    // Named /mem-trust (not /trust) to avoid collision with pi's built-in /trust (project trust).
    // Without this, trust stays 0.5 forever (no authority signal). Wired so Dig 4 is live.
    if (opts.sqliteMemory) {
      registerSharedCommand(pi, "mem-trust", "Adjust memory trust: /mem-trust <memoryId> [up|down]", async (args) => {
        try {
          const { applyFeedback } = await import("@my-agent/memory");
          const [id, dir] = args.trim().split(/\s+/);
          if (!id) return "[trust] Usage: /mem-trust <memoryId> [up|down]. Find ids via /memory <query>.";
          const helpful = dir !== "down"; // default up
          const db = opts.sqliteMemory!.getDatabase() as never;
          const w = applyFeedback(db, id, "working_memory", helpful);
          const e = applyFeedback(db, id, "episodic_memory", helpful);
          const next = w ?? e;
          if (next === null) return `[trust] No memory found with id ${id}.`;
          return `[trust] Memory ${id} trust ${helpful ? "↑" : "↓"} → ${next.toFixed(2)}.`;
        } catch (e) {
          return `[trust] Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      });

      // Phase 5 governance: /contradict — surface (don't auto-resolve) high-overlap divergent facts.
      registerSharedCommand(pi, "contradict", "Detect potentially-contradictory memories (review only)", async () => {
        try {
          const { detectContradictions } = await import("@my-agent/memory");
          const db = opts.sqliteMemory!.getDatabase() as never;
          const pairs = detectContradictions(db, { similarityThreshold: 0.6 });
          if (pairs.length === 0) return "[contradict] No potential contradictions found.";
          return `[contradict] ${pairs.length} pair(s) to review:\n` + pairs.slice(0, 10).map((p: { aContent: string; bContent: string; similarity: number }, i: number) =>
            `  ${i + 1}. (${p.similarity.toFixed(2)})\n     A: ${p.aContent.slice(0, 80)}\n     B: ${p.bContent.slice(0, 80)}`).join("\n");
        } catch (e) {
          return `[contradict] Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      });

      // Phase 5 grounding: /stale — list memories whose file referents changed/disappeared.
      registerSharedCommand(pi, "stale", "List memories with stale (changed/gone) file referents", async () => {
        try {
          const { staleMemories } = await import("@my-agent/memory");
          const db = opts.sqliteMemory!.getDatabase() as never;
          const stale = staleMemories(db);
          if (stale.length === 0) return "[stale] No stale referents (or none tracked).";
          return `[stale] ${stale.length} memory(ies) with changed/gone referents:\n` + stale.map((s: { memory_id: string; staleness: string }) => `  ${s.memory_id}: ${s.staleness}`).join("\n");
        } catch (e) {
          return `[stale] Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    }

    // /role slash command — list or switch roles
    // Uses pi.registerCommand directly (not registerSharedCommand) to get
    // full ExtensionCommandContext for setActiveTools + setModel access.
    pi.registerCommand("role", {
      description: "List or switch roles (e.g. /role coder)",
      handler: async (args: string, ctx: unknown) => {
        // BUG #5: re-scan disk so newly added/deleted roles are visible.
        const reg = freshRoles();
        if (reg.list().length === 0) {
          uiOf(ctx).notify("[role] Roles not configured.", "info");
          return;
        }
        const name = args.trim();
        if (!name) {
          const roles = reg.list();
          const lines = roles.map((r) => {
            const active = r.name === currentRole?.name ? " ← active" : "";
            return `  ${r.name.padEnd(15)} ${r.description}${active}`;
          });
          uiOf(ctx).notify(`[role] Available roles:\n${lines.join("\n")}`, "info");
          return;
        }
        const role = name === "default" ? reg.getDefault() : reg.get(name);
        if (!role) {
          uiOf(ctx).notify(`[role] Unknown role "${name}". Available: ${reg.list().map((r) => r.name).join(", ")}`, "info");
          return;
        }

        // Apply role overlay: tools + model + prompt.
        // These methods live on the `pi` handle (ExtensionAPI), not on `ctx`
        // (ExtensionCommandContext). Calling them on ctx is dead code — the
        // guard would always be false. Call on pi instead.
        const notes: string[] = [];

        // 1. Apply tool filter (fail-closed: always apply the filter result).
        // BUG #1: filter from the ORIGINAL full tool set (captured once), not
        // from getActiveTools() (current, possibly already-restricted). This
        // makes role switching reversible: reviewer→default restores all tools.
        if (pi.getActiveTools && pi.setActiveTools) {
          try {
            if (originalTools === null) {
              originalTools = pi.getActiveTools(); // capture once, on first switch
            }
            const filtered = filterToolsForRole(originalTools, role);
            pi.setActiveTools(filtered);
            if (filtered.length === 0) {
              notes.push(`⚠ no tools match role filter (check tool names)`);
            } else {
              notes.push(`tools: ${filtered.length}/${originalTools.length}`);
            }
          } catch (e) {
            notes.push(`⚠ tool filter failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          notes.push(`⚠ tool filter unavailable`);
        }

        // 2. Apply model override (if role specifies a preferred model)
        if (role.modelPrefer && pi.setModel && pi.modelRegistry) {
          try {
            const allModels = pi.modelRegistry.getAll?.() ?? [];
            const match = allModels.find(
              (m) => m.id === role.modelPrefer || m.id.includes(role.modelPrefer!)
            );
            if (match) {
              const ok = await pi.setModel(match);
              notes.push(ok ? `model: ${match.id}` : `⚠ setModel rejected`);
            } else {
              notes.push(`⚠ model "${role.modelPrefer}" not found`);
            }
          } catch (e) {
            notes.push(`⚠ model override failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // 3. Switch active role (prompt injection happens in before_agent_start).
        // Not persisted: restart resets to default (intended).
        currentRole = role;
        const summary = notes.length > 0 ? ` — ${notes.join(" · ")}` : "";
        uiOf(ctx).notify(`[role] Switched to "${role.name}": ${role.description}${summary}`, "info");
      },
    });
    commandRegistry.register({ name: "role", description: "List or switch roles", handler: () => "" });

    // ═══════════════════════════════════════════════════════════════════
    // SESSION START: capture session ID + load cron jobs
    // ═══════════════════════════════════════════════════════════════════
    pi.on("session_start", (event: unknown, ctx: unknown) => {
      const c = ctx as { sessionManager?: { getSessionId?: () => string } };
      parentSessionId = c?.sessionManager?.getSessionId?.() ?? `session-${nowWallclock().toString(36)}`;
    });

    // Phase 0B: cron store ownership is gateway-only. The TUI no longer loads
    // its own cron.json (the divergent ~/.mya/cron.json loader was dead — wrong
    // path) nor runs a sweep timer (dual-sweep hazard with the gateway). The
    // gateway is the single sweeper/persister; the TUI's `/cron` display will
    // query the gateway over HTTP in Phase 0C (auth).

    // ═══════════════════════════════════════════════════════════════════
    // AUDIT LOG: every tool call + result + turn boundary
    // ═══════════════════════════════════════════════════════════════════
    if (opts.auditLog) {
      const audit = opts.auditLog;
      pi.on("tool_call", (event: unknown) => {
        const e = event as { toolName: string; toolCallId: string; input?: unknown };
        audit.append({ ts: nowWallclock(), kind: "tool", actor: "agent",
          payload: { phase: "call", tool: e.toolName, callId: e.toolCallId, input: e.input } });
      });
      pi.on("tool_result", (event: unknown) => {
        const e = event as { toolName: string; toolCallId: string; isError?: boolean };
        audit.append({ ts: nowWallclock(), kind: "tool", actor: "agent",
          payload: { phase: "result", tool: e.toolName, callId: e.toolCallId, ok: !e.isError } });
        // J2: track tool usage for achievements
        opts.achievements?.recordStat(`tool:${e.toolName}`);
      });
      pi.on("turn_start", (event: unknown) => {
        const e = event as { turnIndex: number };
        audit.append({ ts: nowWallclock(), kind: "channel", actor: "agent", payload: { phase: "turn_start", turn: e.turnIndex } });
        // J2: track prompt count for achievements
        opts.achievements?.recordStat("promptsSent");
      });
      pi.on("turn_end", (event: unknown) => {
        const e = event as { turnIndex: number };
        audit.append({ ts: nowWallclock(), kind: "channel", actor: "agent", payload: { phase: "turn_end", turn: e.turnIndex } });
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // HOOK REGISTRY: fire gateway lifecycle hooks
    // ═══════════════════════════════════════════════════════════════════
    if (opts.hooks) {
      const hooks = opts.hooks;
      pi.on("session_start", () => void hooks.fire("session_start", {}));
      pi.on("turn_start", () => void hooks.fire("pre_turn", {}));
      pi.on("turn_end", () => void hooks.fire("post_turn", {}));
      pi.on("tool_call", () => void hooks.fire("pre_tool", {}));
      pi.on("tool_result", () => void hooks.fire("post_tool", {}));
    }

    // ═══════════════════════════════════════════════════════════════════
    // AUTO-CAPTURE: automatically extract memorable facts from conversation
    // ═══════════════════════════════════════════════════════════════════
    // Problem: relying solely on the LLM calling 'remember' loses most facts.
    // Solution: pattern-based heuristic extraction (mnemopi pattern).
    // We capture the user prompt at before_agent_start (reliable source),
    // and the assistant message via message_end.
    // On turn_end, run autoCapture() on both → stores high-confidence matches.
    // This is the lightweight always-on safety net; explicit 'remember' tool
    // remains for high-importance facts the LLM chooses to save.
    let pendingUserPrompt = "";
    let lastAssistantTextCapture = "";

    // Track user prompt before the turn starts
    pi.on("before_agent_start", (event: unknown) => {
      try {
        const e = event as { prompt?: string };
        if (e.prompt && e.prompt.trim()) {
          pendingUserPrompt = e.prompt;
          
        } else {
          
        }
      } catch { /* never crash */ }
    });

    // Track assistant response (for decisions, learnings, errors)
    pi.on("message_end", (event: unknown) => {
      try {
        const e = event as { message?: { role?: string; content?: unknown } };
        const msg = e.message;
        if (msg?.role === "assistant") {
          // Content can be string or array of {type, text}
          const c = msg.content;
          if (typeof c === "string") {
            lastAssistantTextCapture = c;
          } else if (Array.isArray(c)) {
            lastAssistantTextCapture = c.filter((x: { type?: string }) => x.type === "text").map((x: { text?: string }) => x.text ?? "").join("");
          }
        }
      } catch { /* never crash */ }
    });

    pi.on("turn_end", () => {
      try {
        if (opts.sqliteMemory) {
          
          // 1. Auto-capture from user prompt (preferences, decisions, facts)
          if (pendingUserPrompt) {
            const r = autoCapture(pendingUserPrompt, opts.sqliteMemory, {
              source: "auto:user",
              minConfidence: 0.55,
              // Phase 3: tag captures with active role → brain types scope='role' (contained)
              agentId: currentRole?.name,
              sessionId: parentSessionId || undefined,
            });
            
            if (r.captured > 0) {
              console.error(`[mya] auto-captured ${r.captured} fact(s) from user message`);
            }
          }
          // 2. Auto-capture from assistant message — VERY conservative
          // Only capture clear learnings/errors, NOT preferences/decisions
          // (the LLM might echo back user's words, causing false positives)
          if (lastAssistantTextCapture) {
            autoCapture(lastAssistantTextCapture, opts.sqliteMemory, {
              source: "auto:assistant",
              minConfidence: 0.85, // very high bar — only near-certain matches
              importance: 0.3,
              agentId: currentRole?.name,
              sessionId: parentSessionId || undefined,
            });
          }
          pendingUserPrompt = "";
          lastAssistantTextCapture = "";
        }
      } catch { /* never crash TUI */ }
    });

    // ═══════════════════════════════════════════════════════════════════
    // LIFECYCLE: run unified lifecycle pipeline on turn_end
    // ═══════════════════════════════════════════════════════════════════
    // Pipeline: purge expired → purge decayed → consolidate → compile → reconcile
    // Uses LifecycleManager when wired; falls back to memory.consolidate() or brain.consolidate().
    pi.on("turn_end", () => {
      try {
        if (opts.sqliteMemory) {
          // Phase 3: pass real session id so consolidation covers the actual pi
          // session (was no-arg → only consolidated the "default" session).
          opts.sqliteMemory.lifecycle(parentSessionId || undefined);
        } else if (opts.lifecycleManager) {
          opts.lifecycleManager.tick();
        } else if (opts.memory) {
          void opts.memory.consolidate();
        } else if (opts.brain) {
          opts.brain.consolidate();
        }
      } catch { /* never crash TUI */ }
    });

    // ═══════════════════════════════════════════════════════════════════
    // TTS: speak assistant messages (MYA_TTS=1)
    // ═══════════════════════════════════════════════════════════════════
    if (process.env["MYA_TTS"] === "1") {
      pi.on("message_end", (event: unknown) => {
        const e = event as { message?: { role?: string; content?: Array<{ type: string; text?: string }> } };
        const msg = e.message;
        if (msg?.role === "assistant" && msg.content) {
          const text = msg.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
          if (text) void speak(text).catch(() => {});
        }
      });
    }

    // ── pi-skill-search (self-contained): scan corpus ~/.mya/agent/data/ ONCE, then
    //    per before_agent_start strip pi's <available_skills> (token save), build a
    //    search index from the corpus (+ any pi skills), register an on-demand
    //    `skill-search` tool, inject a compact category summary. The CORPUS is the
    //    skill source (not pi discovery) — pi-skill-search scans it itself. ──
    const corpusDir = join(homedir(), ".mya", "agent", "data");
    const corpusSkills = scanSkillDirectory(corpusDir);
    let skillIndex: SkillIndex | undefined;
    let lastSkillsFingerprint = "";
    let skillSearchToolRegistered = false;
    // Dedupe by name; corpus skills win ties (mergeSkills from pi-skill-search).
    const mergeSkills = (a: PiSkill[], b: PiSkill[]): PiSkill[] => {
      const m = new Map<string, PiSkill>();
      for (const s of a) m.set(s.name, s);
      for (const s of b) m.set(s.name, s);
      return [...m.values()];
    };

    // ═══════════════════════════════════════════════════════════════════
    // BEFORE_AGENT_START: skill-search strip+summary+tool, then brain facts + context
    // FIXED: return { systemPrompt } instead of mutating the event
    // ═══════════════════════════════════════════════════════════════════
    pi.on("before_agent_start", (event: unknown) => {
      const e = event as {
        systemPrompt?: string;
        prompt?: string;
        systemPromptOptions?: { skills?: PiSkill[] };
      };
      const parts: string[] = [];

      // ── Skill strip + summary (replaces inject-all-skills) ──────────
      // Strip pi's <available_skills> block (token save), build a search index from
      // the corpus (~/.mya/agent/data/) + any pi-discovered skills, register the
      // on-demand `skill-search` tool, inject a compact category summary.
      const stripped = stripAvailableSkillsBlock(e.systemPrompt ?? "");
      let basePrompt = stripped;
      const piVisible = (e.systemPromptOptions?.skills ?? []).filter((s) => !s.disableModelInvocation);
      const merged = piVisible.length > 0 ? mergeSkills(piVisible, corpusSkills) : corpusSkills;
      if (merged.length > 0) {
        const fp = fingerprintSkills(merged);
        if (fp !== lastSkillsFingerprint || !skillIndex) {
          try {
            skillIndex = buildIndex(merged);
            lastSkillsFingerprint = fp;
          } catch (err) {
            console.error("[mya skill-search] index build failed", err);
            skillIndex = undefined;
          }
        }
        if (skillIndex && skillIndex.entries.size > 0) {
          if (!skillSearchToolRegistered) {
            pi.registerTool({
              name: "skill-search",
              label: "Skill Search",
              description: renderToolDescription(skillIndex),
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query — 1 to 500 characters" },
                  limit: { type: "number", description: "Max results (1-20, default 5)" },
                },
                required: ["query"],
              },
              async execute(_id: string, params: { query?: string; limit?: number }) {
                const idx = skillIndex;
                if (!idx || idx.entries.size === 0) {
                  return { content: [{ type: "text" as const, text: "No skills indexed." }] };
                }
                const query = (params.query ?? "").trim();
                if (query.length === 0) {
                  return { content: [{ type: "text" as const, text: "Query is required." }] };
                }
                if (query.length > 500) {
                  return { content: [{ type: "text" as const, text: "Query too long (max 500 chars)." }] };
                }
                const rawLimit = params.limit != null && Number.isFinite(params.limit) ? params.limit : 5;
                const limit = Math.max(1, Math.min(20, Math.floor(rawLimit)));
                const results = search(idx, query, limit);
                const text = formatResults(query, results, idx.entries.size);
                return { content: [{ type: "text" as const, text }] };
              },
            });
            skillSearchToolRegistered = true;
          }
          basePrompt = `${stripped}\n\n${formatCategorySummary(skillIndex)}`;
        }
      }


      // Inject brain facts via unified RetrievalEngine pipeline.
      // Pipeline: tokenize → stopword → 5 arms (BM25+substring+trigram+vector+graph)
      //           → RRF fusion → fuzzy correct → proximity rerank → caps → guard
      if (e.prompt) {
        try {
          let memoryParts: string[] = [];
          if (opts.sqliteMemory) {
            const hits = opts.sqliteMemory.recall(e.prompt, {
              topK: 5,
              sessionAware: true,
              sessionId: parentSessionId || undefined,
              // Phase 3: scope-derived recall — include active role's memories too
              // (3-tier: common global + own-role + own-session). Without agentId,
              // only common + own-session are returned (backward compatible).
              agentId: currentRole?.name,
            });
            if (hits.length > 0) {
              const hitLines = hits.map((h) => `- [${h.tier}] ${h.content.slice(0, 200)}`).join("\n");
              memoryParts.push(`[memory]\n${hitLines}`);
            }
          } else if (opts.retrievalEngine && opts.brain) {
            // Unified pipeline: build docs from Brain facts + takes
            const brain = opts.brain;
            const docs = [
              ...brain.unconsolidatedFacts().map((f) => ({
                id: f.id, content: f.content, role: "working" as const,
              })),
              ...brain.takes.map((t) => ({
                id: t.id, content: t.text, role: "working" as const,
              })),
            ];
            if (docs.length > 0) {
              const result = opts.retrievalEngine.retrieve(docs, e.prompt, { topK: 5 });
              if (result.hits.length > 0) {
                const hitLines = result.hits.map((h) => `- ${h.content.slice(0, 200)}`).join("\n");
                memoryParts.push(`[memory]
${hitLines}`);
              }
            }
          } else if (opts.memory) {
            // Fallback: domain fan-out (legacy)
            const domainResults = opts.memory.recall(e.prompt, { topK: 5 });
            for (const slice of domainResults) {
              if (slice.hits.length > 0) {
                const hitLines = slice.hits
                  .map((h) => `- ${h.content.slice(0, 200)}`)
                  .join("\n");
                memoryParts.push(`[${slice.domain}]\n${hitLines}`);
              }
            }
          } else if (opts.brain) {
            // Last resort: raw brain facts (no ranking)
            const brain = opts.brain;
            const facts = brain.unconsolidatedFacts().slice(0, 10);
            if (facts.length > 0) {
              memoryParts.push(`[facts]\n${facts.map((f) => `- [${f.kind}] ${f.content.slice(0, 200)}`).join("\n")}`);
            }
          }
          if (memoryParts.length > 0) {
            parts.push(`\n[mya memory] Relevant knowledge from previous turns:\n${memoryParts.join("\n\n")}`);
          }
        } catch { /* memory recall is best-effort */ }
      }

      // Inject skills index
      if (opts.skillStore) {
        try {
          const skills = opts.skillStore.index();
          if (skills.length > 0) {
            const skillLines = skills
              .map((s) => `- ${s.name}: ${s.description}`)
              .join("\n");
            parts.push(`\n[mya skills] Available skills (ask to use):\n${skillLines}`);
          }
        } catch { /* skills index is best-effort */ }
      }

      // Role prompt append (if a named role is active)
      if (currentRole?.promptAppend) {
        parts.push(`\n[role: ${currentRole.name}] ${currentRole.promptAppend}`);
      }

      // Context note
      parts.push(
        "\n[mya] Tools available: paid_fetch (x402), hashline_edit (hash-anchored), " +
        "browser_navigate/snapshot/click/type/scroll/back/press/screenshot, browser_search (Camofox anti-detect web search) (agent-browser), delegate_task (subagent). " +
        "Commands: /mya-help for full list.",
      );

      if (parts.length > 0 && typeof e.systemPrompt === "string") {
        return { systemPrompt: basePrompt + parts.join("\n") };
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // TOOL_RESULT: output compression for bash + LSP cascade for edits
    // ═══════════════════════════════════════════════════════════════════
    pi.on("tool_result", (event: unknown) => {
      const e = event as {
        toolName: string;
        input?: Record<string, unknown>;
        content?: Array<{ type: string; text?: string }>;
        details?: Record<string, unknown>;
        isError?: boolean;
      };

      // ── Output compression for bash (from hypa) ─────────────────────
      if (e.toolName === "bash" && !e.isError && e.content) {
        try {
          const textPart = e.content.find((c) => c.type === "text" && c.text);
          if (textPart?.text) {
            const cmd = (e.input?.["command"] as string) ?? "";
            const exitCode = (e.details?.["exitCode"] as number) ?? 0;
            const result = compressCommandOutput(cmd, textPart.text, exitCode);
            // Only compress if savings are meaningful (>20% reduction)
            const ratio = result.originalTokens > 0 ? result.compressedTokens / result.originalTokens : 1;
            if (result.originalTokens > COMPRESS_THRESHOLD_TOKENS && ratio < 0.8) {
              const compressedText = result.text +
                `\n\n[mya] Output compressed: ${result.originalTokens}→${result.compressedTokens} tokens (${Math.round((1 - ratio) * 100)}% saved)`;
              return {
                content: [{ type: "text", text: compressedText }],
                details: e.details,
                isError: false,
              };
            }
          }
        } catch { /* compression is best-effort */ }
      }

      // ── LSP cascade after edits (from pi-lens) ─────────────────
      if ((e.toolName === "edit" || e.toolName === "write") && !e.isError) {
        const filePath = (e.input?.["filePath"] as string) ?? (e.input?.["path"] as string);
        if (filePath) {
          // Best-effort: lazy-init LSP + codegraph, run diagnostics
          void lspCascadeDiagnostics(filePath).catch(() => {});
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // PROVIDER HOOKS: key rotation (from pi-soly, ported to RuntimeCredentials)
    // ═══════════════════════════════════════════════════════════════════
    // Multi-key rotation: when MYA_API_KEYS_<PROVIDER> is set (comma-separated),
    // cycle through keys via RuntimeCredentials.setRuntimeApiKey (upstream 0.80.10+).
    // Provider ID must come from the ACTIVE model (ctx.model?.provider), not env-var name,
    // because env vars allow any name but the request uses the configured provider.
    const keyState = new Map<string, { keys: string[]; idx: number; cooldownUntil: number }>();

    // findRotatableKeys now takes the active provider ID and looks up MYA_API_KEYS_<PROVIDER>.
    // Falls back to scanning env vars if no active provider is known yet (first request).
    function findKeysForProvider(providerId: string): string[] | null {
      const envName = `MYA_API_KEYS_${providerId.replace(/-/g, "_").toUpperCase()}`;
      const raw = process.env[envName];
      if (!raw) return null;
      const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
      return keys.length > 1 ? keys : null;
    }

    pi.on("before_provider_request", async (event: unknown, ctx: unknown) => {
      const c = ctx as { model?: { provider?: string }; modelRegistry?: { setRuntimeApiKey(providerId: string, apiKey: string): Promise<void> } };
      if (!c?.modelRegistry) return;

      const providerId = c.model?.provider;
      if (!providerId) return;

      const keys = findKeysForProvider(providerId);
      if (!keys) return;

      const now = nowWallclock();
      let state = keyState.get(providerId);
      if (!state) {
        state = { keys, idx: 0, cooldownUntil: 0 };
        keyState.set(providerId, state);
      }
      if (state.cooldownUntil > now) return;

      // Pick next key (round-robin), await so the credential is set BEFORE modelRuntime reads it
      state.idx = (state.idx + 1) % state.keys.length;
      const rotatedKey = state.keys[state.idx];
      if (rotatedKey) {
        // setRuntimeApiKey is async + refreshes auth store; AWAIT so it's applied to the
        // CURRENT request (before modelRuntime.streamSimple reads credentials)
        try {
          await c.modelRegistry.setRuntimeApiKey(providerId, rotatedKey);
        } catch (err) {
          console.error(`[mya-bridge] key rotation failed for ${providerId}:`, err);
        }
      }
    });

    pi.on("after_provider_response", (event: unknown, ctx: unknown) => {
      const e = event as { status?: number };
      const c = ctx as { model?: { provider?: string } };
      const providerId = c?.model?.provider;
      if (!providerId) return;

      if (e.status === 429 || e.status === 529) {
        const state = keyState.get(providerId);
        if (state) {
          // 429 = key-specific (60s), 529 = provider-wide (120s)
          state.cooldownUntil = nowWallclock() + (e.status === 429 ? 60_000 : 120_000);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // COMPACTION: ranked block scoring (from pi-vcc)
    // ═══════════════════════════════════════════════════════════════════
    pi.on("session_before_compact", (event: unknown) => {
      try {
        const e = event as {
          preparation?: {
            messagesToSummarize?: Array<Record<string, unknown>>;
            firstKeptEntryId?: string;
            tokensBefore?: number;
          };
        };
        const prep = e.preparation;
        if (!prep?.messagesToSummarize || prep.messagesToSummarize.length === 0) return;

        // Convert pi AgentMessage[] → RuntimeEvent[] for rankedCompact
        const events = prep.messagesToSummarize.map((msg): Record<string, unknown> => {
          const role = msg["role"] as string;
          const content = msg["content"] as Array<Record<string, unknown>> | undefined;
          if (role === "user") {
            const text = (content ?? []).filter((c) => c["type"] === "text").map((c) => c["text"]).join("");
            return { kind: "turn", stage: "start", turnEvent: { state: "Streaming", chunk: { kind: "text", text } } };
          }
          if (role === "assistant") {
            const text = (content ?? []).filter((c) => c["type"] === "text").map((c) => c["text"]).join("");
            return { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "text", text } } };
          }
          // toolResult or other
          const text = (content ?? []).filter((c) => c["type"] === "text").map((c) => c["text"]).join("");
          const toolName = (msg["toolName"] as string) ?? "unknown";
          return { kind: "tool", stage: "result", result: { callId: toolName, ok: true, output: text } };
        });

        const result = rankedCompact(events as never, { maxTokens: 4000 });
        if (result.summary && result.tokensSaved > 0) {
          return {
            compaction: {
              summary: result.summary,
              firstKeptEntryId: prep.firstKeptEntryId ?? "",
              tokensBefore: prep.tokensBefore ?? 0,
              estimatedTokensAfter: (prep.tokensBefore ?? 0) - result.tokensSaved,
              details: { source: "mya-ranked", blocksKept: result.blocksKept },
            },
          };
        }
      } catch { /* ranked compaction is best-effort — fall through to pi default */ }
    });

    // ═══════════════════════════════════════════════════════════════════
    // ADVERSARIAL REVIEW (from pi-dynamic-workflows)
    // After each turn settles, run a best-effort N-reviewer code review
    // using the council provider (if configured).
    // ═══════════════════════════════════════════════════════════════════
    if (opts.council) {
      const council = opts.council;
      let lastAssistantText = "";

      // Capture last assistant message for review
      pi.on("message_end", (event: unknown) => {
        const e = event as { message?: { role?: string; content?: Array<{ type: string; text?: string }> } };
        const msg = e.message;
        if (msg?.role === "assistant" && msg.content) {
          lastAssistantText = msg.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        }
      });

      pi.on("agent_settled", () => {
        if (!lastAssistantText || lastAssistantText.length < 50) return;
        // Extract potential issues from the assistant's response
        const findings = extractFindings(lastAssistantText);
        if (findings.length === 0) return;

        // Run adversarial review (best-effort, non-blocking)
        void adversarialReview(findings, {
          providers: [council],
          reviewerCount: 1,
          threshold: 0.5,
        }).then((result) => {
          const confirmed = result.real;
          if (confirmed.length > 0) {
            // Log to stderr (visible in launcher but doesn't interrupt TUI)
            process.stderr.write(`\n[mya review] ${confirmed.length} issue(s) flagged: ${confirmed.slice(0, 80).join("; ")}\n`);
          }
        }).catch(() => { /* adversarial review is best-effort */ });
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // CUSTOM TOOLS
    // ═══════════════════════════════════════════════════════════════════

    // ── recall (memory search via 4-arm RRF) ─────────────────────
    if (opts.memory) {
      const mem = opts.memory;
      pi.registerTool({
        name: "recall",
        label: "Memory Recall",
        description:
          "Search memory for relevant facts, takes, and knowledge. " +
          "Uses 4-arm RRF (BM25 + substring + vector + graph). " +
          "Pass a query string to find relevant memories.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to recall from memory" },
            topK: { type: "number", description: "Max results per domain (default: 10)" },
          },
          required: ["query"],
        },
        async execute(_id: string, params: { query: string; topK?: number }) {
          // Read from the SAME store `remember` writes to (sqliteMemory →
          // working_memory FTS5). The old `mem.recall()` fans out to domains
          // that read a separate brain/backend NOT wired to remember's writes —
          // so it always returned empty here. sqliteMemory.recall is the FTS5
          // reader over working_memory + episodic_memory (also used by the
          // before_agent_start system-prompt injection at the brain hook).
          const hits = opts.sqliteMemory
            ? opts.sqliteMemory.recall(params.query, { topK: params.topK ?? 10 })
            : mem.recall(params.query, { topK: params.topK ?? 10 })
                .flatMap((s) => s.hits);
          const lines = hits.map((h) => `- ${h.content.slice(0, 500)}`);
          return {
            content: [{
              type: "text",
              text: lines.length > 0 ? lines.join("\n") : "No relevant memories found.",
            }],
          };
        },
      });

      // ── remember (write a fact to memory) ─────────────────────
      pi.registerTool({
        name: "remember",
        label: "Memory Remember",
        description:
          "Save a fact to long-term memory. The fact will be indexed and can " +
          "be retrieved later via the recall tool. Use this for user preferences, " +
          "key decisions, project context, or anything worth remembering.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "The fact to remember" },
            entity: { type: "string", description: "Subject/topic (e.g. 'typescript', 'user-pref')" },
            kind: {
              type: "string",
              enum: ["event", "preference", "commitment", "belief", "fact"],
              description: "Type of fact (default: fact)",
            },
            visibility: {
              type: "string",
              enum: ["private", "world"],
              description: "private (local only) or world (default: private)",
            },
          },
          required: ["content", "entity"],
        },
        async execute(_id: string, params: {
          content: string;
          entity: string;
          kind?: string;
          visibility?: "private" | "world";
          filePath?: string; // Phase 5 grounding: optional file referent to track
        }) {
          if (opts.sqliteMemory) {
            const sid = opts.sqliteMemory.record({ content: params.content, source: "tui", importance: 0.7, memoryType: params.entity });
            // Phase 5 grounding: if a file path is given, track it as a referent so
            // /stale can detect when the file changes (codebase-memory-mcp pattern).
            if (params.filePath) {
              try {
                const { trackReferent } = await import("@my-agent/memory");
                trackReferent(opts.sqliteMemory.getDatabase() as never, sid, params.filePath);
              } catch { /* grounding best-effort */ }
            }
            return { content: [{ type: "text", text: `Remembered: ${params.content} (id=${sid.slice(0, 8)})${params.filePath ? ` +grounded→${params.filePath}` : ""}` }] };
          }
          const fact = mem.record({
            kind: (params.kind ?? "fact") as "event" | "preference" | "commitment" | "belief" | "fact",
            entity: params.entity,
            content: params.content,
            visibility: params.visibility ?? "private",
            notability: 3,
            source: "tui",
          });
          return {
            content: [{
              type: "text",
              text: `Remembered [${fact.kind}] ${fact.entity}: ${fact.content} (id=${fact.id.slice(0, 8)}, ttl=24h)`,
            }],
          };
        },
      });
    }

    // ── web tools (Phase 5 — orchestrator-aware registration) ─────────────
    // Replaces the Phase 2/3 direct leaf registration with the orchestrator-
    // mediated path. Per-tool surface is preserved (the model still calls
    // browser_navigate, browser_snapshot, …, web_search, web_extract), but
    // each dispatch now goes through:
    //   - runBrowserWithFallback  (camofox → cloud → local → web_fetch floor)
    //   - runSearchWithFallback  (search chain B, no universal floor)
    //   - runExtractWithFallback (extract chain B' → web_fetch fallback)
    // Load the `web.*` config once at startup so the orchestrator's cheap
    // reads stay cheap (loadWebConfig is pure — re-called per dispatch by the
    // orchestrator itself; the boot-time read is only for observability).
    const webCfg = loadWebConfig();
    if (process.env["MYA_DEBUG_WEB_CONFIG"] === "1") {
      console.error(`[mya] web config: ${JSON.stringify(webCfg)}`);
    }
    registerWebTools(pi);

    // ── web_fetch (Phase 5 — standalone universal floor) ─────────────────
    // The 7th TUI acceptance gate (browser chain all-fail → web_fetch) needs
    // `web_fetch` to be directly callable. The orchestrator invokes the same
    // function internally for the all-fail floor — this registration exposes
    // it as a first-class tool the model can also choose directly.
    registerFetchTools(pi);

    // ── paid_fetch (x402 wallet) ──────────────────────────────────────
    if (opts.wallet) {
      try {
        const raw = makePaidFetchTool(opts.wallet);
        pi.registerTool({
          name: raw.meta.name,
          description: "Fetch a URL with x402 micropayment",
          parameters: raw.meta.args,
          async execute(_id: string, params: Record<string, unknown>) {
            const result = await raw.run(params, null as never);
            const text = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
            return result.ok
              ? { content: [{ type: "text", text }] }
              : { content: [{ type: "text", text: result.error ?? "error" }], isError: true };
          },
        });
      } catch {}
    }

    // ── debug tool (DAP) ──────────────────────────────────────────────
    if (opts.dapConnect) {
      try {
        const raw = makeDebugTool(opts.dapConnect);
        pi.registerTool({
          name: raw.meta.name,
          description: "DAP debugger: initialize, setBreakpoints, continue, step, evaluate",
          parameters: raw.meta.args,
          async execute(_id: string, params: Record<string, unknown>) {
            const result = await raw.run(params, null as never);
            const text = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
            return result.ok
              ? { content: [{ type: "text", text }] }
              : { content: [{ type: "text", text: result.error ?? "error" }], isError: true };
          },
        });
      } catch {}
    }

    // ── semantic_search (code search by meaning — worker-backed, bounded) ──
    // Uses @my-agent/memory's code-index: ONNX inference is offloaded to a
    // worker_thread (via embeddings.ts) so the TUI/turn stays responsive, and
    // indexing is bounded (per-chunk time budget) so large repos fill across
    // queries instead of blocking. (Replaces the older @my-agent/tools
    // semantic-search, which indexed synchronously on the main thread.)
    try {
      pi.registerTool({
        name: "semantic_search",
        label: "Semantic Code Search",
        description:
          "Search code by MEANING (embedding/semantic search). Use when grep/glob " +
          "can't find code because you don't know the exact term. Returns ranked " +
          "file:line matches. The first query indexes a bounded batch (may take a " +
          "few seconds); retry for fuller results. Needs fastembed (opt-in).",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to find, described by meaning" },
            top_k: { type: "number", description: "Max results (default 8)" },
          },
          required: ["query"],
        },
        async execute(_id: string, params: { query: string; top_k?: number }) {
          const { semanticSearch } = await import("@my-agent/memory");
          const res = await semanticSearch(params.query, process.cwd(), params.top_k ?? 8);
          if (!res.ok) {
            return { content: [{ type: "text", text: `[semantic_search] unavailable: ${res.reason}` }] };
          }
          if (res.hits.length === 0) {
            return { content: [{ type: "text", text: `[semantic_search] no semantic matches (searched ${res.indexedChunks} chunks) — try grep.` }] };
          }
          const lines = res.hits.map((h, i) =>
            `${i + 1}. ${h.filePath}:${h.startLine}-${h.endLine} (score ${h.score.toFixed(3)})\n   ${h.snippet}`,
          );
          return {
            content: [{
              type: "text",
              text: `[semantic_search] top ${res.hits.length} of ${res.indexedChunks} chunks${res.indexing ? " (PARTIAL — still indexing, retry for more)" : ""}:\n\n${lines.join("\n\n")}`,
            }],
          };
        },
      });
    } catch {}

    // ── workflow (multi-step orchestration: agent/parallel/pipeline/phase) ──
    // A1: lets the model write a JS orchestration script with subagents. Source:
    // Claude Code `Workflow`, pi-dynamic-workflows, oh-my-pi `task`. v2 will add
    // journaled resume + worktree isolation (reflink_or_copy is already available).
    try {
      pi.registerTool({
        name: "workflow",
        label: "Workflow (orchestration)",
        description:
          "Run a multi-step orchestration script. Write a JS body " +
          "`export default async (ctx) => { ... }`. Inside, use the globals: " +
          "agent(goal) → spawns a subagent, returns its output; " +
          "parallel([fn, fn, ...]) → runs concurrently (fan-out / best-of-N); " +
          "pipeline([s1, s2, ...]) → sequential, each stage receives the previous " +
          "stage's output; phase('name') → checkpoint marker. Return a value to " +
          "surface it. Best for multi-step tasks, parallel exploration, staged pipelines.",
        parameters: {
          type: "object",
          properties: {
            script: {
              type: "string",
              description: "JS workflow body. Must `module.exports.default = async (ctx) => { ... }`. Use agent()/parallel()/pipeline()/phase().",
            },
            input: { description: "Optional input passed as ctx.input" },
            timeout_ms: { type: "number", description: "Max runtime ms (default 120000)" },
          },
          required: ["script"],
        },
        async execute(_id: string, params: { script: string; input?: unknown; timeout_ms?: number }) {
          const { spawnSubagent, trackSubagent } = await import("../../coding-agent/src/core/subagent.js");
          // Unrestricted (pi-core parity): subagent cwd is NOT bounded to the
          // workspace — same as pi core's delegate/subagent path.
          const spawn = async (goal: string, o: { allowedTools?: string[]; cwd?: string } = {}): Promise<string> => {
            const ws = process.cwd();
            const sub = await spawnSubagent(parentSessionId, {
              goal, allowedTools: o.allowedTools, cwd: o.cwd ?? ws, parentDepth: 1,
            });
            trackSubagent(parentSessionId, sub);
            // Strip the <DONE> sentinel — subagents are prompted to prefix their
            // final answer with it; it must not leak into workflow parallel()/pipeline() joins.
            return ((await sub.wait()) || "").replace(/<DONE>/g, "").trim();
          };
          const wfCtx = {
            input: params.input,
            tools: { execute: async () => [] },
            provider: { stream: async () => ({ events: [] }), health: (() => "Healthy") as () => "Healthy", id: "stub", model: "stub" },
            session: { id: parentSessionId || "mya-workflow", cwd: process.cwd() },
            spawn,
          } as unknown as WorkflowContext;
          try {
            const events = await runWorkflowSource(params.script, wfCtx, { timeoutMs: params.timeout_ms ?? 120_000 });
            const logs = events.filter((e) => e.kind === "log").map((e) => e.message).join("\n");
            return { content: [{ type: "text", text: logs || "[workflow] completed (no output)" }] };
          } catch (e) {
            return { content: [{ type: "text", text: `[workflow] failed: ${(e as Error).message}` }], isError: true };
          }
        },
      });
    } catch {}

    // ── hashline_edit (hash-anchored edits, from pi-hashline-edit-pro) ──
    try {
      pi.registerTool({
        name: "hashline_edit",
        label: "Hash-Anchored Edit",
        description:
          "Edit a file using hash anchors for precise positioning. " +
          "Each edit specifies content_lines (replacement text split by \n) and " +
          "hash_range_inclusive [startHash, endHash] (4-char line hashes).",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Path to the file to edit" },
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  content_lines: { type: "array", items: { type: "string" }, description: "Replacement lines" },
                  hash_range_inclusive: {
                    type: "array",
                    items: { type: "string" },
                    description: "[startHash, endHash] — 4-char anchors",
                  },
                },
                required: ["content_lines", "hash_range_inclusive"],
              },
            },
          },
          required: ["filePath", "edits"],
        },
        async execute(
          _id: string,
          params: {
            filePath: string;
            edits: Array<{ content_lines: string[]; hash_range_inclusive: [string, string] }>;
          },
        ) {
          const { readFileSync, writeFileSync } = await import("node:fs");
          // Unrestricted (pi-core parity): hashline_edit edits any path the agent
          // targets, same as pi core's edit/write.
          const filePath = params.filePath;
          const content = readFileSync(filePath, "utf8");
          const hashes = computeLineHashes(content);
          const result = applyEdits(content, params.edits, hashes);
          const noopCount = result.noopEdits?.length ?? 0;
          writeFileSync(filePath, result.content);
          return {
            content: [{
              type: "text",
              text: `[hashline_edit] Applied ${params.edits.length - noopCount} edit(s) to ${filePath}` +
                (noopCount > 0 ? ` (${noopCount} noop)` : "") +
                (result.firstChangedLine !== undefined ? ` lines ${result.firstChangedLine}-${result.lastChangedLine}` : ""),
            }],
          };
        },
      });
    } catch {}

    // ── code (code execution — simplified, no tool() callback) ─────────
    // Full bidirectional codeexec requires a pi dispatch API (executeRegisteredTool
    // is added to AgentSession but not yet exposed through ExtensionContext).
    // This simplified version runs JS/Python with stdout capture + timeout.
    try {
      const { spawn } = require("child_process");
      pi.registerTool({
        name: "code",
        label: "Code Execution",
        description: "Execute JavaScript or Python code and return stdout/stderr. Use for multi-line scripts, calculations, data processing.",
        parameters: {
          type: "object",
          properties: {
            language: { type: "string", enum: ["javascript", "python"], description: "Programming language" },
            script: { type: "string", description: "Code to execute" },
            timeoutMs: { type: "number", description: "Timeout in ms (default 30000, max 60000)" },
          },
          required: ["language", "script"],
        },
        async execute({ language, script, timeoutMs }: { language: string; script: string; timeoutMs?: number }) {
          if (language !== "javascript" && language !== "python")
            return { content: [{ type: "text", text: `[code] unsupported language: ${language}` }], isError: true };
          const timeout = Math.min(typeof timeoutMs === "number" ? timeoutMs : 30000, 60000);
          const cmd = language === "javascript" ? "node" : "python3";
          const args = language === "javascript" ? ["--input-type=module", "-e", script] : ["-c", script];
          return new Promise((resolve) => {
            const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd: process.cwd(), timeout: timeout });
            let stdout = "", stderr = "";
            child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
            child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
            const timer = setTimeout(() => { child.kill("SIGTERM"); }, timeout);
            child.on("close", (code: number | null) => {
              clearTimeout(timer);
              const output = stdout + (stderr ? "\n[stderr]\n" + stderr : "");
              resolve({
                content: [{ type: "text", text: output || "(no output)" }],
                isError: code !== null && code !== 0,
              });
            });
            child.on("error", (e: Error) => {
              clearTimeout(timer);
              resolve({ content: [{ type: "text", text: `[code] spawn error: ${e.message}` }], isError: true });
            });
          });
        },
      });
    } catch {}

    // ── delegate_task (subagent) ──────────────────────────────────────
    try {
      // @ts-ignore — cross-package dynamic import resolved by esbuild
      void import("../../coding-agent/src/core/subagent.js").then((mod) => {
        const { spawnSubagent, trackSubagent, MAX_SUBAGENT_DEPTH } = mod;
        pi.registerTool({
          name: "delegate_task",
          label: "Delegate Task",
          description: `Spawn a subagent for a focused task (max depth ${MAX_SUBAGENT_DEPTH}). Use allowed_tools to constrain scope.`,
          parameters: {
            type: "object",
            properties: {
              goal: { type: "string", description: "Task for the subagent" },
              allowed_tools: { type: "array", items: { type: "string" } },
              cwd: { type: "string" },
              parent_depth: { type: "number", minimum: 0, maximum: MAX_SUBAGENT_DEPTH - 1 },
              wait: { type: "boolean", default: true },
            },
            required: ["goal"],
          },
          async execute(
            _toolCallId: string,
            params: { goal: string; allowed_tools?: string[]; cwd?: string; parent_depth?: number; wait?: boolean },
          ) {
            // Unrestricted (pi-core parity): subagent cwd is NOT bounded.
            const ws = process.cwd();
            const sub = await spawnSubagent(parentSessionId, {
              goal: params.goal,
              cwd: params.cwd ?? ws,
              allowedTools: params.allowed_tools,
              parentDepth: params.parent_depth ?? 0,
            });
            trackSubagent(parentSessionId, sub);
            if (params.wait !== false) {
              const output = ((await sub.wait()) || "").replace(/<DONE>/g, "").trim();
              return { content: [{ type: "text", text: `[Subagent ${sub.id}]\n${output || "(no output)"}` }] };
            }
            return { content: [{ type: "text", text: `[Subagent ${sub.id} spawned fire-and-forget]` }] };
          },
        });
      }).catch(() => {});
    } catch {}

    // ── bridge builtinTools from @my-agent/tools into pi TUI ─────────
    // These tools (osv_check, check_url_safety, image_generate, video_generate,
    // kanban, disk_cleanup) exist in @my-agent/tools but the TUI uses pi's own
    // tool system. We bridge them via pi.registerTool() so they appear in the TUI.
    const BRIDGE_TOOL_NAMES = new Set([
      "osv_check", "check_url_safety", "image_generate", "video_generate", "kanban", "disk_cleanup",
    ]);
    for (const tool of builtinTools) {
      if (!BRIDGE_TOOL_NAMES.has(tool.meta.name)) continue;
      try {
        const meta = tool.meta as typeof tool.meta & { description?: string; label?: string };
        pi.registerTool({
          name: tool.meta.name,
          label: meta.label ?? tool.meta.name,
          description: meta.description ?? tool.meta.name,
          parameters: tool.meta.args,
          async execute(_id: string, params: Record<string, unknown>) {
            try {
              const result = await tool.run(params, null as never);
              const text = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
              return result.ok
                ? { content: [{ type: "text", text }] }
                : { content: [{ type: "text", text: result.error ?? "error" }], isError: true };
            } catch (e) {
              return { content: [{ type: "text", text: `[${tool.meta.name}] error: ${(e as Error).message}` }], isError: true };
            }
          },
        });
      } catch { /* tool name already registered */ }
    }

    // ── C6: bridge cron agent tools (cron_create/list/delete/run) ─────
    if (opts.cron) {
      try {
        const cronTools = makeCronTools(opts.cron);
        for (const tool of cronTools) {
          try {
            const meta = tool.meta as typeof tool.meta & { description?: string; label?: string };
            pi.registerTool({
              name: tool.meta.name,
              label: meta.label ?? tool.meta.name,
              description: meta.description ?? tool.meta.name,
              parameters: tool.meta.args,
              async execute(_id: string, params: Record<string, unknown>) {
                const result = await tool.run(params, null as never);
                const text = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
                return result.ok
                  ? { content: [{ type: "text", text }] }
                  : { content: [{ type: "text", text: result.error ?? "error" }], isError: true };
              },
            });
          } catch { /* already registered */ }
        }
      } catch { /* makeCronTools unavailable */ }
    }

    if (opts.registerTools) {
      opts.registerTools(pi);
    }

    // ═══════════════════════════════════════════════════════════════════
    // MCP: auto-connect + register tools as pi custom tools
    // ═══════════════════════════════════════════════════════════════════
    if (opts.mcp) {
      const mcp = opts.mcp;
      for (const cfg of opts.mcpConfigs ?? []) {
        try { mcp.register(cfg); } catch {}
      }

      // Auto-start configured servers and register their tools
      for (const cfg of opts.mcpConfigs ?? []) {
        // Check if server is already started (pre-started at gateway boot)
        const existing = mcp.listServers().find((s) => s.id === cfg.id);
        if (existing && (existing.phase === "Healthy" || existing.phase === "Degraded")) {
          // Server already connected — register tools SYNCHRONOUSLY
          const infos = mcp.getToolInfos(cfg.id);
          for (const info of infos) {
            const toolName = info.name;
            const safe = sanitizeMcpToolInfo(info);
            try {
              pi.registerTool({
                name: `mcp_${cfg.id}_${toolName}`,
                label: `MCP: ${toolName}`,
                description: safe.description,
                parameters: safe.parameters,
                async execute(_id: string, params: Record<string, unknown>) {
                  try {
                  const result = await mcp.callTool(cfg.id, toolName, params);
                  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                } catch (e) {
                  return { content: [{ type: "text", text: `[mcp] tool error: ${(e as Error).message}` }], isError: true };
                }
                },
              });
            } catch {}
          }
          continue; // skip async start
        }
        // Server not yet started — async start (fire-and-forget)
        void mcp.start(cfg.id).then((server) => {
          // B3 fix: use full McpToolInfo[] (incl. inputSchema) so the model sees
          // real parameter schemas instead of empty {}.
          const infos = mcp.getToolInfos(cfg.id);
          for (const info of infos) {
            const toolName = info.name;
            const safe = sanitizeMcpToolInfo(info); // B3 hardening: cap size/desc
            try {
              pi.registerTool({
                name: `mcp_${cfg.id}_${toolName}`,
                label: `MCP: ${toolName}`,
                description: safe.description,
                parameters: safe.parameters,
                async execute(_id: string, params: Record<string, unknown>) {
                  try {
                  const result = await mcp.callTool(cfg.id, toolName, params);
                  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                } catch (e) {
                  return { content: [{ type: "text", text: `[mcp] tool error: ${(e as Error).message}` }], isError: true };
                }
                },
              });
            } catch {}
          }
        }).catch(() => {
          /* MCP server start is best-effort */
        });
      }

      registerSharedCommand(pi, "mcp", "List/connect MCP servers. Usage: /mcp [list|connect <id>|tools|health]", async (args) => {
        const parts = args.trim().split(/\s+/);
        const sub = parts[0] ?? "list";
        if (sub === "list" || sub === "") {
          const servers = mcp.listServers();
          if (servers.length === 0) return "[mya] No MCP servers registered";
          return `[mya] MCP: ${servers.map((s) => `${s.id}:${s.phase}(${s.tools.length})`).join(" | ")}`;
        } else if (sub === "connect" && parts[1]) {
          try {
            const server = await mcp.start(parts[1]!);
            // B3 fix: register tools with real inputSchema (not empty {}).
            const infos = mcp.getToolInfos(parts[1]!);
            for (const info of infos) {
              const toolName = info.name;
              const safe = sanitizeMcpToolInfo(info); // B3 hardening: cap size/desc
              try {
                pi.registerTool({
                  name: `mcp_${parts[1]}_${toolName}`,
                  label: `MCP: ${toolName}`,
                  description: safe.description,
                  parameters: safe.parameters,
                  async execute(_id: string, params: Record<string, unknown>) {
                    try {
                  const result = await mcp.callTool(parts[1]!, toolName, params);
                  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                } catch (e) {
                  return { content: [{ type: "text", text: `[mcp] tool error: ${(e as Error).message}` }], isError: true };
                }
                  },
                });
              } catch {}
            }
            return `[mya] MCP ${server.id}: ${server.phase}, ${server.tools.length} tools`;
          } catch (e) {
            return `[mya] MCP connect failed: ${(e as Error).message}`;
          }
        } else if (sub === "tools") {
          return `[mya] MCP tools (${mcp.tools.length}): ${mcp.tools.join(", ") || "none"}`;
        } else if (sub === "health") {
          return `[mya] MCP health: ${mcp.health}`;
        }
        return "[mya] Usage: /mcp [list|connect <id>|tools|health]";
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHANNELS
    // ═══════════════════════════════════════════════════════════════════
    if (opts.channels) {
      const channels = opts.channels;
      registerSharedCommand(pi, "channel", "Manage channels: /channel [list|setup|status|send <id> <target> <text>|health]", async (args) => {
        const parts = args.trim().split(/\s+/);
        const sub = parts[0] ?? "list";
        if (sub === "list" || sub === "") {
          const all = channels.list();
          if (all.length === 0) return "[mya] No channels registered";
          return `[mya] Channels: ${all.map((c) => `${c.isConfigured() ? "✅" : "⬜"} ${c.id}`).join(" | ")}`;
        } else if (sub === "status") {
          const { channelStatusSummary } = await import("@my-agent/gateway");
          return `[mya] Channel status:\n${channelStatusSummary()}`;
        } else if (sub === "setup") {
          const { detectChannels } = await import("@my-agent/gateway");
          const detections = detectChannels();
          const configured = detections.filter((d) => d.configured).map((d) => d.id);
          const needsSetup = detections.filter((d) => !d.configured);
          if (needsSetup.length === 0) return `[mya] All channels configured! 🎉 (${configured.join(", ")})`;
          const help = needsSetup.map((d) => `${d.name}: set ${d.missing.map((m: { envVar: string }) => m.envVar).join(" + ")}`).join("\n");
          return `[mya] Configured: ${configured.join(", ") || "none"}\nTo configure:\n${help}`;
        } else if (sub === "config" && parts[1] && parts[2] && parts[3]) {
          const { saveChannelCredential } = await import("@my-agent/gateway");
          saveChannelCredential(parts[1]!, parts[2]!, parts.slice(3).join(" "));
          return `[mya] ✓ Saved ${parts[2]} for ${parts[1]}`;
        } else if (sub === "send" && parts[1] && parts[2] && parts[3]) {
          const result = await channels.send(parts[1]!, parts[2]!, parts.slice(3).join(" "));
          return result.ok ? `[mya] Sent via ${parts[1]} to ${parts[2]}` : `[mya] Failed: ${result.error}`;
        } else if (sub === "health") {
          return `[mya] Channel health: ${channels.health}`;
        }
        return "[mya] Usage: /channel [list|setup|status|config <id> <var> <val>|send <id> <target> <text>|health]";
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // SLASH COMMANDS
    // ═══════════════════════════════════════════════════════════════════
    registerSharedCommand(pi, "audit", "Show audit log summary", async () =>
      !opts.auditLog ? "AuditLog not configured" : `[mya] Audit: ${opts.auditLog.length} records, tip=${opts.auditLog.tip.slice(0, 16)}…`);

    registerSharedCommand(pi, "secrets", "Show secret store status", async () =>
      !opts.secretStore ? "SecretStore not configured" : `[mya] ${opts.secretStore.snapshot().size} secret(s)`);

    registerSharedCommand(pi, "skills", "Show skill store status", async () => {
      if (!opts.skillStore) return "SkillStore not configured";
      const skills = opts.skillStore.index();
      if (skills.length === 0) return "[mya] No skills loaded";
      return `[mya] ${skills.length} skills: ${skills.map((s) => s.name).join(", ")}`;
    });

    registerSharedCommand(pi, "memory", "Show Brain stats", async () => {
      if (!opts.brain) return "Brain not configured";
      const b = opts.brain;
      return `[mya] Brain: ${b.factCount} facts, ${b.unconsolidatedFacts().length} pending, ${b.takeCount} takes, ${b.embeddedCount} embedded`;
    });

    registerSharedCommand(pi, "wallet", "Show x402 wallet", async () => {
      if (!opts.wallet) return "Wallet not configured";
      const w = opts.wallet;
      const bal = Object.entries(w.balancesSnapshot).filter(([, v]) => (v as number) > 0);
      return `[mya] Wallet ${w.address}: ${bal.length ? bal.map(([k, v]) => `${v} ${k}`).join(", ") : "(empty)"} · ${w.receipts.length} receipts · ${w.health()}`;
    });

    registerSharedCommand(pi, "debug", "Show debug tool status", async () => {
      if (!opts.dapConnect) return "DAP debug tool not configured";
      return `[mya] DAP adapter: ${opts.dapConnect.connect.command} ${(opts.dapConnect.connect.args ?? []).join(" ")}`;
    });

    registerSharedCommand(pi, "eval", "Run eval unit-tier tests", async () => {
      try {
        const harness = defaultHarness();
        const results = await harness.grade();
        const sum = harness.summarize(results);
        return `[mya] Eval: ${sum.passed} passed, ${sum.failed} failed${sum.drifters.length ? " · drifters: " + sum.drifters.join(", ") : ""}`;
      } catch (e) { return `[mya] Eval failed: ${(e as Error).message}`; }
    });

    registerSharedCommand(pi, "sync", "Show sync state", async () => {
      if (!opts.sync) return "SyncServer not configured";
      const r = opts.sync.replicaState;
      return `[mya] Sync: ${r.size} keys · HLC ${r.hlc.wall}:${r.hlc.counter}@${r.hlc.node}`;
    });

    registerSharedCommand(pi, "collab", "Show collab rooms", async () => {
      if (!opts.collab) return "CollabRelay not configured";
      const rooms = opts.collab.roomNames;
      if (rooms.length === 0) return "[mya] Collab: 0 rooms (relay ready)";
      return `[mya] Collab: ${rooms.length} room(s) — ${rooms.map((r) => `${r}=${opts.collab!.stats(r).clients}`).join(", ")}`;
    });

    registerSharedCommand(pi, "acp", "Show ACP lineage", async () => {
      if (!opts.acp) return "AcpBridge not configured";
      const events = opts.acp.ledger.replay();
      return `[mya] ACP: ${events.filter((e) => e.kind === "spawn").length} spawns · ${events.length} events`;
    });

    registerSharedCommand(pi, "workflow", "Run a workflow file", async (args) => {
      const file = args.trim();
      if (!file) return "Usage: /workflow <file>";
      const wfCtx = { input: undefined, tools: { execute: async () => [] }, provider: { stream: async () => ({ events: [] }), health: () => "Healthy" as const, id: "stub", model: "stub" }, session: { id: "mya-tui", cwd: process.cwd() } } as unknown as WorkflowContext;
      try {
        const events = await runWorkflow(file, wfCtx, { timeoutMs: 30_000 });
        return `[mya] Workflow: ${events.length} events, ${events.filter((e) => e.kind === "log").length} logs`;
      } catch (e) { return `[mya] Workflow failed: ${(e as Error).message}`; }
    });

    registerSharedCommand(pi, "sign", "Verify tarball signature", async (args) => {
      const file = args.trim();
      if (!file) return "Usage: /sign <tarball>";
      try {
        const digest = fileSha256(file);
        let bundle: SigstoreBundle | undefined;
        try {
          const fs = await import("node:fs");
          const sidecar = `${file}.sigstore.json`;
          if (fs.existsSync(sidecar)) bundle = JSON.parse(fs.readFileSync(sidecar, "utf8"));
        } catch {}
        if (bundle) {
          const v = await verifyTarball(bundle, file);
          return `[mya] Sign: ${v.ok ? "✓ verified" : "✗ " + v.reason} (sha256=${digest.slice(0, 16)}…)`;
        }
        return `[mya] Sign: sha256=${digest} (no sigstore sidecar)`;
      } catch (e) { return `[mya] Sign failed: ${(e as Error).message}`; }
    });

    registerSharedCommand(pi, "pkg", "List packages", async () => {
      if (!opts.packageHost) return "PackageHost not configured";
      const list = opts.packageHost.list();
      if (list.length === 0) return "[mya] 0 packages";
      return `[mya] ${list.length} packages: ${list.map((p) => `${p.manifest.name}@${p.manifest.version}${p.activated ? "*" : ""}`).join(", ")}`;
    });

    registerSharedCommand(pi, "council", "Show council status", async () => {
      if (!opts.council) return "CouncilProvider not configured";
      return `[mya] Council "${opts.council.id}": ${opts.council.model} — ${opts.council.health()}`;
    });

    registerSharedCommand(pi, "cron", "List cron jobs", async () => {
      // G3/R2-7: query the GATEWAY (the single source of truth) over HTTP instead
      // of the TUI's own vestigial CronScheduler singleton (which is a separate
      // process + empty). Falls back to opts.cron if the gateway isn't reachable.
      const port = parseInt(process.env["MYA_PORT"] ?? "3000", 10);
      try {
        const { authHeaders } = await import("./gw-auth.js");
        const r = await fetch(`http://127.0.0.1:${port}/cron/jobs`, { headers: authHeaders(), signal: AbortSignal.timeout(1000) });
        if (r.ok) {
          const jobs = (await r.json()) as Array<{ name: string; trigger: string; schedule: string | number; enabled?: boolean; lastStatus?: string }>;
          if (jobs.length === 0) return "[mya] Cron: 0 jobs";
          return `[mya] Cron: ${jobs.length} job(s) — ${jobs.map((j) => `${j.name}(${j.trigger}:${j.schedule})${j.lastStatus ? ` ·${j.lastStatus}` : ""}${j.enabled === false ? " ·off" : ""}`).join(", ")}`;
        }
      } catch { /* gateway not running — fall back */ }
      if (!opts.cron) return "CronScheduler not configured (and gateway unreachable)";
      const jobs = opts.cron.listJobs();
      if (jobs.length === 0) return "[mya] Cron: 0 jobs (gateway unreachable; TUI has no local jobs)";
      return `[mya] Cron: ${jobs.length} job(s) — ${jobs.map((j) => `${j.name}(${j.trigger}:${j.schedule})${j.enabled ? "" : " ·off"}`).join(", ")}`;
    });

    registerSharedCommand(pi, "achievements", "View achievement progress", async () => {
      if (!opts.achievements) return "[mya] Achievements not configured";
      const tracker = opts.achievements as unknown as { listUnlocked: () => Array<{ id: string; name: string }>; listLocked: () => Array<{ id: string; name: string }> };
      const unlocked = tracker.listUnlocked();
      const locked = tracker.listLocked();
      let result = `[mya] Achievements: ${unlocked.length}/${unlocked.length + locked.length} unlocked\n`;
      if (unlocked.length > 0) result += `  ✅ ${unlocked.map((a) => a.name).join(", ")}\n`;
      if (locked.length > 0) result += `  🔒 ${locked.slice(0, 5).map((a) => a.name).join(", ")}${locked.length > 5 ? ` (+${locked.length - 5} more)` : ""}`;
      return result;
    });

    registerSharedCommand(pi, "webhooks", "List registered webhooks", async () => {
      const port = parseInt(process.env["MYA_PORT"] ?? "3000", 10);
      try {
        const { authHeaders } = await import("./gw-auth.js");
        const r = await fetch(`http://127.0.0.1:${port}/webhooks`, { headers: authHeaders(), signal: AbortSignal.timeout(1000) });
        if (r.ok) {
          const hooks = (await r.json()) as Array<{ id: string; url: string; events: string[] }>;
          if (hooks.length === 0) return "[mya] Webhooks: 0 registered";
          return `[mya] Webhooks: ${hooks.length} — ${hooks.map((h) => `${h.id}(${h.url.slice(0, 30)})`).join(", ")}`;
        }
      } catch { /* gateway not running */ }
      return "[mya] Webhooks: gateway not reachable (run 'mya serve')";
    });

    registerSharedCommand(pi, "mya-help", "Show mya commands", async () =>
      "[mya] Commands: /audit, /secrets, /skills, /memory, /dream, /role, /wallet, /eval, /sync, /collab, /acp, /workflow, /sign, /pkg, /council, /cron, /mcp, /channel, /achievements, /webhooks\n" +
      "Tools: code, paid_fetch, hashline_edit, browser_navigate/snapshot/click/type/scroll/back/press/screenshot, browser_search, osv_check, check_url_safety, image_generate, video_generate, kanban, disk_cleanup, cron_create/list/delete/run, delegate_task, MCP tools");

    // ═══════════════════════════════════════════════════════════════════
    // KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════════════════════════
    pi.registerShortcut("ctrl+q", {
      description: "Exit to launcher",
      handler: (ctx: unknown) => {
        const c = ctx as { shutdown: () => void };
        c?.shutdown?.();
      },
    });

    // ═══════════════════════════════════════════════════════════════════
    // CRON SWEEP TIMER — removed (Phase 0B). The gateway is the sole sweeper;
    // a second sweep here (on the TUI's own scheduler singleton) was a
    // dual-instance hazard. Lease expiry is handled by the gateway sweep.
    // ═══════════════════════════════════════════════════════════════════
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helper functions for wired features
// ═══════════════════════════════════════════════════════════════════

/** Lazy LSP cascade: builds codegraph + runs diagnostics on first edit. */
let _codegraph: unknown = null;
let _codegraphRoot = "";
async function lspCascadeDiagnostics(filePath: string): Promise<void> {
  const { runCascade } = await import("@my-agent/tools");
  const cwd = process.cwd();

  // Build codegraph once per project (cached)
  if (!_codegraph || _codegraphRoot !== cwd) {
    try {
      _codegraph = await buildCodegraph(cwd);
      _codegraphRoot = cwd;
    } catch {
      return; // codegraph build failed (no .ts files, etc.)
    }
  }

  // Minimal CascadeLspClient: uses a no-op LSP (diagnostics will be empty
  // unless typescript-language-server is available). This primarily serves
  // as the impact-analysis trigger — the codegraph identifies which files
  // depend on the edited file, and we note them for the agent.
  const noopClient = {
    openDocument() {},
    changeDocument() {},
    getDiagnostics: () => [],
  };

  const content = readFileSync(filePath, "utf8");
  const results = await runCascade(filePath, content, _codegraph as never, noopClient);
  // B4: without a real LSP server (noopClient), diagnostics are always empty —
  // but runCascade still returns the importer files the codegraph identified as
  // depending on the edited file. Report that blast radius so the agent knows
  // what its edit may affect (computeImpact walks the reverse-import graph to
  // depth 2). Exclude the edited file itself (the agent knows what it changed).
  const ext = filePath.match(/\.[^.]+$/)?.[0] ?? "";
  const changedCanonical = ext ? filePath.slice(0, filePath.length - ext.length) : filePath;
  const importers = results
    .filter((r: { file: string }) => r.file !== changedCanonical && r.file !== filePath)
    .map((r: { file: string }) => r.file);
  if (importers.length > 0) {
    const list = importers.slice(0, 20).join(", ");
    const more = importers.length > 20 ? ` (+${importers.length - 20} more)` : "";
    process.stderr.write(`\n[mya lsp] Files impacted by this edit (codegraph depth-2): ${list}${more}\n`);
  }
}

/** B3 hardening: cap MCP tool description + inputSchema size (defense-in-depth
 * against a malicious/compromised MCP server returning a huge schema for
 * token-DoS, or a long prompt-injection in its description). MCP servers are
 * user-configured (~/.mya/agent/mcp.json) so this is belt-and-suspenders, not
 * a full trust boundary. */
function sanitizeMcpToolInfo(info: { name: string; description?: string; inputSchema?: Record<string, unknown> }): {
  name: string; description: string; parameters: Record<string, unknown>;
} {
  const description = typeof info.description === "string" && info.description.length > 0
    ? info.description.slice(0, 1000)
    : `MCP tool: ${info.name}`;
  let parameters = info.inputSchema ?? { type: "object", properties: {} };
  try {
    if (JSON.stringify(parameters).length > 32 * 1024) {
      parameters = { type: "object", properties: {} }; // oversized → stub to avoid token bloat
    }
  } catch { parameters = { type: "object", properties: {} }; } // circular → stub
  return { name: info.name, description, parameters };
}

// findRotatableKeys removed in 0.80.10 sync; use findKeysForProvider(activeProviderId) inside handler instead
/** Extract potential issues from assistant text for adversarial review. */
function extractFindings(text: string): string[] {
  const findings: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      (lower.includes("bug") || lower.includes("issue") || lower.includes("problem") ||
       lower.includes("might fail") || lower.includes("could break") || lower.includes("warning:")) &&
      line.trim().length > 10 && line.trim().length < 300
    ) {
      findings.push(line.trim());
    }
    if (findings.length >= 5) break; // cap at 5 findings
  }
  return findings;
}
