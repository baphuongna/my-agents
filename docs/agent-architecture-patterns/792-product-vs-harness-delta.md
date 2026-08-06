# Hướng ADL: Product vs Harness Delta — hai output khả dĩ cho mỗi task, vòng lặp next intent tự cải thiện quy trình

> **Nguồn gốc:** harness-experimental | **Coupling:** 🟢 — thuần convention, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn audit + memory; thiếu delta tracker) | **Effort:** 1 tuần

## Nguồn gốc

**HARNESS.md** của **harness-experimental** nhìn mỗi task qua hai lăng kính: **product delta** — thay đổi sản phẩm (app code, tests, API shape) và **harness delta** — thay đổi quy trình collaboration (docs, templates, validation expectations, decision records, backlog items). Một task hoàn thành tốt có thể tạo cả hai: sửa bug (product) + thêm validation expectation (harness) để bug đó không tái diễn.

Vòng lặp **"next intent"** là điểm cốt lõi: sau mỗi task, hệ thống hỏi "intent tiếp theo là gì" — nếu harness friction lặp lại, intent tiếp theo là sửa harness chứ không phải sửa sản phẩm. Nhờ vậy **hệ thống tự cải thiện quy trình collaboration** thay vì chỉ cải thiện code.

## Mô tả

Với mya, pattern này thêm một **delta registry** vào cuối mỗi turn/task: agent (hoặc orchestrator) phân loại output thành product items và harness items, ghi vào durable store (`packages/memory` Brain hoặc `packages/audit` AuditLog). Một **next-intent planner** đọc friction history (nối ADK trace) và đề xuất intent kế: sửa code, sửa docs, hay sửa harness. Phần khó là giữ harness delta **nhỏ và thực sự cải thiện** — tránh biến mọi task thành cớ để viết thêm docs (docs bloat).

## Kiến trúc (ASCII)

```
  TASK ──► EXECUTION
            │
            ▼
  OUTPUT PHÂN LOẠI
    ├─ PRODUCT DELTA   app code · tests · API shape
    └─ HARNESS DELTA   docs · templates · validation expectations
                       decision records · backlog items
            │
            ▼
  NEXT INTENT PLANNER
    ├─ friction lặp lại? ──► intent = sửa harness
    ├─ code lỗi?        ──► intent = sửa product
    └─ ổn định?         ──► intent = backlog (feature mới)
            │
            ▼
  VÒNG LẶP: mỗi intent là task mới → tự cải thiện quy trình
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — AuditLog + recovery (ghi durable những gì xảy ra)
// ✅ packages/memory — Brain SQLite + governance (lưu delta records)
// ✅ packages/eval — harness.ts (đo product delta — parity scenarios)
// ✅ packages/skills — SkillStore (harness delta dạng skill/docs)
// ✅ packages/workflows — runner (chạy intent tiếp theo như workflow)

// ❌ THIẾU: delta classifier (output → product vs harness items)
// ❌ THIẾU: next-intent planner (friction history → intent đề xuất)
// ❌ THIẾU: friction gating (tránh docs bloat — chỉ sửa harness khi thực sự cần)
```

## Implementation

```typescript
// packages/agent/src/delta.ts (NEW)
export type DeltaKind = "product" | "harness";

export interface DeltaItem {
  kind: DeltaKind;
  target: string;        // file hoặc capability
  note: string;
  friction?: string;     // harness item: friction nào đang giải quyết
}

export interface NextIntent {
  kind: "fix-product" | "fix-harness" | "backlog";
  item: DeltaItem;
}

export function classifyDelta(output: TaskOutput): DeltaItem[] {
  const items: DeltaItem[] = [];
  for (const f of output.changedFiles) {
    if (/packages\/.*\/src/.test(f)) items.push({ kind: "product", target: f, note: "app code" });
    if (/docs\/|template|SKILL\.md/.test(f)) items.push({ kind: "harness", target: f, note: "guidance" });
  }
  return items;
}

export function nextIntent(deltas: DeltaItem[], frictionHistory: string[]): NextIntent {
  const harness = deltas.filter((d) => d.kind === "harness");
  // friction lặp lại mà chưa có harness item giải quyết → sửa harness
  const unresolved = frictionHistory.filter((f) => !harness.some((h) => h.friction === f));
  if (unresolved.length > 0) {
    return { kind: "fix-harness", item: { kind: "harness", target: "docs/", note: unresolved[0] ?? "" } };
  }
  if (deltas.some((d) => d.kind === "product")) return { kind: "fix-product", item: deltas[0] ?? { kind: "product", target: "", note: "" } };
  return { kind: "backlog", item: { kind: "product", target: "backlog", note: "next feature" } };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Quy trình collaboration tự cải thiện | ❌ Dễ docs bloat — mỗi task thêm tài liệu |
| ✅ Product + harness cùng tiến hóa | ❌ Phân loại delta sai → intent sai |
| ✅ Friction lặp lại được xử lý đúng chỗ | ❌ Vòng lặp cần friction data tốt (ADK) |
| ✅ Backlog tự sinh từ intent | ❌ Planner thêm bước sau mỗi task |

## Khác các hướng gần

| | ADL Product/Harness Delta | ADK Trace Tiers | ADN Durable State |
|---|---|---|---|
| Trọng tâm | Hai loại output + vòng lặp | Ghi hành trình | Records quản lý CLI |
| Output | Next intent | Score + friction | Story/trace/decision |
| Nối với | ADK (friction input) | ADL (harness fix) | ADJ (ladder check) |

## Khi nào chọn

- Muốn harness (docs/quy trình) tiến hóa cùng code
- Friction lặp lại đã ghi nhận được (đã có trace)
- Team chấp nhận vòng lặp "intent tiếp theo" sau mỗi task
- Cần gate chống docs bloat (chỉ sửa harness khi friction thật)