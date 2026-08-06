# Hướng AFO: Role-Specialized Agent Set — đóng gói 5 agent chuyên môn (planner/scout/worker/reviewer/visual-tester) với model + thinking mức riêng (Opus medium, Haiku fast, Sonnet minimal) và output contract — pipeline planning có sẵn từ /plan

> **Nguồn gốc:** pi-interactive-subagents (agents/*.md) | **Coupling:** 🟢 — bộ agent config tách rời | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill model field + multi-profile, thiếu role-set pipeline) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-interactive-subagents** đóng gói **5 agent chuyên môn**, mỗi agent có **model + thinking budget mức riêng** phù hợp vai trò: **planner** (Opus, thinking medium — lập kế hoạch sâu), **scout** (Haiku, fast — thăm dò nhanh), **worker** (Sonnet, minimal thinking — làm việc đều), **reviewer** (Opus, medium — đánh giá), **visual-tester** (Sonnet — kiểm thử UI). Mỗi agent có **output contract** rõ (format kết quả). Pipeline `/plan` sẵn: planner → scout → worker → reviewer → visual-tester. Nguyên tắc: **đúng model/thinking cho đúng vai trò**, không dùng model đắt cho task đơn giản.

## Mô tả

mya role-specialized: (1) **skill model field đã sẵn** — `packages/skills` Skill có `model?` field (preferred model per skill); (2) **multi-profile đã sẵn** — `packages/core` Session có ProviderProfile[] (chọn model); (3) **thinking budget** — `packages/core` budget.ts có iteration/cost budget (nền thinking mức); (4) **role-set config** — 5 agent config (model + thinking + output contract); (5) **/plan pipeline** — orchestrator chạy tuần tự planner→scout→worker→reviewer→visual-tester qua spawnSubagent. Nối AFN (async steering) để pipeline event-driven.

## Kiến trúc (ASCII)

```
  /plan ──▶ PIPELINE (tuần tự, output contract giữa mỗi giai đoạn)
   │
   1. PLANNER   (Opus,  thinking medium) ─▶ kế hoạch JSON
   2. SCOUT     (Haiku, fast)            ─▶ danh sách file/điểm quan tâm
   3. WORKER    (Sonnet,thinking minimal) ─▶ thay đổi code
   4. REVIEWER  (Opus,  thinking medium) ─▶ verdict + issues
   5. VISUAL-TESTER (Sonnet)             ─▶ screenshot/UI check

   mỗi agent: model + thinking mức RIÊNG + OUTPUT CONTRACT
   đúng model cho đúng việc → tiết kiệm cost, đúng chất lượng
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — Skill.model?: string (preferred model per skill/agent)
// ✅ packages/skills curator.ts — frontmatter model (preserve ALL fields)
// ✅ packages/core session.ts — Session.profiles: ProviderProfile[] (chọn model)
// ✅ packages/core budget.ts — iteration/cost budget (nền thinking mức)
// ✅ packages/agent index.ts — spawnSubagent(goal, { allowedTools }) cho mỗi role

// ❌ THIẾU: role-set config (5 agent: model+thinking+output contract)
// ❌ THIẾU: /plan pipeline orchestrator (planner→scout→worker→reviewer→visual-tester)
```

## Implementation

```typescript
// packages/agent/src/role-set.ts (MỚI)
export type RoleKind = "planner" | "scout" | "worker" | "reviewer" | "visual-tester";
export interface RoleAgent {
  readonly role: RoleKind;
  readonly model: string;        // "claude-opus" | "claude-haiku" | "claude-sonnet"
  readonly thinking: "none" | "minimal" | "medium";
  readonly outputContract: string;  // format kết quả agent phải tuân
}
export const ROLE_SET: Record<RoleKind, RoleAgent> = {
  planner:  { role: "planner",  model: "opus",   thinking: "medium",  outputContract: "JSON {steps: Step[]}" },
  scout:    { role: "scout",    model: "haiku",  thinking: "none",    outputContract: "list {files: string[], notes: string}" },
  worker:   { role: "worker",   model: "sonnet", thinking: "minimal", outputContract: "diff {path, change}" },
  reviewer: { role: "reviewer", model: "opus",   thinking: "medium",  outputContract: "verdict {ok: bool, issues: Issue[]}" },
  "visual-tester": { role: "visual-tester", model: "sonnet", thinking: "minimal", outputContract: "report {passed: bool, screenshot: path}" },
};
/** Chạy /plan pipeline tuần tự; output mỗi role feed role sau. */
export async function runPlanPipeline(
  spawn: (role: RoleAgent, goal: string) => Promise<string>,
  task: string,
): Promise<string> {
  const plan = await spawn(ROLE_SET.planner, `Plan: ${task}`);
  const scout = await spawn(ROLE_SET.scout, `Scout from plan: ${plan}`);
  const work = await spawn(ROLE_SET.worker, `Implement: ${scout}`);
  const review = await spawn(ROLE_SET.reviewer, `Review: ${work}`);
  return review;   // visual-tester tùy chọn
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đúng model/thinking cho đúng việc — tiết kiệm cost | ❌ 5 agent = 5 lần spawn (latency + orchestration) |
| ✅ Output contract → giai đoạn sau parse được | ❌ Pipeline cứng — khó nhảy bước khi cần |
| ✅ Pipeline /plan sẵn — lập kế hoạch có cấu trúc | ❌ Visual-tester cần capability screenshot (không phải đâu cũng có) |

## Khác các hướng gần

| | AFO Role-Specialized Set | AFN Async Steering | Council (adversarial) |
|---|---|---|---|
| Mô hình | Pipeline vai trò cố định | Fan-out async | Đa model adversarial |
| Model | Theo vai trò (Opus/Haiku/Sonnet) | Theo task | Đa provider |
| Mục đích | Chia công việc theo chuyên môn | Gom kết quả song song | Cross-check quality |

## Khi nào chọn

- Task phức tạp cần chia vai trò (plan → scout → work → review → test)
- Muốn tối ưu cost: model rẻ cho task đơn giản, model đắt cho task sáng tạo
- Cần output contract để giai đoạn parse được
- Guard: output contract validated, pipeline có skip/retry, model fallback khi thiếu
