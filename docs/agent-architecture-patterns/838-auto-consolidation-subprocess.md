# Hướng AFF: Auto-Consolidation Subprocess — memory đạt capacity → spawn child process LLM consolidation, parent reload từ đĩa

> **Nguồn gốc:** pi-hermes-memory | **Coupling:** 🟡 — subprocess + memory store | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn dream-cycle consolidation nền; thiếu capacity-triggered subprocess) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-hermes-memory** (src/handlers/auto-consolidate.ts): khi **memory đạt capacity**, **spawn one-shot child process** (`pi.exec`) chạy **LLM consolidation** rồi **parent reload từ đĩa** — **merge entry thay vì báo lỗi** (memory đầy không phải lỗi — là tín hiệu cần dọn); có **timeout 60s** và **retryWithoutOverrides** (lần retry bỏ override policy — chỉ giữ merge an toàn). Mục đích: capacity không chặn agent — tự dọn nền, merge entries trùng/liên quan thành một, giải phóng chỗ.

Giá trị: (1) **không chặn** — consolidation chạy child process riêng, agent chính tiếp tục; (2) **merge thay vì lỗi** — hết chỗ là chuyện thường (memory tích lũy) — phản ứng đúng là dọn, không crash; (3) **isolate** — child process: consolidation LLM heavy không làm nghẽn process chính, crash không lan; (4) **an toàn** — timeout 60s (không treo) + retry giảm override (không mất dữ liệu).

## Mô tả

Với mya, pattern = **capacity-triggered consolidation worker**: (1) **trigger** — memory store theo dõi capacity (đếm entries / size) — vượt ngưỡng → schedule consolidation (mya memory có `brain-store.ts` + `sqlite-store.ts` + **`dream-cycle.ts`** — consolidation nền 30 phút đã có — pattern này đổi trigger thành *capacity* + chạy *subprocess*); (2) **subprocess** — spawn child process (mya có `packages/print/bg-runner.ts` spawn pattern; `packages/tools/codeexec.ts` spawn) — LLM consolidation chạy ở child, **parent không nghẽn**; (3) **contract** — child đọc entries (qua file/JSON), merge (trùng/liên quan → 1 entry tổng), ghi đĩa, **parent reload từ đĩa** (không giữ state cũ); (4) **an toàn** — timeout 60s (nối AEP tinh thần — abort là kết quả hợp lệ), retry lần 2 **without overrides** (chỉ merge an toàn, không để LLM override tùy tiện); (5) **write gate** — entry merge qua **AFC content-gate** (không để consolidation tạo poison). Đây là pattern **out-of-band maintenance**: việc dọn dẹp nặng chạy ngoài process chính, có giới hạn, có retry an toàn.

## Kiến trúc (ASCII)

```
  MEMORY STORE — theo dõi CAPACITY (entries/size)
    │  vượt ngưỡng ──► schedule (không báo lỗi — merge là phản ứng đúng)
    ▼
  SPAWN ONE-SHOT CHILD PROCESS (pi.exec / bg-runner pattern)
  ├─ đọc entries (JSON/file)
  ├─ LLM consolidation: merge trùng/liên quan → 1 entry tổng
  ├─ timeout 60s (không treo — abort là kết quả hợp lệ)
  └─ retry lần 2 WITHOUT overrides (chỉ merge an toàn)
    │
    ▼ GHI ĐĨA (qua AFC content-gate — không tạo poison)
    ▼ PARENT RELOAD TỪ ĐĨA (không giữ state cũ — state mới nhất)
  (agent chính tiếp tục — dọn nền, không chặn)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/dream-cycle.ts — consolidation nền (LLM summarize + merge)
//   (pattern consolidation đã có — đổi trigger capacity + subprocess)
// ✅ packages/memory/src/brain-store.ts — consolidateAt/consolidateInto
//   (model merge đã có — R35 facts consolidated không bao giờ xóa)
// ✅ packages/print/src/bg-runner.ts — spawn subprocess pattern
// ✅ packages/tools/src/codeexec.ts — spawn child (exec bridge)
// ✅ packages/memory/src/content-gate.ts (AFC) — write gate cho entry merge
// ✅ packages/workflows/src/runner.ts — timeout/abort (tinh thần 60s)

// ❌ THIẾU: capacity trigger (đếm entries/size vượt ngưỡng)
// ❌ THIẾU: one-shot child contract (đọc → merge → ghi → parent reload)
// ❌ THIẾU: retryWithoutOverrides (lần 2 bỏ override — merge an toàn)
```

