/**
 * Ranked Compaction — port of pi-vcc's ranked block selection (Phase 3-1).
 *
 * Maps RuntimeEvent[] → NormalizedBlock[] → ranked selection under token budget.
 * Output: structured sections {sessionGoal, outstandingContext, filesAndChanges, briefTranscript}.
 *
 * Source: source/refs/pi-vcc/src/core/rank.ts + sections.ts
 */
import type { RuntimeEvent, ToolCall, ToolResult, TurnEvent } from "@my-agent/core";

// ─── Block types (mirroring pi-vcc NormalizedBlock) ─────────────────────────

export type NormalizedBlock =
  | { kind: "user"; text: string; sourceIndex?: number }
  | { kind: "assistant"; text: string; sourceIndex?: number }
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; sourceIndex?: number }
  | { kind: "tool_result"; name: string; text: string; sourceIndex?: number }
  | { kind: "bash"; command: string; output: string; exitCode: number | undefined; sourceIndex?: number };

export interface RankedBlock {
  block: NormalizedBlock;
  index: number;
  score: number;
  reasons: string[];
}

export interface SectionData {
  sessionGoal: string[];
  outstandingContext: string[];
  filesAndChanges: string[];
  briefTranscript: string;
}

export interface RankedCompactResult {
  summary: string;
  tokensSaved: number;
  blocksKept: number;
}

// ─── Scoring constants (from pi-vcc rank.ts) ───────────────────────────────

const EDIT_TOOL_RE = /^(edit|write|multiedit|quick_edit|target_edit|apply_patch)$/i;
const READ_TOOL_RE = /^(read|glob|grep|ls|find|semantic_query|semantic_grep|semantic_show)$/i;
const TEST_COMMAND_RE = /\b(?:bun|npm|pnpm|yarn|node|pytest|cargo|go|mvn|gradle)\b[^\n]*(?:test|spec|check|lint|build|tsc)/i;
const WORKFLOW_COMMAND_RE =
  /(?:^|\s)(?:gh\s+(?:pr|issue)\s+[a-z-]+|git\s+(?:commit|push|merge|rebase|revert|cherry-pick|tag|reset|checkout|branch)\b)/i;
const TRIVIAL_BASH_LINE_RE =
  /^(?:set\s+[-+]|cd(?:\s+\S+)?$|export\s+\w+=|(?:source|\.)\s+\S+|pwd$|true$|:$|#|ls(?:\s|$)|echo\b|clear$|sleep\b)/;
const TRIVIAL_BASH_PENALTY = 16;
const MIN_SEGMENT_CLOSING_ASSISTANT_CHARS = 120;

// ─── Token estimation (4 chars ≈ 1 token, matching tools/output-compress.ts) ─

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

// ─── RuntimeEvent → NormalizedBlock mapping ─────────────────────────────────

function extractTextFromResult(result: ToolResult): string {
  if (typeof result.output === "string") return result.output;
  return JSON.stringify(result.output ?? "");
}

function blockFromRuntimeEvent(e: RuntimeEvent, index: number): NormalizedBlock | null {
  switch (e.kind) {
    case "turn": {
      const te = e.turnEvent;
      if (!te) return null;
      // Distinguish user turns (stage: "start") from assistant streaming (stage: "event")
      const isUserTurn = e.stage === "start";
      switch (te.state) {
        case "Streaming": {
          const chunk = te.chunk;
          if (chunk.kind === "text") {
            return { kind: isUserTurn ? "user" : "assistant", text: chunk.text, sourceIndex: index };
          }
          return null;
        }
        case "ToolCalls": {
          // Each tool call becomes a tool_call block; if it's a bash call, also note the command.
          // We return the first call only here; callers may want all calls.
          // For simplicity, return a synthetic assistant text for the tool_calls event.
          const names = te.calls.map((c) => c.name).join(", ");
          return { kind: "assistant", text: `[tool_calls: ${names}]`, sourceIndex: index };
        }
        case "ToolExec": {
          // Tool results — return the first result for now.
          const results = Array.isArray(te.result) ? te.result : te.result.results;
          if (results.length === 0) return null;
          const r = results[0];
          const text = extractTextFromResult(r);
          return { kind: "tool_result", name: r.callId, text, sourceIndex: index };
        }
        case "AwaitingApproval": {
          return { kind: "user", text: `[approval needed for ${te.call.name}]`, sourceIndex: index };
        }
        default:
          return null;
      }
    }
    case "tool": {
      if (e.stage === "request" && e.call) {
        const call = e.call;
        const args = (typeof call.args === "object" && call.args !== null ? call.args : {}) as Record<string, unknown>;
        if (call.name.toLowerCase() === "bash" && typeof args.command === "string") {
          return {
            kind: "bash",
            command: args.command,
            output: "",
            exitCode: undefined,
            sourceIndex: index,
          };
        }
        return { kind: "tool_call", name: call.name, args, sourceIndex: index };
      }
      if (e.stage === "result" && e.result) {
        const text = extractTextFromResult(e.result);
        return { kind: "tool_result", name: e.result.callId, text, sourceIndex: index };
      }
      return null;
    }
    case "log":
      return { kind: "assistant", text: `[log: ${e.message}]`, sourceIndex: index };
    default:
      return null;
  }
}

// ─── Block scoring (ported from pi-vcc scoreBlock) ──────────────────────────

function bashCommandFromBlock(block: NormalizedBlock): string | undefined {
  if (block.kind === "bash") return block.command;
  if (block.kind === "tool_call" && /^bash$/i.test(block.name) && typeof block.args.command === "string") {
    return block.args.command;
  }
  return undefined;
}

function isTrivialOnlyBash(raw: string): boolean {
  const lines = raw.split("\n");
  const meaningful = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !TRIVIAL_BASH_LINE_RE.test(l));
  return meaningful.length === 0;
}

