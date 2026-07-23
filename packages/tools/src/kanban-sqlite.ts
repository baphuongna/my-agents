/**
 * @my-agent/tools — SQLite-backed kanban task board (Phase 7, PLAN-HERMES-PORT).
 *
 * Upgrades the JSON-based `kanban.ts` to a durable SQLite task board with:
 *   - 7-table schema (tasks, task_links DAG, task_events, task_comments,
 *     kanban_notify_subs + indexes)
 *   - DAG parent/child links
 *   - append-only event log + comments
 *   - atomic claim/release/heartbeat lifecycle for concurrent workers
 *   - subscription-based notifications with unseen-event claiming
 *
 * Source: §9 Kanban (docs/hermes-deep-dive-r3.md), PLAN-HERMES-PORT Phase 7.
 *
 * better-sqlite3 is lazy-loaded via createRequire (same proven pattern as
 * @my-agent/memory/sqlite-db.ts) so vitest/vite/esbuild never resolve the
 * native addon at module-eval time. All timestamps use the single
 * `core.time` helper (`nowWallclock`) — never `Date.now()` (invariant #10).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

import { nowWallclock } from "@my-agent/core";

import type { ToolResult } from "@my-agent/core";
import type { ToolImpl } from "./registry.js";

export const DB_PATH = `${homedir()}/.mya/kanban.db`;

// ── Minimal SQLite API surface (avoids importing the native addon at eval) ─
interface SqliteStatement {
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | string };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

let DatabaseCtor: (new (path: string) => SqliteDatabase) | null = null;
function getDatabaseCtor(): new (path: string) => SqliteDatabase {
  if (DatabaseCtor !== null) return DatabaseCtor;
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = req("better-sqlite3");
  DatabaseCtor = (mod.Database ?? mod) as new (path: string) => SqliteDatabase;
  return DatabaseCtor;
}

// ── Domain types ──────────────────────────────────────────────────────────
export type TaskStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

export type BlockKind = "dependency" | "needs_input" | "capability" | "transient" | null;

export interface Task {
  id: string;
  title: string;
  body: string;
  assignee: string | null;
  status: TaskStatus;
  priority: number;
  createdBy: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  projectId: string | null;
  claimLock: string | null;
  claimExpires: number | null;
  result: string | null;
  consecutiveFailures: number;
  workerPid: number | null;
  lastHeartbeatAt: number | null;
  blockKind: BlockKind;
  parentId: string | null;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  kind: string;
  payload: string | null;
  createdAt: number;
}

export interface TaskComment {
  id: number;
  taskId: string;
  author: string;
  body: string;
  createdAt: number;
}

export interface NotifySub {
  taskId: string;
  channel: string;
  chatId: string;
  threadId: string | null;
  lastEventId: number;
}

/** Input for createTask — only `title` is required; everything else defaults. */
export interface CreateTaskInput {
  id?: string;
  title: string;
  body?: string;
  assignee?: string | null;
  status?: TaskStatus;
  priority?: number;
  createdBy?: string;
  projectId?: string | null;
  parentId?: string | null;
  blockKind?: BlockKind;
  startedAt?: number | null;
  completedAt?: number | null;
  claimLock?: string | null;
  claimExpires?: number | null;
  result?: string | null;
  workerPid?: number | null;
  lastHeartbeatAt?: number | null;
}

export interface ListFilter {
  status?: TaskStatus;
  projectId?: string;
  parentId?: string;
}

const TASK_COL_MAP: Record<keyof Task, string> = {
  id: "id",
  title: "title",
  body: "body",
  assignee: "assignee",
  status: "status",
  priority: "priority",
  createdBy: "created_by",
  createdAt: "created_at",
  startedAt: "started_at",
  completedAt: "completed_at",
  projectId: "project_id",
  claimLock: "claim_lock",
  claimExpires: "claim_expires",
  result: "result",
  consecutiveFailures: "consecutive_failures",
  workerPid: "worker_pid",
  lastHeartbeatAt: "last_heartbeat_at",
  blockKind: "block_kind",
  parentId: "parent_id",
};

