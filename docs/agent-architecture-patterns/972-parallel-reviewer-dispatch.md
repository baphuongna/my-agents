# Hướng AKJ: Parallel Reviewer Dispatch — `/vetc-review` auto-detect ngôn ngữ và invoke parallel reviewers (java-reviewer, typescript-reviewer, security-reviewer), review song song theo chuyên môn thay vì một agent generic

> **Nguồn gốc:** vetc-dev-kit (README.md, agents/*.md) | **Coupling:** 🟡 — dispatch reviewers + collect | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có subagent + council; thiếu per-language reviewers) | **Effort:** 2 tuần

## Nguồn gốc

**vetc-dev-kit** có **`/vetc-review`**: (1) **auto-detect ngôn ngữ** — scan code (file extensions, manifest — nối AKH stack detection) để biết Java/TypeScript/…; (2) **invoke parallel reviewers** — dispatch **java-reviewer, typescript-reviewer, security-reviewer** chạy song song — mỗi reviewer là agent chuyên môn (prompt + rubric riêng theo ngôn ngữ); (3) **review song song theo chuyên môn** — không phải một agent generic review mọi thứ — chuyên gia từng lĩnh vực; (4) **gộp kết quả** — parent gom findings từ các reviewer thành một báo cáo.

Giá trị: (1) **chất lượng cao hơn** — reviewer chuyên ngôn ngữ bắt lỗi idiomatic mà generic bỏ sót; (2) **nhanh** — song song thay vì tuần tự; (3) **rubric riêng** — mỗi language có tiêu chí riêng (TS: strict null; Java: exception handling); (4) **security reviewer riêng** — không trộn với code-style review.

## Mô tả

Với mya, pattern = **specialized parallel review**: (1) **language detection** — từ diff/files: extension + manifest (nối AKH) → chọn reviewer set: TS → typescript-reviewer + security-reviewer; Java → java-reviewer + security-reviewer; (2) **reviewer profiles** — mỗi reviewer = SystemPrompt riêng (rubric theo language) — mya có `packages/prompts` (assembler — build prompt per reviewer); (3) **parallel dispatch** — `spawnSubagent` (đã có — subagent.test.ts) 1 reviewer 1 subagent, chạy song song (pool — per-agent concurrency); (4) **collect + merge** — gom findings (mẫu AKC parallel investigation — không shared state); conflict (2 reviewer đụng file) → nêu rõ; (5) **verdict** — gộp thành report: blocking vs non-blocking (mẫu `packages/council` hindsight/adversarial — vote theo threshold). Đây là pattern **expert-role parallelism**: mỗi reviewer là chuyên gia một góc, tổng hợp sau — không có agent "biết tuốt".

## Kiến trúc (ASCII)

```
  /vetc-review <diff/files>
    │
    ▼ AUTO-DETECT NGÔN NGỮ (extension + manifest — nối AKH)
  ├─ *.ts, package.json  ──► TypeScript
  └─ *.java, pom.xml     ──► Java
    │
    ▼ CHỌN REVIEWER SET (theo language + security luôn có)
  ├─ typescript-reviewer  (rubric TS: strict null, type-safety)
  ├─ java-reviewer        (rubric Java: exceptions, concurrency)
  └─ security-reviewer    (rubric security — mọi language)
    │
    ▼ PARALLEL DISPATCH (spawnSubagent — 1 reviewer 1 subagent, song song)
    ▼ COLLECT + MERGE (không shared state — mẫu AKC)
    ▼ VERDICT — blocking vs non-blocking (threshold — council mẫu)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent/src/subagent.test.ts — spawnSubagent · pool.ts — AgentPool (song song)
// ✅ packages/prompts/src/assembler.ts — assemblePrompt (build reviewer prompt)
// ✅ packages/council/src/adversarial.ts — vote+threshold · hindsight.ts — HindsightReviewer (mẫu)
// ✅ packages/tools/src/lsp-cascade.ts — diagnostics (nền — reviewer dữ liệu)
// ❌ THIẾU: language→reviewer set mapping · per-language rubric profiles · dispatch + merge verdict
```

## Implementation

```typescript
// packages/agent/src/reviewer-dispatch.ts (NEW)
export type ReviewerProfile = {
  id: string;                    // "typescript-reviewer"
  languages: string[];           // áp dụng cho ngôn ngữ nào
  rubric: string;                // tiêu chí riêng theo ngôn ngữ
};

/** Reviewer registry — chuyên môn theo ngôn ngữ. */
const REVIEWERS: ReviewerProfile[] = [
  { id: "typescript-reviewer", languages: ["typescript"], rubric: "strict null, type-safety, noUncheckedIndexedAccess, no any" },
  { id: "java-reviewer", languages: ["java"], rubric: "exception handling, concurrency, resource closing" },
  { id: "security-reviewer", languages: ["typescript", "java"], rubric: "injection, secrets, path traversal, egress" },
];

/** Language detection — extension + manifest (nối AKH stack detect). */
export function detectLanguage(files: string[]): string {
  if (files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) return "typescript";
  if (files.some((f) => f.endsWith(".java"))) return "java";
  return "unknown";
}

/** Chọn reviewer set — theo language + security luôn có. */
export function selectReviewers(language: string): ReviewerProfile[] {
  const byLang = REVIEWERS.filter((r) => r.languages.includes(language));
  const security = REVIEWERS.find((r) => r.id === "security-reviewer")!;
  return byLang.some((r) => r.id === "security-reviewer") ? byLang : [...byLang, security];
}

/** Parallel dispatch — 1 reviewer 1 subagent, prompt theo rubric riêng. */
export async function dispatchReviewers(language: string, files: string[], spawn: (goal: string, opts: { allowedTools?: string[] }) => Promise<string>): Promise<Array<{ reviewer: string; findings: string }>> {
  const reviewers = selectReviewers(language);
  return Promise.all(
    reviewers.map(async (r) => {
      const goal = [
        `Bạn là ${r.id} — review theo rubric RIÊNG của bạn:`,
        r.rubric,
        `Files: ${files.join(", ")}`,
        "Trả về findings dạng: [BLOCKING|NON-BLOCKING] file:line — vấn đề",
      ].join("\n");
      const findings = await spawn(goal, { allowedTools: ["read", "grep", "find"] });
      return { reviewer: r.id, findings };
    }),
  );
}

/** Merge verdict — gom findings, phân blocking theo threshold. */
export function mergeVerdict(results: Array<{ reviewer: string; findings: string }>): { blocking: string[]; nonBlocking: string[]; byReviewer: string[] } {
  const blocking: string[] = [];
  const nonBlocking: string[] = [];
  for (const r of results) {
    for (const line of r.findings.split("\n")) {
      if (/\[BLOCKING\]/.test(line)) blocking.push(`[${r.reviewer}] ${line}`);
      else if (/\[NON-BLOCKING\]/.test(line)) nonBlocking.push(`[${r.reviewer}] ${line}`);
    }
  }
  return { blocking, nonBlocking, byReviewer: results.map((r) => r.reviewer) };
}
// Nối council: verdict qua threshold (như adversarial.ts) — finding sống khi đủ vote
// Nối prompts: reviewer prompt qua assemblePrompt (rubric làm stable tier)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chuyên môn — reviewer theo ngôn ngữ bắt lỗi idiomatic | ❌ Reviewer registry phải duy trì theo ngôn ngữ mới |
| ✅ Song song — nhanh hơn review tuần tự | ❌ Nhiều subagent cùng lúc tốn token |
| ✅ Rubric riêng — TS strict null, Java exceptions | ❌ Language detection sai (mixed repo) — reviewer set lệch |
| ✅ Security reviewer riêng — không trộn style | ❌ Merge findings dạng text — cần parse chuẩn (BLOCKING tag) |

## Khác các hướng gần

| | AKJ Parallel Reviewers | AKC Parallel Investigation | 697 Adversarial Review |
|---|---|---|---|
| Trọng tâm | Review theo chuyên môn | Investigate failure song song | Review kiểu đối thủ |
| Cơ chế | Reviewer set + rubric | Cluster + dispatch | N reviewers REFUTE |
| Quan hệ | Chuyên môn hóa của AKC | Nền dispatch chung | Verdict theo threshold |

## Khi nào chọn

- Codebase đa ngôn ngữ — review generic bỏ sót lỗi idiomatic
- Muốn security review luôn chạy song song với code review
- Đã có spawnSubagent + pool + prompts assembler — thêm reviewer set là rẻ
- Guard: detect language thật, reviewer set đúng, rubric riêng, verdict blocking/non-blocking rõ