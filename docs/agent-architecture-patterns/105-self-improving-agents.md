# Hướng DA: Self-Improving Agents — agent tự tích lũy kinh nghiệm thành năng lực

> **Nguồn gốc:** "Self-Improvements in Modern Agentic Systems: A Survey" (arXiv 2607.13104, 2026); Gao "Survey of Self-Evolving Agents" (222 cites); OpenAI cookbook
> **Coupling:** 🟡 — vòng hồi quy cần cổng kiểm soát
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval/memory sẵn; thiếu improve loop)
> **Effort:** 2-3 tuần

## Nguồn gốc

Self-improving agents: **agent đổi từ kinh nghiệm → tăng năng lực tích lũy** ("convert experience into accumulated capability gains" — arXiv 2607.13104 survey 2026). Các cơ chế: (1) **intrinsic feedback** — tự đánh giá output (self-reflection, self-eval); (2) **extrinsic feedback** — từ evals/judge/user (GGGG/PP); (3) **capability updates** — cập nhật prompts, skills (YY), few-shot examples, memory (MM), đôi khi fine-tune/retrain (OpenAI cookbook "Autonomous Agent Retraining"). Điểm mấu chốt: **controllable evolution** (alphaxiv 2026) — không để agent tự đổi lung tung: mọi thay đổi qua cổng: triggered bởi bằng chứng (eval fail → fix), versioned, review (SSSS gate), rollback. Cảnh báo reddit 2026: "months trying to make agents recursively self-improve" — chi phí cao, dễ overfit vào eval (YYYY hacking), cần ranh giới (không tự đổi code lõi/tool). Khác **EEEE consolidation** (dọn memory) — BBBBB cải thiện *cách hành động* (prompt/skill/example).

## Mô tả

mya improve loop (nightly + per-task): (1) **nguồn phản hồi** — eval fail (SSSS), task fail (RRRR/trace QQQQ), user phản hồi (53), drift (ZZZZ); (2) **phân loại** — prompt issue / skill thiếu / example sai / tool misuse / memory thiếu → đúng loại fix; (3) **sinh fix** — LLM đề xuất sửa (prompt patch, skill update, new few-shot) → **staged**: không vào production trực tiếp — chạy qua golden (SSSS gate) + replay (QQQQ) → đạt ngưỡng mới áp dụng; (4) **versioned** — mọi thay đổi ghi version (VV/28 — rollback); (5) **ranh giới** — agent không tự đổi code lõi, tool permissions (OO), safety policies (RRR) — chỉ cải thiện tri thức + cách dùng. Đo: capability score theo thời gian (ZZZZ drift detector chính là theo dõi).

## Kiến trúc

```
  PHẢN HỒI: eval fail (SSSS) · task fail (RRRR) · user (53) · drift (ZZZZ)
        │
        ▼
  PHÂN LOẠI: prompt? skill (YY)? example? tool? memory (MM)?
        │
        ▼
  SINH FIX (LLM đề xuất — prompt patch/skill/example)
        │
        ▼
  STAGED GATE: golden (SSSS) + replay (QQQQ) ≥ ngưỡng? ──NO──► bỏ
        │ YES
        ▼
  ÁP DỤNG (versioned — VV/28, rollback được)
        │
  RANH GIỚI: KHÔNG đổi code lõi/tool permissions/OO/RRR — tri thức + cách dùng
        │
  ĐO: capability score theo t (ZZZZ) — improved? đúng chiều?
```

```
mya: eval + memory + skills SẴN — thiếu: improve loop + staged gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval + SSSS gate — extrinsic feedback + cổng
// ✅ QQQQ replay — verify fix (diff với trace cũ)
// ✅ ZZZZ drift — đo cải thiện theo thời gian
// ✅ YY skills + MM memory — nơi "năng lực" trú
// ✅ VV audit + 28 versioning — mọi thay đổi vết lại
// ✅ YYYY anti-hack — tránh overfit eval

// ❌ THIẾU: improve loop (collect → classify → fix → stage → apply)
// ❌ THIẾU: staged gate tự động (golden + replay trước apply)
// ❌ THIẾU: ranh giới tự động (không đổi core/policy)
```

## Implementation

```typescript
// packages/improve/src/loop.ts (NEW)
interface Improvement { kind: "prompt" | "skill" | "example"; patch: unknown; }

function collectFeedback(sources: Feedback[]): FailureSample[] { ... }

function classify(s: FailureSample): ImprovementKind {
  // trace QQQQ: prompt misunderstand? tool misuse? memory missing?
}

function improve(sample: FailureSample, gate: EvalGate): Patch | null {
  const patch = llmProposeFix(sample);             // sinh đề xuất
  const ok = gate.run(patch, golden + replay);     // SSSS + QQQQ
  return ok ? patch : null;                        // không đủ → bỏ
}
// apply: versioned (VV) — rollback 1 lệnh; ranh giới: core/policy bất khả
// OpenAI cookbook: đôi khi retrain — ngoài phạm vi mya (LLM call thôi)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Năng lực tích lũy từ kinh nghiệm (survey 2026) | ❌ Chi phí: sinh fix + gate mỗi lần (thực tế reddit 2026) |
| ✅ Controllable evolution — staged gate + versioned | ❐ Overfit eval (YYYY anti-hack phải bật) |
| ✅ Task fail → fix tự động (ít lặp lỗi) | ❌ Ranh giới khó lập trình tự động |
| ✅ Nối nguyên stack eval/memory/trace | ❌ Thay đổi âm thầm — user khó hiểu |

## Khác các hướng gần

| | EEEE Consolidation | 71 EvoPrompt | BBBBB: Self-Improve |
|---|---|---|---|
| Cải thiện gì | Memory dọn | Prompt tối ưu | **Toàn bộ capability** |
| Feedback | Lịch sử | Eval | **Eval + fail + user + drift** |
| Mối quan hệ | Bộ phận | 1 cơ chế | **Vòng hồi quy tổng** |

## Khi nào chọn

- Agent fail lặp cùng loại (JJJ detect) — muốn tự sửa
- Đã có eval + trace + skills + memory (đủ nền)
- Chấp nhận staged gate + versioning kỷ luật
- Ranh giới rõ (không tự đổi core/policy)