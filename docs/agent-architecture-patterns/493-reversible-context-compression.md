# Hướng RY: Reversible Context Compression — nén mất mát có hoàn nguyên, bản gốc giữ local TTL

> **Nguồn gốc:** headroom (context-compression with reversibility / "CCR"); "lossy context compression reversible"; "keep original locally TTL"; "restore-on-demand from TTL window"; "compression with undo window"
> **Coupling:** 🟡 — thêm reversible layer quanh lossy compressor (compress → cache gốc TTL → restore khi cần)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai LLM client + context-window manager sẵn — chưa có TTL original-store + restore hook)
> **Effort:** 2-3 tuần

## Nguồn gốc

**headroom** định nghĩa **CCR (Context Compression with Reversibility)**: nén context **có mất mát** (lossy — summary/prune) để tiết kiệm token, **nhưng** không hủy bản gốc — giữ **bản gốc local** trong **TTL window** (ví dụ 5 phút / 50 lượt) để **hoàn nguyên** (restore) nếu nén làm mất chi tiết quan trọng. Nguyên tắc: **lossy không có nghĩa là vĩnh viễn** — trong cửa sổ TTL, agent (hoặc user) có thể "phóng to lại" (expand) phần đã nén để xem/đưa trở lại context đầy đủ. Khác **100 prompt-compression** (nén 1 chiều, không undo) — RY là **nén + cửa sổ undo**; khác **462 micro-compaction** (summary thay thế luôn) — RY **giữ gốc cạnh summary**.

## Mô tả

mya reversible context compression: (1) **Compress (lossy)**: context vượt budget → nén (summary/prune LLMLingua-style) ra bản nén. (2) **Cache gốc TTL**: bản gốc (full text + vị trí) lưu vào **local TTL store** (`compress- originals`, key = segment-id, TTL = N phút/lượt). (3) **Compressed đi LLM**: chỉ bản nén gửi tới LLM (token giảm). (4) **Restore-on-demand**: nếu phát hiện bản nén thiếu chi tiết (agent cần lại / user hỏi) → **expand** từ TTL store → khôi phục bản gốc vào context (trước khi TTL hết). (5) **Expire**: hết TTL → gốc bị xóa, bản nén trở thành vĩnh viễn (chốt lossy). mya có `packages/ai` + context-window manager — RY thêm **TTL original-store** + **expand hook** (compress ghi 2 nơi: nén đi LLM, gốc vào TTL).

## Kiến trúc

```
  CONTEXT (full) gần tràn budget
        │
        ▼
  ┌─── COMPRESS (lossy) ────────────────────────────────┐
  │  segment A (800 tok) → summary "read parser.rs ..."  │ (nén)
  │  segment B (600 tok) → pruned (300 tok)              │
  └───────────────┬───────────────────┬──────────────────┘
                  │                   │
        ┌─────────▼───────┐  ┌────────▼─────────────────┐
        │ COMPRESSED      │  │ TTL ORIGINAL-STORE       │
        │ (gửi tới LLM)   │  │ segA: full 800 tok, ttl  │
        │  token giảm ↓    │  │ segB: full 600 tok, ttl  │
        └─────────┬───────┘  │  (key = segment-id)       │
                  │          └────────┬─────────────────┘
                  │                   │ restore-on-demand
                  │          ┌────────▼─────────────────┐
                  │          │ agent/user cần chi tiết? │
                  │          │  expand(segA) → gốc vào  │
                  │          │  context lại (undo nén)   │
                  │          └──────────────────────────┘
                  ▼
  ┌─── TTL EXPIRE ──────────────────────────────────────┐
  │  hết TTL → gốc xóa → bản nén = vĩnh viễn (chốt)      │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — LLM client (nơi chèn compressor)
// ✅ context-window manager — token budget tracking (nền — RY probe + trigger)
// ✅ 100 prompt-compression — compressor (nền — RY bọc reversible quanh nó)
// ✅ 462 micro-compaction — per-turn rolling (nền — RY = TTL undo trên đó)

// ❌ THIẾU: TTL original-store (compress ghi 2 nơi: nén đi LLM + gốc vào store TTL)
// ❌ THIẾU: segment-id key (link bản nén ↔ bản gốc trong TTL)
// ❌ THIẾU: expand hook (restore bản gốc vào context khi cần, trước TTL hết)
// ❌ THIẾU: TTL expiry sweep (xóa gốc hết hạn → chốt lossy)
```

