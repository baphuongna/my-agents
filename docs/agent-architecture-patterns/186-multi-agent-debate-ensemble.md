# Hướng GD: Multi-Agent Debate & Ensemble — nhiều LLM tranh luận/trung bình để chính xác hơn

> **Nguồn gốc:** "Wisdom of the Silicon Crowd" (Schoenegger 2024, Science Adv — LLM ensemble rival human crowd; 146 cites); NeurIPS 2024 "Multi-LLM Debate: Framework, Principles, Interventions" (theoretical — Bayesian inference); "Multi-Agent Debate for LLM Judges" (Hu — 25 cites — iterate + refine qua structured discussion); ACM "The Cost of Consensus" (đặt câu hỏi — self-correction có thể tốt hơn debate)
> **Coupling:** 🟡 — nhiều LLM gọi am song song + aggregate
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (multi-model + consensus sẵn; thiếu debate/ensemble)
> **Effort:** 2-4 tuần

## Nguồn gốc

Ensemble/debate: **hỏi nhiều LLM khác nhau (hoặc cùng LLM nhiều prompt) rồi gộp — không tin 1 cái — "wisdom of the crowd" cho silicon** — Schoenegger (Sci Adv 2024): "LLM predictions can rival the human crowd's forecasting accuracy through simple aggregation"; NeurIPS 2024: "multi-LLM debate ... draws on connections from in-context learning and Bayesian inference" (lý thuyết — tranh luận gộp xác suất); Hu: "multiple LLMs iteratively refine their judgments through structured discussion" (judge tốt hơn qua debate); ACM 2025: "The Cost of Consensus" — cảnh báo: isolated self-correction thậm chí tốt hơn multi-agent debate (cần đo, không mặc định). Điểm khác **EEEEEE consensus** (agent quyết định chung — agreement cho hành động) và **AAAAAA arena** (so đối kháng) — EEEEEEEE *tăng chất lượng suy luận*: (1) sample — sinh N câu trả lời (N model khác nhau — multi-model, hoặc cùng model N lần); (2) aggregate — gộp: voting đa số (simple aggregation — Schoenegger), median (dự đoán số liệu), self-consistency (majority over rationales); (3) debate — các LLM xem bài nhau rồi sửa (Hu — iterate + refine), judge cuối (EEE judge?); (4) cost guard — N× cost (chọn N nhỏ khi đơn giản — LLLLLLL budget; GGGG budget; đợi cost cao); (5) measure — so tự sửa vs debate (ACM — "cost of consensus" — thử nghiệm thực tế để quyết), (6) dùng — task mờ, quyết định đắt, judge chất lượng. Nối EEEEEE (nền consensus — quyết nhóm), AAAAAA (nền so sánh), 178 (routing model), LLLLLLL (cost N×), GGGG (budget), WWWWWW (intent — topic rõ để debate đúng).

## Kiến trúc

```
  TASK khó/mờ
        │
        ▼
  N MẪU (multi-model 178 — hoặc cùng model nhiều seed)
        │
        ├── AGGREGATE (Schoenegger simple aggregation / self-consistency)
        ├── DEBATE (Hu structure discussion — LLMs sửa nhau, judge cuối)
        └── SELF-CORRECT (đối chứng — ACM cost of consensus)
        │
        ▼
  GỘP: voting/median/confidence-weight (Bayesian — NeurIPS)
        │
        ▼
  COST GUARD (LLLLLLL — N× cost · GGGG budget · giảm N khi đơn giản)
```

```
mya: multi-model + EEEEEE SẴN — thiếu: ensemble/debate runner
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ multi-model — nhiều provider/model (nền ensemble)
// ✅ EEEEEE consensus — quyết định nhóm (nền gộp)
// ✅ GGGG budget + LLLLLLL cost — quản N× cost
// ✅ AAAAAA arena — so sánh (nền thí nghiệm)
// ✅ PP eval — đo ensemble vs single (quyết có đáng)
// ✅ WWWWWW intent — topic rõ (debate đúng)

// ❌ THIẾU: ensemble runner (N sample + aggregate)
// ❌ THIẾU: debate loop (LLMs sửa nhau — Hu)
// ❌ THIẾU: adaptive N (đơn giản N=1 · khó N lớn)
```

## Implementation

```typescript
// packages/ensemble/src/debate.ts (NEW)
export class Ensemble {
  async answer(q: Question): Promise<Answer> {
    const n = adaptN(q);                          // đơn giản N=1, khó N lớn
    const samples = await parallel(models(), n);  // 178 — N model khác nhau
    if (n === 1) return samples[0];
    const refined = await debateRound(samples);   // Hu — iterate refine
    return aggregate(refined);                    // voting/median (Schoenegger)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chính xác hơn — rival human crowd forecasting (Schoenegger) | ❌ N× cost — token gấp nhiều lần |
| ✅ Deb rag — judge chất lượng hơn qua thảo luận (Hu) | ❐ ACM: consensus không luôn thắng — phải đo |
| ✅ Giảm bias 1 model/prompt | ❌ Latency cao (nhiều call song song nhưng vẫn chậm) |
| ✅ Xây trên multi-model + budget | ❌ Nhiều LLM cùng lỗi (correlated) — ensemble vô dụng |

## Khác các hướng gần

| | EEEEEE Consensus | AAAAAA Arena | EEEEEEEE: Ensemble |
|---|---|---|---|
| Mục đích | Quyết nhóm (hành động) | So đối kháng | **Chất lượng câu trả lời** |
| Cơ chế | Agreement | Đấu | **Aggregate/debate N mẫu** |
| Quan hệ | Đầu ra | Thí nghiệm | **Tăng chính xác suy luận** |

## Khi nào chọn

- Task mờ/quan trọng — sai tốn kém (forecast, judge, quyết định)
- Đã đủ N model khác nhau (multi-model — diverse)
- Budget chi trả N× cost (task hiếm — không hằng ngày)
- Đo trước: ensemble vs single trên task (ACM — tránh tự mặc định)