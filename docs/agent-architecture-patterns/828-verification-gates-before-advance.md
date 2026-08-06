# Hướng AEV: Verification Gates Before Advance — mỗi phase blueprint có gate, gate pass mới được sang phase sau

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟡 — đụng plan execution + loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn approval + recovery FSM; thiếu gate runner) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-extensions** (src/verification.ts): mỗi **phase blueprint** có **verification gate** bắt buộc: `tests_pass`, `typecheck_clean`, `custom_command`, `user_approval` — chạy bằng **execSync timeout 120s**; lệnh `/plan-verify` **bắt buộc gate pass mới được sang phase sau**. Nghĩa là: plan không tiến theo thời gian/ý chí, mà tiến theo **bằng chứng** — phase N không được coi là xong nếu gate của nó chưa pass.

Giá trị: (1) **chống tiến vội** — agent không lướt sang phase sau khi phase trước còn đỏ (test fail, typecheck lỗi); (2) **bằng chứng thay lời hứa** — "phase xong" = gate output pass, không phải agent nói "xong rồi"; (3) **phân loại gate** — tự động (tests/typecheck) + thủ công (user_approval) — mỗi loại đúng chỗ; (4) **bounded** — execSync timeout 120s — gate không treo mãi (nối watchdog tinh thần AEP timeout).

## Mô tả

Với mya, pattern = **gate layer trên plan/loop execution**: (1) **Gate model** — `{ type: "tests_pass" | "typecheck_clean" | "custom_command" | "user_approval", command?, timeoutMs=120_000 }`; (2) **runner** — `tests_pass` chạy test → parse qua **AET test-run-detector** (TestSummary → pass/fail deterministic); `typecheck_clean` chạy typecheck (mya có `scripts/typecheck.mjs`); `custom_command` chạy lệnh chỉ định; `user_approval` gọi **packages/tools/approval.ts** (đã có ApprovalRequest → Allow/Deny, timeout fail-closed); (3) **gate blocking** — phase advance bị chặn tới khi gate pass — tích hợp ở điểm chuyển phase (loop có budget/approval gate sẵn — thêm gate verify); (4) **fail policy** — gate fail → quay lại phase (feedback structured) hoặc fail-loud (nối RRRR recovery — packages/audit/recovery.ts RecoveryRecipe FSM "bounded recovery" đã có); (5) **/plan-verify** — lệnh manual chạy lại gate để xác nhận trước khi advance. Đây là pattern **evidence-gated progress**: tiến độ = bằng chứng verify, không phải xác nhận chủ quan.

## Kiến trúc (ASCII)

```
  PLAN PHASE N (blueprint — nối AEU DAG task)
    │
    ▼ GATE RUNNER (verification.ts)
  ├─ tests_pass      ──► chạy test → AET parse → TestSummary.failed == 0
  ├─ typecheck_clean ──► scripts/typecheck.mjs → exit 0
  ├─ custom_command  ──► execSync(command, {timeout: 120s})
  └─ user_approval   ──► packages/tools/approval.ts → Allow
    │
    ▼ PASS ──► SANG PHASE SAU (advance chỉ khi gate pass)
    ▼ FAIL ──► quay lại phase / fail-loud (RRRR recovery FSM)
  (execSync timeout 120s — gate không treo mãi)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/approval.ts — ApprovalRequest → Allow/Deny
//   (gate user_approval — đã sẵn, timeout fail-closed)
// ✅ packages/audit/src/recovery.ts — RecoveryRecipe FSM (bounded recovery)
//   (fail policy — đã sẵn nền)
// ✅ scripts/typecheck.mjs — typecheck (lệnh gate typecheck_clean)
// ✅ packages/eval/src/test-run-detector.ts (AET) — parse test output
// ✅ packages/core/src/loop.ts — budget/approval gate (mẫu gate trong loop)
// ✅ packages/workflows/src/runner.ts — plan/phase execution

// ❌ THIẾU: Gate model + gate runner (execSync timeout 120s)
// ❌ THIẾU: chặn phase advance khi gate chưa pass
// ❌ THIẾU: /plan-verify command + fail policy nối recovery FSM
```

