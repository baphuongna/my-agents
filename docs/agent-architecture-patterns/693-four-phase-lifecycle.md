# Hướng ZQ: Four-Phase Lifecycle — 4 lifecycle phase Analysis→Planning→Solutioning→Implementation, mỗi phase gán agent riêng và có validation (BMad Master kiểm PRD completeness, readiness check) — cổng validate giữa phase
> **Nguồn gốc:** BMAD-METHOD (bmad-orchestrator.js) | **Coupling:** 🟡 — phase machine + validation gate trong orchestrator | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (two-loops ZC nền + workflows runner — chưa có 4-phase với agent riêng) | **Effort:** 2-3 tuần

## Nguồn gốc

**BMAD-METHOD** chia lifecycle làm **4 phase tuần tự**: (1) **Analysis** — hiểu vấn đề, thu thập context; (2) **Planning** — lập kế hoạch, phân rã; (3) **Solutioning** — thiết kế giải pháp (architecture, PRD); (4) **Implementation** — viết code, triển khai. Mỗi phase **gán agent riêng** (agent chuyên cho từng phase — không 1 agent làm tất cả) và có **validation** ở cuối: **BMad Master** kiểm **PRD completeness** (PRD có đủ yêu cầu? acceptance criteria?), **readiness check** (output phase đủ để phase sau bắt đầu?). Validation là **cổng giữa phase** — phase sau không bắt đầu khi phase trước chưa đạt. Nguyên tắc: **4 phase, agent riêng, cổng validate giữa mỗi phase**.

## Mô tả

mya four-phase lifecycle: (1) **4 phase const** — analysis → planning → solutioning → implementation. (2) **Per-phase agent** — mỗi phase có agent/profile riêng (role, model, tool set). (3) **Validation gate** — cuối phase: master check (PRD completeness, readiness) → pass mới sang phase sau. (4) **Artifact handoff** — phase output (analysis doc, plan, PRD) là input phase sau. mya có core/loop.ts + agent/pool.ts + roles + council/adversarial (validation) — ZQ thêm **phase machine 4 phase** + **per-phase agent assignment** + **validation gate**.

## Kiến trúc

```
  ┌── ANALYSIS ──▶ ┌── PLANNING ──▶ ┌── SOLUTIONING ──▶ ┌── IMPLEMENTATION ──┐
  │  agent: analyst│  agent: planner│  agent: architect │  agent: builder    │
  │  context+vấn đề│  plan + phân rã │  PRD + design     │  code + test       │
  └──────┬─────────┘  └──────┬───────┘  └───────┬───────┘  └────────┬────────┘
         ▼ validate          ▼ validate         ▼ validate           ▼ done
  ┌── BMad Master (validation gate) ────────────────────────────┐
  │  analysis đủ? → plan đủ? → PRD completeness? → ready?        │
  │  fail → quay lại phase (refine) | pass → phase sau           │
  └─────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — runTurn (nền — ZQ phase execution)
// ✅ packages/agent pool.ts — AgentPool (nền — ZQ per-phase agent)
// ✅ packages/core roles.ts — RoleConfig/loadRoles (nền — ZQ gán role per phase)
// ✅ packages/council adversarial.ts — adversarialReview (nền — ZQ validation)
// ✅ packages/ai model-routing.ts — resolveModelForPhase (nền — ZQ model per phase)
// ✅ packages/workflows runner.ts — workflow runner (nền — ZQ phase machine)

// ❌ THIẾU: 4-phase lifecycle const + machine
// ❌ THIẾU: per-phase agent assignment (phase → agent/profile)
// ❌ THIẾU: validation gate giữa phase (master check)
```

## Implementation

```typescript
// packages/core/src/four-phase.ts (MỚI)

type Phase = "analysis" | "planning" | "solutioning" | "implementation";

const PHASES: Phase[] = ["analysis", "planning", "solutioning", "implementation"];

interface PhaseAgent { phase: Phase; role: string; model?: string }
interface PhaseArtifact { phase: Phase; content: string }
interface Validator { validate(phase: Phase, artifact: PhaseArtifact): Promise<{ pass: boolean; issues: string[] }> }

class FourPhaseLifecycle {
  constructor(
    private runPhase: (phase: Phase, agent: PhaseAgent, input: PhaseArtifact) => Promise<PhaseArtifact>,
    private agents: Record<Phase, PhaseAgent>,     // mỗi phase 1 agent riêng
    private validator: Validator,                   // BMad Master — validation gate
    private maxRetries = 2,
  ) {}

  async run(initial: PhaseArtifact): Promise<PhaseArtifact> {
    let input = initial;
    for (const phase of PHASES) {
      let artifact: PhaseArtifact | null = null;
      let retries = 0;
      // loop refine trong phase (validation fail → chạy lại phase)
      while (retries <= this.maxRetries) {
        artifact = await this.runPhase(phase, this.agents[phase], input);
        const v = await this.validator.validate(phase, artifact);
        if (v.pass) break;                          // cổng pass → phase sau
        retries++;
        if (retries > this.maxRetries) throw new Error(`${phase} fail sau ${this.maxRetries} retries: ${v.issues.join("; ")}`);
        input = { phase, content: `fix: ${v.issues.join("; ")}\n${artifact.content}` };
      }
      input = artifact!;                            // artifact phase → input phase sau
    }
    return input;                                   // implementation artifact cuối
  }
}
// Usage:
// const lc = new FourPhaseLifecycle(runPhaseWithAgent, {
//   analysis:       { phase: "analysis",       role: "analyst",  model: "gpt-4o" },
//   planning:       { phase: "planning",       role: "planner",  model: "gpt-4o" },
//   solutioning:    { phase: "solutioning",    role: "architect",model: "gpt-4o" },
//   implementation: { phase: "implementation", role: "builder",  model: "gpt-4o" },
// }, bmadMasterValidator);
// const done = await lc.run({ phase: "analysis", content: taskPrompt });
// // PRD completeness fail → quay lại solutioning refine — cổng validate giữa phase
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mỗi phase agent chuyên (chất lượng tốt hơn 1 agent) | ❌ 4 agent → chi phí model/token cao hơn |
| ✅ Cổng validate giữa phase (sai sớm, không trôi) | ❌ Validator là LLM → có thể pass nhầm |
| ✅ Artifact rõ ràng (mỗi phase có output) | ❌ Phase cứng (feature nhỏ phải chạy đủ 4 phase) |
| ✅ Retry trong phase (fail → refine, không chết) | ❌ Handoff artifact giữa phase phải đủ schema |

## Khác các hướng gần

| | Single agent loop | Two phases (plan/do) | ZQ: Four-Phase |
|---|---|---|---|
| Số phase | 1 | 2 | **4 (analysis→impl)** |
| Agent | 1 | 1 | **Riêng mỗi phase** |
| Gate | Không | 1 | **3 cổng validate** |

## Khi nào chọn

- Feature lớn cần analysis/plan/design trước khi code (không code vội)
- Muốn mỗi phase có agent/role chuyên biệt
- Muốn validation giữa phase (PRD completeness, readiness)
- Nối packages/core loop.ts + agent pool.ts + roles.ts + council adversarial.ts + ai model-routing.ts + workflows runner.ts; guard gate-quality (validator đủ chặt, không pass nhầm), phase-agent-fit (agent đúng phase), và artifact-schema (handoff giữa phase ổn định); ZQ = four-phase lifecycle, kết hợp 679 ZC two-loops-control-plane (phase machine deterministic) + 694 ZR adaptive-complexity-scaling (độ sâu phase theo quy mô)
