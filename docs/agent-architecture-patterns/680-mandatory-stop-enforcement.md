# Hướng ZD: Mandatory Stop Enforcement — hook-enforced MANDATORY STOP sau mỗi step + process check permit/halt — gates block progression, không phải suggestion; obedience bằng enforcement
> **Nguồn gốc:** babysitter (docs/user-guide/architecture.md) | **Coupling:** 🔴 — hook vào turn loop, chặn progression sau mỗi step | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (core/loop.ts có turn hooks — chưa có mandatory-stop enforcement) | **Effort:** 2-3 tuần

## Nguồn gốc

**babysitter** nhận ra: nếu chỉ **suggest** ("nên dừng ở đây để xác nhận") thì LLM **không obey** — suggestion dễ bị bỏ qua khi context dài, khi task hấp dẫn. Giải pháp: **MANDATORY STOP** được **enforce bằng hook**: sau **mỗi step** (tool call), orchestrator dừng agent loop, gọi **process check** → verdict **permit** (cho phép tiếp) hoặc **halt** (chặn, yêu cầu xác nhận/đổi hướng). Agent **không thể** tự tiếp tục nếu check không permit — việc chặn nằm ở **code**, không phải lời nhắc trong prompt. Nguyên tắc: **obedience bằng enforcement — gates block progression, không phải suggestion**.

## Mô tả

mya mandatory stop enforcement: (1) **Per-step stop**: sau mỗi tool call / turn, agent loop tạm dừng. (2) **Process check**: hook chạy policy (permission rules, budget, evidence, role filter) → **permit** (tiếp) | **halt** (chặn + lý do). (3) **Halt action**: agent không tự resume — cần human approve hoặc orchestrator đổi hướng. (4) **Hook-enforced**: check nằm trong code path (post-tool hook), không phải system prompt. mya có core/loop.ts (`hooks` post-tool sink) + tools/permission.ts (`requiresApproval`) — ZD thêm **mandatory stop state machine** + **process check verdict** + **resume permission**.

## Kiến trúc

```
  AGENT LOOP
  ┌──────────────────────────────────────────────────────┐
  │  step N: tool call → result                            │
  │    │                                                   │
  │    ▼  POST-STEP HOOK (code, không phải prompt)         │
  │  ┌── MANDATORY STOP ──────────────────────────────┐    │
  │  │  process check:                                 │    │
  │  │   ├ permission rules (requiresApproval?)         │    │
  │  │   ├ budget còn? evidence đủ? role filter?        │    │
  │  │   └ verdict: PERMIT → resume loop                 │    │
  │  │             HALT  → block + chờ approve/đổi hướng │    │
  │  └─────────────────────────────────────────────────┘    │
  │  resume CHỈ khi check permit (hoặc human approve)       │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — hooks (PostToolHookSink, nền — ZD check ở đây)
// ✅ packages/tools permission.ts — requiresApproval + awaitHumanPrompt (nền — ZD halt action)
// ✅ packages/core budget.ts + iteration-budget.ts (nền — ZD budget check)
// ✅ packages/gateway approval-relay.ts — ApprovalRelay (nền — ZD resume qua approve)

// ❌ THIẾU: mandatory stop state machine (luôn dừng sau mỗi step)
// ❌ THIẾU: process check verdict (permit/halt chuẩn hóa)
// ❌ THIẾU: resume permission (agent không tự resume khi halt)
```

## Implementation

```typescript
// packages/core/src/mandatory-stop.ts (MỚI)

type Verdict = { action: "permit"; reason?: string } | { action: "halt"; reason: string };

interface StepContext {
  tool: string; args: unknown; result: { ok: boolean };
  budget: { used: number; max: number };
  round: number;
}

interface Policy { check(ctx: StepContext): Promise<Verdict> }

class MandatoryStop {
  private halted = false;
  private haltReason = "";

  constructor(private policies: Policy[]) {}

  // Sau MỖI step: mandatory stop → chạy policies → permit/halt
  async afterStep(ctx: StepContext): Promise<Verdict> {
    if (this.halted) return { action: "halt", reason: this.haltReason }; // đã halt thì giữ
    for (const p of this.policies) {
      const v = await p.check(ctx);
      if (v.action === "halt") { this.halted = true; this.haltReason = v.reason; return v; }
    }
    return { action: "permit" };
  }

  // Resume CHỈ qua approve — agent không tự resume
  approve(): void { this.halted = false; this.haltReason = ""; }
}
// Usage (trong core/loop.ts post-tool hook):
// const stop = new MandatoryStop([
//   { check: async (c) => c.tool === "bash" && !(await permission.requiresApproval(c))
//       ? { action: "permit" } : { action: "halt", reason: "bash needs approval" } },
//   { check: async (c) => c.budget.used <= c.budget.max
//       ? { action: "permit" } : { action: "halt", reason: "budget exceeded" } },
// ]);
// // loop: sau mỗi step → const v = await stop.afterStep(ctx); if (v.action === "halt") break;
// // resume: gateway approval-relay → stop.approve() → loop tiếp — enforcement, không suggestion
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Obedience bằng code (LLM không bỏ qua gate) | ❌ Dừng mỗi step → latency (chờ check) |
| ✅ Block progression thật (halt không resume tự do) | ❌ Resume cần infra approve (chậm khi nhiều halt) |
| ✅ Policy tập trung (permission/budget/evidence 1 chỗ) | ❌ Policy sai → chặn nhầm cả task hợp lệ |
| ✅ Audit rõ (mỗi verdict ghi log) | ❌ Halt nhiều → agent không tiến được (frustration) |

## Khác các hướng gần

| | Suggestion (prompt) | Soft gate | ZD: Mandatory Stop |
|---|---|---|---|
| Enforce | ❌ LLM bỏ qua | ⚠️ | **✅ code chặn** |
| Resume | tự do | tự do | **Chỉ qua approve** |
| Latency | 0 | thấp | **Mỗi step +1 check** |

## Khi nào chọn

- Task nhạy cảm (bash, ghi file, mạng) — không thể tin LLM tự dừng
- Cần gates block thật sự (permission/budget/evidence) giữa các bước
- Muốn audit mọi quyết định tiếp tục
- Nối packages/core loop.ts + tools permission.ts + budget.ts + iteration-budget.ts + gateway approval-relay.ts; guard policy-precision (tránh halt nhầm), resume-auth (chỉ human/leader approve), và stop-overhead (check nhanh, không gọi LLM); ZD = mandatory stop enforcement, kết hợp 679 ZC two-loops-control-plane (control loop enforce) + 681 ZE durable-breakpoint-adapter (halt sống qua restart)