## Implementation

```typescript
// packages/memory/src/auto-consolidate.ts (NEW)
export interface ConsolidateInput { entries: Array<{ id: string; content: string; type: string }>; }

export const CONSOLIDATE_TIMEOUT_MS = 60_000;
export const CAPACITY_THRESHOLD = 10_000;   // entries — tùy chỉnh

/**
 * Capacity trigger: vượt ngưỡng → spawn child consolidation.
 * One-shot child: đọc entries → LLM merge → ghi đĩa → parent reload.
 */
export async function autoConsolidate(
  store: {
    count(): number;
    entries(): Promise<ConsolidateInput["entries"]>;
    writeMerged(entries: Array<{ content: string; type: string }>): Promise<void>;  // qua AFC gate
    reload(): Promise<void>;   // parent reload từ đĩa — không giữ state cũ
  },
  spawnChild: (input: ConsolidateInput, opts: { timeoutMs: number; allowOverrides: boolean }) => Promise<Array<{ content: string; type: string }>>,
): Promise<"skipped" | "merged" | "timeout" | "retried"> {
  if (store.count() < CAPACITY_THRESHOLD) return "skipped";   // chưa đầy — không làm gì

  const input = { entries: await store.entries() };

  // Lần 1: cho phép overrides (LLM có thể thay entry cũ bằng entry tốt hơn).
  try {
    const merged = await spawnChild(input, { timeoutMs: CONSOLIDATE_TIMEOUT_MS, allowOverrides: true });
    await store.writeMerged(merged);   // AFC gate trước khi ghi
    await store.reload();
    return "merged";
  } catch (e) {
    // Timeout/lỗi → retry WITHOUT overrides: chỉ merge an toàn, không override tùy tiện.
    try {
      const safe = await spawnChild(input, { timeoutMs: CONSOLIDATE_TIMEOUT_MS, allowOverrides: false });
      await store.writeMerged(safe);
      await store.reload();
      return "retried";
    } catch {
      return "timeout";   // cả 2 lần fail — báo, không crash
    }
  }
}
// Child process: spawn qua bg-runner/codeexec pattern — parent không nghẽn
// Nối AFC: writeMerged qua content-gate — consolidation không tạo poison
// R35: entry consolidated đánh dấu consolidated_at — không bao giờ xóa (đã có)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Capacity không chặn — tự dọn nền | ❌ Subprocess thêm chi phí spawn + IPC |
| ✅ Merge thay vì báo lỗi — phản ứng đúng | ❌ LLM merge có thể làm mất chi tiết (policy override) |
| ✅ Child isolate — LLM heavy không nghẽn chính | ❌ Parent reload phải đồng bộ state (race với write khác) |
| ✅ Timeout 60s + retry an toàn — không treo/mất | ❌ Threshold capacity phải tune theo lưu trữ |

## Khác các hướng gần

| | AFF Auto-Consolidation | AFD Background Learning | AEQ Graduation |
|---|---|---|---|
| Trọng tâm | Dọn memory khi đầy | Học nền từ conversation | Thăng cấp tri thức |
| Cơ chế | Child process + reload | Interval + in-process/spawn | Pipeline + ngưỡng |
| Quan hệ | Merge sau khi học (AFD) | Nguồn memory mới | Nâng cấp sau dọn |

## Khi nào chọn

- Memory tích lũy nhanh — hết chỗ là chuyện thường xuyên
- Đã có dream-cycle consolidation + bg-runner spawn — đổi trigger capacity
- Muốn dọn nền không chặn agent chính (child process)
- Cần an toàn: timeout + retryWithoutOverrides (không mất dữ liệu)