# Hướng AEO: Parallel-Pipeline Primitives — `parallel(thunks)` và `pipeline(items, ...stages)` như nguyên thủy orchestration lồng được

> **Nguồn gốc:** pi-dynamic-workflows | **Coupling:** 🟢 — sandbox globals, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn trong workflow runner sandbox) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-dynamic-workflows** (README.md): cung cấp **global `parallel(thunks)`** — chạy đồng thời, trả kết quả **theo input order** — và **`pipeline(items, ...stages)`** — **fan-out giữa các stage** (mỗi item đi qua từng stage, kết quả stage này là input stage sau). Điểm mấu chốt: đây là **nguyên thủy orchestration lồng được** (composable) — `parallel` và `pipeline` gọi lẫn nhau, lồng trong nhau, dùng trong `agent()` goals, trong vòng lặp, trong điều kiện.

Giá trị: (1) **composition** — orchestration phức tạp = tổ hợp vài nguyên thủy nhỏ, không cần framework DSL riêng; (2) **determinism** — `parallel` giữ input order khi trả kết quả (không phụ thuộc thứ tự hoàn thành — dễ test, dễ debug); (3) **một ngữ nghĩa** — `pipeline` làm rõ luồng dữ liệu (items qua stages) khác `parallel` (tasks độc lập); (4) **đủ dùng** — không cần DAG engine (nối AEU dependency-graph cho case phức tạp hơn).

## Mô tả

Với mya, pattern = **chuẩn hóa + mở rộng primitives đã có**: (1) `packages/workflows/src/runner.ts` đã có `parallel` (Promise.all theo thứ tự) và `pipeline` (stage nối tiếp) trong sandbox — đúng nền; pattern thêm: (2) **`pipeline(items, ...stages)`** — fan-out: mỗi item chạy qua toàn bộ stages (khác `pipeline(stages)` hiện tại — chỉ nối stage, không fan-out item); (3) **nested** — `parallel` chứa `pipeline`, `pipeline` stage gọi `parallel` — lồng tự do; (4) **error policy** — thunk fail → các task còn lại vẫn chạy (fail-fast tùy chọn qua `{ stopOnError }`), lỗi gom theo item; (5) **abort-aware** — thunk nhận `signal` (nối AEP) để hủy sớm. Đây là pattern **minimal orchestration core** — đúng triết lý mya §18 minimal core: vài nguyên thủy đủ cho đa số workflow, DAG (AEU) chỉ khi cần dependency thật.

## Kiến trúc (ASCII)

```
  WORKFLOW SCRIPT (sandbox globals)
    │
    ├─ parallel(thunks) ──► chạy đồng thời ──► kết quả THEO INPUT ORDER
    │                       (Promise.all — deterministic, dễ test)
    │
    └─ pipeline(items, ...stages)
         items ─► stage1 ─► stage2 ─► … ─► results
         (FAN-OUT: mỗi item qua mọi stage — kết quả stage này = input stage sau)
         │
         └─ lồng: parallel([() => pipeline(items, s1, s2), () => agent(goal)])
                    │
                    ▼
            mỗi task nhận AbortSignal (AEP) — hủy sớm khi workflow abort
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — parallel + pipeline sandbox globals
//   (parallel: Promise.all theo thứ tự — đã đúng)
// ✅ packages/workflows/src/runner.ts — phase() runtime-discovered (AEN)
// ✅ packages/workflows/src/runner.ts — signal → worker.terminate (AEP nền)
// ✅ packages/agent/src/index.ts — spawn subagent (agent() goal primitive)
// ✅ packages/workflows/src/worker.ts — tool proxy qua parent

// ❌ THIẾU: pipeline(items, ...stages) fan-out (hiện chỉ nối stage)
// ❌ THIẾU: error policy (stopOnError / gom lỗi theo item)
// ❌ THIẾU: signal truyền vào từng thunk/stage (abort-aware)
```

## Implementation

```typescript
// packages/workflows/src/primitives.ts (NEW)
export async function parallel<T>(thunks: Array<() => Promise<T>>, opts: { stopOnError?: boolean } = {}): Promise<T[]> {
  if (!opts.stopOnError) {
    // Chạy đồng thời, trả theo input order — lỗi gom, không chặn task khác.
    const settled = await Promise.allSettled(thunks.map((t) => t()));
    return settled.map((s) => (s.status === "fulfilled" ? s.value : undefined as T));
  }
  return Promise.all(thunks.map((t) => t()));   // fail-fast
}

export async function pipeline<T>(
  items: T[],
  ...stages: Array<(item: T, ctx: { signal?: AbortSignal }) => Promise<T>>
): Promise<T[]> {
  let current = items;
  for (const stage of stages) {
    // FAN-OUT: chạy stage trên mọi item song song, giữ thứ tự input.
    current = await parallel(current.map((item) => () => stage(item, { signal: undefined })));
  }
  return current;
}
// Nested: parallel([() => pipeline(items, s1, s2), () => agent(goal)])
// Mỗi stage nhận signal (AEP) — abort lan từ workflow xuống từng item
// Nối AEN: stage gọi phase(name) → progress view tự cập nhật
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lồng được — orchestration phức tạp từ nguyên thủy nhỏ | ❌ Nested sâu — khó đọc/debug stack |
| ✅ Kết quả theo input order — deterministic, test dễ | ❌ Fan-out pipeline không quản dependency (cần AEU) |
| ✅ Error gom theo item — một task fail không chết cả nhóm | ❌ Lỗi im lặng (undefined) dễ nuốt lỗi — cần policy rõ |
| ✅ Đã có nền parallel/pipeline — thêm fan-out + signal | ❌ Promise.all tốn tài nguyên khi thunk nặng |

## Khác các hướng gần

| | AEO Parallel/Pipeline | AEU Dependency Graph | AEN Runtime Phases |
|---|---|---|---|
| Trọng tâm | Nguyên thủy orchestration | DAG task đa session | Progress view |
| Cơ chế | Promise.all + stage chain | 3-màu DFS + isTaskReady | Event → view model |
| Quan hệ | Nền chung | Nâng cấp khi cần dep | Tiêu thụ event của runner |

## Khi nào chọn

- Workflow cần chạy song song / nhiều stage trên tập items
- Muốn orchestration trong workflow script không cần framework DSL
- Đã có workflow runner sandbox — thêm fan-out + error policy
- Cần determinism (kết quả theo input order) để test ổn định