## Implementation

```typescript
// packages/ai/src/reversible-compression.ts (MỚI)
interface Segment { id: string; text: string; tokens: number }
interface Original { text: string; tokens: number; expiresAt: number } // TTL
interface Compressed { id: string; text: string; tokens: number; originalId: string }

class ReversibleCompression {
  private originals = new Map<string, Original>(); // key = segment-id

  constructor(
    private countTokens: (s: string) => number,
    private compress: (s: string) => Promise<string>,
    private ttlMs: number,
  ) {}

  // nén (lossy) + cache gốc TTL
  async compressSegment(seg: Segment): Promise<Compressed> {
    const compact = await this.compress(seg.text);
    // cache bản gốc TTL
    this.originals.set(seg.id, { text: seg.text, tokens: seg.tokens, expiresAt: Date.now() + this.ttlMs });
    return { id: seg.id, text: compact, tokens: this.countTokens(compact), originalId: seg.id };
  }

  // hoàn nguyên (expand) trước TTL hết
  expand(id: string): Segment | null {
    const orig = this.originals.get(id);
    if (!orig) return null; // đã hết TTL → lossy chốt
    return { id, text: orig.text, tokens: orig.tokens };
  }

  // sweep TTL expiry (chốt lossy cho gốc hết hạn)
  sweepExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, orig] of this.originals) {
      if (orig.expiresAt <= now) { this.originals.delete(id); removed++; }
    }
    return removed;
  }

  // restore-on-demand: agent phát hiện thiếu chi tiết → expand + đưa lại context
  restoreIfNeeded(ctx: Segment[], compressed: Compressed[], needDetailId: string): Segment[] {
    const orig = this.expand(needDetailId);
    if (!orig) return ctx; // hết TTL → không undo được
    return ctx.map(s => s.id === needDetailId ? orig : s); // thay compressed bằng gốc
  }
}

// Usage:
// const c = await rev.compressSegment({ id: 'segA', text: full800tok, tokens: 800 });
// send c.text tới LLM (token giảm); gốc nằm trong TTL store
// if (need detail) → ctx = rev.restoreIfNeeded(ctx, [c], 'segA');  // undo
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Undo window (nén sai → restore trước TTL hết) | ❌ Bộ nhớ local (giữ bản gốc song song — gấp đôi trong TTL) |
| ✅ An toàn hơn lossy thuần (100 — không hoàn nguyên) | ❌ TTL sweep overhead (quét expiry định kỳ) |
| ✅ Token vẫn giảm (gốc không đi LLM) | ❌ Sau TTL → lossy vĩnh viễn (không undo nữa) |
| ✅ Phối 462 micro-compaction (undo layer) | ❌ Phức tạp (segment-id link + 2 store) |

## Khác các hướng gần

| | 100 Prompt-Compression | 462 Micro-Compaction | RY: Reversible |
|---|---|---|---|
| Có undo | ❌ (1 chiều) | ❌ (thay luôn) | **✅ TTL window** |
| Bản gốc | Hủy | Thay bằng summary | **Giữ TTL (song song)** |
| Khi mất mát | Vĩnh viễn | Vĩnh viễn | **Reversible → expire** |

## Khi nào chọn

- Nén lossy nhưng sợ mất chi tiết quan trọng (muốn cửa sổ undo)
- Session dài, context phình, nhưng đôi khi cần expand lại (audit / verify)
- Chấp nhận thêm bộ nhớ local trong TTL window
- Nối packages/ai (compressor) + context-window manager (trigger) + 100 compression + 462 micro-compaction; guard TTL expiry sweep (gốc hết hạn → chốt) + restore timing (trước TTL hết) + segment-id link (nén ↔ gốc chính xác)
