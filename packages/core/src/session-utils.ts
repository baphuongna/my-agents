/**
 * @my-agent/session — §4 R31 turn/session completeness mechanics.
 *
 * The core loop (packages/core) ships runTurn + FSM + budget. This package
 * holds the load-bearing session mechanics a Tier-1 builder needs (folded from
 * FEATURE-INVENTORY Part 1): tree-structured JSONL session, plan-mode todos,
 * mid-turn message queue, context-window preflight, unified cancel protocol.
 *
 * Source: §4 Core Loop completeness (R31); pi session-manager, claw-code
 * session.rs, pi compaction, pi plan-mode, MyAgents cancellation.
 */
import { randomUUID } from "node:crypto";
import { nowWallclock } from "@my-agent/core";

// ─── Session JSONL tree (§4 R31: pi session-manager / claw-code session.rs) ──

export type EntryKind =
  | "message"
  | "model_change"
  | "compaction"
  | "branch_summary"
  | "custom"
  | "label";

export interface SessionEntry {
  id: string;
  parentId: string | null; // tree-structured (null = root)
  kind: EntryKind;
  role?: "user" | "assistant" | "system" | "tool";
  content: unknown;
  ts: number;
  /** Schema version for migration (v1 → v2 → v3). */
  v: 1 | 2 | 3;
}

/**
 * Tree-structured session log. Append-only; entries reference a parent (rooted
 * at null). Supports JSONL serialize/deserialize + v1→v2→v3 migration.
 */
export class SessionTree {
  private readonly entries = new Map<string, SessionEntry>();
  private readonly children = new Map<string | null, string[]>();
  readonly schemaVersion: 1 | 2 | 3 = 3;

  append(entry: Omit<SessionEntry, "id" | "ts" | "v"> & { id?: string; ts?: number }): SessionEntry {
    const id = entry.id ?? randomUUID();
    const full: SessionEntry = {
      id,
      parentId: entry.parentId,
      kind: entry.kind,
      role: entry.role,
      content: entry.content,
      ts: entry.ts ?? nowWallclock(),
      v: this.schemaVersion,
    };
    this.entries.set(id, full);
    const siblings = this.children.get(full.parentId) ?? [];
    siblings.push(id);
    this.children.set(full.parentId, siblings);
    return full;
  }

  get(id: string): SessionEntry | undefined {
    return this.entries.get(id);
  }

  /** Children of a parent (null = roots). */
  childrenOf(parentId: string | null): SessionEntry[] {
    return (this.children.get(parentId) ?? []).map((id) => this.entries.get(id)!).filter(Boolean);
  }

  /** Linearize the tree in append order (the message log sent to a provider). */
  linearize(): SessionEntry[] {
    return [...this.entries.values()].sort((a, b) => a.ts - b.ts);
  }

  /** Serialize to newline-delimited JSON (JSONL). */
  toJSONL(): string {
    return this.linearize()
      .map((e) => JSON.stringify(e))
      .join("\n");
  }

  /** Load from JSONL, migrating older schema versions. */
  static fromJSONL(text: string): SessionTree {
    const tree = new SessionTree();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const raw = JSON.parse(trimmed) as SessionEntry;
      tree.append(migrateEntry(raw));
    }
    return tree;
  }

  get length(): number {
    return this.entries.size;
  }
}

/** Migrate a session entry to the current schema (v3). v1 had no `v` field;
 * v2 added `role`; v3 added `ts` normalization. */
export function migrateEntry(raw: Partial<SessionEntry>): Omit<SessionEntry, "id" | "ts" | "v"> & {
  id?: string;
  ts?: number;
} {
  const v = (raw.v ?? 1) as 1 | 2 | 3;
  // v1 → v2: ensure role exists
  if (v < 2 && !raw.role) raw.role = raw.kind === "message" ? "user" : undefined;
  // v2 → v3: ts always a number
  if (raw.ts == null) raw.ts = 0;
  return raw as Omit<SessionEntry, "id" | "ts" | "v"> & { id?: string; ts?: number };
}

// ─── Plan-mode todos (§4 R31: pi plan-mode, Cursor todos) ────────────────────

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface Todo {
  id: string;
  text: string;
  status: TodoStatus;
}

