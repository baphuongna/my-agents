# Hướng NI: Plan-as-Branch Workflow — plan = git branch, scaffold/execute/verify/PR, STATE.md mỗi turn

> **Nguồn gốc:** pi-soly; "git branching model" (Git Flow, trunk-based); "structured plan execution"; "plan-execute" (57); "spec-driven development" (114); "task board as VCS"; "project state machine"; "visible state" (agent transparency)
> **Coupling:** 🟡 — thêm soly workflow engine vào agent loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (git + agent-loop sẵn — chưa có plan-branch workflow)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Git Flow**: mỗi feature = branch → develop → merge. pi-soly áp dụng: **mỗi plan = một git branch**. Workflow: `soly new <slug>` (tạo branch + PLAN.md) → `soly execute` (LLM chạy plan, follow rules, write SUMMARY.md) → `soly verify` (self-review loop) → `soly done` (commit + push + draft PR). State sống trong `.agents/STATE.md` (markdown, git-friendly, inject vào system prompt mỗi turn). Nguyên lý: **LLM không drive workflow — *user* drive qua slash commands**, LLM là executor trong khung đó. Giống **57 plan-execute** (plan rồi execute) nhưng plan **= branch** (VCS-backed, auditable). Khác ở chỗ state là file markdown visible (không phải hidden plan object).

## Mô tả

mya plan-as-branch workflow: (1) `soly init` scaffold `.agents/` (STATE.md, plans/, rules/); (2) `soly new feat/auth` → `git checkout -b feat/auth` + PLAN.md; (3) `soly execute` → LLM đọc PLAN.md + STATE.md, thực thi, viết SUMMARY.md; (4) `soly verify` → self-review loop (cho đến "No issues"); (5) `soly done` → commit + push + `gh pr create`. STATE.md inject mỗi turn → agent biết trạng thái. Rules inject vào `## ⚠️ MANDATORY` block. Nối 57 plan-execute + 114 spec-driven + 253 change-preview.

## Kiến trúc

```
  USER: soly new feat/auth-jwt
        │
        ▼
  git checkout -b feat/auth-jwt
  .agents/plans/feat/auth-jwt/PLAN.md  ← (scaffolded)
        │
        ▼
  USER: soly execute feat/auth-jwt
        │
        ▼
  ┌─── EXECUTE LOOP (LLM-driven, rule-bounded) ───────────┐
  │                                                        │
  │  Each turn, system prompt gets:                         │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ ## ⚠️ MANDATORY: soly project rules              │  │
  │  │ (rules from .agents/rules/, glob-scoped)          │  │
  │  │                                                   │  │
  │  │ .agents/STATE.md  (current state — inject)       │  │
  │  │ .agents/plans/feat/auth-jwt/PLAN.md (goal)       │  │
  │  └──────────────────────────────────────────────────┘  │
  │                                                        │
  │  LLM executes plan step → writes code → updates        │
  │  STATE.md → SUMMARY.md                                 │
  └────────────────────────┬───────────────────────────────┘
                           │
                           ▼
  USER: soly verify    → self-review loop (until "No issues found")
  USER: soly done      → git commit + push + gh pr create --draft
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 57 plan-execute — plan then execute (nền — NI = plan as git branch)
// ✅ 114 spec-driven-development — spec → code (nền)
// ✅ git integration — branch/commit (sẵn)
// ✅ 292 agent-lifecycle-hooks — hooks (nền — NI uses session_start/agent_start)

// ❌ THIẾU: soly workflow commands (new/execute/verify/done)
// ❌ THIẾU: STATE.md per-turn injection
// ❌ THIẾU: PLAN.md scaffold + SUMMARY.md output
// ❌ THIẾU: verify self-review loop (until clean)
// ❌ THIẾU: draft PR creation (gh integration)
```

## Implementation

