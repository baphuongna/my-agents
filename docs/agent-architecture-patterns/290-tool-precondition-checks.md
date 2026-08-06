# Hướng KD: Tool Precondition Checks — kiểm tra state/điều kiện trước khi gọi tool, fail sớm

> **Nguồn gốc:** "Design by Contract" (Bertrand Meyer — precondition/postcondition/invariant); "fail fast"; "guard clauses"; Eiffel DbC; "validate before execute"; "precondition assertion"; API input validation
> **Coupling:** 🟢 — thêm check tại tool entry, không chạm infra
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool có schema validation — chưa có state precondition)
> **Effort:** 0.5-1.5 tuần

## Nguồn gốc

Design by Contract (Bertrand Meyer, Eiffel): mỗi operation có **precondition** (điều kiện phải true trước khi gọi) — nếu vi phạm → fail ngay (fail fast), không chạy logic trong state sai. Guard clauses: check early return. API input validation: validate trước execute. Đối với agent: tool thường cần state cụ thể để thành công — VD `deploy` cần "tests pass + branch=main + built"; `delete` cần "file exists + not protected". Nếu không check trước → tool chạy giữa chừng fail (đã có side-effect một phần) hoặc trả lỗi khó hiểu. Precondition check fail sớm (trước execute) → agent biết ngay "thiếu gì", retry/fix thay vì half-done. Khác **289 KC dry-run** (preview outcome) — KD check *state trước*; khác **226 HR approval** (người duyệt) — KD *tự động validate*; khác **JU (281) idempotency** (chống trùng) — KD *chống chạy sai state*; khác **124 DT permissions** (quyền) — KD check *điều kiện logic* không chỉ quyền.

## Mô tả

mya tool precondition checks: mỗi tool khai báo precondition (state/schema checks) → kiểm tra trước execute → nếu fail, trả lỗi rõ "thiếu X" (không chạy). Fail early giúp agent retry/fix sạch. mya tool có schema validation — KD thêm state precondition (file exists, tests pass, branch đúng) + structured error.

## Kiến trúc

```
  AGENT calls TOOL T(args)
        │
        ▼
  PRECONDITION CHECKS (trước execute)
   · schema valid? (sản)
   · state: file exists? tests pass? branch=main? not protected?
        │
   ┌────┴────┐
   │         │
  pass      fail
   │         │
   ▼         ▼
  EXECUTE   FAIL FAST — error rõ "thiếu: tests pass"
  (state OK)     (không side-effect — agent biết sửa/retry)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool schema validation — validate args (sản)
// ✅ 124 DT dynamic permissions — quyền tool (sản)
// ✅ GU (203) retry — retry khi lỗi (sản — cần fail rõ để retry đúng)
// ✅ 289 KC dry-run — preview (kết hợp)
// ✅ GP (198) audit — record fail (sản)

// ❌ THIẾU: state precondition declaration per tool
// ❌ THIẾU: precondition check before execute (fail fast)
// ❌ THIẾU: structured precondition error (agent biết thiếu gì để fix)
```

## Implementation

```typescript
// packages/precond/src/index.ts (NEW)
interface Precondition { check: (ctx: Ctx, args: unknown) => Promise<void>; msg: string; }
async function withPreconds<T>(tool: { preconds: Precondition[]; run: () => Promise<T> },
                               ctx: Ctx, args: unknown): Promise<T> {
  for (const p of tool.preconds) {
    try { await p.check(ctx, args); }                          // fail fast (DbC)
    catch { throw new PreconditionError(p.msg); }              // lỗi rõ — agent fix/retry (GU 203)
  }
  return tool.run();                                           // state OK → execute
}
// VD deploy.preconds = [{check: testsPass, msg:"tests must pass"},
//                       {check: branchMain, msg:"branch must be main"}]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail fast — không half-done side-effect (DbC Meyer) | ❌ Phải khai báo precondition mỗi tool (nhiều việc) |
| ✅ Lỗi rõ — agent biết "thiếu gì" để fix/retry | ❌ Check tốn overhead (state query mỗi call) |
| ✅ Tránh chạy tool trong state sai (xóa nhầm, deploy hỏng) | ❌ Precondition quá chặt → block hợp lệ (false reject) |
| ✅ Coupling thấp (🟢) — chỉ thêm check | ❌ Race: check pass nhưng state đổi trước execute |

## Khác các hướng gần

| | 226 HR Approval | 289 KC Dry-Run | JU Idempotency | KD: Precondition Checks |
|---|---|---|---|---|
| Cái gì | Người duyệt | Preview outcome | Chống trùng effect | **Validate state trước** |
| Khi nào | Trước destructive | Trước apply | Khi retry | **Trước execute** |
| Cơ chế | Human | No-commit sim | K-store | **DbC guard fail-fast** |

## Khi nào chọn

- Tool cần state cụ thể để thành công (deploy cần tests pass, delete cần exists)
- Muốn fail rõ sớm — agent biết thiếu gì để fix (không half-done)
- Coupling thấp acceptable — chỉ thêm check
- Luôn: guard atomic với execute (chống race), structured error cho agent retry (GU 203); kết hợp 289 dry-run cho destructive