const DEFAULT_CLAIM_TTL_MS = 5 * 60_000; // 5 min
const HEARTBEAT_EXTEND_MS = 5 * 60_000;

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row["id"]),
    title: String(row["title"] ?? ""),
    body: String(row["body"] ?? ""),
    assignee: strOrNull(row["assignee"]),
    status: String(row["status"] ?? "todo") as TaskStatus,
    priority: Number(row["priority"] ?? 0),
    createdBy: String(row["created_by"] ?? "agent"),
    createdAt: Number(row["created_at"]),
    startedAt: numOrNull(row["started_at"]),
    completedAt: numOrNull(row["completed_at"]),
    projectId: strOrNull(row["project_id"]),
    claimLock: strOrNull(row["claim_lock"]),
    claimExpires: numOrNull(row["claim_expires"]),
    result: strOrNull(row["result"]),
    consecutiveFailures: Number(row["consecutive_failures"] ?? 0),
    workerPid: numOrNull(row["worker_pid"]),
    lastHeartbeatAt: numOrNull(row["last_heartbeat_at"]),
    blockKind: strOrNull(row["block_kind"]) as BlockKind,
    parentId: strOrNull(row["parent_id"]),
  };
}

function rowToEvent(row: Record<string, unknown>): TaskEvent {
  return {
    id: Number(row["id"]),
    taskId: String(row["task_id"]),
    kind: String(row["kind"]),
    payload: strOrNull(row["payload"]),
    createdAt: Number(row["created_at"]),
  };
}

function rowToComment(row: Record<string, unknown>): TaskComment {
  return {
    id: Number(row["id"]),
    taskId: String(row["task_id"]),
    author: String(row["author"] ?? "agent"),
    body: String(row["body"]),
    createdAt: Number(row["created_at"]),
  };
}

function rowToSub(row: Record<string, unknown>): NotifySub {
  return {
    taskId: String(row["task_id"]),
    channel: String(row["channel"]),
    chatId: String(row["chat_id"]),
    threadId: strOrNull(row["thread_id"]),
    lastEventId: Number(row["last_event_id"] ?? 0),
  };
}

/**
 * SQLite-backed kanban task board. Pass `:memory:` for an ephemeral in-memory
 * database (used by tests); otherwise a file path under `~/.mya/`.
 */
export class KanbanDB {
  private readonly db: SqliteDatabase;

