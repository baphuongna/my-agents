# Hướng UQ: Fidelity-Scorecard Persistence — FIDELITY.md ghi điểm đa chiều, câu hỏi test, model answerer/scorer cho phép re-score độc lập sau xuất bản

> **Nguồn gốc:** DISTILL-R2 `FIDELITY.md` (multi-dimensional scorecard, test questions, `model_answerer`/`model_scorer`); "persist scorecard"; "re-score independently post-publish"; "dimensional fidelity"; "answerer + scorer separation" | **Coupling:** 🟢 — thêm FIDELITY.md artifact + answerer/scorer pipeline vào distill output | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval + llm-as-judge sẵn — chưa có scorecard artifact + re-score format) | **Effort:** 2-3 tuần

## Nguồn gốc

**DISTILL-R2** khi chưng cất skill không chỉ xuất skill — mà kèm **FIDELITY.md**: một scorecard ghi **điểm đa chiều** (accuracy, completeness, voice-fidelity, safety, …) + **câu hỏi test** + **answerer** (model trả lời test theo skill) + **scorer** (model chấm điểm). Mục đích: **re-score độc lập** — sau khi publish, bất kỳ model nào có thể chạy lại answerer + scorer → **điểm xác minh được**, không tin tưởng black-box. Nguyên tắc: **fidelity phải measurable + reproducible** — scorecard persist cùng skill, ai cũng re-score được. Khác điểm đơn (chỉ 1 con số) — UQ **multi-dimensional + re-runnable scorecard**.

## Mô tả

mya fidelity-scorecard persistence: (1) **Scorecard**: FIDELITY.md ghi điểm đa chiều + câu hỏi test + criteria. (2) **Answerer**: model trả lời test question theo skill (chỉ dùng skill, không ngoài). (3) **Scorer**: model chấm answer theo criteria → điểm từng chiều. (4) **Persist**: FIDELITY.md lưu cùng skill artifact. (5) **Re-score**: sau publish, chạy answerer + scorer độc lập → verify điểm. mya có eval + llm-as-judge — UQ thêm **scorecard artifact** + **answerer/scorer separation** + **re-score format**.

## Kiến trúc

```
  SKILL distill xong → sinh FIDELITY.md (kèm skill)
        │
        ▼
  ┌─── SCORECARD (FIDELITY.md) ──────────────────────────┐
  │  dimensions: [accuracy, completeness, voice, safety]  │
  │  test questions: [Q1, Q2, Q3]                          │
  │  criteria: per-dimension rubric                        │
  │  answerer: "model-X trả lời theo skill"                │
  │  scorer: "model-Y chấm theo rubric"                    │
  └───────────────────────┬─────────────────────────────┘
                          │ (chạy answerer + scorer)
                          ▼
  ┌─── SCORE (đa chiều) ─────────────────────────────────┐
  │  accuracy: 8/10  completeness: 9/10                   │
  │  voice: 7/10  safety: 10/10  → overall 8.5            │
  └───────────────────────┬─────────────────────────────┘
                          │ (persist + re-runnable)
                          ▼
  POST-PUBLISH: model-Z re-run answerer+scorer → verify 8.5 ✓
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — benchmark (nền — UQ scorer)
// ✅ 84 llm-as-judge — model chấm điểm (nền — UQ scorer)
// ✅ packages/skills — skill artifact (nền — UQ kèm FIDELITY.md)

// ❌ THIẾU: FIDELITY.md format (dimensions + test + criteria)
// ❌ THIẾU: answerer pipeline (model trả lời theo skill)
// ❌ THIẾU: scorer pipeline (model chấm theo rubric)
// ❌ THIẾU: re-score runner (post-publish independent verify)
```

## Implementation

