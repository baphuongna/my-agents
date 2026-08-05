# Hướng I: Kanban Board — task queue qua SQLite

> **Coupling:** 🟢 SQLite — agents chỉ cần đọc/ghi SQLite
> **Agent-agnostic:** ✅ — bất kỳ agent poll board
> **Code sẵn:** ✅ packages/tools/src/kanban-sqlite.ts (7-table schema)

## Mô tả

Shared task board (SQLite DAG) là single source of truth. Tasks flow qua columns (ready → in-progress → review → done). Agents atomic claim ready tasks (CAS lock + TTL). Agents report status. Crash recovery: TTL expires → stale task reclaimed.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                    mya daemon                            │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │    Kanban Board (SQLite DAG — 7 tables)         │   │
│   │                                                  │   │
│   │   ready → claim(CAS) → in-progress → review     │   │
│   │                                    → done       │   │
│   │                                                  │   │
│   │   · atomic CAS claim (TTL lease)                │   │
│   │   · task dependencies (links DAG)               │   │
│   │   · heartbeat → stale reclaim                   │   │
│   │   · append-only event log                       │   │
│   │   · max_in_progress per agent                   │   │
│   │   · failure_limit → quarantine                  │   │
│   └────┬─────────┬──────────┬───────────┬───────────┘   │
│        │         │          │           │                │
╔════════╪═════════╪══════════╪═══════════╪═══════════════╗
║        ▼         ▼          ▼           ▼                ║
║   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           ║
║   │ pi     │ │claude  │ │opencode│ │ aider  │           ║
║   │ worker │ │ worker │ │ worker │ │ worker │           ║
║   │        │ │        │ │        │ │        │           ║
║   │ poll   │ │ poll   │ │ poll   │ │ poll   │           ║
║   │ board  │ │ board  │ │ board  │ │ board  │           ║
║   │ claim  │ │ claim  │ │ claim  │ │ claim  │           ║
║   │ do it  │ │ do it  │ │ do it  │ │ do it  │           ║
║   │ report │ │ report │ │ report │ │ report │           ║
║   └────────┘ └────────┘ └────────┘ └────────┘           ║
║                                                          ║
║   Workers là BẤT KỲ agent nào.                          ║
║   Poll board → claim → work → report.                   ║
║   Zero IPC. Zero coupling. SQLite là everything.         ║
╚══════════════════════════════════════════════════════════╝
```

## mya ĐÃ CÓ kanban-sqlite.ts

```typescript
// packages/tools/src/kanban-sqlite.ts — 7-TABLE SCHEMA
tables: tasks, task_links, task_events, task_comments, notify_subs

// Atomic CAS claim:
db.prepare("UPDATE tasks SET status='in_progress', holder=?, claimed_at=? \
  WHERE id=? AND status='ready'").run(agentId, nowWallclock(), taskId);

// TTL lease expiry:
db.prepare("UPDATE tasks SET status='ready', holder=NULL \
  WHERE status='in_progress' AND claimed_at < ?").run(nowWallclock() - TTL);

// Heartbeat:
db.prepare("UPDATE tasks SET heartbeat=? WHERE id=? AND holder=?")
  .run(nowWallclock(), taskId, agentId);

// DAG dependencies:
db.prepare("SELECT * FROM task_links WHERE child=? AND parent_status != 'done'");
```

## Task lifecycle

```
1. User/cron tạo task:
   INSERT INTO tasks (id, description, status='ready', priority, tools_allowed)
   → task appears on board

2. Agent polls board (cron interval hoặc fs.watch SQLite):
   SELECT * FROM tasks WHERE status='ready' AND dependencies_met ORDER BY priority

3. Agent claims (atomic CAS):
   UPDATE tasks SET status='in_progress', holder=agentId WHERE id=? AND status='ready'
   → if affected rows = 1 → claim successful

4. Agent works (native):
   · Agent runs own loop, own tools, own LLM
   · Agent heartbeat: UPDATE tasks SET heartbeat=now WHERE id=?

5. Agent reports done:
   UPDATE tasks SET status='review', result=? WHERE id=?
   INSERT INTO task_events (task_id, type='done', output=?)

6. Reviewer agent picks up:
   SELECT * FROM tasks WHERE status='review'

7. Review approved → done:
   UPDATE tasks SET status='done' WHERE id=?

8. Crash recovery (TTL expires):
   UPDATE tasks SET status='ready', holder=NULL
   WHERE status='in_progress' AND heartbeat < now - TTL
   → another agent re-claims
```

## Agent interaction (zero coupling)

Agents don't need to know about mya. They just need:
```bash
# Poll for ready tasks (any agent with SQLite access):
sqlite3 ~/.mya/kanban.db "SELECT id, description FROM tasks WHERE status='ready' LIMIT 1"

# Claim (atomic):
sqlite3 ~/.mya/kanban.db "UPDATE tasks SET status='in_progress', holder='pi-agent-1' WHERE id='task-42' AND status='ready'"

# Do work (native agent loop):
pi --print "implement authentication: $TASK_DESCRIPTION"

# Report done:
sqlite3 ~/.mya/kanban.db "UPDATE tasks SET status='review', result='$RESULT' WHERE id='task-42'"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fully decoupled (SQLite only) | ❌ Polling latency (default 60s) |
| ✅ Crash recovery (TTL reclaim) | ❌ No streaming (task result is atomic) |
| ✅ Observable (board = dashboard) | ❌ SQLite single-writer |
| ✅ Natural parallelism | ❌ Complex debugging (distributed reasoning) |
| ✅ Idempotent (CAS prevents double-dispatch) | ❌ Agent must poll (waste cycles) |
| ✅ Dependency ordering (DAG) | ❌ No real-time inter-agent comm |
| ✅ Failure tracking (failure_limit → quarantine) | |

## So sánh với các hướng khác

| | I: Kanban | H: ACP | K: Event Stream |
|---|---|---|---|
| Communication | SQLite read/write | JSON-RPC stdio | Append-only log |
| Coupling | Zero (shared DB) | Low (protocol) | Zero (shared log) |
| Real-time | ❌ (poll) | ✅ (push) | ⚠️ (watch) |
| Crash recovery | ✅ TTL reclaim | ❌ | ✅ replay log |
| Parallelism | ✅ CAS lock | ✅ spawn | ✅ |

## Khi nào chọn

- Muốn fully decoupled coordination
- OK với polling latency
- Cần crash recovery (TTL reclaim)
- Cần dependency ordering (task DAG)
- Muốn observable dashboard (board = UI)
