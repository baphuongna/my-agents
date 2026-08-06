# Hướng QT: Incremental Micro-Compaction — nén micro mỗi lượt chỉ gấp lượt-cũ-nhất thành summary

> **Nguồn gốc:** hermes-agent (trajectory_compressor.py); "incremental micro-compaction"; "compress oldest turn → summary each turn"; "rolling window summarization"; "trajectory compression within token budget"
> **Coupling:** 🟡 — thêm micro-compaction hook vào context-window manager (mỗi lượt → gấp 1 lượt cũ)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory + context-window manager sẵn — chưa có per-turn rolling compaction)
> **Effort:** 2-3 tuần

## Nguồn gốc

**hermes-agent** (`trajectory_compressor.py`) nén trajectory theo chiến lược: **protect first turns** (system/human/first-tool) + **protect last N turns** (final actions) + **compress MIDDLE turns** thành **single human summary**. **Incremental micro-compaction** mở rộng: thay vì nén tất cả middle cùng lúc (macro), **mỗi lượt mới** chỉ **gấp lượt-cũ-nhất** (oldest middle turn) thành **1 dòng summary** — **rolling window**. Nguyên tắc: **nén nhỏ liên tục** tốt hơn nén lớn gián đoạn — context luôn fit budget, không đợi tới khi tràn mới compact (giật cục). Khác **082 memory-consolidation** (snapshot cuối) — QT là **per-turn rolling**; khác **90 prompt-caching** (cache prefix) — QT là **summarize suffix cũ**.

## Mô tả

mya incremental micro-compaction: (1) **Window budget**: mỗi lượt kiểm tra context-window token count. (2) **Rolling compact**: nếu gần budget → gấp **lượt-cũ-nhất** (turn K) thành **1 dòng summary** (`turn K: read parser.rs, found null-token bug`). (3) **Protect**: không gấp first-turn (system/instructions) và last-N turn (active context). (4) **Replace**: turn K text → summary line, giải phóng token. (5) **Repeat next turn**: lượt mới đến → lại gấp lượt cũ nhất còn lại → context ổn định gần budget, không tràn. mya có `packages/memory` + context-window manager — QT thêm **rolling compactor** (1 turn → 1 summary mỗi lượt) + **budget probe** + **protected-range guard**.

## Kiến trúc

```
  CONTEXT WINDOW (turns 1..N), budget = 32k tokens:
  ┌─────────────────────────────────────────────────────┐
  │  [PROTECTED] turn 1: system prompt                   │
  │  [PROTECTED] turn 2: user request                    │
  │  [MIDDLE]    turn 3: read parser.rs (800 tok)        │ ← oldest middle
  │  [MIDDLE]    turn 4: edit parser.rs (600 tok)        │
  │  [MIDDLE]    turn 5: run tests (1200 tok)            │
  │  [PROTECTED] turn 6..N: last 3 turns (active)        │
  └───────────────────────┬─────────────────────────────┘
                          │ new turn N+1 arrives
                          ▼
  ┌─── MICRO-COMPACT (chỉ gấp lượt cũ nhất) ────────────┐
  │  turn 3 (800 tok) → summary: "read parser.rs:       │
  │   found null-token bug at line 142" (20 tok)         │
  │  → giải phóng 780 token                               │
  └───────────────────────┬─────────────────────────────┘
                          │ next turn N+2
                          ▼
  ┌─── ROLLING (gấp lượt cũ nhất mới) ──────────────────┐
  │  turn 4 (600 tok) → summary: "edited parser.rs:     │
  │   added EOF sentinel check" (15 tok)                 │
  │  → context luôn ổn định gần budget, không tràn        │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — memory store (nền — QT store summaries)
// ✅ context-window manager — token budget tracking (nền — QT probe)
// ✅ 082 memory-consolidation — snapshot (nền — QT = rolling micro)
// ✅ 90 prompt-caching — cache prefix (nền — QT protect prefix)

// ❌ THIẾU: rolling compactor (1 oldest middle turn → 1 summary line/turn)
// ❌ THIẾU: protected-range guard (first + last-N turn không gấp)
// ❌ THIẾU: budget probe (token count → trigger compact khi gần budget)
// ❌ THIẾU: summary generator (turn content → concise 1-line)
```

## Implementation

```typescript
// packages/agent/src/micro-compaction.ts (MỚI)
interface Turn { id: number; role: string; content: string; tokens: number; compacted?: boolean }

class MicroCompactor {
  constructor(
    private countTokens: (s: string) => number,
    private summarize: (content: string) => Promise<string>,
    private budget: number,
    private protectedTail = 3,
  ) {}

  // mỗi lượt gọi: nếu gần budget → gấp lượt middle cũ nhất
  async compactIfNeeded(turns: Turn[]): Promise<Turn[]> {
    const total = turns.reduce((s, t) => s + t.tokens, 0);
    if (total <= this.budget * 0.85) return turns; // còn dư, không gấp

    // tìm oldest middle turn chưa gấp (bỏ first 2 protected + last N protected)
    const middleStart = 2;
    const middleEnd = turns.length - this.protectedTail;
    for (let i = middleStart; i < middleEnd; i++) {
      const t = turns[i]!;
      if (!t.compacted) {
        const summary = await this.summarize(t.content);
        t.content = `[summary] ${summary}`;
        t.tokens = this.countTokens(t.content);
        t.compacted = true;
        break; // chỉ gấp 1 lượt/lần (micro)
      }
    }
    return turns;
  }
}

// Usage (trong main loop, mỗi lượt):
// turns.push(newTurn);
// turns = await compactor.compactIfNeeded(turns);  // gấp 1 lượt cũ nếu gần budget
// → context luôn ổn định, không tràn đột ngột
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context luôn ổn định (rolling, không giật cục khi tràn) | ❌ Summary chất lượng (gấp hỏng → mất thông tin) |
| ✅ Mượt (1 turn/lượt, không compact lớn gián đoạn) | ❌ Overhead (summarize mỗi lượt khi gần budget) |
| ✅ Token giải phóng dần (780/turn) | ❌ Chain-summary (summary của summary → drift) |
| ✅ Nối 082 consolidation (micro layer) | ❌ Protected range sai → gấp wrong turn (mất active) |

## Khác các hướng gần

| | 082 Memory-Consolidation | 90 Prompt-Caching | QT: Micro-Compaction |
|---|---|---|---|
| Cái gì | Snapshot cuối | Cache prefix | **Gấp 1 turn cũ/lượt** |
| Khi | Cuối task | Mỗi call | **Mỗi lượt (rolling)** |
| Đơn vị | Toàn bộ context | Prefix stable | **Oldest middle turn** |

## Khi nào chọn

- Session dài (context sắp tràn, không thể giữ full history)
- Muốn mượt (rolling, không giật khi tràn đột ngột)
- First/last turns quan trọng (protect, chỉ gấp middle)
- Nối packages/memory (store summaries) + context-window manager (budget probe) + 082 consolidation; guard summary quality (không gấp mù) + protected-range (không gấp active) + chain-drift (summary lồng nhiều lần → sai lệch)
