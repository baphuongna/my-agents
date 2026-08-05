# Hướng U: Tuple Space — bộ nhớ chung, agent tự tìm việc (Linda)

> **Nguồn gốc:** Parallel Programming — Linda (Gelernter, Yale, 1985)
> **Coupling:** 🟢 Associative memory
> **Agent-agnostic:** ✅ — bất kỳ agent读写 tuple space
> **Code sẵn:** ✅ SQLite (có thể implement tuple space)

## Nguồn gốc

David Gelernter tại Yale giới thiệu Linda (1985) — "Generative Communication in Linda." Tuple space là shared associative memory. Processes giao tiếp bằng write/read/take tuples theo pattern matching. Không direct messaging, không shared variables, không message queues.

**Tham chiếu:**
- Gelernter, D. (1985). "Generative Communication in Linda." *ACM TOPLAS*, 7(1), 80–112.
- Carriero, N. & Gelernter, D. (1989). "How to Write Parallel Programs." *ACM Computing Surveys*, 21(3).

## Mô tả

Agents giao tiếp với shared tuple space — associative memory. Viết tuples (structured data), đọc/lấy theo pattern matching. Agent cần gì → viết `("question", topic)` → block chờ `("answer", topic)`. Agent biết câu trả lời → viết answer tuple. Không cần biết về nhau.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                    TUPLE SPACE                               │
│              (bộ nhớ chung, associative)                     │
│                                                              │
│  ("task", "fix-auth", status="open", priority=3)             │
│  ("task", "write-tests", status="open", priority=2)          │
│  ("result", "fix-auth", done, file="auth.ts")                │
│  ("knowledge", "user-pref", "prefers-strict-ts")             │
│  ("question", "how-to-JWT", asker=Agent-007)                 │
│  ("answer", "how-to-JWT", text="use jsonwebtoken...")        │
│  ("lock", "auth.ts", holder=Agent-007, expires=...)          │
│  ("capability", "rust-expert", agent=Agent-005)              │
│                                                              │
│       ▲ out()    ▲ out()    ▲ rd()    ▲ in()    ▲ rd()      │
│       │          │          │         │          │           │
│   ┌───┴───┐  ┌──┴────┐  ┌──┴────┐  ┌──┴────┐  ┌──┴────┐    │
│   │Agent A│  │Agent B│  │Agent C│  │Agent D│  │Agent E│    │
│   │coder  │  │tester │  │review │  │planner│  │memory │    │
│   └───────┘  └───────┘  └───────┘  └───────┘  └───────┘    │
│                                                              │
│  out(tuple)  → viết tuple vào space                         │
│  rd(pattern) → đọc tuple khớp pattern (block đến khi có)    │
│  in(pattern) → đọc VÀ XÓA tuple khớp pattern                │
│                                                              │
│  Agent không biết nhau. Tự tìm việc qua pattern matching.   │
│  Decoupled trong TIME (viết 10h, đọc 3h).                  │
│  Decoupled trong SPACE (không cần address).                 │
└──────────────────────────────────────────────────────────────┘
```

## 6 operations

```typescript
// out(tuple) — write tuple to space (non-blocking)
space.out({ tag: "task", desc: "fix-auth", status: "open", priority: 3 });

// rd(pattern) — read matching tuple (blocks until match found)
const task = await space.rd({ tag: "task", status: "open" });

// in(pattern) — read AND REMOVE matching tuple (atomic)
const task = await space.in({ tag: "task", status: "open" });

// rdp(pattern) — non-blocking read (returns null if no match)
const result = space.rdp({ tag: "result", desc: "fix-auth" });

// inp(pattern) — non-blocking take
const task = space.inp({ tag: "task", status: "open" });

// eval(expression) — spawn async computation
space.eval(async () => {
  const task = await space.in({ tag: "task", status: "open" });
  const result = await doWork(task);
  space.out({ tag: "result", desc: task.desc, result });
});
```

## SQLite implementation

```typescript
// packages/tuple-space/src/index.ts
import Database from "better-sqlite3";

class TupleSpace {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tuples (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,        -- JSON
        tag TEXT,                  -- indexed for pattern matching
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tag ON tuples(tag);
    `);
  }

  out(tuple: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO tuples (data, tag, created_at) VALUES (?, ?, ?)")
      .run(JSON.stringify(tuple), tuple.tag as string, Date.now());
  }

  async rd(pattern: Record<string, unknown>): Promise<Record<string, unknown>> {
    while (true) {
      const row = this.rdp(pattern);
      if (row) return row;
      await sleep(100); // poll interval
    }
  }

  rdp(pattern: Record<string, unknown>): Record<string, unknown> | null {
    // Build SQL query from pattern
    const { where, params } = this.buildQuery(pattern);
    const row = this.db.prepare(`SELECT data FROM tuples ${where} LIMIT 1`).get(...params);
    return row ? JSON.parse(row.data) : null;
  }

  in(pattern: Record<string, unknown>): Record<string, unknown> {
    while (true) {
      const { where, params } = this.buildQuery(pattern);
      // Atomic: delete + return (CAS)
      const row = this.db.prepare(
        `DELETE FROM tuples WHERE id = (
          SELECT id FROM tuples ${where} LIMIT 1
        ) RETURNING data`
      ).get(...params);
      if (row) return JSON.parse(row.data);
      await sleep(100);
    }
  }

  private buildQuery(pattern: Record<string, unknown>): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(pattern)) {
      clauses.push(`json_extract(data, '$.${key}') = ?`);
      params.push(value);
    }
    return { where: `WHERE ${clauses.join(" AND ")}`, params };
  }
}
```

## Coordination example

```
Agent A (coder):
  1. task = space.in({ tag: "task", status: "open" })  // claim task
  2. space.out({ tag: "lock", file: "auth.ts", holder: agentId })
  3. ... work on task ...
  4. space.out({ tag: "result", desc: task.desc, file: "auth.ts" })
  5. space.out({ tag: "task", desc: "review-auth", status: "open" })

Agent B (reviewer):
  1. result = space.rd({ tag: "result", desc: "fix-auth" })  // see result
  2. ... review ...
  3. space.out({ tag: "review", desc: "fix-auth", status: "approved" })

Agent C (memory):
  1. knowledge = space.rd({ tag: "knowledge" })  // share knowledge
  2. space.out({ tag: "knowledge", fact: "user prefers TypeScript" })
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ultimate decoupling (anonymous agents) | ❌ Blocking semantics (rd/in block) |
| ✅ Natural load balancing (first in() wins) | ❌ No ordering guarantees |
| ✅ Async by default (writer/reader decoupled in time) | ❌ Garbage accumulation |
| ✅ Broadcast for free (multiple rd() same tuple) | ❌ Security (any agent reads any tuple) |
| ✅ Simple semantics (6 operations) | ❌ O(n) pattern matching (need indexing) |

## Khác message queue

| | Message Queue | Tuple Space |
|---|---|---|
| Routing | By destination address | By content pattern (associative) |
| Delivery | Push to subscriber | Pull by pattern match |
| Persistence | Until delivered | Until taken (in) |
| Broadcast | Need topic per consumer | Multiple rd() = free broadcast |
| Decoupling | Know topic name | Know NOTHING (pure pattern) |

## Khi nào chọn

- Want ultimate decoupling (agents truly anonymous)
- Want associative coordination (find by content, not address)
- Natural load balancing (competing in() calls)
- OK with polling/blocking semantics
- Want simplest coordination primitive (6 operations)
