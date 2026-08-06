# Hướng ADM: Component Responsibility Taxonomy — map 11 vùng trách nhiệm của harness với bằng chứng cụ thể

> **Nguồn gốc:** harness-experimental | **Coupling:** 🟢 — bảng đánh giá, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn audit/eval/memory; thiếu taxonomy checker) | **Effort:** 1 tuần

## Nguồn gốc

**HARNESS_COMPONENTS.md** của **harness-experimental** lập bản đồ **11 vùng trách nhiệm** mà một harness (hệ thống quanh agent) phải đảm nhận: **task specification, context selection, tool access, project memory, task state, observability, failure attribution, verification, permissions, entropy auditing, intervention recording**. Mỗi vùng được đánh dấu **Covered / Partial / Missing** kèm **evidence file cụ thể** — không nói chung chung "chúng tôi có observability" mà chỉ ra file/record nào chứng minh.

Giá trị của pattern: (1) **checklist toàn diện** — nhóm không bỏ sót vùng nào; (2) **bằng chứng bắt buộc** — mỗi status gắn với file thật; (3) **khoảng trống hiện ra** — phần Missing là roadmap rõ ràng cho harness.

## Mô tả

Với mya, taxonomy là **một bảng máy đọc được**: mỗi vùng trách nhiệm map sang package + module + status hiện tại. Có thể đưa vào `packages/eval` như một maturity test: scan workspace (nối ADJ ladder) để tự điền Covered/Partial/Missing — thay vì khai báo tay. Ví dụ: **observability** → `packages/audit` AuditLog + `packages/core` RuntimeEvent (Covered); **intervention recording** → `packages/audit` recovery (Partial — thiếu log can thiệp thủ công). Output là bảng trong docs và gate trong CI.

## Kiến trúc (ASCII)

```
  TAXONOMY (11 vùng trách nhiệm)
    ├─ task specification  ──► docs/ + work item store
    ├─ context selection   ──► packages/prompts (assembler)
    ├─ tool access         ──► packages/tools (registry + approval)
    ├─ project memory      ──► packages/memory (Brain)
    ├─ task state          ──► packages/core (Session)
    ├─ observability       ──► packages/audit + core RuntimeEvent
    ├─ failure attribution ──► packages/audit (recovery.ts)
    ├─ verification        ──► packages/eval (tiers)
    ├─ permissions         ──► packages/tools (approval.ts)
    ├─ entropy auditing    ──► packages/audit (merkleRoot)  [Partial]
    └─ intervention recording ──► packages/audit recovery     [Partial]
            │
            ▼
  STATUS: Covered / Partial / Missing + evidence file cho từng mục
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ task specification — docs/agent-architecture-patterns + work items
// ✅ context selection — packages/prompts (assemblePrompt, request-context)
// ✅ tool access — packages/tools (ToolRegistry + dispatch)
// ✅ project memory — packages/memory (Brain + manager + governance)
// ✅ task state — packages/core (Session + SessionTree + runTurn)
// ✅ observability — packages/audit (AuditLog) + core (RuntimeEvent)
// ✅ failure attribution — packages/audit (recovery.ts FailureScenario)
// ✅ verification — packages/eval (Parity/Integration/Credentialed)
// ✅ permissions — packages/tools (approval.ts + permission.ts)
// ❌ entropy auditing — audit có merkleRoot nhưng chưa tự audit drift
// ❌ intervention recording — recovery có, chưa log can thiệp thủ công
```

## Implementation

```typescript
// packages/eval/src/taxonomy.ts (NEW)
export type Coverage = "Covered" | "Partial" | "Missing";

export interface ResponsibilityArea {
  name: string;              // 11 vùng chuẩn
  evidence: string[];        // file/record chứng minh
  status: Coverage;
}

export function assessTaxonomy(ws: WorkspaceState): ResponsibilityArea[] {
  return [
    { name: "task specification", evidence: [ws.docs], status: "Covered" },
    { name: "context selection", evidence: ["packages/prompts"], status: "Covered" },
    { name: "tool access", evidence: ["packages/tools"], status: "Covered" },
    { name: "project memory", evidence: ["packages/memory"], status: "Covered" },
    { name: "task state", evidence: ["packages/core"], status: "Covered" },
    { name: "observability", evidence: ["packages/audit"], status: "Covered" },
    { name: "failure attribution", evidence: ["packages/audit/recovery.ts"], status: "Covered" },
    { name: "verification", evidence: ["packages/eval"], status: "Covered" },
    { name: "permissions", evidence: ["packages/tools/approval.ts"], status: "Covered" },
    { name: "entropy auditing", evidence: ["packages/audit/merkleRoot"], status: "Partial" },
    { name: "intervention recording", evidence: ["packages/audit/recovery.ts"], status: "Partial" },
  ].filter((a) => a.evidence.every((e) => existsIn(ws, e)) ? a : { ...a, status: "Missing" });
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Checklist 11 vùng — không bỏ sót | ❌ Bảng phải cập nhật khi package đổi |
| ✅ Mỗi status có bằng chứng thật | ❌ Auto-check cần map package→vùng chuẩn |
| ✅ Missing = roadmap rõ ràng | ❌ "Covered" chưa chắc chất lượng tốt |
| ✅ Nối ADJ ladder (criteria inspectable) | ❌ 11 vùng có thể thiếu vùng mới (MCP…) |

## Khác các hướng gần

| | ADM Taxonomy | ADJ Ladder | ADK Trace |
|---|---|---|---|
| Đơn vị | Vùng trách nhiệm | Level H0→Hn | Record hành trình |
| Output | Covered/Partial/Missing | Level đạt được | Score + friction |
| Mục đích | Toàn diện, chỉ khoảng trống | Đo tiến bộ | Debug + cải thiện |

## Khi nào chọn

- Muốn kiểm tra toàn diện harness — vùng nào thiếu
- Cần bằng chứng cho từng khẳng định "có X"
- Đã có packages rõ ràng — map sang 11 vùng dễ
- Muốn roadmap harness từ phần Missing