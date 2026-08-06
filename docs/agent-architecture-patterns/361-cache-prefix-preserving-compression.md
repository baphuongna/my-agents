# Hướng MW: Cache-Prefix-Preserving Compression — CacheAligner giữ KV-cache prefix khi nén, không phá cache hit

> **Nguồn gốc:** Prompt caching (Anthropic prompt cache, OpenAI KV-cache); "prefix-preserving edit"; cache breakpoint; "cache-aware truncation"; prompt cache invalidation; "stable prefix"
> **Coupling:** 🟡 — thêm CacheAligner vào context pipeline (can thiệp thứ tự nén)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (166 prompt-caching-layer + 191 kv-semantic-cache sẵn — chưa có cache-aware compression)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**Prompt caching** (Anthropic / OpenAI): prefix prompt được cache ở KV-cache — lặp lại → cache hit (rẻ, nhanh). **Cache invalidation**: sửa **1 byte trong prefix** → toàn bộ cache miss (tính lại). **Vấn đề**: context compression (nén block giữa) vô tình **chỉnh sửa prefix** → phá cache hit → đắt hơn. **CacheAligner**: compressor biết **đâu là prefix cache** → **không chạm** phần đã cache, chỉ nén phần *sau* cache breakpoint. Nguyên tắc: **nén phải tôn trọng cache boundary** — giữ prefix nguyên vẹn để cache hit. Khác **100 CV prompt-compression** (nén tất cả, không biết cache) — MW **cache-aware**; khác **166 FJ prompt-caching-layer** (set cache breakpoint) — MW **bảo vệ** breakpoint khi nén.

## Mô tả

mya cache-prefix-preserving compression: CacheAligner nhận context + vị trí cache breakpoint → chia làm **prefix (cached)** và **suffix (uncached)**. Prefix: **không nén** (giữ nguyên byte → cache hit). Suffix: nén tự do (compressor 359 MU). Kết quả: tiết kiệm token (suffix nén) **mà không** mất cache hit (prefix nguyên vẹn). Nối 166 FJ (cache layer) — MW là **compression policy** bảo vệ cache.

## Kiến trúc

```
  CONTEXT: [ system | tools | history... | new turn ]
            ◄────── cached prefix ──────►◄─ suffix ─►
                     (KV-cache hit)          (mỗi turn mới)
                          │                       │
                          ▼                       ▼
                   ┌─── CACHE ALIGNER ───────────────────┐
                   │  split at breakpoint:               │
                   │   prefix = [..., history]  → FREEZE │
                   │   suffix = [new turn]     → COMPRESS│
                   └──┬──────────────────────────┬───────┘
                      ▼                          ▼
                 KEEP byte-identical     compress (359 MU)
                 (cache hit ✅)          (token giảm ✅)
                      │                          │
                      └──────────┬───────────────┘
                                 ▼
         COMPRESSED CONTEXT = frozen prefix + compressed suffix
         → cache hit preserved + token saved
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 166 FJ prompt-caching-layer — set cache breakpoint (nền)
// ✅ 191 GI kv-semantic-cache — semantic cache (nền)
// ✅ 100 CV prompt-compression — entropy compressor (cho suffix)
// ✅ 359 MU content-type-aware — compressor (cho suffix)

// ❌ THIẾU: cache-aware split (prefix/suffix theo breakpoint)
// ❌ THIẾU: freeze policy (prefix byte-identical guarantee)
// ❌ THIẾU: cache-miss detection → re-freeze new prefix
```

## Implementation

```typescript
// packages/agent/src/cache-aligner.ts (NEW)
interface CacheBreakpoint {
  index: number;     // block index nơi cache prefix kết thúc
  hash: string;      // hash của prefix (đối chiếu cache hit)
}

class CacheAligner {
  constructor(
    private compress: (text: string) => string, // 359 MU / 100 CV
    private lastPrefixHash: string | null = null,
  ) {}

  align(blocks: string[], bp?: CacheBreakpoint): { context: string; prefixChanged: boolean } {
    if (!bp) {
      // không có cache → nén toàn bộ
      return { context: blocks.map(b => this.compress(b)).join('\n'), prefixChanged: true };
    }
    const prefix = blocks.slice(0, bp.index).join('\n');
    const suffix = blocks.slice(bp.index);

    // Verify prefix chưa đổi → cache hit
    const prefixHash = this.hash(prefix);
    const prefixChanged = prefixHash !== bp.hash;

    if (prefixChanged) {
      // prefix đổi → cache miss, nén cả prefix lần này
      const all = blocks.map(b => this.compress(b)).join('\n');
      this.lastPrefixHash = this.hash(blocks.slice(0, bp.index).join('\n'));
      return { context: all, prefixChanged: true };
    }

    // prefix ổn định → freeze, chỉ nén suffix
    const compressedSuffix = suffix.map(b => this.compress(b)).join('\n');
    return { context: `${prefix}\n${compressedSuffix}`, prefixChanged: false };
  }

  private hash(s: string): string {
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }
}

// Usage:
// const { context, prefixChanged } = aligner.align(blocks, breakpoint);
// if (prefixChanged) warn('cache miss — prefix changed');
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cache hit giữ nguyên (prefix byte-identical) | ❌ Phải biết breakpoint (cần 166 FJ) |
| ✅ Vẫn giảm token (suffix nén) | ❌ Prefix lớn → ít block để nén |
| ✅ Tránh cache invalidation vô tình | ❌ Hash overhead mỗi turn |
| ✅ Nối 166 FJ + 191 GI (cache) | ❌ Provider khác nhau khác breakpoint rule |

## Khác các hướng gần

| | 100 Prompt Compression | 166 Prompt Caching | 191 KV Semantic Cache | MW: Cache-Prefix-Preserving |
|---|---|---|---|---|
| Cái gì | Nén tất cả | Set breakpoint | Semantic match | **Nén tôn trọng breakpoint** |
| Cache-aware | ❌ | ✅ (set) | ✅ (match) | ✅ (bảo vệ) |
| Freeze prefix | ❌ | ❌ | ❌ | ✅ |
| Compress suffix | ✅ (toàn bộ) | ❌ | ❌ | ✅ |

## Khi nào chọn

- Dùng prompt caching (Anthropic/OpenAI) và cũng nén context
- Prefix ổn định (system + tools + history dài) tái sử dụng qua turn
- Muốn giảm token **mà không** phá cache hit
- Kết hợp 166 FJ (breakpoint) + MW (compress policy) + 359 MU (suffix compressor); guard prefix-changed detection (re-freeze khi cache miss)