```typescript
// packages/agent/src/plan-branch.ts (NEW)
import { execSync } from 'node:child_process';

interface PlanContext {
  slug: string;
  branch: string;
  planPath: string;
  statePath: string;
}

class PlanBranchWorkflow {
  // soly new <slug> — create branch + scaffold PLAN.md
  new(slug: string): PlanContext {
    const branch = slug;
    execSync(`git checkout -b ${branch}`);

    const planPath = `.agents/plans/${slug}/PLAN.md`;
    const statePath = '.agents/STATE.md';
    this.write(planPath, this.planTemplate(slug));
    this.touch(statePath);

    return { slug, branch, planPath, statePath };
  }

  // soly execute <slug> — inject plan + state into system prompt, run agent
  execute(ctx: PlanContext): void {
    const plan = this.read(ctx.planPath);
    const state = this.read(ctx.statePath);
    const rules = this.loadRules(); // glob-scoped, see NJ

    // System prompt injection (each turn):
    // ## ⚠️ MANDATORY: soly project rules
    // <rules>
    // .agents/STATE.md: <state>
    // .agents/plans/<slug>/PLAN.md: <plan>
    // LLM executes plan → updates STATE.md → writes SUMMARY.md
    this.injectSystemPrompt(rules, state, plan);
  }

  // soly verify [N] — self-review loop until clean
  async verify(maxRounds: number = 5): Promise<{ clean: boolean; rounds: number }> {
    for (let i = 0; i < maxRounds; i++) {
      const issues = await this.runSelfReview();
      if (issues.length === 0) return { clean: true, rounds: i + 1 };
      await this.fixIssues(issues);
    }
    return { clean: false, rounds: maxRounds };
  }

  // soly done <slug> — commit + push + draft PR
  done(ctx: PlanContext): void {
    execSync('git add -A');
    execSync(`git commit -m "feat: ${ctx.slug}"`);
    execSync('git push -u origin HEAD');
    execSync(`gh pr create --draft --title "${ctx.slug}" --body-file ${ctx.planPath}`);
  }

  // After each turn: update STATE.md with current progress
  updateState(ctx: PlanContext, progress: string): void {
    this.write(ctx.statePath, `# State\n\nLast updated: ${new Date().toISOString()}\n\n${progress}`);
  }

  private planTemplate(slug: string): string {
    return `# Plan: ${slug}\n\n## Goal\n\n## Steps\n\n## Acceptance\n`;
  }
  private write(p: string, c: string): void {}
  private read(p: string): string { return ''; }
  private touch(p: string): void {}
  private loadRules(): string { return ''; }
  private injectSystemPrompt(rules: string, state: string, plan: string): void {}
  private async runSelfReview(): Promise<string[]> { return []; }
  private async fixIssues(issues: string[]): Promise<void> {}
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan = branch (auditable, reversible, VCS-backed) | ❌ Branch overhead (manage branches) |
| ✅ STATE.md visible mỗi turn (agent context grounding) | ❌ User-driven (LLM không tự drive — cần user command) |
| ✅ Self-review verify loop (không merge nếu dirty) | ❌ Markdown state (no schema validation) |
| ✅ Draft PR auto-created (review-ready) | ❌ gh CLI dependency (for PR) |

## Khác các hướng gần

| | 57 Plan-Execute | 114 Spec-Driven | 164 Workflows-as-Code | NI: Plan-as-Branch |
|---|---|---|---|---|
| Plan | In-memory | Spec file | Code script | **Git branch + PLAN.md** |
| State | Hidden | Spec | Code | **STATE.md (visible, inject mỗi turn)** |
| Output | Result | Code | Result | **Branch + PR + SUMMARY.md** |

## Khi nào chọn

- Muốn structured workflow (new → execute → verify → PR)
- Plan cần VCS-backed (branch = audit trail)
- Agent cần state grounding mỗi turn (STATE.md)
- Nối 374 conditional-rule-loading (MANDATORY rules inject) + 253 change-preview + 57 plan-execute
