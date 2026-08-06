# Hướng AEN: Runtime-Discovered Phases — progress view dẫn dắt bởi phase() calls lúc runtime thay vì meta tĩnh

> **Nguồn gốc:** pi-dynamic-workflows | **Coupling:** 🟢 — event stream, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn phase() emit trong workflow runner) | **Effort:** 1 tuần

## Nguồn gốc

**pi-dynamic-workflows** (src/workflow.ts): **progress view được dẫn dắt bởi `phase(...)` calls lúc runtime** thay vì meta tĩnh khai báo trước. Đặc điểm: (1) **phase sinh trong loop/condition tự xuất hiện** — workflow chạy `for` qua 10 mục, mỗi mục gọi `phase("process item N")` → view render 10 phase thực tế, không cần khai báo 10 phase trước; (2) **branch bị skip không hiện thành hàng trống** — nếu `if` không chạy nhánh nào, phase nhánh đó không xuất hiện (không có dòng "ghost"); (3) view = **log thực thi** chứ không phải kế hoạch tĩnh.

Giá trị: progress view **luôn phản ánh đúng thực tế** — không lệch với code chạy, không cần duy trì meta song song, tự thích nghi với workflow động (điều kiện, vòng lặp, số lần không biết trước). Failure mode chống: meta tĩnh khai báo 5 phase nhưng runtime chạy 3 → view sai; hoặc nhánh không chạy vẫn hiện "đang chờ" mãi.

## Mô tả

Với mya, pattern = **progress events từ sandbox ra view**: (1) workflow runner (packages/workflows runner.ts) đã có `phase: (name) => emit({ kind: "log", level: "info", message: "[phase] name" })` — đúng nền; pattern thêm **typed event** `{ kind: "phase", name, seq }` để view phân biệt phase với log thường; (2) **view model** — giữ `Map<seq, PhaseState>`; phase mới xuất hiện khi event đến (runtime-discovered), không có pre-declaration; (3) **skip tự nhiên** — nhánh không chạy thì không có event → không có hàng; (4) **trạng thái** — phase đang chạy (🚧), xong (✅), fail (❌) — cập nhật theo event tiếp theo (nối AEP abort → skipped). Nối thêm: view này có thể render trong print transport (agents-panel pattern) hoặc web dashboard — một nguồn sự thật là event stream của runner.

## Kiến trúc (ASCII)

```
  WORKFLOW SCRIPT (sandbox)
    │  phase("fetch users")          ──► event {kind:"phase", name, seq:1}
    │  for (u of users) {            ──► loop runtime
    │    phase(`process ${u.name}`)  ──► event seq:2,3,4… (số lượng runtime)
    │    if (u.admin) phase("grant") ──► chỉ emit khi nhánh chạy
    │  }                               (skip → KHÔNG có event → không hàng trống)
    ▼
  EVENT STREAM (runner emit)
    ▼
  PROGRESS VIEW MODEL (Map<seq, PhaseState>)
    ├─ phase mới → thêm hàng (runtime-discovered)
    ├─ phase xong → ✅ (event tiếp theo)
    └─ branch skip → không có hàng — không ghost
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — phase(name) sandbox global
//   (emit log "[phase] name" — nền có sẵn, chỉ cần typed event)
// ✅ packages/workflows/src/runner.ts — parallel/pipeline primitives (AEO)
// ✅ packages/workflows/src/runner.ts — signal abort → worker.terminate (AEP)
// ✅ packages/core/src/loop.ts — RuntimeEvent stream (event sink pattern)
// ✅ packages/print/src/agents-panel.ts — panel view (render model)

// ❌ THIẾU: typed event {kind:"phase"} riêng (khác log thường)
// ❌ THIẾU: view model Map<seq, PhaseState> + trạng thái ✅/🚧/❌
// ❌ THIẾU: render progress view từ event (print/web)
```

## Implementation

```typescript
// packages/workflows/src/progress-view.ts (NEW)
export type PhaseState = "running" | "done" | "failed" | "skipped";

export interface PhaseEvent { kind: "phase"; name: string; seq: number; }

export class ProgressView {
  private phases = new Map<number, { name: string; state: PhaseState }>();
  private order: number[] = [];

  /** Runtime-discovered: event đến → thêm/cập nhật — không pre-declare. */
  onEvent(e: PhaseEvent): void {
    const cur = this.phases.get(e.seq);
    if (!cur) {
      this.phases.set(e.seq, { name: e.name, state: "running" });
      this.order.push(e.seq);
      return;
    }
    if (e.name !== cur.name) { cur.name = e.name; cur.state = "running"; }
  }

  markDone(seq: number, failed = false): void {
    const p = this.phases.get(seq);
    if (p) p.state = failed ? "failed" : "done";
  }

  /** Branch skip → không có seq trong map → render bỏ qua (không hàng trống). */
  render(): string[] {
    return this.order
      .map((seq) => {
        const p = this.phases.get(seq);
        if (!p || p.state === "skipped") return null;
        const icon = p.state === "done" ? "✅" : p.state === "failed" ? "❌" : "🚧";
        return `${icon} ${p.name}`;
      })
      .filter((l): l is string => l !== null);
  }
}
// Runner: phase(name) → emit typed PhaseEvent thay vì log string
// Nối AEP: abort → markDone(seq, skipped) cho phase đang chạy
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ View luôn đúng thực tế — không lệch runtime | ❌ Không thấy "kế hoạch" trước khi chạy (chỉ thấy khi chạy) |
| ✅ Loop/condition tự thích nghi — không khai báo trước | ❌ Phase tên trùng seq khó phân biệt (cần seq) |
| ✅ Branch skip không ghost — view sạch | ❌ Cần typed event — runner phải sửa emit |
| ✅ Đã có phase() nền — thêm model + render | ❌ Workflow fail giữa phase → trạng thái treo cần timeout |

## Khác các hướng gần

| | AEN Runtime Phases | AEO Parallel/Pipeline | AEP Abort |
|---|---|---|---|
| Trọng tâm | Progress view | Nguyên thủy orchestration | Hủy workflow |
| Cơ chế | Event → view model | Promise.all + stage chain | AbortSignal lan truyền |
| Quan hệ | Tiêu thụ event của runner | Sinh phase runtime | Đánh dấu skipped |

## Khi nào chọn

- Workflow động (loop/condition) — meta tĩnh không theo kịp
- Muốn progress view phản ánh thực tế, không duy trì khai báo song song
- Đã có runner emit event — thêm typed phase + view model
- Cần biết nhánh nào thực sự chạy (skip không hiện hàng trống)