function scoreBlock(
  block: NormalizedBlock,
  index: number,
  total: number,
  modifiedFiles: Set<string>,
  readFiles: Set<string>,
): RankedBlock {
  const ranked: RankedBlock = { block, index, score: 0, reasons: [] };
  const recency = total <= 1 ? 0 : Math.round((index / (total - 1)) * 12);
  ranked.score += recency;
  ranked.reasons.push("recency");

  if (block.kind === "user") {
    ranked.score += 18;
    ranked.reasons.push("user-turn");
  }
  if (block.kind === "assistant") {
    ranked.score += 10;
    ranked.reasons.push("assistant-context");
  }
  if (block.kind === "tool_result") {
    ranked.score += 1;
    ranked.reasons.push("tool-result-low-value");
  }

  if (block.kind === "tool_call") {
    const command = bashCommandFromBlock(block);
    if (EDIT_TOOL_RE.test(block.name)) {
      ranked.score += 34;
      ranked.reasons.push("edit-tool");
    } else if (command && TEST_COMMAND_RE.test(command)) {
      ranked.score += 26;
      ranked.reasons.push("test-command");
    } else if (READ_TOOL_RE.test(block.name)) {
      ranked.score += 6;
      ranked.reasons.push("read-tool");
    } else {
      ranked.score += 12;
      ranked.reasons.push("tool-call");
    }
    if (command && WORKFLOW_COMMAND_RE.test(command)) {
      ranked.score += 14;
      ranked.reasons.push("workflow-command");
    }
    if (command && isTrivialOnlyBash(command)) {
      ranked.score -= TRIVIAL_BASH_PENALTY;
      ranked.reasons.push("trivial-bash");
    }
  }

  if (block.kind === "bash") {
    ranked.score += 8;
    ranked.reasons.push("bash");
    if (block.exitCode != null && block.exitCode !== 0) {
      ranked.score += 24;
      ranked.reasons.push("nonzero-exit");
    }
    if (TEST_COMMAND_RE.test(block.command)) {
      ranked.score += 22;
      ranked.reasons.push("test-command");
    }
    if (WORKFLOW_COMMAND_RE.test(block.command)) {
      ranked.score += 14;
      ranked.reasons.push("workflow-command");
    }
    if (isTrivialOnlyBash(block.command) && !(block.exitCode != null && block.exitCode !== 0)) {
      ranked.score -= TRIVIAL_BASH_PENALTY;
      ranked.reasons.push("trivial-bash");
    }
  }

  // File operation boosts (simplified — no hook-provided ops in this context)
  // We could extract file paths from tool_call args, but for now skip.
  // The adjacency boost below provides context around important blocks.

  if (block.kind === "tool_result" && block.text.length > 1000) {
    ranked.score -= 8;
    ranked.reasons.push("long-tool-result");
  }

  return ranked;
}

// ─── Adjacency boost (ported from pi-vcc boostAdjacency) ────────────────────

