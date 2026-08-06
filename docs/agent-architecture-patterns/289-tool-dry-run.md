# Hướng KC: Tool Dry-Run — chạy thử tool không side-effect, preview trước khi commit

> **Nguồn gốc:** "dry run" (chạy thử không commit); Terraform `plan` (preview changes trước apply); git `--dry-run`; "what-if" analysis; "no-op simulation"; "staging preview"; destructive command `--dry-run` flag
> **Coupling:** 🟡 — thêm dry-run mode vào tool + approval flow
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (approval gate HR sẵn — chưa có dry-run preview)
> **Effort:** 1-2 tuần

## Nguồn gốc

Dry-run (Terraform `plan`, git `--dry-run`): chạy tool ở chế độ **không commit side-effect** → preview kết quả/thay đổi sẽ xảy ra → user/agent review → nếu OK mới apply thật. Terraform plan: show "will create/update/destroy" mà không động resource. What-if analysis: mô phỏng outcome trước quyết. Đối với agent: tool destructive (write, delete, deploy, send) — trước khi commit, dry-run preview "sẽ làm gì" → human approval (HR 226) hoặc agent self-check → giảm sai lầm không thể rollback. Khác **226 HR human approval** (người duyệt trước) — KC *cung cấp preview* để duyệt có thông tin; khác **JU (281) idempotency** (chống trùng effect) — KC *chống effect không muốn*; khác **JK (271) speculative** (chạy nhánh thừa) — KC *preview chính cái sẽ chạy*; khác **JL (272) degradation** — KC không liên quan tải.

## Mô tả

mya tool dry-run: tool destructive hỗ trợ mode `dryRun: true` → thực thi logic nhưng không commit (no write/send/delete) → trả preview (diff, sẽ-thay-đổi-gì). Flow: agent đề xuất action → dry-run → preview → approval (HR) hoặc self-check → apply thật. mya có approval gate (HR) — KC thêm dry-run preview để duyệt có thông tin ("sẽ xóa 3 file" thay vì "xóa?").

## Kiến trúc

```
  AGENT proposes destructive ACTION (write/delete/deploy/send)
        │
        ▼
  DRY-RUN (mode: no commit — tính preview không side-effect)
   → "sẽ: tạo 2 file, sửa 1, xóa 3"
        │
        ▼
  REVIEW: human approval (HR 226) hoặc agent self-check
        │
   ┌────┴────┐
   │         │
  approve   reject
   │         │
   ▼         ▼
  APPLY    ABORT (không effect)
  (commit thật)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 226 HR human-approval gate — duyệt trước (sản — cần preview để duyệt có thông tin)
// ✅ 230 HV event sourcing — diff/preview (nền)
// ✅ JU (281) idempotency — apply an toàn (kết hợp)
// ✅ 124 DT dynamic permissions — quyền tool (nền)

// ❌ THIẾU: dryRun mode trong tool (no-commit preview)
// ❌ THIẾU: diff/preview renderer (sẽ-thay-đổi-gì)
// ❌ THIẾU: dry-run → approval → apply flow
```

## Implementation

```typescript
// packages/dryrun/src/index.ts (NEW)
interface ToolSpec { run(input, opts?): Promise<Effect>; supportsDryRun?: boolean; }
async function dryRunThenApply(tool: ToolSpec, input: unknown): Promise<Effect> {
  if (tool.supportsDryRun) {
    const preview = await tool.run(input, { dryRun: true });   // no side-effect — preview
    const ok = await approvalGate.confirm(preview);            // HR 226 — duyệt có thông tin
    if (!ok) return { aborted: true };                         // không effect
  }
  return await tool.run(input);                                // apply thật (commit)
}
// tool destructive thêm opts.dryRun → tính preview không write/send/delete
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Preview trước commit — giảm sai không rollback (Terraform plan) | ❌ Mọi tool phải hỗ trợ dryRun (instrumentation) |
| ✅ Duyệt có thông tin ("xóa 3 file" không phải "xóa?") | ❌ Dry-run preview không hoàn toàn khớp apply (race/state đổi) |
| ✅ An toàn destructive action (delete/deploy/send) | ❌ Overhead — 2 lần (dry + apply) |
| ✅ Tự self-check trước human gate | ❌ Tool không deterministic → preview lệch |

## Khác các hướng gần

| | 226 HR Approval | JU Idempotency | JK Speculative | KC: Dry-Run |
|---|---|---|---|---|
| Cái gì | Duyệt trước hành động | Chống trùng effect | Chạy nhánh thừa | **Preview không commit** |
| Khi nào | Trước destructive | Khi retry | Tại rẽ nhánh | **Trước apply thật** |
| Quan hệ | KC cung cấp preview cho HR | Áp kèm | Khác | **Nối HR — duyệt có thông tin** |

## Khi nào chọn

- Tool destructive/irreversible (delete, deploy, send, pay) — preview đáng
- Human approval (HR) cần thông tin để duyệt đúng
- Tool deterministic + có thể tính preview không commit
- Không dùng tool thuần read (dry-run vô nghĩa); luôn cảnh báo preview có thể lệch apply (race)
