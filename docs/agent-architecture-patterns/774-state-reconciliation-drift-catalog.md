# Hướng ACT: State Reconciliation Drift Catalog — detector + repair handler đăng ký trong một registry duy nhất, cap=2 retry contract

> **Nguồn gốc:** gsd-2 (docs/dev/ADR-017-state-reconciliation-drift-driven.md) | **Coupling:** 🟡 — thêm drift catalog registry vào state management | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có reconcile pipeline — chưa có catalog registry) | **Effort:** 2 tuần

## Nguồn gốc

**gsd-2** xây **drift catalog** — **detector + repair handler đăng ký trong một registry duy nhất** với **cap=2 retry contract**. Mỗi **drift kind có owner detector riêng** (stale worker, unregistered milestone, roadmap divergence...) — không phải một detector to cho mọi thứ. Repair handler **idempotent** (chạy lại an toàn), và sau repair là **repair-then-retry settle sạch** — state tự ổn định thay vì **ad-hoc recovery checks** rải rác khắp codebase. Nguyên tắc: **mọi drift kind đều có chủ (detector + repair) trong một nơi, repair idempotent, retry có cap**.

## Mô tả

mya state reconciliation drift catalog: (1) **registry duy nhất** — `DriftCatalog` map `DriftKind → { detect, repair }`; (2) **owner per kind** — stale-worker detector riêng, unregistered-milestone detector riêng... (mỗi kind một module); (3) **repair idempotent** — chạy lại repair nhiều lần ra cùng trạng thái (không side-effect tích lũy); (4) **cap=2 contract** — sau repair, re-detect tối đa 2 lần; hết cap còn drift → báo, không loop; (5) **thay thế ad-hoc checks** — mọi recovery check rải rác được gom về catalog. Nối ACQ (reconcile pipeline) — ACT là registry mà ACQ gọi.

## Kiến trúc

```
  DRIFT CATALOG (registry duy nhất)
    │ stale-worker           → detect + repair       │
    │ unregistered-milestone → detect + repair       │
    │ roadmap-divergence     → detect + repair       │
    │ missing-completion-ts  → detect + repair       │
         │  (ACQ reconcile gọi)
         ▼
    detect(kind) → DriftRecord[]
         │  có drift?
         ▼
    repair(kind, drift) — IDEMPOTENT (chạy lại an toàn)
         ▼
    re-detect — CAP 2 lần (hết cap còn drift → report)
         ▼
    sạch ──▶ dispatch · không sạch ──▶ báo (không ad-hoc recovery)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core reconcile.ts (ACQ) — reconcileBeforeDispatch pipeline (nền — ACT được gọi từ đây)
// ✅ packages/core laneboard.ts — classifyFreshness (nền — stale worker detector)
// ✅ packages/core durable-ack.ts — classifyCompletionTarget (nền — missing completion detector)
// ✅ packages/memory conflict.ts — checkAndResolveConflicts (nền — repair idempotent mẫu)
// ✅ packages/cron cross-process-lock.ts — lock (nền — chống double repair)

// ❌ THIẾU: DriftCatalog registry (kind → detector + repair)
// ❌ THIẾU: cap=2 contract giữa catalog và reconcile
// ❌ THIẾU: gom ad-hoc recovery checks về catalog
```
## Implementation
```typescript
// packages/core/src/drift-catalog.ts (MỚI)
import type { DriftRecord } from "./reconcile.js";
export interface DriftKindEntry {
  kind: DriftRecord["kind"];
  /** Owner detector — mỗi kind một detector riêng. */
  detect(): Promise<DriftRecord[]>;
  /** Repair idempotent — chạy lại nhiều lần ra cùng trạng thái. */
  repair(drift: DriftRecord): Promise<void>;
}
const MAX_REPAIR_PASSES = 2;
/** Registry duy nhất — kind → detector + repair. */
export class DriftCatalog {
  private readonly entries = new Map<string, DriftKindEntry>();
  register(entry: DriftKindEntry): void {
    if (this.entries.has(entry.kind)) {
      throw new Error(`drift kind đã đăng ký: ${entry.kind}`);
    }
    this.entries.set(entry.kind, entry);
  }
  kinds(): DriftRecord["kind"][] {
    return [...this.entries.keys()] as DriftRecord["kind"][];
  }
  /** Detect toàn bộ catalog — gộp mọi kind. */
  async detectAll(): Promise<DriftRecord[]> {
    const out: DriftRecord[] = [];
    for (const e of this.entries.values()) {
      out.push(...(await e.detect()));
    }
    return out;
  }
  /** Repair-then-retry — cap=2 contract, settle sạch. */
  async reconcileWithCap(detect: () => Promise<DriftRecord[]>): Promise<{
    clean: boolean;
    repaired: DriftRecord[];
    remaining: DriftRecord[];
  }> {
    const repaired: DriftRecord[] = [];
    let drifting = await detect();
    let pass = 0;
    while (drifting.length > 0 && pass < MAX_REPAIR_PASSES) {
      pass += 1;
      for (const d of drifting) {
        const entry = this.entries.get(d.kind);
        if (!entry) throw new Error(`drift kind chưa đăng ký: ${d.kind}`);
        await entry.repair(d); // idempotent — chạy lại an toàn
      }
      repaired.push(...drifting);
      drifting = await detect(); // re-detect — settle sạch
    }
    return { clean: drifting.length === 0, repaired, remaining: drifting };
  }
}
/** Register một drift kind — mỗi kind có owner detector + repair. */
export function registerDriftKind(catalog: DriftCatalog, entry: DriftKindEntry): void {
  catalog.register(entry);
}
//        const r = await catalog.reconcileWithCap(() => catalog.detectAll());
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nơi cho mọi drift kind — không rải rác ad-hoc | ❌ Registry phải được nạp đủ (thiếu kind = drift không sửa) |
| ✅ Owner per kind — detector chuyên trách, dễ test | ❌ Nhiều kind = nhiều module detector/repair |
| ✅ Repair idempotent — retry an toàn, không tích lũy | ❌ Idempotency phải được verify (test chạy 2 lần) |
| ✅ Cap=2 contract — không loop vô hạn | ❌ Drift phức có thể cần >2 pass — phải thiết kế repair gọn |

## Khác các hướng gần

| | ACQ: Reconcile pipeline | ACT: Drift Catalog |
|---|---|---|
| Chức năng | derive→detect→repair→re-derive | **Registry kind → detector + repair** |
| Phạm vi | Pipeline chung | **Đăng ký + owner per kind** |
| Retry | cap 2 pass | **cap=2 contract + repair idempotent** |
| Quan hệ | Gọi catalog | **Nền cho ACQ** |

## Khi nào chọn

- Nhiều loại drift khác nhau cần quản lý tập trung (worker, milestone, roadmap…)
- Muốn thay thế ad-hoc recovery checks bằng registry có contract
- Đã có ACQ pipeline — thêm catalog để scale nhiều drift kind
- Guard: registry nạp đủ, repair idempotent có test, cap=2, kind chưa đăng ký fail rõ
