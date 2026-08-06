# Hướng AJI: Dreams Consolidation Phases — consolidation nền chia ba phase: light sleep (activity scoring + clustering), REM (cross-session synthesis, supersession resolution, semantic SPLIT/MERGE/UPDATE), deep sleep (promotion hot→cold tier, page-version snapshot, archive)

> **Nguồn gốc:** remnic | **Coupling:** 🟡 — consolidation pipeline memory | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (DreamCycle + lifecycle + consolidate; thiếu 3 phase + semantic ops) | **Effort:** 3 tuần

## Nguồn gốc

**remnic** consolidation nền chia **ba phase**: **light sleep** (activity scoring + clustering), **REM** (cross-session synthesis, supersession resolution, semantic consolidation **SPLIT/MERGE/UPDATE**), **deep sleep** (promotion **hot→cold tier**, page-version snapshot, archive). Mỗi phase có **config gates riêng** — không phải chạy hết mỗi lần, mà theo điều kiện (activity level, nhu cầu, tần suất).

Nguyên tắc: **consolidation phân tầng theo chi phí** — light (rẻ, thường xuyên: score + cluster) → REM (đắt, vừa phải: LLM synthesis + semantic ops) → deep (nặng, hiếm: tier promotion + snapshot + archive); **mỗi phase có gate riêng** — chỉ chạy khi cần (REM chỉ khi có cross-session conflict; deep chỉ khi hot quá nhiều); **semantic ops có tên rõ** — SPLIT (một memory quá to tách ra), MERGE (nhiều memory trùng gộp), UPDATE (synthesis cập nhật).

## Mô tả

Với mya, pattern = **nâng cấp DreamCycle thành 3 phase**: (1) **mya có DreamCycle (dream-cycle.ts)** — timer interval 4h, consolidationFn (LLM decision), dreamSQLite (consolidate L0→L1) — nền đúng; (2) **light sleep = activity scoring + clustering** — mya có `sqlite-consolidate` (salience + access boost + grouping) + `retrieve` clustering (cosine) — phase này gần có sẵn; (3) **REM = cross-session synthesis + supersession + SPLIT/MERGE/UPDATE** — mya có conflict.ts (Jaccard supersede) + governance (contradiction) — thiếu **LLM semantic ops** (SPLIT/MERGE/UPDATE quyết định bằng LLM — nối consolidationFn pattern); (4) **deep sleep = hot→cold promotion + page-version snapshot + archive** — mya có tree.ts (L0→L1→L2 promote) + brain-store (version) + retention (purge) — gần có sẵn, thiếu page-version snapshot + archive rõ; (5) **config gates riêng** — light chạy mỗi dream cycle; REM chỉ khi có conflict/unresolved; deep chỉ khi hot count > ngưỡng; (6) **nối AJH** — REM regenerate synthesis (entity two-layer). Timer + shutdown pattern giữ nguyên (unref + shutdown flag có sẵn).

## Kiến trúc (ASCII)

```
  DREAM CYCLE TIMER (4h — unref, shutdown-safe — có sẵn)
    │
    ▼ LIGHT SLEEP (rẻ — mỗi cycle)
    ├─ activity scoring (salience + access boost — sqlite-consolidate có)
    └─ clustering (cosine groups — retrieve có)
    │
    ▼ REM (đắt — gate: có conflict/unresolved)
    ├─ cross-session synthesis (LLM — nối AJH regenerate)
    ├─ supersession resolution (Jaccard — conflict.ts có)
    └─ semantic SPLIT / MERGE / UPDATE (LLM decision — consolidationFn)
    │
    ▼ DEEP SLEEP (nặng — gate: hot > ngưỡng)
    ├─ promotion hot→cold tier (tree.ts L0→L1→L2 có)
    ├─ page-version snapshot (brain-store version — bổ sung snapshot)
    └─ archive (retention/purge — archive dir rõ)
  (mỗi phase config gate riêng — không chạy hết mỗi lần)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory dream-cycle.ts — DreamCycle (timer 4h, unref, shutdown,
//   consolidationFn LLM decision — nền orchestration)
// ✅ packages/memory sqlite-consolidate.ts — salience + access boost + grouping
//   (light sleep — gần có)
// ✅ packages/memory conflict.ts — Jaccard supersede (REM supersession có)
// ✅ packages/memory governance.ts — contradiction detect (REM input)
// ✅ packages/memory tree.ts — L0→L1→L2 promote (deep promotion có)
// ✅ packages/memory brain-store.ts — version field (deep page-version nền)
// ✅ packages/memory sqlite-consolidate.ts — purge/retention (deep archive nền)

// ❌ THIẾU: 3-phase pipeline rõ ràng + config gates riêng
// ❌ THIẾU: REM semantic SPLIT/MERGE/UPDATE (LLM decision)
// ❌ THIẾU: deep page-version snapshot + archive dir rõ
```