function boostAdjacency(ranked: RankedBlock[]): void {
  const important = ranked
    .filter(
      (r) =>
        r.score >= 34 ||
        r.reasons.includes("edit-tool") ||
        r.reasons.includes("test-command") ||
        r.reasons.includes("nonzero-exit"),
    )
    .map((r) => r.index);

  for (const idx of important) {
    // Boost user block before important event
    for (let i = idx - 1; i >= Math.max(0, idx - 8); i--) {
      if (ranked[i].block.kind === "user") {
        ranked[i].score += 10;
        ranked[i].reasons.push("near-important-event");
        break;
      }
    }
    // Boost assistant block before important event
    for (let i = idx - 1; i >= Math.max(0, idx - 4); i--) {
      if (ranked[i].block.kind === "assistant") {
        ranked[i].score += 7;
        ranked[i].reasons.push("near-important-event");
        break;
      }
    }
    // Boost block after important event
    for (let i = idx + 1; i <= Math.min(ranked.length - 1, idx + 4); i++) {
      if (ranked[i].block.kind === "assistant" || ranked[i].block.kind === "bash") {
        ranked[i].score += 5;
        ranked[i].reasons.push("after-important-event");
        break;
      }
    }
  }
}

// ─── Segment-closing assistant boost (ported from pi-vcc) ───────────────────

function nextNonToolResult(ranked: RankedBlock[], index: number): NormalizedBlock | undefined {
  for (let i = index + 1; i < ranked.length; i++) {
    if (ranked[i].block.kind !== "tool_result") return ranked[i].block;
  }
  return undefined;
}

function boostSegmentClosingAssistants(ranked: RankedBlock[]): void {
  for (let i = 0; i < ranked.length; i++) {
    const current = ranked[i];
    if (current.block.kind !== "assistant") continue;
    if (current.block.text.trim().length < MIN_SEGMENT_CLOSING_ASSISTANT_CHARS) continue;
    const next = nextNonToolResult(ranked, i);
    if (!next || next.kind === "user") {
      current.score += 14;
      current.reasons.push("segment-closing-assistant");
    }
  }
}

// ─── Deduplication key (simplified from pi-vcc) ─────────────────────────────

function dedupKey(block: NormalizedBlock): string | undefined {
  const command = bashCommandFromBlock(block);
  if (command) {
    const normalized = command.replace(/\s+/g, " ").trim();
    return normalized ? `bash:${normalized}` : undefined;
  }
  if (block.kind === "tool_call") {
    const path = typeof block.args.path === "string" ? block.args.path : undefined;
    return path ? `tool:${block.name.toLowerCase()}:${path}` : undefined;
  }
  return undefined;
}

// ─── Ranked block selection (ported from pi-vcc selectRankedBriefBlocks) ────

export function rankBriefBlocks(
  blocks: NormalizedBlock[],
  options?: { modifiedFiles?: string[]; readFiles?: string[] },
): RankedBlock[] {
  const modifiedFiles = new Set(options?.modifiedFiles ?? []);
  const readFiles = new Set(options?.readFiles ?? []);
  const ranked = blocks.map((block, index) => scoreBlock(block, index, blocks.length, modifiedFiles, readFiles));
  boostAdjacency(ranked);
  boostSegmentClosingAssistants(ranked);
  return ranked;
}

export function selectRankedBriefBlocks(
  blocks: NormalizedBlock[],
  options?: {
    maxBlocks?: number;
    preserveRecentBlocks?: number;
    maxTokens?: number;
    modifiedFiles?: string[];
    readFiles?: string[];
  },
): NormalizedBlock[] {
  const maxBlocks = options?.maxBlocks ?? 80;
  const preserveRecentBlocks = Math.min(options?.preserveRecentBlocks ?? 16, maxBlocks);
  const maxTokens = options?.maxTokens;

  // Fast path: nothing to trim
  if (blocks.length <= maxBlocks && maxTokens == null) return blocks;

  const ranked = rankBriefBlocks(blocks, options);
  const selected = new Set<number>();
  const seenKeys = new Set<string>();

  // Per-block token cost, only computed when a token budget is active
  const costs =
    maxTokens == null
      ? null
      : blocks.map((b) => {
          const text = blockToText(b);
          return estimateTokens(text);
        });
  let usedTokens = 0;

  // Keep recent blocks (newest first) to preserve local continuity
  for (let i = blocks.length - 1; i >= Math.max(0, blocks.length - preserveRecentBlocks); i--) {
    if (blocks[i].kind === "tool_result") continue;
    if (selected.has(i)) continue;
    if (costs && usedTokens + costs[i] > maxTokens!) continue;
    selected.add(i);
    if (costs) usedTokens += costs[i];
    const key = dedupKey(blocks[i]);
    if (key) seenKeys.add(key);
  }

  // Greedy selection by score
  const ordered = [...ranked].sort((a, b) => b.score - a.score || b.index - a.index);
  for (const item of ordered) {
    if (selected.size >= maxBlocks) break;
    if (selected.has(item.index)) continue;
    if (item.block.kind === "tool_result") continue;
    const key = dedupKey(item.block);
    if (key && seenKeys.has(key)) continue;
    if (costs) {
      // Skip (not break) so smaller high-value blocks can still fit the budget
      if (usedTokens + costs[item.index] > maxTokens!) continue;
      usedTokens += costs[item.index];
    }
    selected.add(item.index);
    if (key) seenKeys.add(key);
  }

  return [...selected].sort((a, b) => a - b).map((i) => blocks[i]);
}

