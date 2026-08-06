# Hướng ZA: Workflow Dispatch Chaining — chuỗi workflow nối nhau bằng createWorkflowDispatch thay vì workflow_run — kiểm soát deterministic thứ tự, params, ref
> **Nguồn gốc:** awesome-persona-distill-skills (FINDINGS.md) | **Coupling:** 🟡 — thêm dispatch-chaining vào workflows runner | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflows runner chạy tuần tự — chưa có dispatch chain với params/ref control) | **Effort:** 1-2 tuần

## Nguồn gốc

**awesome-persona-distill-skills** nối nhiều GitHub workflow bằng **`workflow_run`** (trigger tự động khi workflow khác xong) — nhưng `workflow_run` bất định: không truyền được **params** tùy ý, không chọn **ref** (branch/tag) chính xác, thứ tự phụ thuộc sự kiện chứ không phải lệnh. Họ chuyển sang **`createWorkflowDispatch`** (GitHub API): workflow A khi xong gọi API dispatch workflow B với **explicit inputs + ref** → thứ tự, params, branch đều **deterministic và ghi log được**. Nguyên tắc: **chaining bằng lệnh (dispatch), không phải sự kiện ngầm (workflow_run)**.

## Mô tả

mya workflow dispatch chaining: (1) **Chain definition**: mỗi workflow khai báo `dispatch: { workflowId, inputs, ref }` khi xong. (2) **Dispatch call**: runner gọi `createWorkflowDispatch(workflowId, { inputs, ref })` — thay vì chờ event. (3) **Deterministic order**: thứ tự do code quyết định (gọi tuần tự, await từng dispatch), không phải event race. (4) **Params + ref**: inputs/ref truyền explicit — workflow sau nhận đúng context. (5) **Log/audit**: mỗi dispatch ghi vào audit — chuỗi truy vết được. mya có workflows/runner.ts (chạy 1 workflow) — ZA thêm **dispatch-chain step** + **inputs/ref passing** + **audit log**.

## Kiến trúc

```
  ❌ workflow_run (event-based — bất định)
  workflow A ──done──▶ (event) ──▶ workflow B?
                       params ✗, ref ✗, order race ⚠️

  ✅ createWorkflowDispatch (lệnh — deterministic)
  ┌── WORKFLOW A ──┐   ┌── WORKFLOW B ──┐   ┌── WORKFLOW C ──┐
  │  run()          │   │  run()          │   │  run()          │
  │  └─dispatch(B,  │──▶│  └─dispatch(C,  │──▶│  done           │
  │     inputs:{..},│   │     inputs:{..},│   │                 │
  │     ref:"main") │   │     ref:"v1.2") │   │                 │
  └─────────────────┘   └─────────────────┘   └─────────────────┘
  order = code (await tuần tự) | params = explicit | ref = explicit
  mỗi dispatch → audit log
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — chạy workflow (nền — ZA nối chain ở đây)
// ✅ packages/workflows runner.ts — ctx.parallel (nền — ZA dispatch song song khi cần)
// ✅ packages/audit index.ts — AuditLog (nền — ZA ghi từng dispatch)
// ✅ packages/cron agent-tools.ts — scheduled runs (relate — ZA dispatch từ cron)

// ❌ THIẾU: dispatch-chain step (workflow xong → dispatch workflow khác)
// ❌ THIẾU: inputs/ref passing (params tùy ý + ref chính xác)
// ❌ THIẾU: chain audit (mỗi dispatch ghi log để truy vết)
```

## Implementation

```typescript
// packages/workflows/src/dispatch-chain.ts (MỚI)

interface DispatchTarget { workflowId: string; inputs?: Record<string, unknown>; ref?: string }

interface DispatchApi {
  createWorkflowDispatch(target: DispatchTarget): Promise<{ id: string; ok: boolean }>;
}

class DispatchChain {
  constructor(
    private api: DispatchApi,
    private audit: (rec: { workflowId: string; inputs?: unknown; ref?: string; ok: boolean }) => void,
  ) {}

  // Chaining: workflow A gọi tiếp workflow B với inputs/ref explicit
  async run(
    start: DispatchTarget,
    next: (result: { id: string }) => DispatchTarget | null,
  ): Promise<string[]> {
    const chain: string[] = [];
    let target: DispatchTarget | null = start;
    while (target) {
      const res = await this.api.createWorkflowDispatch(target);   // await → deterministic order
      this.audit({ workflowId: target.workflowId, inputs: target.inputs, ref: target.ref, ok: res.ok });
      if (!res.ok) throw new Error(`dispatch ${target.workflowId} failed`);
      chain.push(target.workflowId);
      target = next({ id: res.id });                                // code quyết định bước tiếp
    }
    return chain;
  }
}
// Usage:
// const chain = new DispatchChain(githubDispatchApi, (rec) => auditLog.append({ kind: "dispatch", ...rec }));
// await chain.run(
//   { workflowId: "build.yml", inputs: { sha: headSha }, ref: "main" },
//   (r) => ({ workflowId: "publish.yml", inputs: { buildId: r.id }, ref: "v1.2" }),
// );
// → build → publish, thứ tự/params/ref deterministic + audit
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic order (await từng dispatch) | ❌ Phải quản lý chain thủ công (code) |
| ✅ Params/ref explicit (context chính xác) | ❌ Fail giữa chain → cần retry/resume policy |
| ✅ Audit từng bước (truy vết chuỗi) | ❌ Phụ thuộc API dispatch (rate limit) |
| ✅ Không event race (không workflow_run) | ❌ Chain tĩnh trong code (khó đổi khi runtime) |

## Khác các hướng gần

| | workflow_run | Cron tuần tự | ZA: Dispatch Chain |
|---|---|---|---|
| Order | Event race | Lịch | **Code await** |
| Params | ✗ | input cố định | **Explicit mỗi bước** |
| Ref | ✗ | cố định | **Chọn được** |
| Audit | khó | có | **✅ mỗi dispatch** |

## Khi nào chọn

- Chuỗi workflow phụ thuộc thứ tự chặt chẽ, cần truyền context giữa bước
- Muốn thứ tự/params/ref deterministic và truy vết được
- Event-based trigger (workflow_run) quá bất định
- Nối packages/workflows runner.ts + audit index.ts + cron agent-tools.ts; guard retry-policy (dispatch fail → retry/backoff), idempotency (dispatch trùng → không chạy 2 lần), và ref-validation (ref phải tồn tại trước dispatch); ZA = workflow dispatch chaining, kết hợp 677 YZ bilingual-consistency-ci (CI chained validation) + 682 ZF evidence-driven-completion (mỗi bước có evidence)
