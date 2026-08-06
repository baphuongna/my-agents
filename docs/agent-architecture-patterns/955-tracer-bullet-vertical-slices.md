# Hướng AJS: Tracer-Bullet Vertical Slices — `/to-issues` bẻ plan thành vertical slices (tracer bullets) xuyên qua mọi layer, phân loại HITL vs AFK, mỗi slice demoable độc lập

> **Nguồn gốc:** skills (skills/engineering/to-issues/SKILL.md) | **Coupling:** 🟢 — planning convention, gắn qua tool/skill | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có workflow runner + subagent; thiếu slice planner) | **Effort:** 2 tuần

## Nguồn gốc

**skills** (skills/engineering/to-issues/SKILL.md) có **`/to-issues`** — bẻ plan thành **vertical slices (tracer bullets)**: (1) **vertical slice xuyên qua mọi layer** — schema → API → UI → tests — mỗi slice cắt thẳng đứng, không phải theo tầng ngang (không làm hết schema rồi mới làm hết API); (2) **phân loại HITL vs AFK** — human-in-loop (slice cần user quyết định) tách khỏi fully autonomous (slice chạy không cần người); (3) **mỗi slice demoable độc lập** — slice nào cũng chạy được, nhìn thấy kết quả, không cần chờ các slice khác; (4) **quiz user về granularity/dependencies trước khi chốt** — hỏi to/nhỏ, slice nào phụ thuộc slice nào rồi mới chốt danh sách.

Giá trị: (1) **luôn có thứ chạy được** — tracer bullet sớm phát hiện tích hợp lệch (schema không khớp API, API không khớp UI); (2) **user thấy tiến độ thật** — mỗi slice demo được là một milestone; (3) **AFK chạy nền được** — phân loại rõ slice nào cần người, slice nào tự chạy; (4) **giảm context rot** — slice ngắn, đóng gói, không kéo dài qua nhiều session.

## Mô tả

Với mya, pattern = **vertical-slice planning** gắn vào workflow: (1) **slice planner tool** — nhận plan (từ user hoặc spec), bẻ thành slices: mỗi slice = { id, title, layers: [schema, api, ui, tests], hitl: boolean, deps: string[], demo: string }; (2) **HITL/AFK classification** — slice có quyết định chủ quan (tên field, UX flow) → `hitl: true` (cần approval channel — đã có `packages/tools/src/approval.ts`); slice thuần cơ khí → `hitl: false` (chạy autonomous); (3) **dependency graph** — slice.deps cho phép chạy song song (nối `parallel` của workflow runner) hoặc tuần tự; (4) **demo contract** — mỗi slice khai báo cách demo (lệnh chạy + output mong đợi) — verify slice xong bằng chính demo đó; (5) nơi gắn — mya có `packages/workflows` (runner + A1 orchestration `parallel`/`pipeline`) — slice planner sinh ra danh sách task, runner chạy. Đây là pattern **incremental delivery with running software**: giá trị đo bằng slice demo được, không phải % layer hoàn thành.

## Kiến trúc (ASCII)

```
  PLAN (user / spec)
    │
    ▼ /to-issues — SLICE PLANNER
  ├─ cắt VERTICAL SLICES (mỗi slice xuyên schema → API → UI → tests)
  ├─ phân loại HITL vs AFK (cần user quyết định? → hitl)
  ├─ quiz granularity + dependencies (to/nhỏ? slice nào phụ thuộc gì?)
  └─ chốt danh sách slices { id, layers, hitl, deps, demo }
    │
    ▼ RUNNER (workflows runner + subagent)
  ├─ slice hitl=false → AFK: chạy tự động (song song theo deps)
  └─ slice hitl=true  → HITL: dừng chờ approval (approval.ts)
    │
    ▼ DEMO (mỗi slice chạy được độc lập — verify bằng demo contract)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — runWorkflowSource + parallel/pipeline
//   (nền — runner cho slice execution)
// ✅ packages/workflows/src/worker.ts — workflow worker (nền — slice chạy nền)
// ✅ packages/agent/src/subagent.test.ts — spawnSubagent (nền — 1 slice 1 subagent)
// ✅ packages/tools/src/approval.ts — ApprovalChannel (nền — HITL gate)
// ✅ packages/core/src/iteration-budget.ts — IterationBudget (nền — giới hạn slice)

// ❌ THIẾU: slice planner (/to-issues) — bẻ plan → vertical slices
// ❌ THIẾU: HITL/AFK classification field
// ❌ THIẾU: demo contract per slice (lệnh demo + output mong đợi)
// ❌ THIẾU: dependency graph → schedule (song song vs tuần tự)
```