/** Structured per-session task list (TodoWrite). One in_progress at a time. */
export class TodoList {
  private readonly todos = new Map<string, Todo>();
  private order: string[] = [];

  write(updates: Array<{ id?: string; text: string; status?: TodoStatus }>): Todo[] {
    for (const u of updates) {
      if (u.id && this.todos.has(u.id)) {
        const existing = this.todos.get(u.id)!;
        existing.text = u.text ?? existing.text;
        if (u.status) existing.status = u.status;
      } else {
        const id = u.id ?? randomUUID();
        const todo: Todo = { id, text: u.text, status: u.status ?? "pending" };
        this.todos.set(id, todo);
        this.order.push(id);
      }
    }
    // enforce: at most one in_progress
    const inProgress = this.list().filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      for (const t of inProgress.slice(0, -1)) this.todos.get(t.id)!.status = "completed";
    }
    return this.list();
  }

  list(): Todo[] {
    return this.order.map((id) => this.todos.get(id)!).filter(Boolean);
  }
}

// ─── Mid-turn message queue (§4 R31: pi steer/followUp/nextTurn) ─────────────

export type DeliveryMode = "steer" | "followUp" | "nextTurn";

export interface QueuedMessage {
  id: string;
  text: string;
  mode: DeliveryMode;
  ts: number;
}

/** A queue of mid-turn user messages (Alt+Enter queues, Alt+Up restores).
 * - steer: interrupts the current turn (injects into the live turn)
 * - followUp: runs immediately after the current turn completes
 * - nextTurn: waits for the next explicit user prompt */
export class MessageQueue {
  private queue: QueuedMessage[] = [];

  enqueue(text: string, mode: DeliveryMode = "nextTurn"): QueuedMessage {
    const msg: QueuedMessage = { id: randomUUID(), text, mode, ts: nowWallclock() };
    this.queue.push(msg);
    // steer + followUp sort first (time-priority), nextTurn after
    this.queue.sort((a, b) => {
      const rank = (m: DeliveryMode) => (m === "steer" ? 0 : m === "followUp" ? 1 : 2);
      return rank(a.mode) - rank(b.mode) || a.ts - b.ts;
    });
    return msg;
  }

  /** Drain messages of a mode (the loop calls this at the right boundary). */
  drain(mode: DeliveryMode): QueuedMessage[] {
    const matching = this.queue.filter((m) => m.mode === mode);
    this.queue = this.queue.filter((m) => m.mode !== mode);
    return matching;
  }

  peek(): QueuedMessage[] {
    return [...this.queue];
  }

  get length(): number {
    return this.queue.length;
  }
}

// ─── Context-window preflight (§4/§6 R31: claw-code preflight_message_request) ─

export type PreflightResult =
  | { ok: true }
  | { ok: false; estimatedTotalTokens: number; contextWindowTokens: number; overflow: number };

/** Reject a provider request where est. input+output > context_window BEFORE the
 * wire call (fail fast, don't burn quota). */
export function preflightContextWindow(
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  contextWindowTokens: number,
): PreflightResult {
  const total = estimatedInputTokens + estimatedOutputTokens;
  if (total > contextWindowTokens) {
    return {
      ok: false,
      estimatedTotalTokens: total,
      contextWindowTokens,
      overflow: total - contextWindowTokens,
    };
  }
  return { ok: true };
}

// ─── Unified cancel protocol (§4 R31: MyAgents cancellation) ─────────────────

export type CancelReason = "user" | "timeout" | "upstream" | "shutdown" | "error";

/** Combine multiple AbortSignals into one (AbortSignal.any polyfill for
 * Node < 20.3). Aborts with the first signal's reason. */
export function cancelAny(signals: (AbortSignal | undefined)[], reason: CancelReason = "user"): AbortSignal {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return new AbortController().signal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(valid);
  }
  // polyfill
  const ctrl = new AbortController();
  const onAbort = (src: AbortSignal) => {
    if (ctrl.signal.aborted) return;
    ctrl.abort((src as { reason?: unknown }).reason ?? reason);
  };
  for (const s of valid) {
    if (s.aborted) {
      onAbort(s);
      break;
    }
    s.addEventListener("abort", () => onAbort(s), { once: true });
  }
  return ctrl.signal;
}
