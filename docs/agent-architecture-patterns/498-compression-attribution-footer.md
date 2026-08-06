# Hướng SD: Compression Attribution Footer — footer [hypa: 1200->340 tok, -72%], agent biết reducer nào chạy

> **Nguồn gốc:** hypa (compression attribution footer); "[hypa: 1200->340 tok, -72%]"; "reducer attribution metadata"; "which compression reducer ran"; "compression provenance footer"
> **Coupling:** 🟢 — thêm footer emitter sau mỗi compress (append attribution metadata)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai compressor sẵn — chưa có reducer-attribution footer + reducer registry)
> **Effort:** 1 tuần

## Nguồn gốc

**hypa** đính kèm **attribution footer** sau mỗi lần nén: footer dạng `[hypa: 1200->340 tok, -72%]` (reducer-tên: before→after tok, % tiết kiệm). Mục đích: **agent (và user) biết reducer nào chạy** + **bao nhiêu token tiết kiệm** — provenance cho compression. Nguyên tắc: **nén không ẩn danh** — mỗi bản nén ghi rõ ai nén (reducer name), nén từ đâu (before token), kết quả (after token, %). Giúp debug (reducer nào tốt/tệ), audit (token tiết kiệm thật không), và agent tự nhận biết context đã nén (không tưởng là raw). Khác **466 citation-attribution** (cite nguồn context) — SD là **cite reducer** (ai nén); khác **494 savings-accounting** (đo tổng session) — SD là **per-segment footer**.

## Mô tả

mya compression attribution footer: (1) **Reducer registry**: mỗi reducer (LLMLingua, summary, prune, project-DSL 497) đăng ký tên + hàm nén. (2) **Apply reducer**: context segment đi qua reducer → before/after token count. (3) **Footer emit**: append `[reducer: before→after tok, -X%]` vào cuối segment nén. (4) **Agent awareness**: footer trong context → LLM thấy "phần này đã nén bởi reducer X" (không tưởng raw, biết có thể mất chi tiết). (5) **Telemetry aggregate**: collect footer → report reducer nào tiết kiệm nhiều nhất (cho 494 accounting). mya có compressor — SD thêm **reducer registry** + **footer emitter**.

## Kiến trúc

```
  CONTEXT SEGMENT (1200 tok)
        │
        ▼
  ┌─── REDUCER (registry) ──────────────────────────────┐
  │  name: "hypa-summarize"                              │
  │  apply(1200 tok) → 340 tok                            │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── FOOTER EMIT ─────────────────────────────────────┐
  │  segment nén (340 tok) + footer:                     │
  │  "...summary content..."                             │
  │  [hypa-summarize: 1200->340 tok, -72%]               │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  AGENT thấy footer → biết:
    - "phần này nén bởi hypa-summarize"
    - "tiết kiệm 72% (1200→340)"
    - "có thể mất chi tiết → cân nhắc expand (493)"
  TELEMETRY: aggregate footer → reducer nào tiết kiệm nhất
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — compressor (nền — SD emit footer quanh reducer)
// ✅ budget tracker — token count (nền — SD before/after)
// ✅ 466 citation-attribution — provenance (gần — SD = reducer citation)
// ✅ 494 savings-accounting — đo tổng (nền — SD footer feed vào nó)

// ❌ THIẾU: reducer registry (tên + hàm nén)
// ❌ THIẾU: footer emitter ([reducer: before→after, -X%])
// ❌ THIẾU: agent awareness (footer trong context — LLM biết đã nén)
```

## Implementation

```typescript
// packages/ai/src/compression-footer.ts (MỚI)
interface Reducer { name: string; apply: (text: string) => Promise<string> }

class CompressionFooter {
  private reducers = new Map<string, Reducer>();
  private history: { reducer: string; before: number; after: number; pct: number }[] = [];

  constructor(private countTokens: (s: string) => number) {}

  register(r: Reducer): void { this.reducers.set(r.name, r); }

  // nén + emit footer
  async compressWith(reducerName: string, text: string): Promise<string> {
    const reducer = this.reducers.get(reducerName);
    if (!reducer) return text; // không có reducer → không nén
    const before = this.countTokens(text);
    const compressed = await reducer.apply(text);
    const after = this.countTokens(compressed);
    const pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
    this.history.push({ reducer: reducerName, before, after, pct });
    return `${compressed}\n[${reducerName}: ${before}->${after} tok, -${pct}%]`;
  }

  // telemetry aggregate (feed vào 494 savings accounting)
  reducerStats(): { reducer: string; calls: number; avgPct: number }[] {
    const map = new Map<string, { calls: number; totalPct: number }>();
    for (const h of this.history) {
      const e = map.get(h.reducer) ?? { calls: 0, totalPct: 0 };
      e.calls++; e.totalPct += h.pct; map.set(h.reducer, e);
    }
    return [...map.entries()].map(([reducer, e]) => ({ reducer, calls: e.calls, avgPct: Math.round(e.totalPct / e.calls) }));
  }
}

// Usage:
// footer.register({ name: 'hypa-summarize', apply: summarizeAsync });
// const out = await footer.compressWith('hypa-summarize', segment1200tok);
// // out = "summary...\n[hypa-summarize: 1200->340 tok, -72%]"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Provenance (agent biết reducer nào nén) | ❌ Footer tốn token (mỗi segment +1 dòng) |
| ✅ Debug (reducer nào tốt/tệ — telemetry) | ❌ Agent có thể nhầm (footer vs content) |
| ✅ Audit (token tiết kiệm thật, measured) | ❌ Reducer registry (quản lý nhiều reducer) |
| ✅ Phối 493/494 (footer → expand/accounting) | ❌ Footer format (cần parse được — machine-readable) |

## Khác các hướng gần

| | 466 Citation-Attribution | 494 Savings-Accounting | SD: Compression-Footer |
|---|---|---|---|
| Cite cái gì | Nguồn context | Savings tổng | **Reducer (ai nén)** |
| Granularity | Reply | Session | **Per-segment footer** |
| Cho ai | User (verify) | Operator (cost) | **Agent + user (awareness)** |

## Khi nào chọn

- Nhiều reducer (LLMLingua/summary/prune/DSL) — muốn biết cái nào chạy
- Agent cần awareness (biết context đã nén, có thể mất chi tiết)
- Muốn debug/audit reducer hiệu quả
- Nối packages/ai (compressor) + 466 citation + 494 accounting; guard footer format (machine-readable `[name: a->b tok, -X%]`) + footer token cost (ngắn) + reducer registry (version, registry); phối 493 reversible (footer → agent biết expand khi cần)
