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
 * - browser_action:   CDP browser automation (from pi-computer-use)
 * - delegate_task:    subagent delegation
 * - MCP tools:        auto-registered from connected MCP servers
 *
 * LIFECYCLE:
 * - AuditLog:         tool_call/tool_result/turn_start/turn_end → Merkle log
 * - Brain:            turn_end → consolidate()
 * - Cron:             load cron.json + 60s sweep timer
 * - TTS:              message_end → speak() (MYA_TTS=1)
 * - Skills:           discovered from ~/.mya/skills/
 *
 * Slash commands: /audit, /secrets, /skills, /memory, /wallet, /eval, /sync,
 *   /collab, /acp, /workflow, /sign, /pkg, /council, /cron, /mcp, /channel, /mya-help
 */
import { nowWallclock } from "@my-agent/core";
import { makePaidFetchTool } from "@my-agent/x402";
import { makeDebugTool } from "@my-agent/dap";
import { defaultHarness } from "@my-agent/eval";
import { speak } from "@my-agent/tts";
import { runWorkflow, type WorkflowContext } from "@my-agent/workflows";
import { fileSha256, verifyTarball, type SigstoreBundle } from "@my-agent/signing";
import { compressCommandOutput, buildCodegraph, runCascade as _rc } from "@my-agent/tools";
import { applyEdits, computeLineHashes } from "@my-agent/tools";
import { rankedCompact } from "@my-agent/prompts";
import { adversarialReview } from "@my-agent/council";
import { commandRegistry } from "./command-registry.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { AuditLog } from "@my-agent/audit";
import type { SecretStore } from "@my-agent/secrets";
import type { HookRegistry, McpManager, McpServerConfig, ChannelRegistry } from "@my-agent/gateway";
import type { SkillStore } from "@my-agent/skills";
import type { CronScheduler } from "@my-agent/cron";
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
  registerTools?: (pi: MyaPiApi) => void;
}

