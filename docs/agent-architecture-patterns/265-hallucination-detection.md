# Hướng JE: Hallucination Detection — phát hiện claim sai/mắng tín

> **Nguồn gốc:** "SelfCheckGPT" (Manakul 2023); "RAGAS faithfulness"; "FACTSCORE" (Min 2023); "Chain-of-Verification" (CoVe, Dhuliawala 2023); Self-consistency (205); retrieval grounding (219)
> **Coupling:** 🟡 — chạm LLM output pipeline + RAG
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (219 grounding + 205 self-consistency sẵn — thiếu verification pipeline)
> **Effort:** 3-4 tuần

## Nguồn gốc

Hallucination detection: **phát hiện LLM bịa claim không có trong source** — không phải kiểm đúng/sai tuyệt đối mà "có support không?". SelfCheckGPT (Manakul 2023): sample nhiều output → đo inconsistency (model bịa = inconsistent across samples). FACTSCORE (Min 2023): tách output thành atomic facts → kiểm từng fact có support không. Chain-of-Verification (CoVe, Dhuliawala 2023): model tự sinh verification plan → check → revise. RAGAS faithfulness: output phải grounded trong retrieved context. Cốt lõi: **decompose → verify → score** — không tin raw output, kiểm từng claim.

## Mô tả

mya hallucination detection: sau khi LLM generate → pipeline (1) decompose thành atomic claims, (2) verify mỗi claim (retrieval grounding 219, self-consistency 205, external check), (3) score → flag low-confidence. Nối 219 answer-grounding: claim phải cite source. Nối 205 self-consistency: sample N → inconsistency = hallucination signal. Nối JD (264) temporal: claim về fact-time → verify against valid fact. Output flagged → agent có thể revise (CoVe) hoặc warn user.

## Kiến trúc

```
  LLM OUTPUT (text with claims)
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  HALLUCINATION DETECTION PIPELINE                    │
  │  1. DECOMPOSE (FACTSCORE): text → atomic claims      │
  │     "Obama born Hawaii 1961" → [born-Hawaii][year]   │
  │  2. VERIFY each claim                                │
  │     a. GROUNDING (219): in retrieved context?        │
  │     b. SELF-CHECK (SelfCheckGPT): sample N →         │
  │        consistent? inconsistency = hallucination     │
  │     c. EXTERNAL: lookup knowledge (JD 264)           │
  │  3. SCORE                                            │
  │     claim confidence = verified / total              │
  │     low score → flag                                 │
  └──────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ HIGH CONF │          │ LOW CONFIDENCE   │
  │ trust     │          │ → REVISE (CoVe)  │
  │ output    │          │ → WARN user      │
  └───────────┘          │ → cite source 219│
                         └──────────────────┘
```

```
mya: 219 grounding + 205 self-consistency sẵn — thiếu: claim decomposition + verify pipeline + score/flag
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 219 answer-grounding-citations — claim must cite (documented)
// ✅ 205 self-consistency-sampling — sample N outputs (documented)
// ✅ 223 web-search-grounding-tool — external verify (documented)
// ✅ JD (264) temporal-knowledge — fact-time verify (documented)

// ❌ THIẾU: claim decomposition (atomic fact extraction)
// ❌ THIẾU: verification pipeline (grounding + self-check + external)
// ❌ THIẾU: confidence scoring (verified / total)
// ❌ THIẾU: revise loop (CoVe — fix flagged claims)
```

## Implementation

```typescript
// packages/verify/src/hallucination.ts (NEW)
interface AtomicClaim { text: string; verified: boolean | null; source?: string; }

export class HallucinationDetector {
  constructor(private model: ModelProvider, private knowledge: RetrievalSource) {}

  async check(output: string, context: string): Promise<HallucinationReport> {
    // 1. Decompose into atomic claims (FACTSCORE)
    const claims: AtomicClaim[] = await this.decompose(output);

    // 2. Verify each claim
    for (const claim of claims) {
      // a. Grounding: in retrieved context? (219)
      const grounded = await this.knowledge.search(claim.text);
      claim.verified = grounded.similarity > 0.8;
      claim.source = grounded.hit?.ref;

      // b. Self-check if not grounded (SelfCheckGPT)
      if (!claim.verified) {
        const samples = await Promise.all(
          Array.from({ length: 3 }, () => this.model.generate(output.slice(0, 200)))
        );
        claim.verified = this.consistent(claim.text, samples); // 205
      }
    }

    // 3. Score
    const score = claims.filter((c) => c.verified).length / claims.length;
    return { score, flagged: claims.filter((c) => !c.verified) };
  }

  private async decompose(text: string): Promise<AtomicClaim[]> {
    // Split into atomic factual claims via LLM
    const raw = await this.model.generate(`Split into atomic facts:\n${text}`);
    return raw.split("\n").filter(Boolean).map((t) => ({ text: t.trim(), verified: null }));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện claim bịa trước khi tin (SelfCheckGPT/FACTSCORE) | ❌ Latency (decompose + verify mỗi output) |
| ✅ Confidence score — biết độ tin cậy | ❌ Token cost (sample N for self-check 205) |
| ✅ Revise loop (CoVe — fix flagged) | ❌ False positive (true claim không có trong context) |
| ✅ Nối 219 grounding + 205 self-consistency | ❌ External verify dependency (knowledge quality) |

## Khác các hướng gần

| | 219 Grounding | 205 Self-Consistency | JE: Hallucination Detect |
|---|---|---|---|
| Mục | Cite source | Sample consensus | **Decompose + verify + score** |
| Granularity | Whole output | Whole output | **Per atomic claim** |
| Output | Citation | Vote | **Confidence + flag + revise** |

## Khi nào chọn

- Output factual (code, data, API) — sai hậu quả nghiêm
- Cần confidence score (user biết độ tin)
- Có RAG/knowledge để verify (219, 223, JD 264)
- Nối 219 grounding + 205 self-consistency + CoVe revise