  constructor(dbPath?: string) {
    const path = dbPath ?? DB_PATH;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const Ctor = getDatabaseCtor();
    this.db = new Ctor(path);
    // WAL is a no-op (returns 'memory') on in-memory DBs; safe either way.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA wal_autocheckpoint = 100");
    // Disable FK enforcement: a task board needs soft-reference semantics —
    // children may be created before their parent, a parent may be deleted
    // while children remain (re-parented by app logic), and the DAG in
    // task_links is managed explicitly via INSERT OR IGNORE. The FOREIGN KEY
    // clauses in the schema are kept as documentation. (better-sqlite3 v12
    // turns foreign_keys ON by default, hence the explicit override.)
    this.db.exec("PRAGMA foreign_keys = OFF");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        assignee TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'agent',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        project_id TEXT,
        claim_lock TEXT,
        claim_expires INTEGER,
        result TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        worker_pid INTEGER,
        last_heartbeat_at INTEGER,
        block_kind TEXT,
        parent_id TEXT,
        FOREIGN KEY (parent_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS task_links (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id),
        FOREIGN KEY (parent_id) REFERENCES tasks(id),
        FOREIGN KEY (child_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'agent',
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS kanban_notify_subs (
        task_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        thread_id TEXT,
        last_event_id INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (task_id, channel, chat_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_links_parent ON task_links(parent_id);
      CREATE INDEX IF NOT EXISTS idx_links_child ON task_links(child_id);
      CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
    `);
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  createTask(input: CreateTaskInput): Task {
    const id = input.id ?? randomUUID();
    const now = nowWallclock();
    const task: Task = {
      id,
      title: input.title,
      body: input.body ?? "",
      assignee: input.assignee ?? null,
      status: input.status ?? "todo",
      priority: input.priority ?? 0,
      createdBy: input.createdBy ?? "agent",
      createdAt: now,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      projectId: input.projectId ?? null,
      claimLock: input.claimLock ?? null,
      claimExpires: input.claimExpires ?? null,
      result: input.result ?? null,
      consecutiveFailures: 0,
      workerPid: input.workerPid ?? null,
      lastHeartbeatAt: input.lastHeartbeatAt ?? null,
      blockKind: input.blockKind ?? null,
      parentId: input.parentId ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at,
            started_at, completed_at, project_id, claim_lock, claim_expires, result,
            consecutive_failures, worker_pid, last_heartbeat_at, block_kind, parent_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        task.id,
        task.title,
        task.body,
        task.assignee,
        task.status,
        task.priority,
        task.createdBy,
        task.createdAt,
        task.startedAt,
        task.completedAt,
        task.projectId,
        task.claimLock,
        task.claimExpires,
        task.result,
        task.consecutiveFailures,
        task.workerPid,
        task.lastHeartbeatAt,
        task.blockKind,
        task.parentId,
      );
    this.addEvent(id, "created");
    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? rowToTask(row) : null;
  }

  updateTask(id: string, updates: Partial<Task>): boolean {
    const keys = Object.keys(updates) as Array<keyof Task>;
    const cols = keys.filter((k) => k !== "id" && updates[k] !== undefined);
    if (cols.length === 0) return this.getTask(id) !== null;
    const setClause = cols.map((k) => `${TASK_COL_MAP[k]} = ?`).join(", ");
    const values = cols.map((k) => updates[k] ?? null);
    const prev = this.getTask(id);
    const res = this.db.prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`).run(...values, id);
    const changed = (res.changes ?? 0) > 0;
    if (changed && prev && updates.status !== undefined && updates.status !== prev.status) {
      this.addEvent(id, "status_changed", { from: prev.status, to: updates.status });
    }
    return changed;
  }

  listTasks(filter?: ListFilter): Task[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.status !== undefined) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.projectId !== undefined) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.parentId !== undefined) {
      where.push("parent_id = ?");
      params.push(filter.parentId);
    }
    const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY priority DESC, created_at ASC`;
    return this.db.prepare(sql).all(...params).map(rowToTask);
  }

  deleteTask(id: string): boolean {
    // Manual cascade (FKs are documentary; PRAGMA foreign_keys is off by default).
    this.db.prepare("DELETE FROM task_links WHERE parent_id = ? OR child_id = ?").run(id, id);
    this.db.prepare("DELETE FROM task_events WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM task_comments WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM kanban_notify_subs WHERE task_id = ?").run(id);
    const res = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return (res.changes ?? 0) > 0;
  }

  // ── DAG links ───────────────────────────────────────────────────────────

  linkTasks(parentId: string, childId: string): boolean {
    const res = this.db
      .prepare("INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)")
      .run(parentId, childId);
    const ok = (res.changes ?? 0) > 0;
    if (ok) this.addEvent(childId, "linked", { parentId });
    return ok;
  }

  unlinkTasks(parentId: string, childId: string): boolean {
    const res = this.db
      .prepare("DELETE FROM task_links WHERE parent_id = ? AND child_id = ?")
      .run(parentId, childId);
    return (res.changes ?? 0) > 0;
  }

  getChildTasks(parentId: string): Task[] {
    return this.db
      .prepare(
        `SELECT t.* FROM tasks t
         JOIN task_links l ON l.child_id = t.id
         WHERE l.parent_id = ?
         ORDER BY t.priority DESC, t.created_at ASC`,
      )
      .all(parentId)
      .map(rowToTask);
  }

  getParentTasks(childId: string): Task[] {
    return this.db
      .prepare(
        `SELECT t.* FROM tasks t
         JOIN task_links l ON l.parent_id = t.id
         WHERE l.child_id = ?`,
      )
      .all(childId)
      .map(rowToTask);
  }

  // ── Events ──────────────────────────────────────────────────────────────

  addEvent(taskId: string, kind: string, payload?: unknown): number {
    const data = payload === undefined ? null : JSON.stringify(payload);
    const res = this.db
      .prepare("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)")
      .run(taskId, kind, data, nowWallclock());
    return Number(res.lastInsertRowid);
  }

  getEvents(taskId: string, afterEventId?: number): TaskEvent[] {
    if (afterEventId === undefined) {
      return this.db
        .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC")
        .all(taskId)
        .map(rowToEvent);
    }
    return this.db
      .prepare("SELECT * FROM task_events WHERE task_id = ? AND id > ? ORDER BY id ASC")
      .all(taskId, afterEventId)
      .map(rowToEvent);
  }

  // ── Comments ────────────────────────────────────────────────────────────

  addComment(taskId: string, body: string, author = "agent"): number {
    const res = this.db
      .prepare("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?,?,?,?)")
      .run(taskId, author, body, nowWallclock());
    return Number(res.lastInsertRowid);
  }

  getComments(taskId: string): TaskComment[] {
    return this.db
      .prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY id ASC")
      .all(taskId)
      .map(rowToComment);
  }

  // ── Claim lifecycle ─────────────────────────────────────────────────────

  /** Atomically claim a task for a worker. Fails if already actively claimed. */
  claimTask(taskId: string, workerPid: number, claimTtlMs = DEFAULT_CLAIM_TTL_MS): boolean {
    const now = nowWallclock();
    const expires = now + claimTtlMs;
    const lock = `${workerPid}:${randomUUID().slice(0, 8)}`;
    const res = this.db
      .prepare(
        `UPDATE tasks
           SET claim_lock = ?, claim_expires = ?, worker_pid = ?,
               status = 'running', started_at = COALESCE(started_at, ?)
         WHERE id = ? AND (claim_lock IS NULL OR claim_expires < ?)`,
      )
      .run(lock, expires, workerPid, now, taskId, now);
    const ok = (res.changes ?? 0) > 0;
    if (ok) this.addEvent(taskId, "claimed", { workerPid, expires });
    return ok;
  }

  releaseClaim(taskId: string): boolean {
    const res = this.db
      .prepare("UPDATE tasks SET claim_lock = NULL, claim_expires = NULL WHERE id = ?")
      .run(taskId);
    const ok = (res.changes ?? 0) > 0;
    if (ok) this.addEvent(taskId, "released");
    return ok;
  }

  /** Update heartbeat; extends an active claim's expiry. Returns false if task missing. */
  heartbeat(taskId: string): boolean {
    const now = nowWallclock();
    const res = this.db
      .prepare(
        `UPDATE tasks
           SET last_heartbeat_at = ?,
               claim_expires = CASE WHEN claim_lock IS NOT NULL THEN ? ELSE claim_expires END
         WHERE id = ?`,
      )
      .run(now, now + HEARTBEAT_EXTEND_MS, taskId);
    return (res.changes ?? 0) > 0;
  }

  // ── Notifications ───────────────────────────────────────────────────────

  addNotifySub(taskId: string, channel: string, chatId: string, threadId?: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kanban_notify_subs (task_id, channel, chat_id, thread_id, last_event_id, created_at)
         VALUES (?, ?, ?, ?, COALESCE((SELECT last_event_id FROM kanban_notify_subs WHERE task_id = ? AND channel = ? AND chat_id = ?), 0), ?)`,
      )
      .run(taskId, channel, chatId, threadId ?? null, taskId, channel, chatId, nowWallclock());
  }

  removeNotifySub(taskId: string, channel: string, chatId: string): void {
    this.db
      .prepare("DELETE FROM kanban_notify_subs WHERE task_id = ? AND channel = ? AND chat_id = ?")
      .run(taskId, channel, chatId);
  }

  getNotifySubs(taskId: string): NotifySub[] {
    return this.db
      .prepare("SELECT * FROM kanban_notify_subs WHERE task_id = ?")
      .all(taskId)
      .map(rowToSub);
  }

  /** Return events newer than `lastEventId` whose kind is in `eventKinds`. */
  claimUnseenEvents(taskId: string, lastEventId: number, eventKinds: string[]): TaskEvent[] {
    if (eventKinds.length === 0) return [];
    const placeholders = eventKinds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM task_events
         WHERE task_id = ? AND id > ? AND kind IN (${placeholders})
         ORDER BY id ASC`,
      )
      .all(taskId, lastEventId, ...eventKinds)
      .map(rowToEvent);
  }

  // ── Maintenance ─────────────────────────────────────────────────────────

  walCheckpoint(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Migrate the legacy JSON board store (`~/.mya/kanban.json`) into SQLite.
 * Legacy shape: `{ boards: [{ id, name, columns: [{ id, name, tasks: [{ id, title, column }] }] }] }`.
 * Returns the number of tasks migrated.
 */
export function migrateJsonToSqlite(jsonPath: string, db: KanbanDB): number {
  if (!existsSync(jsonPath)) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return 0;
  }
  if (typeof parsed !== "object" || parsed === null) return 0;
  const store = parsed as { boards?: unknown };
  if (!Array.isArray(store.boards)) return 0;

  let count = 0;
  const colToStatus: Record<string, TaskStatus> = {
    todo: "todo",
    doing: "running",
    done: "done",
  };
  for (const board of store.boards) {
    if (typeof board !== "object" || board === null) continue;
    const b = board as { id?: string; name?: string; columns?: unknown };
    const projectId = b.name ?? b.id ?? null;
    if (!Array.isArray(b.columns)) continue;
    for (const col of b.columns) {
      if (typeof col !== "object" || col === null) continue;
      const c = col as { id?: string; name?: string; tasks?: unknown };
      if (!Array.isArray(c.tasks)) continue;
      for (const t of c.tasks) {
        if (typeof t !== "object" || t === null) continue;
        const task = t as { id?: string; title?: string; column?: string };
        // Idempotency: skip if task already exists (re-run safety)
        if (task.id && db.getTask(task.id)) continue;
        const status = (task.column && colToStatus[task.column]) || "todo";
        db.createTask({
          id: task.id,
          title: String(task.title ?? ""),
          status,
          projectId,
        });
        count++;
      }
    }
  }
  return count;
}

// ── Tool interface ────────────────────────────────────────────────────────

let defaultDb: KanbanDB | null = null;
function getDefaultDB(): KanbanDB {
  if (!defaultDb) defaultDb = new KanbanDB();
  return defaultDb;
}

const SQLITE_ACTIONS = [
  "create",
  "show",
  "list",
  "complete",
  "block",
  "comment",
  "link",
  "heartbeat",
] as const;

/**
 * SQLite-backed kanban tool. Exposes task create/show/list/complete/block/
 * comment/link/heartbeat actions. Stored in ~/.mya/kanban.db (WAL mode).
 * The legacy JSON-based `kanbanTool` is retained for backwards compatibility.
 */
export const kanbanSqliteTool: ToolImpl = {
  meta: {
    name: "kanban_sqlite",
    description:
      "Manage a SQLite-backed task board with DAG links, events, comments, claims, and notifications. " +
      "Actions: create, show, list, complete, block, comment, link, heartbeat. Stored in ~/.mya/kanban.db.",
    args: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...SQLITE_ACTIONS], description: "Action to perform" },
        id: { type: "string", description: "Task id (show/complete/block/comment/link/heartbeat)" },
        title: { type: "string", description: "Task title (create)" },
        body: { type: "string", description: "Task body/details (create)" },
        assignee: { type: "string", description: "Assignee (create)" },
        priority: { type: "number", description: "Priority, higher = sooner (create/list sort)" },
        project_id: { type: "string", description: "Project id (create/list filter)" },
        parent_id: { type: "string", description: "Parent task id (create/link)" },
        child_id: { type: "string", description: "Child task id (link)" },
        status: { type: "string", description: "Filter by status (list)" },
        result: { type: "string", description: "Completion result (complete)" },
        block_kind: {
          type: "string",
          enum: ["dependency", "needs_input", "capability", "transient"],
          description: "Block reason kind (block)",
        },
        reason: { type: "string", description: "Block reason text, added as comment (block)" },
        comment: { type: "string", description: "Comment body (comment)" },
        author: { type: "string", description: "Comment author (comment)" },
        worker_pid: { type: "number", description: "Worker process pid (heartbeat)" },
      },
      required: ["action"],
    },
    requiredMode: "WorkspaceWrite",
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run(args, _ctx): Promise<ToolResult> {
    const a = args as {
      action?: string;
      id?: string;
      title?: string;
      body?: string;
      assignee?: string;
      priority?: number;
      project_id?: string;
      parent_id?: string;
      child_id?: string;
      status?: string;
      result?: string;
      block_kind?: string;
      reason?: string;
      comment?: string;
      author?: string;
      worker_pid?: number;
    };
    if (!a.action) return { callId: "kanban_sqlite", ok: false, output: null, error: "action required" };
    const db = getDefaultDB();

    switch (a.action) {
      case "create": {
        if (!a.title) return { callId: "kanban_sqlite", ok: false, output: null, error: "title required" };
        const task = db.createTask({
          title: a.title,
          body: a.body,
          assignee: a.assignee ?? null,
          priority: a.priority,
          projectId: a.project_id ?? null,
          parentId: a.parent_id ?? null,
        });
        return { callId: "kanban_sqlite", ok: true, output: { task_id: task.id, status: task.status } };
      }
      case "show": {
        if (!a.id) return { callId: "kanban_sqlite", ok: false, output: null, error: "id required" };
        const task = db.getTask(a.id);
        if (!task) return { callId: "kanban_sqlite", ok: false, output: null, error: `task '${a.id}' not found` };
        return { callId: "kanban_sqlite", ok: true, output: { task } };
      }
      case "list": {
        const tasks = db.listTasks({
          status: a.status as TaskStatus | undefined,
          projectId: a.project_id,
          parentId: a.parent_id,
        });
        return {
          callId: "kanban_sqlite",
          ok: true,
          output: { count: tasks.length, tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })) },
        };
      }
      case "complete": {
        if (!a.id) return { callId: "kanban_sqlite", ok: false, output: null, error: "id required" };
        const result = a.result ?? "";
        const changed = db.updateTask(a.id, { status: "done", completedAt: nowWallclock(), result });
        if (!changed) return { callId: "kanban_sqlite", ok: false, output: null, error: `task '${a.id}' not found` };
        db.addEvent(a.id, "completed", { result });
        return { callId: "kanban_sqlite", ok: true, output: { id: a.id, status: "done" } };
      }
      case "block": {
        if (!a.id) return { callId: "kanban_sqlite", ok: false, output: null, error: "id required" };
        const kind = (a.block_kind ?? "dependency") as BlockKind;
        const changed = db.updateTask(a.id, { status: "blocked", blockKind: kind });
        if (!changed) return { callId: "kanban_sqlite", ok: false, output: null, error: `task '${a.id}' not found` };
        if (a.reason) db.addComment(a.id, a.reason);
        db.addEvent(a.id, "blocked", { blockKind: kind, reason: a.reason ?? null });
        return { callId: "kanban_sqlite", ok: true, output: { id: a.id, status: "blocked", blockKind: kind } };
      }
      case "comment": {
        if (!a.id) return { callId: "kanban_sqlite", ok: false, output: null, error: "id required" };
        if (!a.comment) return { callId: "kanban_sqlite", ok: false, output: null, error: "comment body required" };
        if (!db.getTask(a.id)) return { callId: "kanban_sqlite", ok: false, output: null, error: `task '${a.id}' not found` };
        const commentId = db.addComment(a.id, a.comment, a.author);
        return { callId: "kanban_sqlite", ok: true, output: { comment_id: commentId, task_id: a.id } };
      }
      case "link": {
        if (!a.parent_id || !a.child_id)
          return { callId: "kanban_sqlite", ok: false, output: null, error: "parent_id and child_id required" };
        const ok = db.linkTasks(a.parent_id, a.child_id);
        return { callId: "kanban_sqlite", ok, output: ok ? { parent_id: a.parent_id, child_id: a.child_id } : null, error: ok ? undefined : "link failed (missing task or duplicate)" };
      }
      case "heartbeat": {
        if (!a.id) return { callId: "kanban_sqlite", ok: false, output: null, error: "id required" };
        const ok = db.heartbeat(a.id);
        return { callId: "kanban_sqlite", ok, output: ok ? { id: a.id, heartbeat: true } : null, error: ok ? undefined : `task '${a.id}' not found` };
      }
      default:
        return { callId: "kanban_sqlite", ok: false, output: null, error: `unknown action: ${a.action}` };
    }
  },
};
