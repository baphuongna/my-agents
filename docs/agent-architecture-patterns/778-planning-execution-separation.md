# Hướng ACX: Planning-Execution Separation — ba lớp Planning/Execution/Worker, intelligence nằm ở system chứ không phải một model worker

> **Nguồn gốc:** oh-my-openagent (docs/guide/orchestration.md) | **Coupling:** 🟡 — thêm orchestration 3 lớp vào agent pipeline | **Agent-agnostic:** ⚠️ (phụ thuộc multi-agent roles) | **Code sẵn:** ⚠️ (có council + subagent + workflows — chưa có 3-layer separation) | **Effort:** 2 tuần

## Nguồn gốc

**oh-my-openagent** tách **ba lớp rõ ràng**: (1) **Planning Layer** — `Prometheus` interview (hỏi cho rõ) + `Metis` gap analysis (tìm lỗ hổng) + `Momus` ruthless review (chê không nể); (2) **Execution Layer** — `Atlas` conductor, **read-only, chỉ verify** (không tự ý sửa); (3) **Worker Layer** — `Sisyphus-Junior` + specialists thực thi. Ràng buộc cứng: **Junior bị chặn delegate** (không spawn cấp dưới), **phải pass lsp_diagnostics**, **không được sửa plan files**. Ý tưởng cốt lõi: **intelligence nằm ở system** (cấu trúc 3 lớp + guard) **chứ không phải một model worker** — dù model yếu, hệ thống vẫn giữ chất lượng bằng tách vai. Nguyên tắc: **plan không đụng execute, execute không đụng plan, worker bị chặn delegate + phải pass diagnostics**.

## Mô tả

mya planning-execution separation: (1) **3 lớp** — Planning (interview + gap + review), Execution (conductor read-only verify), Worker (thực thi có guard); (2) **role separation** — Planning agent không viết code, Worker không sửa plan; (3) **worker guard** — không delegate, phải pass lsp_diagnostics (packages/tools lsp-client.ts đã có) trước khi coi là xong; (4) **plan files bất khả xâm** — worker không sửa plan (plan là contract); (5) **intelligence in system** — chất lượng đến từ cấu trúc + guard, không phụ thuộc model mạnh. Nối workflows (runner/worker) + council (planning review) — ACX là kiến trúc orchestration.

## Kiến trúc

