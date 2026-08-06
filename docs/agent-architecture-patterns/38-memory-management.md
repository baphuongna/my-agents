# Hướng AL: Memory Management — context compaction, 3-tier hierarchy

> **Nguồn gốc:** LLM context window constraint (2022–); pi-vcc ranked compaction
> **Coupling:** 🟢 — mya nội bộ, agents không cần biết
> **Agent-agnostic:** ✅ — bất kỳ agent có prompt dài
> **Code sẵn:** ✅ packages/prompts (compress, ranked-compaction) + packages/memory
> **Effort:** 0 — đã implement, cần tích hợp policy

## Nguồn gốc

Context window là tài nguyên hiếm nhất của LLM agents: dài quá → cost tăng + chất lượng giảm, ngắn quá → mất ngữ cảnh. pi-vcc (pi coding agent) xử lý bằng **ranked block selection**: phân hạng các block lịch sử theo giá trị, giữ block quan trọng, tóm tắt block cũ. Đây không phải một tính năng — là **policy liên tục** chạy trong vòng đời session.

## Mô tả

3 tầng nhớ, mỗi tầng có chiến lược riêng:
- **Tầng 1 — Working (prompt)**: 3-tier cache-stable prompt. Khi vượt token limit → compact: ưu tiên giữ tail + block quan trọng, summarize phần head theo template.
- **Tầng 2 — Project (brain)**: facts + takes + tombstones, auto-capture từ tin nhắn, compaction định kỳ (dọn tombstone cũ).
- **Tầng 3 — Long-term (dream)**: định kỳ LLM summarize + trích pattern từ facts gần đây, lưu thành "dream facts" — thay thế nội dung cũ mà vẫn giữ tinh hoa.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                 MEMORY HIERARCHY (3 tầng)                   │
│                                                            │
│  T1: WORKING (prompt, tokens giới hạn)                     │
│  ├─ stableTier: identity + tools + skills   (cache-stable) │
│  ├─ volatileTier: task + recent turns       (cache-miss)   │
│  └─ vượt limit → rankedCompact + summarize head            │
│                                                            │
│  T2: PROJECT (SQLite brain, WAL)                           │
│  ├─ facts (auto-capture, grounding, graph)                 │
│  ├─ compaction: tombstone > 72h bị drop                    │
│  └─ index: BM25 + trigram + vector + fuzzy cache           │
│                                                            │
│  T3: LONG-TERM (dream cycle)                               │
│  └─ định kỳ summarizeWithProvider(recent facts)            │
│     → dream facts: pattern + tinh hoa, xóa bản thô         │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (toàn bộ)

```typescript
// packages/prompts/src/compress.ts
//  - shouldIdleCompact(opts)     — idle gap trigger predicate
//  - first-compaction template   — 13 sections
//  - rolling update template     — re-compaction
//  - ineffectiveCount ≥ 2        — compaction không giúp → dừng

// packages/prompts/src/ranked-compaction.ts — PORT của pi-vcc
//  rankedCompact(events, { maxTokens }) — Phase 3-1 ranked block selection

// packages/prompts/src/compressors.ts
//  windowCompressor · summarizeCompressor · nativeContentCompressor
//  overflowRecovery — 4 compressor, chọn theo tình huống

// packages/memory/src/dream-cycle.ts
//  summarizeWithProvider(recent) — LLM summarize → dream fact

// packages/memory/src/brain-store.ts — compact(): tombstone > 72h drop

// packages/prompts/src/assembler.ts — 3-tier cache-stable prompt (§5)
```

## Policy (gắn kết các mảnh)

```typescript
// packages/prompts/src/memory-policy.ts (NEW — orchestration)
interface MemoryPolicy {
  maxTokens: number;
  tiers: {
    working: { limit: number; compressors: Compressor[] };
    project: { index: boolean; compactAfterDays: number };
    longTerm: { summarizeEveryMs: number; provider: "auto" | "none" };
  };
}

const DEFAULT_POLICY: MemoryPolicy = {
  maxTokens: 128_000,
  tiers: {
    working: {
      limit: 100_000,
      compressors: [overflowRecovery, summarizeCompressor, windowCompressor],
    },
    project: { index: true, compactAfterDays: 3 },
    longTerm: { summarizeEveryMs: 6 * 3600_000, provider: "auto" },
  },
};

// Vòng đời: assemble → vượt limit → compact T1 → tràn T2 → dream T3
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giữ ngữ cảnh quan trọng (ranked selection) | ❌ Summarize tốn 1 LLM call (dream cycle) |
| ✅ Cache-stable → tận dụng provider prompt cache | ❌ Thông tin chi tiết mất khi summarize |
| ✅ Idle compaction (không chặn turn) | ❌ Policy nhiều tham số, dễ tinh chỉnh sai |
| ✅ Đã port pi-vcc, đã test (5.370 tests) | ❌ ineffective compaction → loop lãng phí |
| ✅ Tách rõ 3 tầng (prompt/brain/dream) | |

## Khi nào chọn

- Session dài (hàng trăm turns) — bắt buộc
- Muốn giảm cost (compact thay vì tăng context)
- Đã có packages/memory + packages/prompts — chỉ cần policy
- Muốn cache-stable prompt cho provider caching
- Muốn agent nhớ dự án qua nhiều session (dream)
