# Hướng FFF: Plan-and-Execute — planner riêng, executor riêng

> **Nguồn gốc:** Wang et al., 2023 (Plan-and-Solve; arXiv 2305.04091); LangChain Plan-and-Execute
> **Coupling:** 🟢 — planner ↔ executor qua task list (kanban)
> **Agent-agnostic:** ✅ — executor có thể là bất kỳ agent/tool
> **Code sẵn:** ⚠️ (1 phần — kanban + subagent-spawn sẵn; thiếu planner role + re-plan loop)
> **Effort:** 1-2 tuần

## Nguồn gốc

Plan-and-Execute: tách **planning** khỏi **execution**. Planner (thường prompt riêng / model tier cao) nhận goal → xuất **task list có thứ tự + phụ thuộc** → executor (model tier thấp/tool) chạy từng task → sau mỗi bước kiểm tra kết quả → nếu lệch so với kế hoạch thì **re-plan** (planner gọi lại). Paper Plan-and-Solve chỉ ra prompt dài "Let's think step by step" kém hiệu quả với bài phức tạp; thay bằng bản kế hoạch rõ ràng + kiểm tra. Khác Y Query Planner (database optimization) và XX Impasse-Subgoal (chỉ sinh subgoal *khi kẹt*) — P&E sinh kế hoạch **chủ động từ đầu** và re-plan có kỷ luật.

## Mô tả

mya nhận goal lớn ("thêm feature X") → **planner** (tier big qua RR) phân rã thành các task có order + dependency → ghi vào **kanban-sqlite (I)** → **executor agent** (subagent-spawn theo role) nhặt từng task làm → sau mỗi task: reconcile (DD kiểu K8s) giữa kết quả thực vs kế hoạch → nếu sai/lệch → **re-plan** (planner chạy lại với state mới) → kanban cập nhật. Kết hợp FF Saga khi 1 task fail phải rollback chuỗi.

## Kiến trúc

```
  goal ──► PLANNER (tier big) ──► task list (order + dep)
                                      │ kanban-sqlite (I)
                                      ▼
                          ┌──── EXECUTOR (subagent theo role) ────┐
         re-plan ◄─ state mới ── RECONCILE (kết quả vs kế hoạch)  │
         (planner gọi lại)        │ đúng ──► task kế tiếp          │
                                  │ lệch ──► re-plan               │
                                  └────────────────────────────────┘
  hết task ──► verify tổng (PP eval) ──► done
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools/src/kanban-sqlite.ts — task list có order/owner/stage (I)
// ✅ packages/print/src/role-subagent-spawn.ts — executor theo role (XX)
// ✅ packages/ai/src/model-routing.ts — tier small/medium/big (planner=big, exec=small)
// ✅ cron reconcile (DD) — sẵn cơ chế đối chiếu trạng thái

// ❌ THIẾU: planner agent/role riêng (hiện agent tự vừa plan vừa làm)
// ❌ THIẾU: vòng re-plan tự động khi executor lệch kế hoạch
// ❌ THIẾU: chuẩn hoá task list format (goal → kanban cards)
```

## Implementation

```typescript
// packages/print/src/planner.ts (NEW)
interface Plan {
  tasks: Array<{ id: string; desc: string; dependsOn: string[] }>;
}

async function planExecute(goal: string): Promise<Result> {
  const plan = await plannerModel(goal);          // tier big (RR)
  const ids = await kanban.createMany(plan.tasks); // packages/tools/kanban-sqlite

  while (true) {
    const next = await kanban.nextReady(ids);      // task dep đã fulfilled
    if (!next) break;
    const out = await runExecutor(next, plan);     // role-subagent-spawn
    const ok = await reconcile(next, out, plan);   // kết quả vs kế hoạch
    if (!ok) {
      const replan = await plannerModel(goal, currentState, next, out); // re-plan
      await kanban.revise(ids, replan.tasks);      // cập nhật task list
      continue;
    }
    await kanban.complete(next.id);                // I: sang stage done
  }
  return verifyTotal(goal);                        // PP eval
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Planner dùng tier big (chất lượng cao nhất), exec dùng tier nhỏ → tiết kiệm | ❌ Re-plan kém → kế hoạch sai lan truyền |
| ✅ Task list minh bạch, audit được (kanban) | ❌ Chi phí planner mỗi lần re-plan |
| ✅ Re-plan tự sửa khi thực tế lệch kế hoạch | ❌ Task phụ thuộc phức tạp phá vỡ thứ tự đơn giản |
| ✅ Executor đơn giản = dễ test, dễ thay | ❌ Goal mở (không đo được) khó reconcile |
| ✅ Kanban + spawn sẵn, chỉ thêm planner | |

## Khác các hướng gần

| | Y Query Planner | XX Impasse-Subgoal | FFF: Plan-and-Execute |
|---|---|---|---|
| Bản chất | Tối ưu query DB | Sinh subgoal khi *kẹt* | Phân rã goal *chủ động* |
| Thời điểm | Trước 1 query | Phát sinh khi impasse | Đầu task + re-plan có kỷ luật |
| Re-plan | Không | Có (khi lại kẹt) | Có (sau mỗi reconcile fail) |
| Vai trò | Planner 1 lần | Agent tự sinh | Planner riêng + executor riêng |

## Khi nào chọn

- Goal lớn, nhiều bước, có thể chết khi làm từ đầu → cuối
- Đã có kanban + subagent-spawn + tier routing
- Muốn thử nghiệm với executor model rẻ (tier small) mà giữ planner xịn
- Task có dependency rõ ràng, đo được