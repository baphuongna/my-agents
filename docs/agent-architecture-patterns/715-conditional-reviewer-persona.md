# Hướng AAM: Conditional Reviewer Persona — 50+ reviewer personas chọn theo diff, security dùng anchored confidence

> **Nguồn gốc:** compound-engineering-plugin (plugins/compound-engineering/agents/ce-security-reviewer.agent.md) | **Coupling:** 🟢 — thêm reviewer selector vào review phase | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có council + hindsight — chưa có persona set + anchored confidence) | **Effort:** 2 tuần

## Nguồn gốc

**compound-engineering-plugin** có **hơn 50 reviewer personas** chuyên biệt — **security, performance, correctness, data-migrations, scope-guardian…** — được chọn **theo đặc điểm diff** (file nào đổi, loại thay đổi gì). Đặc biệt: **security reviewer dùng anchored confidence (100/75/50/25)** với **ngưỡng P0 thấp hơn** vì chi phí bỏ sót (miss) cao hơn chi phí false positive. Nguyên tắc: **persona khớp diff + ngưỡng quyết định theo chi phí lỗi** — review không generic, mỗi loại rủi ro có tiêu chuẩn riêng.

## Mô tả

mya conditional reviewer persona: packages/council đã có council.ts (fan-out vote) + hindsight.ts (critic) + adversarial.ts (refute). AAM thêm **persona registry**: `{ id, match(diff), systemPrompt, anchorConfidence }` — chọn persona theo diff: diff đụng SQL → data-migrations persona; đụng auth/network → security persona; đụng hot loop → performance. **Anchored confidence**: reviewer phải chọn mức tin 100/75/50/25 (không float) — bắt buộc định lượng; security dùng ngưỡng P0 thấp (vd 50) — nghi ngờ nhẹ cũng chặn merge. Tích hợp adversarial filter hiện có.

## Kiến trúc

```
  DIFF (files changed, loại thay đổi)
        │
        ▼
  ┌─── PERSONA SELECTOR ──────────────────────────────┐
  │  diff đụng *.sql / migrations  → data-migrations   │
  │  diff đụng auth/network/crypto  → security          │
  │  diff đụng hot loop/codegen     → performance       │
  │  fallback                        → correctness      │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── REVIEWER RUN ──────────────────────────────────┐
  │  systemPrompt = persona prompt (security:          │
  │    "anchored confidence: 100/75/50/25")            │
  │  threshold P0: security 50 (thấp — miss đắt)       │
  │  → finding { severity: P0..P3, confidence }        │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council council.ts — fan-out vote (nền chạy nhiều reviewer)
// ✅ packages/council hindsight.ts — critic lane (nền persona review)
// ✅ packages/council adversarial.ts — refute filter (nền chặn false positive)
// ✅ packages/tools lsp-cascade.ts — diff impact (nền chọn persona theo files)
// ✅ packages/ai model-routing.ts — phase routing (nền chọn reviewer theo diff)

// ❌ THIẾU: persona registry (match(diff) → persona)
// ❌ THIẾU: anchored confidence (100/75/50/25 enum)
// ❌ THIẾU: per-persona threshold (security P0 thấp)
```

## Implementation

```typescript
// packages/council/src/persona.ts (NEW)
export type AnchoredConfidence = 100 | 75 | 50 | 25;
export type Severity = "P0" | "P1" | "P2" | "P3";

export interface ReviewerPersona {
  id: string;
  /** Match diff → persona này được chọn. */
  match(diff: string[]): boolean;
  systemPrompt: string;
  /** Ngưỡng severity chặn merge — security thấp vì miss đắt. */
  blockThreshold: Severity;
}

const SECURITY_PROMPT = `Bạn là security reviewer. Với mỗi finding, cho anchored confidence: 100 (chắc chắn), 75 (khả năng cao), 50 (nghi ngờ), 25 (có thể). Ngưỡng chặn P0: confidence ≥ 50 là đủ — miss đắt hơn false positive.`;

export const PERSONAS: ReviewerPersona[] = [
  {
    id: "security",
    match: (d) => d.some((f) => /auth|network|crypto|secret|token|permission/i.test(f)),
    systemPrompt: SECURITY_PROMPT,
    blockThreshold: "P0", // ngưỡng thấp: nghi ngờ nhẹ cũng chặn
  },
  {
    id: "data-migrations",
    match: (d) => d.some((f) => /\.sql$|migrat|schema/i.test(f)),
    systemPrompt: "Bạn là data-migration reviewer. Kiểm tra backward-compat, rollback path, index/constraint.",
    blockThreshold: "P1",
  },
  {
    id: "performance",
    match: (d) => d.some((f) => /hot|loop|bench|index\.ts/i.test(f)),
    systemPrompt: "Bạn là performance reviewer. Tìm N+1, O(n²), chặn event loop.",
    blockThreshold: "P1",
  },
];

/** Chọn persona theo diff — fallback correctness. */
export function selectPersona(diff: string[]): ReviewerPersona {
  return PERSONAS.find((p) => p.match(diff)) ?? {
    id: "correctness", match: () => true,
    systemPrompt: "Bạn là correctness reviewer. Logic đúng, edge case đủ.",
    blockThreshold: "P1",
  };
}

/** Finding với confidence anchored — bắt buộc enum, không float. */
export interface PersonaFinding { severity: Severity; confidence: AnchoredConfidence; message: string }

/** Merge gate: finding ≥ ngưỡng persona → block. */
export function shouldBlock(persona: ReviewerPersona, findings: PersonaFinding[]): boolean {
  const rank: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return findings.some((f) => rank[f.severity] <= rank[persona.blockThreshold] && f.confidence >= 50);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Review đúng trọng tâm theo diff — không generic | ❌ 50 personas là số lượng lớn — duy trì tốn |
| ✅ Anchored confidence — reviewer phải định lượng | ❌ Model có thể chọn confidence sai (anchored ép được) |
| ✅ Security ngưỡng thấp — miss ít hơn | ❌ False positive nhiều hơn (chặn nhầm) |
| ✅ Fallback correctness — không bao giờ thiếu persona | ❌ Match(diff) heuristic — cần test phủ diff types |

## Khác các hướng gần

| | Hindsight (critic chung) | AAM: Persona Review |
|---|---|---|
| Review | Một critic chung | **Persona theo diff** |
| Confidence | Không bắt buộc | **Anchored 100/75/50/25** |
| Gate | approved boolean | **Per-persona threshold** |
| Mối quan hệ | Nền | **Chọn persona cho critic** |

## Khi nào chọn

- Code review tự động — cần trọng tâm theo loại thay đổi
- Security-critical — miss đắt hơn false positive
- Đã có council/hindsight — thêm persona registry + anchored confidence
- Guard: match(diff) test phủ các loại diff, confidence enum validate, threshold per persona
