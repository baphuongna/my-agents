# Hướng AJK: Identity Continuity Anchor — artifacts phục hồi identity (`identity-anchor.md`, incident records append-only, weekly/monthly audits, improvement-loops) để agent lấy lại hành vi ổn định sau drift/context loss

> **Nguồn gốc:** remnic | **Coupling:** 🟡 — identity persistence + injection | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có stable tier identity + DriftGrader; chưa có anchor artifact + incident/audit/improvement cycles) | **Effort:** 2.5 tuần

## Nguồn gốc

**remnic** identity continuity thêm **artifacts phục hồi**: `identity-anchor.md` (file mỏ neo identity — hành vi cốt lõi ổn định), **incident records append-only** (ghi các lần drift/context loss), **weekly/monthly audits** (rà identity định kỳ), **improvement-loops** (chu kỳ cải tiến hành vi). **Injection tôn trọng `identityMaxInjectChars`** và **fail-open khi parse lỗi** — agent lấy lại hành vi ổn định sau drift/context loss.

Nguyên tắc: **identity là artifact phục hồi** — không chỉ system prompt inline, mà file mỏ neo đọc lại khi agent bị drift/context loss; **incident records append-only** — mỗi lần agent lệch hành vi được ghi (provenance: khi nào, vì sao, khắc phục); **audit chu kỳ** — weekly/monthly rà identity có còn đúng; **inject bounded + fail-open** — giới hạn ký tự (`identityMaxInjectChars`), parse lỗi không crash (fail-open → dùng default identity).

## Mô tả

Với mya, pattern = **identity persistence + recovery artifacts**: (1) **mya có stable tier (assembler.ts)** — identity trong system prompt hash-stable, `defaultStableTier(name)` — nền identity inline có; (2) **mya có DriftGrader (drift.ts)** — score drift qua golden cases — nền detect drift; (3) **AJK thêm `identity-anchor.md`** — file mỏ neo (hành vi cốt lõi, principles, constraints) lưu trong workspace/memory; (4) **inject anchor** vào stable tier (nối assembler) với `identityMaxInjectChars` bound; (5) **incident records append-only** — log drift/context loss (nối drift.ts detection → incident store); (6) **weekly/monthly audit** — cron (packages/cron) rà anchor vs current behavior; (7) **improvement-loops** — sau audit, update anchor; (8) **fail-open** — parse anchor lỗi → dùng `defaultStableTier` (không crash). Recovery: khi context loss/drift detected → re-inject anchor mạnh hơn.

## Kiến trúc (ASCII)

```
  IDENTITY-ANCHOR.md  (mỏ neo — hành vi cốt lõi, principles, constraints)
    │
    ▼ INJECT vào stable tier (assembler) — bounded identityMaxInjectChars
    ├─ parse OK    ──► anchor text inject vào system prompt
    └─ parse FAIL  ──► FAIL-OPEN ──► defaultStableTier(name) (không crash)
    │
    ▼ DRIFT / CONTEXT LOSS detected (DriftGrader)
    ├─► record INCIDENT (append-only: khi nào, vì sao, khắc phục)
    └─► RE-RECOVER ──► re-inject anchor mạnh hơn
    │
    ▼ AUDIT CYCLES (cron — weekly/monthly)
    ├─ rà anchor vs current behavior
    └─ improvement-loop ──► update anchor.md
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts assembler.ts — stable tier (identity) hash-stable,
//   defaultStableTier(name), rebuildStableTier (nền identity inline)
// ✅ packages/prompts drift.ts — DriftGrader, identityCompressor, DriftGrade
//   (nền detect drift — golden case scoring)
// ✅ packages/ai route-identity.ts — identity routing (nền)
// ✅ packages/cron — cron scheduler (nền weekly/monthly audit)
// ✅ packages/memory brain.ts — BrainPage { compiledTruth, version } (nền artifact)

// ❌ THIẾU: identity-anchor.md artifact (mỏ neo file) + inject vào stable tier
// ❌ THIẾU: incident records append-only (drift/context loss log)
// ❌ THIẾU: identityMaxInjectChars bound + fail-open parse
// ❌ THIẾU: weekly/monthly audit + improvement-loops
```

## Implementation

```typescript
// packages/prompts/src/identity-anchor.ts (NEW)
export interface IdentityAnchor {
  text: string;            // hành vi cốt lõi, principles, constraints
  version: number;
}

export interface IncidentRecord {
  at: number; reason: string; driftScore: number; fix: string;
}

/** Đọc anchor — fail-open: parse lỗi → null (gọi defaultStableTier). */
export function loadAnchor(path: string): IdentityAnchor | null {
  try { return { text: readFileSync(path, "utf8"), version: 1 }; }
  catch { return null; }   // fail-open — không crash
}

/** Inject anchor vào stable tier, bounded identityMaxInjectChars. */
export function injectAnchor(
  anchor: IdentityAnchor | null,
  fallback: string,
  maxChars: number,        // identityMaxInjectChars
): string {
  const base = anchor ? anchor.text : fallback;   // null → default
  return base.length > maxChars ? base.slice(0, maxChars) : base;
}
// assembler.rebuildStableTier(): injectAnchor(loadAnchor(ws), defaultStableTier(n),
//   cfg.identityMaxInjectChars). DriftGrader detect → append IncidentRecord →
// audit cron weekly/monthly rà + improvement-loop update anchor.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Recovery sau drift/context loss — re-inject anchor | ❌ Anchor artifact cần maintain — stale nếu quên update |
| ✅ Incident records truy vết — biết khi nào lệch | ❌ Audit chu kỳ tốn LLM — cần gate (cron) |
| ✅ Fail-open an toàn — parse lỗi không crash | ❌ identityMaxInjectChars cắt mất nội dung nếu anchor dài |
| ✅ Nối DriftGrader (detect) + cron (audit) | ❌ Append-only incident phình — cần retention |

## Khác các hướng gần

| | AJK Identity Anchor | AJH Synthesis-Timeline | AJE Trace→Primitive |
|---|---|---|---|
| Trọng tâm | Identity persistence + recovery | Format entity 2 lớp | Capture pipeline |
| Cơ chế | Anchor + incident + audit + fail-open | Synthesis + timeline + stale | Judge + staging + commit |
| Quan hệ | Mỏ neo behavioral; facts là dữ liệu | Provenance source/session | Sinh facts |

## Khi nào chọn

- Agent hay drift/context loss — cần mỏ neo identity phục hồi
- Muốn truy vết incident (khi nào lệch, vì sao)
- Đã có stable tier + DriftGrader — muốn nâng thành artifact + audit cycle
- Guard: identityMaxInjectChars bound, fail-open parse (không crash), cron gate cho audit, retention cho incident records
