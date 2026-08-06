# Hướng ADJ: Harness Maturity Ladder — định nghĩa mức độ harness bằng criteria verifiable được

> **Nguồn gốc:** harness-experimental | **Coupling:** 🟢 — đo lường bên ngoài, không đổi runtime | **Agent-agnostic:** ✅ — criteria thuần file/record/benchmark | **Code sẵn:** ⚠️ (sẵn eval tiers; thiếu ladder checker) | **Effort:** 1 tuần

## Nguồn gốc

**HARNESS_MATURITY.md** của **harness-experimental** chống một failure mode phổ biến: nhóm tự nhận "chúng tôi có harness" nhưng không ai kiểm chứng được. Pattern định nghĩa **maturity ladder H0 → H1 → H2 → ...** — mỗi level có **criteria verifiable được**: file tồn tại, durable records đầy đủ, benchmark output đúng format. Một level chỉ đạt khi **criteria inspect được** — người ngoài (hoặc script) có thể kiểm tra bằng mắt/bằng lệnh, không phụ thuộc lời khẳng định.

Đây là pattern về **đo tiến bộ của quy trình** thay vì đo sản phẩm: ladder đo xem hệ thống collaboration quanh agent (docs, templates, validation, records) đã hoàn thiện tới đâu. H0 là "không có gì", H1 có intake, H2 có durable trace, H3 có auto-scoring, v.v.

## Mô tả

Với mya, ladder là **một module check bên ngoài** chạy định kỳ (CI hoặc `mya harness-check`): duyệt state root, kiểm tra từng criteria của từng level, output bảng level → criteria → pass/fail. Điểm mạnh: dùng chung cơ chế `packages/eval` (tier với fixture) nhưng criteria là **hệ thống file thật** của workspace (`.crew/state`, docs, APPLY-LOG) chứ không phải test fixture. Kết quả ladder là số liệu cho governance: level tăng = quy trình cải thiện thật, không phải tự nhận.

## Kiến trúc (ASCII)

```
  WORKSPACE STATE
    ├─ docs/ (templates, checklists)
    ├─ .crew/state/runs/ (durable records)
    ├─ APPLY-LOG.md (audit trail)
    └─ benchmark outputs
            │
            ▼
  LADDER CHECKER (mya harness-check / CI)
    L0: repo tồn tại
    L1: intake gate có file + checklist dùng được
    L2: durable trace records (task_summary, files_changed, errors)
    L3: auto-scoring + benchmark output đúng format
    ...
            │  mỗi criteria inspect được (file tồn tại, format đúng)
            ▼
  BẢNG KẾT QUẢ: level hiện tại + criteria fail cụ thể
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — tiers.ts (Integration/Credentialed/Parity)
//   (nền benchmark criteria + fixture)
// ✅ packages/audit — AuditLog + Checkpoint (durable records)
// ✅ packages/memory — Brain SQLite (state durable để check)
// ✅ packages/cron — scan.ts (nền chạy checker định kỳ)
// ✅ docs/ — đã có nhiều convention docs (nền criteria "file tồn tại")

// ❌ THIẾU: ladder definition (H0→Hn với criteria inspectable)
// ❌ THIẾU: checker tự động (scan state root, output bảng pass/fail)
// ❌ THIẾU: gating — release chặn khi level < ngưỡng
```

## Implementation

```typescript
// packages/eval/src/maturity.ts (NEW)
export interface MaturityCriterion {
  id: string;
  inspect: (state: WorkspaceState) => boolean;   // phải check được
  evidence: string;                              // file/record cụ thể
}

export interface MaturityLevel { id: string; criteria: MaturityCriterion[]; }

export const LADDER: MaturityLevel[] = [
  { id: "H0", criteria: [] },
  {
    id: "H1",
    criteria: [
      { id: "intake-doc", inspect: (s) => exists(s.docs, "FEATURE_INTAKE.md"), evidence: "docs/FEATURE_INTAKE.md" },
      { id: "checklist", inspect: (s) => exists(s.docs, "HARNESS_COMPONENTS.md"), evidence: "docs/HARNESS_COMPONENTS.md" },
    ],
  },
  {
    id: "H2",
    criteria: [
      { id: "trace-db", inspect: (s) => sqliteHasTable(s.state, "trace"), evidence: "trace.sqlite" },
      { id: "apply-log", inspect: (s) => exists(s.root, "APPLY-LOG.md"), evidence: "APPLY-LOG.md" },
    ],
  },
  { id: "H3", criteria: [/* benchmark output đúng format, auto-scoring chạy */] },
];

export function checkMaturity(state: WorkspaceState): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const level of LADDER) {
    for (const c of level.criteria) result[`${level.id}:${c.id}`] = c.inspect(state);
  }
  return result; // bảng pass/fail — không có "tự nhận"
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo tiến bộ quy trình, không cảm tính | ❌ Criteria phải viết inspectable — tốn công |
| ✅ Người ngoài/script kiểm tra được | ❌ File tồn tại chưa chắc nội dung đúng |
| ✅ Gate release theo level (H ≥ ngưỡng) | ❌ Ladder leo lên khó, tụt dễ |
| ✅ Tái dùng eval machinery | ❌ Workspace state khác nhau → criteria khó chuẩn hóa |

## Khác các hướng gần

| | ADJ Maturity Ladder | ADN Durable State | AEE Fidelity Rubric |
|---|---|---|---|
| Đo gì | Mức harness của repo | Records quản lý bởi CLI | Độ trung thực migration |
| Cách đo | Criteria inspectable | SQLite + verify commands | Self-score theo rubric |
| Dùng khi | Đánh giá tiến bộ | Vận hành hàng ngày | Sau migration |

## Khi nào chọn

- Muốn chứng minh "có harness" bằng bằng chứng, không bằng lời
- Cần gate khách quan cho release/quy trình
- Đã có state durable + docs — chỉ thêm checker
- Team đang cải thiện quy trình và muốn đo từng nấc