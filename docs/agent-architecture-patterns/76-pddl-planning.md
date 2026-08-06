# Hướng BX: PDDL Classical Planning — formal planner thay lời nói tự do

> **Nguồn gốc:** PDDL (McDermott 1998); LLM+P (2023); "Classical Planning with LLM-Generated Heuristics" (NeurIPS 2025)
> **Coupling:** 🟢 Protocol — domain planner ↔ task store
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (build mới — LLM→PDDL + solver)
> **Effort:** 2-3 tuần

## Nguồn gốc

PDDL (Planning Domain Definition Language) — chuẩn **classical planning**: domain = predicates + actions (preconditions/effects), problem = initial state + goal. **Solver** (Fast Downward, Metric-FF...) chứng minh: plan tồn tại hay **provably không tồn tại** (formal guarantee — Tanaka: "plans are either correct or provably nonexistent"). Thế hệ LLM: **LLM+P** (2023) — để LLM dịch bài toán tự nhiên → PDDL, chạy solver, ánh xạ plan về; "Classical Planning with LLM-Generated Heuristics" (NeurIPS 2025) — LLM sinh heuristics cho solver; NL-PDDL (2024) mở rộng open-world. Khác **LLL HTN** (method library thủ công, decompose task) — PDDL là **state-space search** với solver + tính đúng được chứng minh; khác **FFF** (LLM tự do, không đảm bảo) — PDDL có **đảm bảo formal**.

## Mô tả

mya dùng cho task có **cấu trúc trạng thái rõ** (build pipeline, deploy quy trình, task scheduling đa ràng buộc): LLM dịch task → **PDDL domain + problem** (đúng format — LLM giỏi viết PDDL) → solver chạy (nhanh, deterministic) → plan = chuỗi hành động → ánh xạ về tool call (mỗi action = 1 tool). Goal không đạt được → **solver trả "unsolvable"** (bằng chứng formal — tránh LLM chạy mù). Kết hợp: OO (action = tool có quyền), SSS (LLM→PDDL chỉ 1 lần dịch, phần còn lại rẻ), PP (verify plan). Hạn chế: state rời rạc, miền phải diễn tả được bằng predicates — task LLM mở (viết code) không hợp.

## Kiến trúc

```
  task (ngôn ngữ tự nhiên) ──► LLM dịch ──► PDDL (domain + problem)
                                            │
                                            ▼
                                    SOLVER (Fast Downward...)
                                            │
                            ┌─── plan tồn tại ───► actions ──► tool call (OO)
                            └─── UNSOLVABLE (formal) ──► báo người (không chạy mù)
                                            ▲
                        LLM có thể sửa model nếu sai (reformulate)
```

```
mya: OO (tool = action) + PP (verify plan) — nối được
     thiếu: PDDL writer (LLM) + solver + mapping action→tool
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools — action = tool call (mapping sẵn)
// ✅ OO roles — precondition (tool được gọi khi có quyền — khớp action)
// ✅ SS budget — chặn solver/LLM reformulate lố
// ✅ PP eval — verify plan sau khi thi hành

// ❌ THIẾU: PDDL writer (LLM dịch task → domain/problem đúng format)
// ❌ THIẾU: solver (Fast Downward-class) + unsolvable detection
// ❌ THIẾU: mapping action → tool + reformulate khi model sai
```

## Implementation

```typescript
// packages/planner/src/pddl.ts (NEW)
interface PddlDomain { predicates: string[]; actions: Action[] }
interface PddlProblem { objects: string[]; init: string[]; goal: string[] }

async function planPddl(task: string): Promise<Plan | "unsolvable"> {
  const { domain, problem } = await llmToPddl(task);       // LLM dịch (SS: 1 lần)
  const plan = await solvePddl(domain, problem);           // solver deterministic
  if (plan.kind === "unsolvable") {
    const fixed = await llmFixModel(task, solverFeedback); // reformulate
    return fixed ? await planPddl(fixed) : "unsolvable";   // vẫn fail → báo thật
  }
  return mapPlanToTools(plan.actions);                     // action → OO tool call
}

// ƯU ĐIỂM CỐT LÕI: solver trả unsolvable = goal thật không đạt được
// (formal) — không như LLM tự cho rằng "làm được" rồi chạy mù
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ **Đảm bảo formal**: plan đúng hoặc provably không có | ❌ Miền phải diễn tả bằng predicates (state rời rạc) |
| ✅ Tránh LLM run mù khi goal không đạt | ❌ Task mở (viết code) không phù hợp |
| ✅ Phần lớn rẻ: chỉ LLM dịch, solver deterministic | ❌ LLM dịch sai PDDL → plan sai logic |
| ✅ Kết hợp OO (action→tool) + PP (verify) | ❌ Re-model (reformulate) thêm vòng LLM |
| ✅ NeurIPS 2025: LLM heuristics tăng tốc solver | |

## Khác các hướng gần

| | FFF Plan-and-Execute | LLL HTN | YYY: PDDL |
|---|---|---|---|
| Đảm bảo | Không (LLM) | Không | **Formal (solver)** |
| Cơ chế | LLM tự do | Method library | **State-space + predicates** |
| Fail | Re-plan | Backtrack | **Chứng minh unsolvable** |
| Phù hợp | Task mở | Task quy trình | Task có cấu trúc trạng thái |

## Khi nào chọn

- Task có trạng thái + hành động + ràng buộc rõ (scheduling, pipeline, deploy)
- Cần chứng minh goal không đạt được (tránh chạy mù)
- Muốn deterministic plan + verify (PP)
- Sẵn sàng duy trì PDDL domain cho miền đã biết