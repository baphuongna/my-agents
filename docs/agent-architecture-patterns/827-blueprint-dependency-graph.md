# Hướng AEU: Blueprint Dependency Graph — plan multi-session bằng DAG task, detectCycles 3-màu DFS, chỉ expose task sẵn sàng

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟡 — đụng orchestration multi-session | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn workflows primitives; thiếu DAG + multi-session scheduling) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-extensions** (src/dependency-graph.ts): **pi-blueprint** quản lý plan nhiều session bằng **DAG task** với: (1) **detectCycles** — thuật toán **3-màu DFS** (trắng/xám/đen — white/gray/black) phát hiện vòng lặp dependency ngay lúc lập plan; (2) **isTaskReady** — task chỉ sẵn sàng khi mọi dependency đã xong (fan-in check); (3) **findBlockedTasks** — tìm task bị chặn (dependency fail / không bao giờ ready) để báo; (4) điều phối **multi-session theo dependency** — session (subagent) chỉ được spawn khi task của nó ready.

Giá trị: (1) **an toàn** — cycle phát hiện lúc lập plan, không deadlock lúc chạy; (2) **song song tối đa** — task không dependency chạy đồng thời (nối AEO); (3) **minh bạch** — blocked tasks lộ rõ lý do. Khác AEO: AEO là primitives *runtime*, AEU là *structure* (DAG) — DAG quyết định *cái gì chạy khi nào*, primitives thực thi *cách chạy*.

## Mô tả

Với mya, pattern = **DAG task layer trên orchestration hiện có**: (1) **TaskGraph** — `{ id, deps, run }`; (2) **detectCycles** — 3-màu DFS (gặp lại node xám trong stack → cycle); (3) **scheduler** — `ready = filter(isTaskReady)` → chạy qua `parallel` (AEO) → cập nhật → lặp; (4) **blocked detection** — `findBlockedTasks` → fail-loud (RRRR/CCC) thay vì treo; (5) **session mapping** — mỗi task = subagent spawn, abort khi cancel (AEP). mya đã có `packages/workflows` runner (agent/parallel/pipeline/phase) — thêm tầng DAG ở *trên* runner. Đây là pattern **structure over convention**: dependency khai báo tường minh.

## Kiến trúc (ASCII)

```
  PLAN (multi-session) — task + deps
  ┌─ t1 ─┐
  ├─ t2 ─┼─► t4 ─► t6
  ├─ t3 ─┘      │
  └─ t5 ────────┘
    ▼ DETECT CYCLES (3-màu DFS) — gặp node XÁM ──► CYCLE (báo ngay lúc plan)
    ▼ SCHEDULER LOOP
  ├─ ready = isTaskReady (mọi dep completed) → parallel(AEO) chạy
  ├─ task xong → cập nhật → ready mới
  └─ findBlockedTasks (dep fail / cycle sót) → fail-loud (RRRR/CCC)
    ▼ mỗi task = 1 subagent session (spawn — abort qua AEP)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — agent/parallel/pipeline/phase (AEO — nền thực thi)
// ✅ packages/agent/src/index.ts — spawn subagent + lifecycle (mỗi task = 1 session)
// ✅ packages/workflows/src/runner.ts — signal → terminate (AEP abort nền)
// ✅ packages/cron/src/scan.ts — lập lịch (pattern chạy định kỳ)
// ✅ packages/core/src/types.ts — ToolHookSink (hook điểm nối)

// ❌ THIẾU: TaskGraph model + detectCycles (3-màu DFS)
// ❌ THIẾU: isTaskReady/findBlockedTasks + scheduler loop
// ❌ THIẾU: map task → subagent spawn + abort (AEP)
```

## Implementation

```typescript
// packages/workflows/src/dependency-graph.ts (NEW)
export interface Task<R = unknown> {
  id: string;
  deps: string[];
  run: (ctx: { signal?: AbortSignal }) => Promise<R>;
}

type Color = "white" | "gray" | "black";   // 3-màu DFS
/** Detect cycle — 3-màu DFS: gặp lại node xám (đang trong stack) = cycle. */
export function detectCycles(tasks: Task[]): string[] | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const color = new Map<string, Color>();
  for (const t of tasks) color.set(t.id, "white");

  const visit = (id: string, stack: string[]): string[] | null => {
    const c = color.get(id)!;
    if (c === "gray") return [...stack.slice(stack.indexOf(id)), id];  // cycle!
    if (c === "black") return null;
    color.set(id, "gray");
    for (const dep of byId.get(id)?.deps ?? []) {
      const cyc = visit(dep, [...stack, id]);
      if (cyc) return cyc;
    }
    color.set(id, "black");
    return null;
  };

  for (const t of tasks) {
    const cyc = visit(t.id, []);
    if (cyc) return cyc;
  }
  return null;
}

export function isTaskReady(t: Task, completed: Set<string>): boolean {
  return t.deps.every((d) => completed.has(d));
}

export function findBlockedTasks(tasks: Task[], completed: Set<string>): string[] {
  return tasks.filter((t) => !completed.has(t.id) && !isTaskReady(t, completed)).map((t) => t.id);
}

/** Scheduler: mỗi vòng chạy ready-set song song (AEO parallel). */
export async function runGraph<R>(
  tasks: Task<R>[],
  run: (t: Task<R>) => Promise<R>,
  opts: { signal?: AbortSignal } = {},
): Promise<Map<string, R>> {
  const completed = new Set<string>();
  const results = new Map<string, R>();
  while (completed.size < tasks.length) {
    const ready = tasks.filter((t) => !completed.has(t.id) && isTaskReady(t, completed));
    if (ready.length === 0) throw new Error(`blocked: ${findBlockedTasks(tasks, completed)}`);
    await Promise.all(ready.map(async (t) => {
      results.set(t.id, await run(t));       // run = spawn subagent (AEP abort-aware)
      completed.add(t.id);
    }));
  }
  return results;
}
// Lập plan: detectCycles trước → cycle → báo ngay; chạy: runGraph (blocked → fail-loud)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cycle bị bắt lúc plan — không deadlock lúc chạy | ❌ DAG khai báo thủ công — workflow đơn giản thì thừa |
| ✅ Song song tối đa theo ready-set (nối AEO) | ❌ Task fail → cả nhánh phụ thuộc blocked (cần policy) |
| ✅ Blocked tasks lộ rõ — fail-loud thay vì treo | ❌ 3-màu DFS O(V+E) nhỏ nhưng cần test cycle cases |

## Khác các hướng gần

| | AEU Dependency Graph | AEO Parallel/Pipeline | AEP Workflow Abort |
|---|---|---|---|
| Trọng tâm | Cấu trúc plan (DAG) | Nguyên thủy runtime | Hủy workflow |
| Cơ chế | 3-màu DFS + ready-set | Promise.all + stage chain | AbortSignal lan |
| Quan hệ | Chỉ đạo AEO (cái gì chạy) | Thực thi AEU (cách chạy) | Hủy giữa chừng (AEP) |
## Khi nào chọn

- Plan nhiều session/task có dependency thật (không phải pipeline tuyến tính)
- Cần chắc chắn không cycle — chạy dài, không thể deadlock
- Đã có AEO primitives + subagent spawn — thêm tầng DAG
- Muốn song song tối đa + blocked tasks minh bạch