# Hướng MK: Synthesis with Gap Analysis — tổng hợp trả lời có citation + nêu "brain chưa biết/stale/mâu thuẫn"

> **Nguồn gốc:** gbrain (graph brain — synthesize answer from knowledge graph + flag gaps); "epistemic humility" in LLM; "calibrated uncertainty"; "knowledge gap detection"; "claim verification" vs hallucination; RAG "I don't know" handling
> **Coupling:** 🟡 — thêm synthesis layer sau retrieval, trước output
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retrieval + grounding + conflict sẵn — chưa có gap/stale/contradiction synthesis)
> **Effort:** 2-3 tuần

## Nguồn gốc

**gbrain**: agent có "brain" (knowledge graph/memory) → khi được hỏi, **tổng hợp** câu trả lời từ facts đã biết + **nêu rõ**: (1) **gap** — "brain chưa biết điều này"; (2) **stale** — "fact này cũ, có thể đã đổi"; (3) **contradiction** — "có 2 facts mâu thuẫn". Nguyên tắc: **epistemic humility** — agent không bịa khi thiếu, mà nói "tôi chưa biết" hoặc "thông tin này stale". Khác **118 error-analysis** (phân tích *lỗi runtime*) — MK phân tích **khoảng trống kiến thức**; khác **343 relevance-score** (đánh giá output) — MK đánh giá **sự đầy đủ của kiến thức**; khác **314 conflict-merge** (gộp facts) — MK **báo cáo** mâu thuẫn cho user, không tự gộp.

## Mô tả

mya synthesis with gap analysis: sau khi retrieve facts (memory/brain), trước khi trả output → **analyze**: (1) có đủ facts không? → gap (thiếu); (2) facts có cũ không? → stale; (3) facts có mâu thuẫn không? → contradiction. Trả answer + **confidence + gap flags**. VD: "Dựa trên 3 facts, dự án X dùng Rust — ⚠ 1 fact stale (6 tháng trước), ⚠ không tìm thấy ai maintain Y (gap)." Nối 88 hybrid-graph (retrieval), 314 conflict-merge (contradiction input), 343 relevance (quality check), 344 citation-health (citation trong synthesis). mya có grounding.ts — MK thêm **epistemic analysis layer**.

## Kiến trúc

```
  USER QUERY
       │
       ▼
  ┌─── RETRIEVE (memory / brain / graph 88) ───┐
  │  facts[] ← query memory                     │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  ┌─── EPISTEMIC ANALYSIS ──────────────────────┐
  │                                             │
  │  1. COVERAGE: facts đủ trả query không?     │
  │     · thiếu → GAP ("brain chưa biết X")     │
  │                                             │
  │  2. FRESHNESS: facts cũ không?              │
  │     · age > threshold → STALE ("có thể đổi")│
  │                                             │
  │  3. CONSISTENCY: facts mâu thuẫn?           │
  │     · 2+ conflicting → CONTRADICTION        │
  │         │                                   │
  │    ┌────┴────────────┐                      │
  │    │ FULLY GROUNDED   │ GAP/STALE/CONFLICT   │
  │    └────┬────────────┘                      │
  └─────────┼───────────────────────────────────┘
            │
       FULL → answer + citations (344)
       GAP  → answer + "⚠ chưa biết: X"
       STALE → answer + "⚠ thông tin cũ: Y"
       CONFLICT → answer + "⚠ mâu thuẫn: A vs B"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/grounding.ts — grounding check (nền — MK phân tích)
// ✅ packages/memory/src/conflict.ts — conflict detection (MK contradiction input)
// ✅ 88 CJ hybrid-graph-vector — retrieval (MK lấy facts)
// ✅ 343 ME relevance-score — output quality (sau MK)
// ✅ 344 MF citation-health — citation validate (MK output)
// ✅ 314 LB knowledge-conflict-merge — gộp facts (MK báo cáo, LB gộp)

// ❌ THIẾU: coverage analysis (đủ facts không → gap)
// ❌ THIẾU: freshness check (fact cũ → stale flag)
// ❌ THIẾU: synthesis with epistemic flags (answer + gap/stale/contradiction)
// ❌ THIẾU: calibrated confidence (how sure is the synthesis?)
```

