# Hướng AX: Knowledge Compilation — nén lặp lại thành skill thủ tục

> **Nguồn gốc:** Soar chunking (Laird/Rosenbloom/Newell, 1986); ACT-R production compilation; PRAXIS (arXiv:2511.22074)
> **Coupling:** 🟢 — skill là artifact tĩnh, agents đọc khi cần
> **Agent-agnostic:** ✅ — bất kỳ agent đọc skill
> **Code sẵn:** ⚠️ (1 phần — packages/skills là nơi chứa; thiếu compilation loop)
> **Effort:** 1-2 tuần

## Nguồn gốc

Soar **chunking** (1986): sau khi giải một subgoal bằng nhiều bước suy luận, Soar nén toàn bộ thành 1 "chunk" — điều kiện → kết quả ngay. ACT-R gọi là production compilation. Ý tưởng chung: **amortize chi phí suy luận** — lần đầu tốn N bước, lần sau 1 bước. PRAXIS (2025) hiện đại hóa cho LLM agents: lưu state-action-result exemplars, truy hồi theo state → tái dùng hành vi đã học. Voyager dùng dạng NL (skill library tăng dần). mya đã có `packages/skills` — thiếu vòng nén tự động.

## Mô tả

Theo dõi tần suất: task dạng X lặp lại ≥ N lần với cùng chuỗi hành động → **compile** thành skill thủ tục (SKILL.md + script) mô tả "khi gặp X: làm A → B → C". Lần sau router (RR) hoặc agent đọc skill → bỏ qua deliberation. Compilation cần *human-in-the-loop nhẹ* (chỉ promote khi đạt ngưỡng + test qua). Khác Cache (NN — kết quả *cụ thể*): compilation là **tri thức thủ tục *tổng quát* hóa** từ nhiều lần.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│              COMPILATION LOOP (mya)                        │
│                                                            │
│  event ledger (K) ──► ┌───────────────┐                    │
│  task: type + actions │ frequency     │                    │
│                       │ counter       │                    │
│                       └───────┬───────┘                    │
│                               │ ≥ N lần + mẫu chuỗi ổn định│
│                               ▼                            │
│                     ┌───────────────────┐                  │
│                     │ COMPILE (draft)   │                  │
│                     │ SKILL.md + script │                  │
│                     └───────┬───────────┘                  │
│                             ▼                              │
│              ┌─────────────────────────┐                   │
│              │ VERIFY (PP eval)        │                   │
│              │ chạy golden scenario    │                   │
│              │ + human approve nhẹ     │                   │
│              └───────┬─────────────────┘                   │
│                      ▼                                     │
│              packages/skills ──► agent đọc khi gặp task X   │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — nơi chứa skill (SKILL.md + assets)
// ✅ packages/tools/src/kanban-sqlite.ts — task type có thể đếm tần suất
// ✅ packages/eval — ParityHarness (verify skill trước khi promote)
// ✅ packages/intercom/src/skills/pi-intercom/SKILL.md — ví dụ skill thủ tục

// ❌ THIẾU: frequency counter + chuỗi-action extractor + promote pipeline.
//    Skills hiện viết tay; chưa có vòng nén tự động từ lịch sử.
```

## Implementation

```typescript
// packages/skills/src/compiler.ts (NEW)
class SkillCompiler {
  private freq = new Map<string, { count: number; pattern: string[] }>();

  /** Gọi sau mỗi task xong — đếm theo task type. */
  observe(taskType: string, actions: string[]): void {
    const e = this.freq.get(taskType) ?? { count: 0, pattern: [] };
    e.count++;
    if (e.pattern.length === 0) e.pattern = actions;   // mẫu đầu tiên
    this.freq.set(taskType, e);
  }

  async compile(): Promise<void> {
    for (const [type, e] of this.freq) {
      if (e.count >= PROMOTE_THRESHOLD && stablePattern(e.pattern)) {
        const skill = draftSkill(type, e.pattern);      // SKILL.md từ chuỗi
        const passed = await harness.gradeAgainst(skill);  // PP: golden test
        if (passed.ok) {
          await writeSkill(type, skill);               // → packages/skills
          log(`[compile] ${type} → skill (${e.count} lần)`);
        }
      }
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task lặp lại sau này rẻ + nhanh (1 bước) | ❌ Skill compile sai → lặp sai nhiều lần |
| ✅ Tri thức tích lũy theo dự án (institutional) | ❌ Chuỗi action trích xuất khó tự động |
| ✅ Kết hợp PP eval + human approve | ❌ Skill phình → cần governance (tier) |
| ✅ packages/skills sẵn nơi chứa | |
| ✅ Giảm cost (đúng trọng tâm mya) | |

## Khi nào chọn

- Có task lặp lại rõ ràng (fix lint, build, migrate...)
- Muốn hệ thống "học" theo thời gian thay vì viết skill tay
- Đã có skills + eval harness
- Kết hợp XX: bài học từ impasse cũng thành skill
