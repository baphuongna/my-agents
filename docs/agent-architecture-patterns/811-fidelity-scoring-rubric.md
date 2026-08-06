# Hướng AEE: Fidelity Scoring Rubric — self-score độ trung thực của migration theo 5 câu hỏi

> **Nguồn gốc:** pi-crew-self-distill | **Coupling:** 🟢 — rubric đánh giá sau migration | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn eval; thiếu rubric checker) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew-self-distill** ghi **FIDELITY.md** với **self-score 88/100** theo **rubric 5 câu hỏi**: (1) **behavior preserved?** — hành vi có giữ nguyên không; (2) **inline patterns gone?** — pattern inline (viết tay lặp lại) đã thay bằng abstraction chưa; (3) **tests pass?** — test có chạy qua không; (4) **shadowing resolved?** — biến/shadowing đã xử lý chưa; (5) **imports correct?** — import có đúng không. Mỗi câu trả lời được chấm điểm, tổng thành 0-100.

Pattern cho phép **đánh giá độ trung thực của bản migration** một cách có cấu trúc: không phải "có vẻ ổn" mà là điểm số theo rubric — câu nào kém thì biết sửa gì. Self-score có rủi ro tự khen, nhưng rubric cụ thể + câu hỏi định lượng giảm thiểu.

## Mô tả

Với mya, rubric là **checker trong `packages/eval`**: sau migration (hashline-edit — nối AEC apply log), chạy 5 câu hỏi: behavior preserved (so sánh test cũ/mới — ParityHarness có sẵn), inline patterns gone (grep pattern lặp — codegraph), tests pass (tiers), shadowing resolved (tsc noEmit + lint), imports correct (tsc module resolution + lint-deps script). Điểm theo trọng số — output FIDELITY.md. Nối ADH (acceptance criteria) — rubric là criteria cho migration; nối ADJ (ladder) — FIDELITY.md là evidence inspectable.

## Kiến trúc (ASCII)

```
  MIGRATION XONG (hashline-edit, apply-log ghi hàng)
    │
    ▼ FIDELITY RUBRIC (5 câu hỏi — 0-100)
    1. behavior preserved?  ──► ParityHarness (test cũ vs mới)
    2. inline patterns gone? ──► grep/codegraph (pattern lặp còn không)
    3. tests pass?          ──► eval tiers (test:critical)
    4. shadowing resolved?  ──► tsc noEmit + lint
    5. imports correct?     ──► tsc module resolution + lint-deps
            │
            ▼
  FIDELITY.md — self-score 88/100
  câu nào kém → biết sửa gì (behavior? imports? shadowing?)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval/src/harness.ts — ParityHarness (behavior preserved — câu 1)
// ✅ packages/eval/src/tiers.ts — Integration/Credentialed (tests pass — câu 3)
// ✅ packages/tools/src/codegraph.ts — codegraph (inline patterns — câu 2)
// ✅ scripts/typecheck.mjs + lint-deps.mjs (shadowing/imports — câu 4-5)
// ✅ packages/tools/src/hashline-edit.ts — migration edit (đối tượng rubric)
// ✅ packages/audit — AuditLog (ghi kết quả score)

// ❌ THIẾU: rubric checker (5 câu → điểm 0-100)
// ❌ THIẾU: FIDELITY.md generator (output self-score)
// ❌ THIẾU: gate — điểm < ngưỡng → chưa merge migration
```

## Implementation

```typescript
// packages/eval/src/fidelity.ts (NEW)
export interface FidelityAnswer {
  question: string;
  score: number;      // 0-20 mỗi câu
  evidence: string;
}

export async function scoreFidelity(migration: Migration): Promise<FidelityAnswer[]> {
  const answers: FidelityAnswer[] = [];

  // 1. behavior preserved — ParityHarness: test cũ replay trên code mới
  const parity = await runParity(migration.oldTests, migration.newCode);
  answers.push({ question: "behavior preserved?", score: parity.ok ? 20 : 10, evidence: parity.report });

  // 2. inline patterns gone — codegraph/grep đếm pattern lặp còn sót
  const inline = await countInlinePatterns(migration);
  answers.push({ question: "inline patterns gone?", score: inline === 0 ? 20 : Math.max(0, 20 - inline), evidence: `còn ${inline} pattern` });

  // 3. tests pass — eval tiers (test:critical)
  const tests = await runCritical();
  answers.push({ question: "tests pass?", score: tests.ok ? 20 : 0, evidence: `${tests.passed}/${tests.total}` });

  // 4. shadowing resolved — tsc noEmit + lint
  const shadow = await runTscAndLint();
  answers.push({ question: "shadowing resolved?", score: shadow.ok ? 20 : 10, evidence: shadow.errors.join("; ") });

  // 5. imports correct — module resolution + lint-deps
  const imports = await checkImports(migration.changedFiles);
  answers.push({ question: "imports correct?", score: imports.ok ? 20 : 10, evidence: imports.problems.join("; ") });

  return answers;
}

export function total(answers: FidelityAnswer[]): number {
  return answers.reduce((sum, a) => sum + a.score, 0); // 0-100
}

export function writeFidelity(answers: FidelityAnswer[]): void {
  const score = total(answers);
  writeFileSync("FIDELITY.md",
    `# Fidelity\n\n**Score: ${score}/100**\n\n` +
    answers.map((a) => `- [${a.score}/20] ${a.question} — ${a.evidence}`).join("\n"));
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đánh giá migration có cấu trúc, không cảm tính | ❌ Self-score có thể tự khen (cần reviewer) |
| ✅ Câu nào kém → biết sửa gì | ❌ Rubric 5 câu có thể thiếu khía cạnh |
| ✅ Evidence gắn từng câu | ❌ Parity replay tốn thời gian cho migration lớn |
| ✅ Nối AEC apply log (migration ↔ score) | ❌ Điểm số dễ bị "gaming" nếu câu mơ hồ |

## Khác các hướng gần

| | AEE Fidelity Rubric | AEC Apply Log | ADJ Maturity Ladder |
|---|---|---|---|
| Đo gì | Độ trung thực migration | Từng dòng thay đổi | Mức harness |
| Cách | 5 câu hỏi → 0-100 | Bảng # + Verified | Criteria inspectable |
| Output | FIDELITY.md | APPLY-LOG.md | Level H0→Hn |

## Khi nào chọn

- Migration lớn cần đánh giá "có giữ nguyên hành vi không"
- Muốn biết chính xác câu nào yếu để sửa
- Đã có eval (Parity/tiers) + codegraph — thêm rubric
- Team review migration bằng điểm số + evidence