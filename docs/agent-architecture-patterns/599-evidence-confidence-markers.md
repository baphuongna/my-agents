# Hướng WA: Evidence Confidence Markers — ép agent đánh dấu mức các claim dùng [V]/[I]/[A]/[U], cấm trình bày suy luận như fact

> **Nguồn gốc:** pi-agent-flow (evidence confidence markers); "force agent to mark claim confidence with [V]/[I]/[A]/[U]"; "ban presenting reasoning as fact"; "verified/inferred/assumed/unknown tagging"; "epistemic honesty in agent output" | **Coupling:** 🟢 — thêm confidence-marker convention vào system prompt + output parser | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (system prompt + parser sẵn — chưa có marker convention) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-agent-flow** giải bài toán **agent hallucination/confabulation** — agent trình bày suy luận như fact, khó phân biệt gì verified vs đoán. Giải pháp **evidence confidence markers**: ép agent **đánh dấu mỗi claim** với 1 trong 4 mức: **[V] Verified** (đã kiểm chứng — test pass, code chạy), **[I] Inferred** (suy ra từ evidence nhưng chưa verify trực tiếp), **[A] Assumed** (giả định, chưa có evidence), **[U] Unknown** (không biết, cần điều tra). Nguyên tắc: **epistemic honesty** — agent phải biết ranh giới kiến thức, **cấm trình bày suy luận [I]/[A] như fact [V]**. Khác unmarked output (tất cả như nhau) — WA **explicit confidence tagging**.

## Mô tả

mya evidence confidence markers: (1) **System prompt**: quy tắc ép agent đánh dấu claim bằng [V]/[I]/[A]/[U]. (2) **Convention**: mỗi factual claim → marker prefix (vd "[V] tests pass", "[A] the bug is in auth"). (3) **Parser**: extract claims + markers → structured confidence map. (4) **Gate**: cảnh báo nếu agent trình [I]/[A] mà không có marker (disguised reasoning as fact). (5) **Decision**: ưu tiên [V] cho action, [U] → điều tra thêm trước khi act. mya có system prompt + parser — WA thêm **marker convention** + **confidence gate**.

## Kiến trúc

```
  AGENT OUTPUT (mỗi claim có marker)
  ┌─────────────────────────────────────────────────────────┐
  │  [V] All 50 tests pass (verified — npm test exit 0)      │  ← Verified
  │  [I] The timeout is likely from network (inferred)       │  ← Inferred
  │  [A] Reducing retries to 2 should fix it (assumed)       │  ← Assumed
  │  [U] Whether prod has same issue: unknown (need data)    │  ← Unknown
  └───────────────────────────┬─────────────────────────────┘
                              │ (parse markers)
                              ▼
  ┌─── CONFIDENCE MAP ─────────────────────────────────────┐
  │  verified: ["tests pass"]                                │
  │  inferred: ["timeout from network"]                      │
  │  assumed:  ["reduce retries fixes it"]                   │
  │  unknown:  ["prod same issue"]                           │
  │  → action dựa trên [V]; [A]/[U] → investigate trước      │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts — system prompt (nền — WA marker convention ở đây)
// ✅ packages/agent sdk.ts — agent output (nền — WA parse output)
// ✅ packages/audit — audit (nền — WA confidence audit)
// ✅ 588 VP operational-handoff — structured output (relate — WA = confidence layer)

// ❌ THIẾU: marker convention ([V]/[I]/[A]/[U] trong system prompt)
// ❌ THIẾU: confidence parser (extract claims + markers)
// ❌ THIẾU: epistemic gate (chặn disguised reasoning as fact)
```

## Implementation

```typescript
// packages/agent/src/evidence-confidence-markers.ts (MỚI)

type Confidence = 'V' | 'I' | 'A' | 'U';

interface Claim { marker: Confidence; text: string }

class EvidenceConfidenceMarkers {
  // system prompt: ép agent đánh dấu claim
  static prompt(): string {
    return [
      '# Evidence Confidence Markers — MANDATORY',
      'Mark EVERY factual claim with one of:',
      '  [V] Verified — directly confirmed (test passed, code runs)',
      '  [I] Inferred — deduced from evidence, not directly verified',
      '  [A] Assumed — hypothesis, no supporting evidence yet',
      '  [U] Unknown — do not know, needs investigation',
      'NEVER present [I]/[A] reasoning as unmarked fact.',
    ].join('\n');
  }

  // parse: extract claims + markers từ agent output
  static parse(output: string): Claim[] {
    const claims: Claim[] = [];
    const lines = output.split('\n');
    const re = /\[([VIAU])\]\s*(.+)/i;
    for (const line of lines) {
      const m = line.match(re);
      if (m) claims.push({ marker: m[1]!.toUpperCase() as Confidence, text: m[2]!.trim() });
    }
    return claims;
  }

  // gate: cảnh báo claim không có marker (disguised reasoning)
  static validate(output: string): { unmarked: string[]; lowConfidence: Claim[] } {
    const claims = this.parse(output);
    const lines = output.split('\n');
    const unmarked = lines.filter(l =>
      l.trim().length > 20 && !l.match(/\[[VIAU]\]/i) && !l.startsWith('#') && !l.startsWith('-')
    );
    const lowConfidence = claims.filter(c => c.marker === 'A' || c.marker === 'U');
    return { unmarked, lowConfidence };
  }

  // decision: [V] → act; [A]/[U] → investigate
  static canAct(claims: Claim[]): { ready: boolean; blockers: Claim[] } {
    const blockers = claims.filter(c => c.marker === 'A' || c.marker === 'U');
    return { ready: blockers.length === 0, blockers };
  }
}

// Usage:
// systemPrompt += EvidenceConfidenceMarkers.prompt();
// const output = await llm(...);
// const claims = EvidenceConfidenceMarkers.parse(output);
// const { ready, blockers } = EvidenceConfidenceMarkers.canAct(claims);
// if (!ready) investigate(blockers);  // [A]/[U] → không act vội
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Epistemic honesty (agent biết ranh giới kiến thức) | ❌ LLM compliance (không luôn tuân marker) |
| ✅ Action safety ([V] → act, [A]/[U] → investigate) | ❌ Verbosity (mỗi claim thêm marker) |
| ✅ Audit trail (confidence map rõ ràng) | ❌ Marker gaming (agent tag sai [A]→[V]) |
| ✅ Hallucination check (unmarked = disguised reasoning) | ❌ Parser brittle (format lệch → miss) |

## Khác các hướng gần

| | Unmarked output | Free-form confidence | WA: Evidence-Markers |
|---|---|---|---|
| Claim tag | ❌ | Prose ("I think") | **[V]/[I]/[A]/[U] structured** |
| Gate | ❌ | ❌ | **✅ chặn disguised reasoning** |
| Decision | Blind | Human judge | **confidence-based ([V] → act)** |

## Khi nào chọn

- Agent hay trình suy luận như fact (hallucination risk)
- Muốn epistemic honesty (biết gì verified vs đoán vs giả định)
- Cần action safety ([V] mới act, [A]/[U] investigate trước)
- Nối packages/prompts + packages/agent sdk.ts + packages/audit + 588 VP operational-handoff; guard LLM-compliance (re-prompt nếu thiếu marker), marker-validation (spot-check [V] thật verified), và parser-robustness (fallback nếu format lệch); WA = evidence confidence markers, kết hợp 600 WB structured-json-flow-report (confidence marker = structured claim) + 588 VP (handoff — confidence cho handoff fields)
