# Hướng AAH: Waste Detector Composition — 14 detectors độc lập trả WasteFinding|null rồi gom lại xếp hạng theo impact

> **Nguồn gốc:** codeburn (docs/architecture.md) | **Coupling:** 🟢 — thêm detector pipeline, đọc từ telemetry/audit có sẵn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có telemetry + budget — chưa có waste detectors) | **Effort:** 2 tuần

## Nguồn gốc

**codeburn** dùng **14 detectors độc lập** phát hiện lãng phí token/cost: **junk reads** (đọc file không dùng), **duplicate reads** (đọc trùng), **bloated CLAUDE.md**, **ghost agents/skills/commands** (khai nhưng không tồn tại), **context bloat ratio > 25:1** (context lớn gấp 25 lần output hữu ích), **session outliers** (session đốt token bất thường). Mỗi detector trả `WasteFinding | null` — **composition**: gom tất cả finding lại rồi **xếp hạng theo impact** (token/cost ước tính). Nguyên tắc: **detector đơn trách nhiệm, tổng hợp ở pipeline** — thêm detector mới không đụng detector cũ.

## Mô tả

mya waste detector composition: packages/core telemetry.ts + budget.ts + audit có sẵn nguồn dữ liệu (event counts, spend, session). AAH thêm **detector pipeline**: mỗi detector nhận `WasteContext` (telemetry snapshot, session stats, budget) trả `WasteFinding | null` — ví dụ `DuplicateReadDetector` (tool events read trùng file), `ContextBloatDetector` (token in / token out ratio > 25), `GhostSkillDetector` (skill index vs file skill tồn tại). Pipeline gom findings, **rank theo impact** (token × cost), trả danh sách có thứ tự. Detector là pure functions — dễ test, dễ thêm.

## Kiến trúc

```
  WASTE CONTEXT (telemetry + budget + audit + skill store)
        │
        ▼
  ┌─── DETECTORS (14 độc lập) ─────────────────────────┐
  │  junkReads          → WasteFinding | null           │
  │  duplicateReads     → WasteFinding | null           │
  │  bloatedClaudeMd    → WasteFinding | null           │
  │  ghostAgents/Skills → WasteFinding | null           │
  │  contextBloat>25:1  → WasteFinding | null           │
  │  sessionOutliers    → WasteFinding | null           │
  │  … (tổng 14)                                        │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── COMPOSE + RANK ─────────────────────────────────┐
  │  findings = detectors.flatMap(f => f(ctx) ?? [])    │
  │  sort by impact (tokens × cost) DESC                │
  │  → [Finding{type, impact, evidence, fix}]           │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core telemetry.ts — event counts (nền cho detectors)
// ✅ packages/core budget.ts — spend accounting (nền impact estimate)
// ✅ packages/core cost.ts — token → USD (nền rank theo cost)
// ✅ packages/audit — audit log (nền evidence)
// ✅ packages/skills skill.ts + curator.ts — skill index (nền ghost skill detect)
// ✅ packages/memory auto-capture.ts — turn events (nền junk/duplicate read)

// ❌ THIẾU: WasteFinding/WasteContext types + detector pipeline
// ❌ THIẾU: 14 detectors (bắt đầu 4-6 chính)
// ❌ THIẾU: rank by impact (token × cost)
```

## Implementation

```typescript
// packages/core/src/waste.ts (NEW)export interface WasteFinding {
  type: string;        // "duplicate_read" | "context_bloat" | "ghost_skill" …
  impactTokens: number; // ước tính token lãng phí
  impactUsd: number;    // impactTokens × cost
  evidence: string;     // mô tả ngắn cho agent/user
}

export interface WasteContext {
  toolEvents: Array<{ name: string; args: Record<string, unknown>; ts: number }>;
  tokenIn: number; tokenOut: number;
  skillIndex: string[];
  skillFiles: string[];
}

export type WasteDetector = (ctx: WasteContext) => WasteFinding | null;

/** Detector ví dụ 1: duplicate reads (cùng path đọc ≥ 2 lần trong cửa sổ). */
export const duplicateReadDetector: WasteDetector = (ctx) => {
  const seen = new Map<string, number>();
  for (const e of ctx.toolEvents) {
    if (e.name === "read" && typeof e.args.path === "string") {
      seen.set(e.args.path, (seen.get(e.args.path) ?? 0) + 1);
    }
  }
  const dups = [...seen].filter(([, n]) => n >= 2);
  if (!dups.length) return null;
  const wasted = dups.length * 2_000; // ước tính: mỗi đọc lại ~2k token
  return { type: "duplicate_read", impactTokens: wasted, impactUsd: wasted / 1_000_000 * 3, evidence: dups.map(([p, n]) => `${p}×${n}`).join(", ") };
};

/** Detector ví dụ 2: context bloat ratio > 25:1. */
export const contextBloatDetector: WasteDetector = (ctx) => {
  const ratio = ctx.tokenIn / Math.max(1, ctx.tokenOut);
  if (ratio <= 25) return null;
  const wasted = ctx.tokenIn - ctx.tokenOut * 25;
  return { type: "context_bloat", impactTokens: wasted, impactUsd: wasted / 1_000_000 * 3, evidence: `ratio ${ratio.toFixed(1)}:1` };
};

/** Detector ví dụ 3: ghost skill (index có, file không tồn tại). */
export const ghostSkillDetector: WasteDetector = (ctx) => {
  const ghosts = ctx.skillIndex.filter((s) => !ctx.skillFiles.includes(s));
  if (!ghosts.length) return null;
  return { type: "ghost_skill", impactTokens: 0, impactUsd: 0, evidence: ghosts.join(", ") };
};

/** Pipeline: chạy mọi detector → gom → rank theo impact. */
export function runWasteAnalysis(ctx: WasteContext, detectors: WasteDetector[]): WasteFinding[] {
  return detectors
    .flatMap((d) => d(ctx) ?? [])
    .sort((a, b) => b.impactTokens - a.impactTokens); // rank theo impact
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Detector độc lập — thêm mới không đụng cũ | ❌ Impact ước tính heuristic — không chính xác tuyệt đối |
| ✅ Rank theo impact — agent sửa cái lãng phí nhất trước | ❌ 14 detectors là số lượng lớn — cần test từng cái |
| ✅ Pure functions — dễ unit test | ❌ Cần nguồn dữ liệu chuẩn (telemetry/audit) đầy đủ |
| ✅ Finding có evidence + fix — hành động được | ❌ False positive (đọc 2 lần có thể có chủ đích) |

## Khác các hướng gần

| | Telemetry (counts) | AAH: Waste Detectors |
|---|---|---|
| Output | Số liệu thô | **Finding có impact + evidence** |
| Hành động | Dashboard đọc | **Agent sửa theo rank** |
| Kiến trúc | Aggregate | **Composition 14 detectors** |
| Mối quan hệ | Nguồn dữ liệu | **Lớp phân tích trên telemetry** |

## Khi nào chọn

- Muốn agent tự phát hiện lãng phí token/cost và sửa
- Đã có telemetry + budget + audit — đủ dữ liệu cho detectors
- Bắt đầu 4-6 detectors chính, thêm dần; mỗi detector là pure function + test
- Kết hợp actionable remediation (AAI): finding kèm fix copy-paste được