## Implementation

```typescript
// packages/workflows/src/verification.ts (NEW)
export type GateType = "tests_pass" | "typecheck_clean" | "custom_command" | "user_approval";

export interface Gate {
  type: GateType;
  command?: string;                 // cho custom_command
  timeoutMs?: number;               // default 120_000
}

export interface GateResult { ok: boolean; detail: string; }

/** Chạy gate — deterministic, có timeout (không treo mãi). */
export async function runGate(
  gate: Gate,
  deps: {
    runTests: () => Promise<TestSummary>;        // nối AET parser
    typecheck: () => Promise<{ ok: boolean }>;
    exec: (cmd: string, timeoutMs: number) => Promise<{ ok: boolean; output: string }>;
    approve: () => Promise<"Allow" | "Deny">;    // packages/tools/approval
  },
): Promise<GateResult> {
  const timeout = gate.timeoutMs ?? 120_000;
  switch (gate.type) {
    case "tests_pass": {
      const s = await deps.runTests();
      return s.failed === 0 && s.errors === 0
        ? { ok: true, detail: `tests ${s.passed} passed` }
        : { ok: false, detail: `tests failed=${s.failed} errors=${s.errors}` };
    }
    case "typecheck_clean": {
      const r = await deps.typecheck();
      return r.ok ? { ok: true, detail: "typecheck clean" } : { ok: false, detail: "typecheck errors" };
    }
    case "custom_command": {
      if (!gate.command) return { ok: false, detail: "no command" };
      const r = await deps.exec(gate.command, timeout);
      return r.ok ? { ok: true, detail: r.output } : { ok: false, detail: r.output };
    }
    case "user_approval": {
      const d = await deps.approve();
      return d === "Allow" ? { ok: true, detail: "approved" } : { ok: false, detail: "denied" };
    }
  }
}

/** Chặn advance: phase chỉ coi là xong khi gate pass. */
export function canAdvance(gate: GateResult | undefined): boolean {
  return gate !== undefined && gate.ok;
}
// Nối loop: điểm chuyển phase → nếu !canAdvance → quay lại phase / fail-loud
// Fail policy: recovery FSM (packages/audit) — bounded, không sửa bừa (RRRR)
// /plan-verify: chạy lại gate thủ công trước khi advance
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiến độ = bằng chứng (gate pass) — không lời hứa | ❌ Gate chạy chậm (test/typecheck) — cần tune tần suất |
| ✅ Phân loại gate — tự động + thủ công đúng chỗ | ❌ Custom command có thể phá môi trường — cần cẩn thận |
| ✅ Timeout 120s — gate không treo mãi | ❌ Tests pass nhưng coverage thấp — gate không bắt |
| ✅ Nối AET (parse) + approval + recovery FSM | ❌ Plan cứng nhắc nếu gate quá nghiêm (tune policy) |

## Khác các hướng gần

| | AEV Verification Gates | AET Test Parser | AEU Dependency Graph |
|---|---|---|---|
| Trọng tâm | Chặn tiến khi gate fail | Parse kết quả test | Cấu trúc plan |
| Cơ chế | Gate check + execSync | Regex theo runner | 3-màu DFS + ready-set |
| Quan hệ | Tiêu thụ TestSummary (AET) | Nguồn tín hiệu gate | Chỉ đạo phase (AEV gate per phase) |

## Khi nào chọn

- Plan nhiều phase — cần chắc chắn phase trước xong thật rồi mới tiến
- Muốn agent không lướt qua test fail/typecheck lỗi
- Đã có approval + recovery FSM + AET parser — thêm gate runner
- Cần /plan-verify manual gate trước khi advance