# Hướng AEF: Cascading Replace Strategies — chuỗi chiến lược khớp từ exact đến block-anchor

> **Nguồn gốc:** pi-diff | **Coupling:** 🟢 — thuật toán replace, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn hashline-edit; thiếu cascade replacer) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-diff** có **`src/core/replace.ts`**: **cascade replacer** — thử lần lượt các chiến lược từ **exact match → escape-normalized → line-trimmed → block-anchor**, kèm **Levenshtein similarity** cho trường hợp gần khớp. Quy tắc: chiến lược đầu tiên khớp **đúng 1 candidate** thì thắng; **nhiều candidate → reject** để an toàn (không đoán bừa chỗ nào để sửa).

Pattern chống failure mode: edit tool match cứng (exact) fail vì whitespace/escape khác nhau; hoặc match lỏng quá sửa nhầm chỗ. Cascade cho độ **bền với formatting** (normalize rồi mới so) mà vẫn **an toàn** (reject khi mơ hồ).

## Mô tả

Với mya, `packages/tools/src/hashline-edit.ts` đã có edit có verify. Pattern thêm **cascade replacer** vào core edit path: (1) exact match; (2) escape-normalized (decode escape sequences); (3) line-trimmed (trim whitespace đầu/cuối mỗi dòng); (4) block-anchor (khớp theo anchor block); kèm **Levenshtein similarity ≥ ngưỡng** cho gần khớp. Mỗi tầng: **0 candidate → xuống tầng sau; 1 candidate → replace; ≥2 candidate → REJECT**. `packages/memory` retrieve.ts đã có Levenshtein + fuzzy correction — tái dùng. Audit ghi tầng nào thắng (nối AEC apply log).

## Kiến trúc (ASCII)

```
  REPLACE REQUEST (oldText → newText)
    │
    ▼ CASCADE (tầng đầu khớp đúng 1 candidate thắng)
    ├─ 1. exact match ────────────► khớp 1 → replace
    ├─ 2. escape-normalized ──────► decode escape rồi so
    ├─ 3. line-trimmed ───────────► trim whitespace mỗi dòng
    └─ 4. block-anchor ───────────► khớp theo anchor block
         + Levenshtein similarity ≥ ngưỡng (gần khớp)
            │
            ▼
  QUYẾT ĐỊNH
    ├─ 0 candidate ──► xuống tầng sau (hoặc fail hết)
    ├─ 1 candidate ──► REPLACE an toàn
    └─ ≥2 candidate ──► REJECT (không đoán bừa)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools/src/hashline-edit.ts — edit có verify (đối tượng cascade)
// ✅ packages/memory/src/retrieve.ts — Levenshtein + fuzzy correction
//   (tái dùng cho tầng gần khớp)
// ✅ packages/core — ToolResult (trả kết quả replace + tầng đã dùng)
// ✅ packages/audit — AuditLog (ghi tầng thắng — nối AEC)
// ✅ packages/eval — tests cho replace an toàn

// ❌ THIẾU: cascade replacer (4 tầng + Levenshtein)
// ❌ THIẾU: reject rule (≥2 candidate → từ chối)
// ❌ THIẾU: báo tầng nào thắng (audit + UX)
```

## Implementation

```typescript
// packages/tools/src/cascade-replace.ts (NEW)
export type MatchTier = "exact" | "escape-normalized" | "line-trimmed" | "block-anchor";

export function cascadeReplace(
  source: string,
  oldText: string,
  newText: string,
  opts: { levenshteinThreshold?: number } = {},
): { ok: true; result: string; tier: MatchTier } | { ok: false; reason: string; candidates: number } {
  const tiers: Array<{ tier: MatchTier; normalize: (s: string) => string }> = [
    { tier: "exact", normalize: (s) => s },
    { tier: "escape-normalized", normalize: unescapeSequences },
    { tier: "line-trimmed", normalize: (s) => s.split("\n").map((l) => l.trim()).join("\n") },
    { tier: "block-anchor", normalize: (s) => anchorBlocks(s) },
  ];

  for (const t of tiers) {
    const normSrc = t.normalize(source);
    const normOld = t.normalize(oldText);
    const candidates = findCandidates(normSrc, normOld, opts.levenshteinThreshold ?? 0.9);

    if (candidates.length === 1) {
      // 1 candidate — replace an toàn, ghi tầng thắng
      const [idx] = candidates[0] ?? [0];
      return { ok: true, result: source.slice(0, idx) + newText + source.slice(idx + oldText.length), tier: t.tier };
    }
    if (candidates.length > 1) {
      // ≥2 candidate — REJECT, không đoán bừa
      return { ok: false, reason: "ambiguous", candidates: candidates.length };
    }
    // 0 candidate → xuống tầng sau
  }
  return { ok: false, reason: "no-match", candidates: 0 };
}

function findCandidates(src: string, oldText: string, threshold: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= src.length - oldText.length; i++) {
    const slice = src.slice(i, i + oldText.length);
    if (slice === oldText) out.push([i, oldText.length]);
    else if (levenshtein(slice, oldText) / oldText.length <= 1 - threshold) {
      out.push([i, oldText.length]);   // gần khớp theo Levenshtein
    }
  }
  return out;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bền với whitespace/escape khác nhau | ❌ Nhiều tầng normalize — code phức tạp hơn |
| ✅ Reject khi mơ hồ — không sửa nhầm | ❌ Levenshtein O(n·m) chậm trên file lớn |
| ✅ Ghi tầng thắng — biết vì sao khớp | ❌ Block-anchor cần heuristic tốt |
| ✅ Nối AEC (audit mỗi replace) | ❌ Threshold sai → bỏ sót hoặc khớp nhầm |

## Khác các hướng gần

| | AEF Cascade Replace | ADQ Rewrite Registry | ADR Filter DSL |
|---|---|---|---|
| Đơn vị | Source code block | Output command | Dòng output |
| Chiến lược | 4 tầng + Levenshtein | 3 đường quyết định | 3 tier parse |
| An toàn | Reject ≥2 candidate | Passthrough unsafe | Passthrough + marker |

## Khi nào chọn

- Edit tool hay fail vì formatting (whitespace, escape)
- Cần an toàn tuyệt đối — không sửa nhầm chỗ
- Đã có hashline-edit + Levenshtein (retrieve.ts) — thêm cascade
- Muốn audit tầng nào đã khớp cho từng replace