// ─── Block → text helper ────────────────────────────────────────────────────

function blockToText(block: NormalizedBlock): string {
  switch (block.kind) {
    case "user":
      return block.text;
    case "assistant":
      return block.text;
    case "tool_call":
      return `${block.name}(${JSON.stringify(block.args)})`;
    case "tool_result":
      return block.text;
    case "bash":
      return `$ ${block.command}\n${block.output}`;
    default:
      return "";
  }
}

// ─── Build structured sections from selected blocks ─────────────────────────

function buildSections(blocks: NormalizedBlock[]): SectionData {
  const sessionGoal: string[] = [];
  const outstandingContext: string[] = [];
  const filesAndChanges: string[] = [];
  const briefTranscript: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "user":
        sessionGoal.push(block.text);
        break;
      case "assistant":
        if (block.text.length > 100) {
          // Long assistant text likely contains context/goals
          outstandingContext.push(block.text);
        } else {
          briefTranscript.push(block.text);
        }
        break;
      case "tool_call": {
        const cmd = bashCommandFromBlock(block);
        if (cmd) {
          briefTranscript.push(`$ ${cmd}`);
        } else {
          filesAndChanges.push(`${block.name}(${JSON.stringify(block.args)})`);
        }
        break;
      }
      case "tool_result":
        // Tool results are low-value; skip unless they contain file changes
        if (block.text.includes("edited") || block.text.includes("wrote") || block.text.includes("created")) {
          filesAndChanges.push(block.text.slice(0, 200));
        }
        break;
      case "bash":
        briefTranscript.push(`$ ${block.command}`);
        if (block.exitCode != null && block.exitCode !== 0) {
          briefTranscript.push(`exit ${block.exitCode}`);
        }
        break;
    }
  }

  return {
    sessionGoal,
    outstandingContext,
    filesAndChanges,
    briefTranscript: briefTranscript.join("\n"),
  };
}

// ─── Main export: rankedCompact ─────────────────────────────────────────────

export function rankedCompact(
  messages: RuntimeEvent[],
  options?: { maxTokens?: number },
): RankedCompactResult {
  // Convert RuntimeEvent[] → NormalizedBlock[]
  const blocks: NormalizedBlock[] = [];
  for (let i = 0; i < messages.length; i++) {
    const block = blockFromRuntimeEvent(messages[i], i);
    if (block) blocks.push(block);
  }

  // Estimate original tokens
  const originalText = blocks.map(blockToText).join("\n");
  const originalTokens = estimateTokens(originalText);

  // Rank and select blocks under budget
  const maxTokens = options?.maxTokens ?? Math.min(4000, Math.max(500, Math.floor(originalTokens * 0.3)));
  const selected = selectRankedBriefBlocks(blocks, { maxTokens });

  // Build structured sections
  const sections = buildSections(selected);

  // Build summary
  const parts: string[] = [];
  if (sections.sessionGoal.length > 0) {
    parts.push(`## Session Goal\n${sections.sessionGoal.join("\n")}`);
  }
  if (sections.outstandingContext.length > 0) {
    parts.push(`## Outstanding Context\n${sections.outstandingContext.join("\n")}`);
  }
  if (sections.filesAndChanges.length > 0) {
    parts.push(`## Files & Changes\n${sections.filesAndChanges.join("\n")}`);
  }
  if (sections.briefTranscript) {
    parts.push(`## Brief Transcript\n${sections.briefTranscript}`);
  }

  const summary = parts.join("\n\n");
  const keptText = selected.map(blockToText).join("\n");
  const keptTokens = estimateTokens(keptText);

  return {
    summary,
    tokensSaved: originalTokens - keptTokens,
    blocksKept: selected.length,
  };
}