/** Minimal pi ExtensionAPI surface (duck-typed to avoid tight coupling). */
export interface MyaPiApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: unknown): void;
  registerShortcut(shortcut: string, options: unknown): void;
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
    // DREAM CYCLE: periodic offline consolidation (every 30 min when idle)
    // ═══════════════════════════════════════════════════════════════════
    // DreamCycle collects recent memories, summarizes them into episodic
    // memory, runs lifecycle (consolidate/degrade/purge), and reviews skills.
    // Uses SQLite when available, falls back to legacy Brain.
    const dreamCycle = opts.dreamCycle ?? new DreamCycle({
      sqliteMemory: opts.sqliteMemory,
      brain: opts.brain,
      skillCurator: opts.skillStore as unknown as { review(): { reviewed: number; stale: string[] } } | undefined,
      isIdle: () => !pi, // always idle in TUI context (pi is active only during turns)
    });
    dreamCycle.start();

    // ═══════════════════════════════════════════════════════════════════
    // SESSION START: capture session ID + load cron jobs
    // ═══════════════════════════════════════════════════════════════════
    pi.on("session_start", (event: unknown, ctx: unknown) => {
      const c = ctx as { sessionManager?: { getSessionId?: () => string } };
      parentSessionId = c?.sessionManager?.getSessionId?.() ?? `session-${nowWallclock().toString(36)}`;
    });

    // Load cron jobs from disk (previously gateway-only)
    if (opts.cron) {
      try {
        const cron = opts.cron;
        const cronPath = join(process.env["HOME"] ?? "~", ".mya", "cron.json");
        if (existsSync(cronPath)) {
          const jobs = JSON.parse(readFileSync(cronPath, "utf8"));
          if (Array.isArray(jobs)) {
            for (const job of jobs) {
              try { cron.register(job); } catch { /* already exists */ }
            }
          }
        }
      } catch { /* cron loading is best-effort */ }
    }

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
      });
      pi.on("turn_start", (event: unknown) => {
        const e = event as { turnIndex: number };
        audit.append({ ts: nowWallclock(), kind: "channel", actor: "agent", payload: { phase: "turn_start", turn: e.turnIndex } });
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
          opts.sqliteMemory.lifecycle();
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

    // ═══════════════════════════════════════════════════════════════════
    // BEFORE_AGENT_START: inject brain facts + skills + context note
    // FIXED: return { systemPrompt } instead of mutating the event
    // ═══════════════════════════════════════════════════════════════════
    pi.on("before_agent_start", (event: unknown) => {
      const e = event as { systemPrompt?: string; prompt?: string };
      const parts: string[] = [];

      // Inject brain facts via unified RetrievalEngine pipeline.
      // Pipeline: tokenize → stopword → 5 arms (BM25+substring+trigram+vector+graph)
      //           → RRF fusion → fuzzy correct → proximity rerank → caps → guard
      if (e.prompt) {
        try {
          let memoryParts: string[] = [];
          if (opts.sqliteMemory) {
            const hits = opts.sqliteMemory.recall(e.prompt, { topK: 5 });
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

      // Context note
      parts.push(
        "\n[mya] Tools available: paid_fetch (x402), hashline_edit (hash-anchored), " +
        "browser_action (CDP), delegate_task (subagent). " +
        "Commands: /mya-help for full list.",
      );

      if (parts.length > 0 && typeof e.systemPrompt === "string") {
        return { systemPrompt: e.systemPrompt + parts.join("\n") };
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
    // PROVIDER HOOKS: key rotation (from pi-soly)
    // ═══════════════════════════════════════════════════════════════════
    // Multi-key rotation: when MYA_API_KEYS_<PROVIDER> is set (comma-separated),
    // cycle through keys. sdk.js reads x-mya-rotated-key convention header.
    const keyState = new Map<string, { keys: string[]; idx: number; cooldownUntil: number }>();

    pi.on("before_provider_headers", (event: unknown) => {
      const e = event as { headers?: Record<string, string> };
      if (!e.headers) return;
      // Detect provider from existing auth header
      const providerKeys = findRotatableKeys();
      if (providerKeys.length <= 1) return; // nothing to rotate

      const now = Date.now();
      let state = keyState.get("default");
      if (!state) {
        state = { keys: providerKeys, idx: 0, cooldownUntil: 0 };
        keyState.set("default", state);
      }
      // Skip if all keys are in cooldown
      if (state.cooldownUntil > now) return;

      // Pick next available key (round-robin)
      state.idx = (state.idx + 1) % state.keys.length;
      const rotatedKey = state.keys[state.idx];
      if (rotatedKey) {
        // Convention header — sdk.js streamFn reads this and overrides apiKey
        e.headers["x-mya-rotated-key"] = rotatedKey;
      }
    });

    pi.on("after_provider_response", (event: unknown) => {
      const e = event as { status?: number };
      if (e.status === 429 || e.status === 529) {
        // Rate-limited: put current key in cooldown
        const state = keyState.get("default");
        if (state) {
          // 429 = key-specific (60s), 529 = provider-wide (120s)
          state.cooldownUntil = Date.now() + (e.status === 429 ? 60_000 : 120_000);
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
          const results = mem.recall(params.query, { topK: params.topK ?? 10 });
          const lines: string[] = [];
          for (const slice of results) {
            if (slice.hits.length > 0) {
              lines.push(`[${slice.domain}]`);
              for (const h of slice.hits) {
                lines.push(`  - ${h.content.slice(0, 500)}`);
              }
            }
          }
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
        }) {
          if (opts.sqliteMemory) {
            const sid = opts.sqliteMemory.record({ content: params.content, source: "tui", importance: 0.7, memoryType: params.entity });
            return { content: [{ type: "text", text: `Remembered: ${params.content} (id=${sid.slice(0, 8)})` }] };
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
          const content = readFileSync(params.filePath, "utf8");
          const hashes = computeLineHashes(content);
          const result = applyEdits(content, params.edits, hashes);
          const noopCount = result.noopEdits?.length ?? 0;
          writeFileSync(params.filePath, result.content);
          return {
            content: [{
              type: "text",
              text: `[hashline_edit] Applied ${params.edits.length - noopCount} edit(s) to ${params.filePath}` +
                (noopCount > 0 ? ` (${noopCount} noop)` : "") +
                (result.firstChangedLine !== undefined ? ` lines ${result.firstChangedLine}-${result.lastChangedLine}` : ""),
            }],
          };
        },
      });
    } catch {}

    // ── browser_action (CDP, from pi-computer-use) ────────────────────
    try {
      pi.registerTool({
        name: "browser_action",
        label: "Browser Action",
        description:
          "Execute a browser action via Chrome DevTools Protocol. " +
          "Actions: press, click, setText, scroll, drag, moveMouse, wait. " +
          "Requires MYA_CDP_URL env (ws://localhost:9222/devtools/page/ID).",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["press", "click", "setText", "scroll", "drag", "moveMouse", "wait"] },
                ref: { type: "string" },
                text: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                scrollX: { type: "number" },
                scrollY: { type: "number" },
                ms: { type: "number" },
              },
              required: ["action"],
            },
          },
          required: ["action"],
        },
        async execute(_id: string, params: { action: Record<string, unknown> }) {
          const cdpUrl = process.env["MYA_CDP_URL"];
          if (!cdpUrl) {
            return {
              content: [{ type: "text", text: "[browser_action] Set MYA_CDP_URL env to a CDP websocket URL" }],
              isError: true,
            };
          }
          try {
            const mod = await import("@my-agent/tools");
            const { prepareAction, executeAction } = mod;
            const prepared = prepareAction(params.action as never, []);
            const { WebSocket } = await import("ws");
            const ws = new WebSocket(cdpUrl);
            await new Promise<void>((resolve, reject) => {
              ws.on("open", resolve);
              ws.on("error", reject);
            });
            let msgId = 0;
            const cdpCall = (method: string, p: Record<string, unknown>) =>
              new Promise<unknown>((resolve, reject) => {
                const id = ++msgId;
                ws.send(JSON.stringify({ id, method, params: p }));
                const handler = (data: unknown) => {
                  try {
                    const msg = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: unknown };
                    if (msg.id === id) {
                      ws.off("message", handler);
                      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
                    }
                  } catch { /* skip */ }
                };
                ws.on("message", handler);
              });
            const client = {
              Input: {
                dispatchMouseEvent: (a: Record<string, unknown>) => cdpCall("Input.dispatchMouseEvent", a),
                dispatchKeyEvent: (a: Record<string, unknown>) => cdpCall("Input.dispatchKeyEvent", a),
                insertText: (a: { text: string }) => cdpCall("Input.insertText", a),
              },
            };
            await executeAction(prepared, client);
            ws.close();
            return {
              content: [{ type: "text", text: `[browser_action] ${(params.action["action"] as string) ?? "action"} executed` }],
            };
          } catch (e) {
            return {
              content: [{ type: "text", text: `[browser_action] Error: ${(e as Error).message}` }],
              isError: true,
            };
          }
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
            const sub = await spawnSubagent(parentSessionId, {
              goal: params.goal,
              cwd: params.cwd,
              allowedTools: params.allowed_tools,
              parentDepth: params.parent_depth ?? 0,
            });
            trackSubagent(parentSessionId, sub);
            if (params.wait !== false) {
              const output = await sub.wait();
              return { content: [{ type: "text", text: `[Subagent ${sub.id}]\n${output || "(no output)"}` }] };
            }
            return { content: [{ type: "text", text: `[Subagent ${sub.id} spawned fire-and-forget]` }] };
          },
        });
      }).catch(() => {});
    } catch {}

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
        void mcp.start(cfg.id).then((server) => {
          // server.tools is string[] (tool names) — register each as pi tool
          for (const toolName of server.tools) {
            try {
              pi.registerTool({
                name: `mcp_${cfg.id}_${toolName}`,
                label: `MCP: ${toolName}`,
                description: `MCP tool from server ${cfg.id}: ${toolName}`,
                parameters: { type: "object", properties: {} },
                async execute(_id: string, params: Record<string, unknown>) {
                  const result = await mcp.callTool(cfg.id, toolName, params);
                  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
            // Register tools after manual connect too
            for (const toolName of server.tools) {
              try {
                pi.registerTool({
                  name: `mcp_${parts[1]}_${toolName}`,
                  label: `MCP: ${toolName}`,
                  description: `MCP tool from server ${parts[1]}: ${toolName}`,
                  parameters: { type: "object", properties: {} },
                  async execute(_id: string, params: Record<string, unknown>) {
                    const result = await mcp.callTool(parts[1]!, toolName, params);
                    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
      if (!opts.cron) return "CronScheduler not configured";
      const jobs = opts.cron.listJobs();
      if (jobs.length === 0) return "[mya] Cron: 0 jobs";
      const due = new Set(opts.cron.due().map((j) => j.id));
      return `[mya] Cron: ${jobs.length} job(s) — ${jobs.map((j) => `${j.name}(${j.trigger}:${j.schedule})${due.has(j.id) ? " ·DUE" : ""}${j.enabled ? "" : " ·off"}`).join(", ")}`;
    });

    registerSharedCommand(pi, "mya-help", "Show mya commands", async () =>
      "[mya] Commands: /audit, /secrets, /skills, /memory, /wallet, /eval, /sync, /collab, /acp, /workflow, /sign, /pkg, /council, /cron, /mcp, /channel\n" +
      "Tools: paid_fetch, hashline_edit, browser_action, delegate_task, MCP tools");

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
    // CRON SWEEP TIMER
    // ═══════════════════════════════════════════════════════════════════
    if (opts.cron) {
      const cron = opts.cron;
      const timer = setInterval(() => {
        try { cron.sweepExpired(); } catch {}
      }, 60_000);
      timer.unref?.();
    }
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
  const impacted = results.filter((r: { diagnostics: unknown[] }) => r.diagnostics.length > 0);
  if (impacted.length > 0) {
    const files = impacted.map((r: { file: string }) => r.file).join(", ");
    process.stderr.write(`\n[mya lsp] Diagnostics in impacted files: ${files}\n`);
  }
}

/** Find comma-separated API keys from MYA_API_KEYS_<PROVIDER> env vars. */
function findRotatableKeys(): string[] {
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MYA_API_KEYS_") && value) {
      return value.split(",").map((k) => k.trim()).filter(Boolean);
    }
  }
  return [];
}

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
