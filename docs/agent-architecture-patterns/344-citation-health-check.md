# Hướng MF: Citation Health Check — validate link/reference trong LLM answer

> **Nguồn gốc:** Link checker (W3C LinkChecker, broken link checker); "reference validation"; academic citation verification; "citation grounding"; SEO link audit; "source verification"; web scraping link validation
> **Coupling:** 🟢 — thêm citation validator (read-only HTTP check)
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (output ready — chưa có citation validation)
> **Effort:** 0.5-1.5 tuần

## Nguồn gốc

**Link checker** (W3C LinkChecker): quét page → check mỗi link HTTP 200 (không 404/dead). **Academic citation verification**: citation có tồn tại + nói đúng ý không. **Citation grounding** (AI search — Perplexity, Bing Chat): mỗi claim trong answer phải có citation → user click → verify. Nguyên tắc: **LLM hallucinate citation** (link giả, ref sai) — cần validate: link sống không, ref tồn tại không, ref hỗ trợ claim không. Khác **343 relevance-score** (output relevance tổng thể) — MF check **citation cụ thể** (link/ref valid).

## Mô tả

mya citation health check: sau khi agent trả answer có citation (link URL, file ref, doc ref), validate: link HTTP check (200?), file ref exists?, ref content match claim? Citation không valid → flag/remove → answer degrade. Nối 342 quality-pipeline — MF là **citation gate**. Nối 219 answer-grounding-citations — MF **validate** citation đó.

## Kiến trúc

```
  LLM ANSWER (có citation)
   "... claim X [1]. claim Y [2]. ..."
   [1] https://docs.example.com/auth
   [2] ./src/config.ts
        │
        ▼
  ┌─── CITATION HEALTH CHECK ───────────────┐
  │                                         │
  │  For each citation:                      │
  │                                         │
  │  [1] URL → HTTP GET → 200 OK? ✅          │
  │         → content match claim X? ✅       │
  │                                         │
  │  [2] file ref → exists? ❌ (404)          │
  │         → CLAIM UNSUPPORTED              │
  │         │                               │
  │    ┌────┴────────┐                      │
  │    │ ALL HEALTHY  │ ANY BROKEN            │
  │    └────┬────────┘                      │
  └─────────┼───────────────────────────────┘
            │
       HEALTHY → trả answer nguyên vẹn
       BROKEN → flag/remove citation [2] + warn
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 342 MD output-quality-pipeline — gate chain (MF là citation gate)
// ✅ 219 answer-grounding-citations — citation feature (nền — MF validate)
// ✅ 343 ME relevance-score — faithfulness (related — MF check specific ref)
// ✅ 198 GP audit — log citation health (evidence)

// ❌ THIẾU: link health check (HTTP GET → 200?)
// ❌ THIẾU: file ref existence check
// ❌ THIẾU: ref content match claim (citation supports claim)
// ❌ THIẾU: broken citation action (flag/remove/degrade)
```

## Implementation

```typescript
// packages/agent/src/citation-check.ts (NEW)
interface Citation {
  id: string;
  type: 'url' | 'file' | 'doc';
  ref: string;
  claim: string; // claim it supports
}

interface CitationHealth {
  citation: Citation;
  status: 'healthy' | 'broken' | 'unsupported';
  reason?: string;
}

class CitationHealthChecker {
  constructor(private fetch: (url: string) => Promise<{ ok: boolean; body: string }>,
              private fileExists: (path: string) => boolean) {}

  async check(citations: Citation[]): Promise<CitationHealth[]> {
    return Promise.all(citations.map(c => this.checkOne(c)));
  }

  private async checkOne(c: Citation): Promise<CitationHealth> {
    // Step 1: ref exists / reachable?
    if (c.type === 'url') {
      try {
        const res = await this.fetch(c.ref);
        if (!res.ok) return { citation: c, status: 'broken', reason: `HTTP ${res.ok ? '' : 'error'}` };
        // Step 2: content supports claim?
        const supported = this.checkSupport(c.claim, res.body);
        if (!supported) return { citation: c, status: 'unsupported', reason: 'content does not support claim' };
      } catch (e) {
        return { citation: c, status: 'broken', reason: (e as Error).message };
      }
    } else if (c.type === 'file') {
      if (!this.fileExists(c.ref)) return { citation: c, status: 'broken', reason: 'file not found' };
    }
    return { citation: c, status: 'healthy' };
  }

  // Simplified — check keyword overlap (real impl uses NLI or LLM judge)
  private checkSupport(claim: string, content: string): boolean {
    const words = claim.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matches = words.filter(w => content.toLowerCase().includes(w)).length;
    return matches / words.length > 0.5;
  }

  // Action — remove broken citation, warn user
  sanitize(answer: string, health: CitationHealth[]): string {
    const broken = health.filter(h => h.status !== 'healthy').map(h => h.citation.id);
    let result = answer;
    for (const id of broken) result = result.replace(`[${id}]`, '[⚠ unverified]');
    if (broken.length > 0) result += '\n\n[⚠ Some citations could not be verified]';
    return result;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hallucinated citation (link giả, ref sai) | ❌ HTTP check latency (network) |
| ✅ User verify được (citation trustworthy) | ❌ Rate limit khi check nhiều link |
| ✅ Coupling thấp (🟢 — read-only check) | ❌ Content match approximate (keyword) |
| ✅ Nối 342 gate + 219 grounding | ❌ Dynamic link (200 nay, 404 mai) |

## Khác các hướng gần

| | 219 Grounding Citations | 343 Relevance Score | 342 Quality Pipeline | MF: Citation Health |
|---|---|---|---|---|
| Cái gì | Add citation | Score output | Gate chain | **Validate citation cụ thể** |
| Check | ❌ (add) | Metric | Multi-gate | **HTTP/exists/content** |
| Per-ref | ❌ | Aggregate | ❌ | ✅ từng citation |
| Action | ❌ | ❌ | retry/block | **flag/remove/warn** |

## Khi nào chọn

- Agent trả answer có citation (URL, file ref, doc ref)
- Muốn phát hallucinated citation (link giả)
- User cần citation trustworthy (click → verify)
- Kết hợp 219 grounding (add citation) + 342 pipeline (gate) — MF validate; cache HTTP check + rate limit; guard against keyword-only match (use NLI)
