# Hướng PJ: Workflow Call-Index Journaling — journal theo runId:callIndex, replay prefix, edit chạy live

> **Nguồn gốc:** pi-dynamic-workflows (workflow.ts — JournalEntry, runId:callIndex namespacing, resume prefix, firstMiss); "deterministic journal replay"; "longest-unchanged-prefix resume"; "workflow edit-then-resume"; "call-index deterministic ordering"
> **Coupling:** 🟡 — thêm journal+resume vào workflow orchestrator (workflow runtime phải deterministic — nối PK)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (workflow.ts journal + resume + firstMiss sẵn — chưa port vào mya agent workflow)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**pi-dynamic-workflows** (`workflow.ts`) journal mỗi `agent()` call theo **`${runId}:${callIndex}`** — callIndex là thứ tự deterministic (0, 1, 2, …). Khi resume: replay journal prefix — các call **unchanged** (cùng callIndex + cùng input) → dùng cached result; call đầu tiên **changed/new** (`firstMiss`) trở đi → chạy live. Nguyên tắc **longest-unchanged-prefix**: cached result chỉ replay khi `callIndex < firstMiss` — một khi miss, nó và mọi thứ sau chạy live. `runId` namespacing: nested workflow (`${runId}-nested1`) có callIndex riêng (restart từ 0) → không collide với parent's callIndex-0. Per-agent **write delta** (keys set bởi agent) cho additive replay. Khi user **edit workflow script** rồi resume: unchanged calls replay cache, chỉ edited/new calls chạy lại — tiết kiệm cost/time. Khác **94 trajectory-replay** (replay toàn bộ trajectory) — PJ là **prefix replay** (chỉ unchanged prefix); khác **427 PK determinism** (sandbox determinism) — PJ là **journaling/replay**.

## Mô tả

mya workflow call-index journaling: workflow chạy → mỗi `agent()` call được **journal** theo `runId:callIndex` (deterministic order). Khi user edit workflow + resume: (1) **Replay prefix**: calls từ index 0 → `firstMiss-1` (unchanged) → dùng cached result (không chạy LLM). (2) **Live from firstMiss**: call `firstMiss` trở đi (changed/new) → chạy live (LLM). (3) **Delta merge**: per-agent write delta (keys agent set) → additive replay (merge vào shared store). (4) **Namespacing**: nested workflow có `${runId}-nested1` → callIndex riêng, không collide. Kết quả: **edit-then-resume** — sửa 1 call cuối → chỉ call đó chạy lại, N-1 calls đầu replay cache. mya có workflow runtime — PJ thêm **journal persistence** + **prefix replay resume**.

## Kiến trúc

```
  WORKFLOW RUN 1 (original script):
  runId: "run-abc"
  ┌─────────────────────────────────────────────────┐
  │ callIndex 0: agent("analyze")     → cached [0]  │ ✅ journal
  │ callIndex 1: agent("plan")        → cached [1]  │ ✅ journal
  │ callIndex 2: agent("implement")   → cached [2]  │ ✅ journal
  │ callIndex 3: agent("test")        → cached [3]  │ ✅ journal
  └─────────────────────────────────────────────────┘

  USER EDITS SCRIPT (change callIndex 2):
  "change implement() to implementV2()"

  WORKFLOW RUN 2 (resume from run-abc):
  ┌─────────────────────────────────────────────────┐
  │ callIndex 0: agent("analyze")                    │
  │   → unchanged → REPLAY cached [0] ✅ (no LLM)    │
  │ callIndex 1: agent("plan")                       │
  │   → unchanged → REPLAY cached [1] ✅ (no LLM)    │
  │ callIndex 2: agent("implementV2")  ← CHANGED     │
  │   → firstMiss → RUN LIVE 🔴 (LLM call)           │
  │ callIndex 3: agent("test")                       │
  │   → after firstMiss → RUN LIVE 🔴 (LLM call)     │
  └─────────────────────────────────────────────────┘
  Result: 2 replayed (free) + 2 live = save 50% cost

  NESTED WORKFLOW NAMESPACING:
  parent runId: "run-abc"
    └─ nested: "run-abc-nested1"
       callIndex 0: agent("sub")  ← keyed as "run-abc-nested1:0"
       (never collides with parent's "run-abc:0")
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ workflow runtime (packages/agent) — workflow execution (nền — PJ = journal+resume)
// ✅ 94 trajectory-replay — replay trajectory (nền — PJ = prefix replay)
// ✅ pi-dynamic-workflows workflow.ts journal (source/ — reference impl)

// ❌ THIẾU: journal persistence (runId:callIndex → cached result store)
// ❌ THIẾU: prefix replay (unchanged calls → cached; firstMiss → live)
// ❌ THIẾU: firstMiss detection (compare callIndex + input hash)
// ❌ THIẾU: nested runId namespacing (avoid callIndex collision)
// ❌ THIẾU: per-agent write delta (additive replay)
```

