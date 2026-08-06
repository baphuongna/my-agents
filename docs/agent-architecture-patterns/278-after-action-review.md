# Hướng JR: After-Action Review — rút kinh nghiệm sau task, cập nhật năng lực/correction

> **Nguồn gốc:** US Army "After-Action Review (AAR)"; agile retrospective; "What went well / what didn't / what to improve"; "reflection in LLM agents" (Reflexion — Shinn et al.); Voyager self-improvement; "post-task retrospective"; DH (112) learning from corrections; NASA AAR
> **Coupling:** 🟡 — chèn review step sau task completion
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (self-improving DA sẵn — chưa có formal AAR step)
> **Effort:** 1-2 tuần

## Nguồn gốc

After-Action Review (US Army AAR): sau mỗi hành động, review có cấu trúc — *What was supposed to happen? What actually happened? Why the difference? What to sustain/improve?* Agile retrospective tương tự (start/stop/continue). Reflexion (Shinn et al.): LLM agent sau task viết *verbal reflection* về lỗi → lưu vào memory → task sau dùng được, tăng hiệu suất. Voyager: agent học từ thành công (skill library). NASA AAR: formal debrief bắt buộc sau mission. Đối với agent: sau task (thành công/thất bại) → agent tự review → rút correction (DH 112) / procedure (JP 276) / consolidation (82) → năng lực tăng dần. Khác **DH (112) learning from corrections** (học từ *user sửa*) — JR review *tự đánh giá* sau task; khác **82 CD consolidation** (sắp xếp khi "ngủ") — JR là *event-driven* ngay sau task; khác **119 DO bounded self-correction** (sửa *trong* task) — JR rút kinh nghiệm *sau* để dùng cho task sau.

## Mô tả

mya after-action review: hook sau task-completion → trigger review LLM: so sánh intent vs outcome, liệt kê what-went-well / what-failed / improvement → lưu vào procedural memory (JP 276) / corrections (DH 112) / audit (GP). Không chặn user (chạy background/lightweight). mya có self-improving (DA) và consolidation (82) — JR thêm formal AAR *step* ngay sau mỗi task (không đợi "ngủ").

## Kiến trúc

```
  TASK COMPLETE (success / fail / partial)
        │
        ▼
  AAR STEP (LLM review — lightweight, background)
   · What was the goal?
   · What actually happened? (compare intent vs outcome)
   · Why the gap? (root cause)
   · Sustain / Improve / Stop
        │
        ├──► PROCEDURAL MEMORY (JP 276) — update procedure
        ├──► CORRECTIONS (DH 112) — what to do differently
        ├──► AUDIT (GP 198) — record lesson
        └──► CONSOLIDATION queue (82) — kết tinh sau
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ DA (105) self-improving — tích lũy năng lực (sản nền)
// ✅ DH (112) learning from corrections — học từ sửa (sẵn)
// ✅ 82 CD consolidation — sắp xếp khi "ngủ" (sẵn)
// ✅ GP (198) audit — record (sản)
// ✅ JP (276) procedural memory — update procedure (bổ sung)

// ❌ THIẾU: AAR hook (trigger sau task-complete)
// ❌ THIẾU: structured review prompt (intent vs outcome)
// ❌ THIẾU: route lesson → đúng store (procedural/correction/audit)
```

## Implementation

```typescript
// packages/aar/src/index.ts (NEW)
async function afterActionReview(task: Task, outcome: Outcome): Promise<void> {
  const review = await llm.review({                          // lightweight, background
    goal: task.intent, outcome,
    prompt: AAR_PROMPT,                                      // what-happened/why/improve
  });
  for (const lesson of review.lessons) {
    if (lesson.kind === "procedure") procMem.learn(task.goal, task.trace, outcome.ok); // JP
    if (lesson.kind === "correction") corrections.add(lesson);                          // DH
    audit.append({ type: "aar", task: task.id, lesson });                                // GP
  }
}
// hook: agent.on("task-complete", afterActionReview) — không chặn user
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Học từ mỗi task — năng lực tăng dần (Reflexion) | ❌ Cost — thêm LLM call sau mỗi task |
| ✅ Bắt root cause — sửa hệ thống không lặp lỗi | ❌ Review sai → rút bài học nhầm (cần verify) |
| ✅ Structured — không tùy tiện (Army AAR) | ❌ Latency nếu chặn user (phải background) |
| ✅ Route vào JP/DH/GP — nuôi các store khác | ❌ Lesson trùng — cần dedup/consolidation (82) |

## Khác các hướng gần

| | DH Corrections | 82 Consolidation | 119 DO Self-Correct | JR: AAR |
|---|---|---|---|---|
| Khi nào | Khi user sửa | Khi "ngủ" | Trong task (đang chạy) | **Sau task (xong rồi)** |
| Nguồn | User feedback | Tự sắp xếp | Lỗi giữa chừng | **Tự đánh giá sau** |
| Mục | Hợp ý user | Kết tinh | Sửa kịp | **Rút bài học dùng sau** |

## Khi nào chọn

- Task có giá trị học cao (phức tạp, dễ sai) — AAR đáng
- Muốn agent tự tiến bộ qua mỗi task (Reflexion/DA)
- Có procedural memory (JP) / corrections (DH) để route lesson
- Luôn: chạy background không chặn user; verify lesson trước khi route; dedup trùng