```
  ┌─ PLANNING LAYER ──────────────────────────────┐
  │  Prometheus — interview (hỏi cho rõ)          │
  │  Metis      — gap analysis (lỗ hổng)          │
  │  Momus      — ruthless review (chê)            │
  │  → PLAN FILES (contract — worker không sửa)    │
                        ▼
  ┌─ EXECUTION LAYER ─────────────────────────────┐
  │  Atlas — conductor, READ-ONLY, chỉ verify      │
  │  (không tự ý sửa — chỉ điều phối + kiểm tra)   │
                        ▼
  ┌─ WORKER LAYER ────────────────────────────────┐
  │  Sisyphus-Junior + specialists                 │
  │  ⛔ bị chặn delegate · ✅ phải pass diagnostics │
  │  ⛔ không sửa plan files                        │
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools lsp-client.ts — LspClient + LspDiagnostic (nền — worker pass diagnostics)
// ✅ packages/tools lsp-cascade.ts — runCascade + computeImpact (nền — verify sau sửa)
// ✅ packages/council council.ts — CouncilProvider (nền — Planning review)
// ✅ packages/council hindsight.ts — HindsightReviewer (nền — Momus analog)
// ✅ packages/agent spawnSubagent — session riêng per worker (nền — Worker layer)
// ✅ packages/workflows runner.ts + worker.ts — workflow + worker_thread (nền — execute)

// ❌ THIẾU: 3-layer separation (Planning/Execution/Worker) với guard
// ❌ THIẾU: worker bị chặn delegate + không sửa plan files
// ❌ THIẾU: conductor read-only verify (Atlas analog)
```
## Implementation
```typescript
// packages/workflows/src/three-layer.ts (MỚI)
export type Layer = "planning" | "execution" | "worker";
export interface RolePolicy {
  layer: Layer;
  /** Worker bị chặn delegate — không spawn cấp dưới. */
  canDelegate: boolean;
  /** Có được sửa plan files không. */
  canEditPlan: boolean;
  /** Bắt buộc pass diagnostics trước khi coi là xong. */
  requiresDiagnostics: boolean;
}
const POLICIES: Record<Layer, RolePolicy> = {
  planning: { layer: "planning", canDelegate: true, canEditPlan: true, requiresDiagnostics: false },
  execution: { layer: "execution", canDelegate: true, canEditPlan: false, requiresDiagnostics: false },
  worker: { layer: "worker", canDelegate: false, canEditPlan: false, requiresDiagnostics: true },
};
/** Guard worker — chặn delegate, chặn sửa plan. */
export function guardWorkerAction(policy: RolePolicy, action: "delegate" | "edit-plan" | "execute"): string | null {
  if (action === "delegate" && !policy.canDelegate) {
    return "worker bị chặn delegate — phải tự làm (chống đệ quy vô hạn + mất kiểm soát)";
  }
  if (action === "edit-plan" && !policy.canEditPlan) {
    return "worker không được sửa plan files — plan là contract, sửa = phá hợp đồng";
  }
  return null;
}
/** Verify gate — worker chỉ hoàn thành khi diagnostics sạch. */
export async function verifyWorkerDone(
  diagnostics: Array<{ severity: string; message: string }>,
): Promise<{ ok: boolean; issues: string[] }> {
  const issues = diagnostics
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `${d.severity}: ${d.message}`);
  return { ok: issues.length === 0, issues };
}
/** Conductor (Atlas analog) — read-only, chỉ verify, không tự sửa. */
export class ReadOnlyConductor {
  private readonly edits: string[] = [];
  /** Ghi nhận thay đổi worker báo — conductor KHÔNG tự sửa. */
  observeEdit(desc: string): void {
    this.edits.push(desc);
  }
  /** Verify kết quả — chỉ đọc + kiểm tra. */
  async verify(workerOutput: string, check: (out: string) => Promise<{ ok: boolean; issues: string[] }>): Promise<{ ok: boolean; issues: string[] }> {
    const r = await check(workerOutput);
    return { ok: r.ok && this.edits.length > 0, issues: r.issues };
  }
}
//        conductor: observeEdit() + verify() — không edit trực tiếp
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Intelligence nằm ở system — model yếu vẫn ra chất lượng | ❌ 3 lớp = 3 lần overhead (latency + token) |
| ✅ Worker bị chặn delegate — kiểm soát độ sâu | ❌ Chặn delegate có thể bó tay task quá lớn cho 1 worker |
| ✅ Plan là contract — không bị worker phá | ❌ Plan sai thì cả pipeline chạy theo plan sai |
| ✅ Diagnostics gate — worker không "xong" khi còn lỗi | ❌ LSP diagnostics phụ thuộc toolchain từng project |

## Khác các hướng gần

| | Workflows (runner/worker) | ACX: 3-Layer Separation |
|---|---|---|
| Cấu trúc | Workflow + worker thread | **Planning / Execution / Worker với role policy** |
| Guard | Timeout/terminate | **Chặn delegate + không sửa plan + diagnostics** |
| Intelligence | Trong workflow code | **Trong system structure (3 lớp + guard)** |
| Dùng khi | Chạy task có cấu trúc | **Task lớn cần tách vai rõ ràng** |

## Khi nào chọn

- Task lớn phức tạp — cần tách plan khỏi execute để không tự sửa đề bài
- Muốn chất lượng không phụ thuộc một model duy nhất (system structure)
- Đã có workflows + council + lsp — nối 3 lớp
- Guard: worker chặn delegate + chặn sửa plan, diagnostics gate, conductor read-only