```typescript
// packages/eval/src/fidelity-scorecard.ts (MỚI)
interface Dimension { name: string; criteria: string }
interface TestQuestion { id: string; question: string }
interface ScoreRow { dimension: string; score: number; max: number; reasoning: string }
interface Scorecard {
  skill: string; dimensions: Dimension[]; questions: TestQuestion[];
  answererModel: string; scorerModel: string;
  scores: ScoreRow[]; overall: number; ts: number;
}

class FidelityScorecard {
  constructor(
    private now: () => number,
    private answerer: (model: string, skill: string, q: TestQuestion) => Promise<string>,
    private scorer: (model: string, answer: string, dim: Dimension) => Promise<ScoreRow>,
  ) {}

  // run answerer + scorer → scorecard
  async score(skill: string, skillContent: string, dims: Dimension[], questions: TestQuestion[],
    answererModel: string, scorerModel: string): Promise<Scorecard> {
    const rows: ScoreRow[] = [];
    for (const q of questions) {
      const answer = await this.answerer(answererModel, skillContent, q);
      for (const dim of dims) rows.push(await this.scorer(scorerModel, answer, dim));
    }
    const overall = rows.reduce((s, r) => s + r.score / r.max, 0) / rows.length;
    return { skill, dimensions: dims, questions, answererModel, scorerModel, scores: rows, overall, ts: this.now() };
  }

  // re-score: post-publish independent verify
  async reScore(prev: Scorecard, skillContent: string): Promise<{ match: boolean; fresh: Scorecard }> {
    const fresh = await this.score(prev.skill, skillContent, prev.dimensions, prev.questions, prev.answererModel, prev.scorerModel);
    return { match: Math.abs(fresh.overall - prev.overall) < 0.5, fresh };
  }

  // serialize FIDELITY.md (markdown)
  toMarkdown(sc: Scorecard): string {
    return `# FIDELITY.md — ${sc.skill}\n\n` +
      `## Dimensions\n${sc.dimensions.map(d => `- ${d.name}: ${d.criteria}`).join('\n')}\n\n` +
      `## Test Questions\n${sc.questions.map(q => `- ${q.id}: ${q.question}`).join('\n')}\n\n` +
      `## Scores (answerer: ${sc.answererModel} / scorer: ${sc.scorerModel})\n` +
      sc.scores.map(r => `- ${r.dimension}: ${r.score}/${r.max} — ${r.reasoning}`).join('\n') +
      `\n\n**Overall: ${sc.overall.toFixed(2)}**`;
  }
}

// Usage:
// const sc = await card.score("rust-skill", content, DIMS, QS, "model-X", "model-Y");
// fs.writeFileSync("FIDELITY.md", card.toMarkdown(sc));
// post-publish: const { match } = await card.reScore(sc, content); // verify
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fidelity measurable (đa chiều, không 1 con số) | ❌ Answerer/scorer cost (LLM call mỗi re-score) |
| ✅ Re-runnable (post-publish verify độc lập) | ❌ Scorer bias (model chấm chủ quan) |
| ✅ Answerer/scorer tách (không tự chấm mình) | ❌ Test-question coverage (thiếu → điểm sai) |
| ✅ Audit trail (criteria + reasoning rõ) | ❌ Scorecard phình (nhiều question → dài) |

## Khác các hướng gần

| | 84 LLM-as-Judge | 091 Synthetic-Eval | UQ: Fidelity-Scorecard |
|---|---|---|---|
| Cái gì | Model chấm output | Sinh data test | **Persist scorecard + re-score** |
| Persist | ❌ | ❌ | **✅ FIDELITY.md** |
| Re-runnable | ⚠️ | ⚠️ | **✅ post-publish** |

## Khi nào chọn

- Skill distill cần verify fidelity (không tin black-box)
- Muốn re-score độc lập sau publish (model đổi → verify lại)
- Cần audit trail (criteria + reasoning)
- Nối packages/eval + 84 llm-as-judge + packages/skills; guard scorer neutrality (answerer ≠ scorer model), test-question quality (UR anti-cheating: không trùng example dialogue), và re-score determinism (seed cố định); UQ = fidelity-scorecard persistence, kết hợp UR benchmark-anti-cheating (test sạch) + US corpus-pii-scrubbing (corpus sạch trước chấm)