## Implementation

```typescript
// packages/workflows/src/slice-planner.ts (NEW)
export type Layer = "schema" | "api" | "ui" | "tests";

export interface VerticalSlice {
  id: string;
  title: string;
  layers: Layer[];                 // cắt thẳng đứng qua các layer
  hitl: boolean;                   // human-in-loop (cần user quyết định)
  deps: string[];                  // slice ids phải chạy trước
  demo: string;                    // demo contract — lệnh + output mong đợi
}

/** Bẻ plan thành vertical slices — mỗi slice demoable độc lập. */
export function planToSlices(plan: string, tasks: Array<{ title: string; layers: Layer[]; hitl: boolean; deps?: string[]; demo: string }>): VerticalSlice[] {
  return tasks.map((t, i) => ({
    id: `slice-${String(i + 1).padStart(3, "0")}`,
    title: t.title,
    layers: [...t.layers].sort(),  // chuẩn hóa thứ tự layer
    hitl: t.hitl,
    deps: t.deps ?? [],
    demo: t.demo,
  }));
}

/** Phân loại AFK — slice không hitl + không dep treo → chạy autonomous. */
export function isAfkSlice(s: VerticalSlice, all: VerticalSlice[]): boolean {
  if (s.hitl) return false;
  const depsDone = s.deps.every((id) => all.find((x) => x.id === id)?.hitl === false);
  return depsDone;
}

/** Schedule: slice không dep → batch đầu; có dep → đợi dep xong. */
export function scheduleSlices(slices: VerticalSlice[]): VerticalSlice[][] {
  const batches: VerticalSlice[][] = [];
  const done = new Set<string>();
  let remaining = [...slices];
  while (remaining.length > 0) {
    const ready = remaining.filter((s) => s.deps.every((d) => done.has(d)));
    if (ready.length === 0) throw new Error("dependency cycle trong slices");
    batches.push(ready);
    ready.forEach((s) => done.add(s.id));
    remaining = remaining.filter((s) => !done.has(s.id));
  }
  return batches;
}

/** Demo gate — verify slice bằng demo contract (lệnh chạy + output mong đợi). */
export async function demoSlice(s: VerticalSlice, run: (cmd: string) => Promise<string>): Promise<boolean> {
  const out = await run(s.demo);
  return out.trim().length > 0;    // demo contract: chạy được + có output
}
// Nối runner: scheduleSlices → từng batch chạy (hitl → approval, afk → tự động)
// Nối subagent: 1 slice 1 spawnSubagent với context được craft riêng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Luôn có slice chạy được — phát hiện lệch tích hợp sớm | ❌ Chia slice chuẩn cần kinh nghiệm — quiz user giúp |
| ✅ Mỗi slice demoable — tiến độ đo được thật | ❌ Slices nhỏ quá → overhead planning |
| ✅ HITL/AFK tách rõ — AFK chạy nền không chờ người | ❌ HITL slice dừng chờ approval — latency |
| ✅ Dependency graph — chạy song song đúng thứ tự | ❌ Cycle dependency — phải detect (scheduleSlices throw) |

## Khác các hướng gần

| | AJS Vertical Slices | 647 Vertical Slice Incremental | 57 Plan-and-Execute |
|---|---|---|---|
| Trọng tâm | Bẻ plan → slice + HITL/AFK | Giao slice theo thứ tự | Planner riêng, executor riêng |
| Cơ chế | Slice planner + demo contract | Implement→Test→Verify→Commit | 2 thành phần tách |
| Quan hệ | Sinh ra slice cho 647 chạy | Tiêu thụ slice của AJS | Khác mức (planning) |

## Khi nào chọn

- Plan lớn, nhiều layer — muốn luôn có phần chạy được thay vì chờ "làm xong tầng"
- Cần tách việc cần người (HITL) khỏi việc tự chạy (AFK) — tiết kiệm thời gian user
- Muốn mỗi milestone là một demo thật — không phải % code
- Guard: quiz granularity trước, dependency graph chống cycle, demo contract per slice