## Implementation

```typescript
// packages/memory/src/synthesis.ts (NEW)
interface Fact {
  id: string;
  text: string;
  source: string;
  timestamp: number;
  confidence: number;
}

type EpistemicFlag =
  | { kind: 'gap'; detail: string }
  | { kind: 'stale'; factId: string; ageDays: number }
  | { kind: 'contradiction'; facts: [string, string]; detail: string };

interface SynthesisResult {
  answer: string;
  citations: string[];
  confidence: number;
  flags: EpistemicFlag[];
}

class GapAnalysisSynthesizer {
  constructor(private staleThresholdDays = 90) {}

  async synthesize(query: string, facts: Fact[]): Promise<SynthesisResult> {
    const flags: EpistemicFlag[] = [];

    // 1. Coverage gap — too few facts?
    if (facts.length === 0) {
      flags.push({ kind: 'gap', detail: `brain chưa biết gì về: ${query}` });
      return { answer: 'Tôi không có thông tin về câu hỏi này.', citations: [], confidence: 0.1, flags };
    }

    // 2. Freshness — stale facts?
    const now = Date.now();
    for (const f of facts) {
      const ageDays = (now - f.timestamp) / 86_400_000;
      if (ageDays > this.staleThresholdDays)
        flags.push({ kind: 'stale', factId: f.id, ageDays: Math.round(ageDays) });
    }

    // 3. Consistency — contradictions?
    const conflicts = this.findConflicts(facts);
    for (const [a, b] of conflicts)
      flags.push({ kind: 'contradiction', facts: [a.id, b.id], detail: `"${a.text}" ↔ "${b.text}"` });

    const confidence = flags.length === 0 ? 0.9 : Math.max(0.2, 0.9 - flags.length * 0.25);
    const answer = await this.llmSynthesize(query, facts);
    return { answer, citations: facts.map(f => f.source), confidence, flags };
  }

  private findConflicts(facts: Fact[]): [Fact, Fact][] {
    // naive: flag facts with opposing sentiment (nối conflict.ts)
    const pairs: [Fact, Fact][] = [];
    for (let i = 0; i < facts.length; i++)
      for (let j = i + 1; j < facts.length; j++)
        if (this.contradicts(facts[i]!.text, facts[j]!.text)) pairs.push([facts[i]!, facts[j]!]);
    return pairs;
  }
  private contradicts(_a: string, _b: string): boolean { return false; } // → conflict.ts
  private async llmSynthesize(_q: string, _f: Fact[]): Promise<string> { return ''; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Epistemic humility — không bịa khi thiếu (gbrain) | ❌ Gap report frustrate (user muốn answer, không muốn "chưa biết") |
| ✅ Stale flag — cảnh báo thông tin cũ | ❌ Stale threshold tuning (90 ngày? 30?) |
| ✅ Contradiction transparent (không giấu) | ❌ Conflict detection accuracy (false positive) |
| ✅ Calibrated confidence (user biết độ chắc) | ❌ Synthesis thêm 1 LLM call |

## Khác các hướng gần

| | 118 Error Analysis | 343 Relevance Score | 314 Conflict Merge | MK: Gap Analysis |
|---|---|---|---|---|
| Phân tích | Lỗi runtime | Output relevant | Gộp mâu thuẫn | **Khoảng trống kiến thức** |
| Gap | ❌ | ❌ | ❌ | ✅ |
| Stale | ❌ | ❌ | ❌ | ✅ |
| Contradiction | ❌ | ❌ | Gộp | **Báo cáo (không gộp)** |

## Khi nào chọn

- Agent trả lời từ knowledge base — cần "biết mình không biết gì"
- Facts có thể stale/cũ (project info đổi theo thời gian)
- Muốn transparency: user thấy gap/stale/contradiction thay vì answer mù
- Kết hợp 88 retrieval (facts) + 314 conflict (input) + 343 relevance (output check) + 344 citation