## Implementation

```typescript
// packages/agent/src/workflow-journal.ts (MỚI — port từ pi-dynamic-workflows workflow.ts)
interface JournalEntry {
  runId: string;
  callIndex: number;          // deterministic call order (0, 1, 2, ...)
  agentName: string;
  inputHash: string;          // hash of agent input (for change detection)
  result: unknown;            // cached agent result
  writeDelta?: Record<string, unknown>; // keys this agent set in shared store
}

class WorkflowJournal {
  private entries = new Map<string, JournalEntry>(); // key: `${runId}:${callIndex}`

  // Record an agent call result
  record(runId: string, callIndex: number, entry: Omit<JournalEntry, 'runId' | 'callIndex'>): void {
    this.entries.set(`${runId}:${callIndex}`, { runId, callIndex, ...entry });
  }

  // Lookup cached result for a call
  lookup(runId: string, callIndex: number): JournalEntry | undefined {
    return this.entries.get(`${runId}:${callIndex}`);
  }

  // Resume: find firstMiss (first changed/new call)
  findFirstMiss(runId: string, newCalls: Array<{ callIndex: number; inputHash: string }>): number {
    for (const call of newCalls) {
      const cached = this.lookup(runId, call.callIndex);
      if (!cached || cached.inputHash !== call.inputHash) {
        return call.callIndex; // first miss (changed or new)
      }
    }
    return newCalls.length; // all unchanged — full replay
  }
}

// Resume logic: replay prefix, run live from firstMiss
async function resumeWorkflow(
  runId: string,
  calls: Array<{ callIndex: number; agentName: string; input: unknown; run: () => Promise<unknown> }>,
  journal: WorkflowJournal,
): Promise<unknown[]> {
  const firstMiss = journal.findFirstMiss(runId,
    calls.map((c) => ({ callIndex: c.callIndex, inputHash: hash(c.input) })));

  const results: unknown[] = [];
  for (const call of calls) {
    if (call.callIndex < firstMiss) {
      // REPLAY: unchanged call → use cached result (no LLM)
      const cached = journal.lookup(runId, call.callIndex)!;
      results.push(cached.result);
    } else {
      // LIVE: changed/new call → run agent (LLM call)
      const result = await call.run();
      journal.record(runId, call.callIndex, {
        agentName: call.agentName,
        inputHash: hash(call.input),
        result,
      });
      results.push(result);
    }
  }
  return results;
}

// Namespacing for nested workflows
function nestedRunId(parentRunId: string, depth: number): string {
  return `${parentRunId}-nested${depth}`;
}
// nested callIndex restarts from 0 — never collides with parent's callIndex
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Edit-then-resume (sửa 1 call → chỉ nó chạy lại, N-1 replay) | ❌ Determinism required (non-deterministic call → cache miss luôn — nối PK) |
| ✅ Cost saving (unchanged calls = free, không LLM) | ❌ Journal storage (mỗi call → entry persisted) |
| ✅ Deterministic replay (cùng input → cùng output → cache valid) | ❌ Input hash fragility (input thay đổi nhẹ → miss dù semantically same) |
| ✅ Nested namespacing (callIndex không collide) | ❌ FirstMiss cascade (1 change → mọi thứ sau live, không replay) |

## Khác các hướng gần

| | 94 Trajectory-Replay | 427 PK Determinism-Realm | PJ: Call-Index-Journaling |
|---|---|---|---|
| Cái gì | Replay toàn bộ | Sandbox deterministic | **Journal + prefix replay** |
| Replay scope | All | N/A | **Unchanged prefix only** |
| Edit-resume | ❌ | N/A | ✅ edit → chỉ changed chạy |
| Namespacing | ❌ | N/A | ✅ runId:nested callIndex |

## Khi nào chọn

- Workflow có nhiều agent calls (muốn edit-then-resume — tiết kiệm cost)
- Workflow deterministic (cùng input → cùng output — cache valid, BẮT BUỘC nối PK)
- Muốn replay unchanged prefix (không chạy lại N-1 calls)
- Nối 427 PK orchestrator-determinism (PJ REQUIRES determinism — non-deterministic call = cache miss luôn) + 94 trajectory-replay (PJ = partial replay, 94 = full replay); guard input hash fragility (input thay đổi nhẹ → false miss)