## Implementation

```typescript
// packages/memory/src/dream-phases.ts (NEW)
export interface PhaseGates {
  lightEveryCycle: boolean;        // light — chạy mỗi cycle
  remOnConflict: boolean;          // REM — chỉ khi conflict/unresolved
  deepHotThreshold: number;        // deep — chỉ khi hot > ngưỡng
}

export type SemanticOp = "split" | "merge" | "update";

export async function runDreamPhases(
  deps: {
    scoreActivity(): void;                 // light: salience + access boost
    cluster(): string[];                   // light: cosine groups
    findConflicts(): Array<{ a: string; b: string }>;  // REM gate
    semanticDecide(text: string): Promise<{ op: SemanticOp; text: string }>; // LLM
    promoteHotToCold(): number;            // deep: tree promote
    snapshotPageVersion(id: string): void; // deep: page-version snapshot
    archiveCold(threshold: number): number; // deep: archive/purge
    hotCount(): number;                    // deep gate
  },
  gates: PhaseGates,
): Promise<{ light: number; rem: number; deep: number }> {
  // LIGHT — rẻ, mỗi cycle.
  deps.scoreActivity();
  const clusters = deps.cluster();
  // REM — đắt, gate theo conflict.
  let rem = 0;
  if (gates.remOnConflict && deps.findConflicts().length > 0) {
    for (const c of clusters) {
      const decision = await deps.semanticDecide(c);     // SPLIT/MERGE/UPDATE
      if (decision.op !== "update" || decision.text) rem++;
    }
  }
  // DEEP — nặng, gate theo hot count.
  let deep = 0;
  if (deps.hotCount() > gates.deepHotThreshold) {
    deep += deps.promoteHotToCold();
    for (const id of clusters.slice(0, 10)) deps.snapshotPageVersion(id);
    deep += deps.archiveCold(gates.deepHotThreshold);
  }
  return { light: clusters.length, rem, deep };
}
// DreamCycle.dream(): thay pipeline đơn bằng runDreamPhases + gates config.
// REM semanticDecide: LLM structured output { op, text } (consolidationFn pattern).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân tầng chi phí — light rẻ thường xuyên, deep nặng hiếm | ❌ 3 phase phức tạp — cần test kỹ từng phase + gate |
| ✅ Gate riêng — không chạy đắt khi không cần | ❌ REM LLM tốn token — gate phải chuẩn (conflict thật) |
| ✅ Nối có sẵn (lifecycle/consolidate/tree) | ❌ Deep snapshot/archive tốn disk — retention phải rõ |
| ✅ Semantic ops có tên (SPLIT/MERGE/UPDATE) | ❌ LLM quyết định sai op — cần fallback deterministic |

## Khác các hướng gần

| | AJI Dreams Phases | AJE Trace→Primitive | AJH Synthesis-Timeline |
|---|---|---|---|
| Trọng tâm | Consolidation nền 3 phase | 3 giai đoạn capture | Entity 2 lớp |
| Cơ chế | Light/REM/deep + gates | Judge + staging + commit | Synthesis + timeline + stale |
| Quan hệ | Tiêu thụ primitive | Sinh primitive | Format cho REM synthesis |

## Khi nào chọn

- DreamCycle hiện là pipeline đơn — muốn phân tầng chi phí + gates
- Có conflict/supersession (conflict.ts) — REM gate theo conflict thật
- Hot memory nhiều — deep promotion + snapshot + archive cần thiết
- Guard: gate config riêng per phase, REM fallback deterministic khi LLM fail, retention rõ, timer unref + shutdown-safe