# Hướng RG: Plan-After-Trial — agent chạy trial thực thi trước rồi mới plan dựa evidence

> **Nguồn gốc:** Papers (Plan-After-Trial — PaT); "run trial before planning"; "evidence-based planning from execution"; "explore-then-plan agent strategy"; "trial execution informs planning"
> **Coupling:** 🟡 — thêm trial-execution phase trước planning loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent loop + tool exec sẵn — chưa có trial-phase trước plan)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Plan-After-Trial (PaT)** paper đảo ngược thứ tự **plan-then-execute** truyền thống: thay vì agent lập kế hoạch từ static context rồi mới execute, PaT yêu cầu agent **chạy trial execution trước** — thử nghiệm nhanh trên môi trường thật (run tool, read file, exec command) — rồi mới **plan dựa trên evidence thực tế** thu được. Nguyên tắc: **plan dựa trên facts, không phải assumption** — trial expose real constraints (path tồn tại không, API response thế nào, dependency nào thiếu) → plan chính xác hơn. Khác **442 explore-first** (explore = tìm hiểu broadly) — PaT trial là **executed probe** (chạy thật, collect evidence); khác **481 decision-complete-plan** (plan rồi confirm) — PaT **trial trước plan**.

## Mô tả

mya plan-after-trial: (1) **Trial phase**: agent nhận task → **không plan ngay** — chạy trial probes (read key files, run tests, query state, check dependencies). (2) **Evidence collection**: mỗi trial probe thu thập evidence (file exists? test pass? API returns? dependency resolved?). (3) **Evidence-based plan**: sau trial, agent **plan dựa trên evidence** — plan phản ánh constraint thật (không assume path/API/dep). (4) **Plan confidence**: trial evidence → plan có confidence score (high nếu trial cover nhiều, low nếu thiếu). (5) **Re-plan trigger**: nếu execute phase gặp unexpected → re-trial + re-plan. mya có agent loop + tool exec — RG thêm **trial phase** (pre-plan probes) + **evidence store** (trial results → plan input) + **re-plan trigger**.

## Kiến trúc

```
  AGENT nhận task: "refactor auth module to use JWT"
        │
        ▼
  ┌─── TRIAL PHASE (pre-plan probes — run before planning) ─────────┐
  │                                                                   │
  │  probe 1: read("src/auth/session.ts") → EXISTS, 240 lines          │
  │  probe 2: read("src/auth/token.ts")  → NOT FOUND                   │
  │  probe 3: run("npm ls jsonwebtoken") → NOT INSTALLED               │
  │  probe 4: run("npm test -- auth")    → 3 pass, 2 fail               │
  │  probe 5: grep("session", "src/")    → 15 files reference session   │
  │                                                                   │
  │  → EVIDENCE COLLECTED:                                             │
  │    { file: session.ts exists, token.ts missing,                     │
  │      jsonwebtoken missing, 2 auth tests failing,                    │
  │      15 files depend on session }                                   │
  └───────────────────────────┬───────────────────────────────────────┘
                              │ evidence drives plan
                              ▼
  ┌─── EVIDENCE-BASED PLAN ───────────────────────────────────────────┐
  │  PLAN (dựa trên trial evidence, NOT assumption):                    │
  │  1. install jsonwebtoken (trial: not installed)                     │
  │  2. create token.ts (trial: not found — need new file)              │
  │  3. refactor session.ts (trial: 240 lines, 15 deps)                 │
  │  4. fix 2 failing auth tests (trial: known failures)                │
  │  confidence: HIGH (trial covered key constraints)                   │
  └───────────────────────────┬───────────────────────────────────────┘
                              │ execute plan
                              ▼
  ┌─── EXECUTE PHASE ─────────────────────────────────────────────────┐
  │  run plan steps...                                                  │
  │  → if unexpected error → RE-TRIAL + RE-PLAN                         │
  └───────────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ agent loop (packages/agent) — exec + plan loop (nền — RG = trial phase trước)
// ✅ tool exec — read/run/grep (nền — RG = trial uses these as probes)
// ✅ 442 explore-first — explore broadly (nền — RG = trial = executed probe)

// ❌ THIẾU: trial phase (pre-plan probe execution)
// ❌ THIẾU: evidence store (collect trial results → feed plan)
// ❌ THIẾU: confidence scoring (trial coverage → plan confidence)
// ❌ THIẾU: re-plan trigger (unexpected → re-trial + re-plan)
```

## Implementation

```typescript
// packages/agent/src/plan-after-trial.ts (MỚI)
interface TrialProbe {
  tool: string;        // read, run, grep
  args: unknown[];
  description: string; // what we're checking
}
interface TrialEvidence {
  probe: TrialProbe;
  result: { ok: boolean; output: string; key: string }; // key = extracted fact
}
interface TrialResult {
  evidence: TrialEvidence[];
  confidence: 'high' | 'medium' | 'low'; // based on trial coverage
}

class PlanAfterTrial {
  // Generate trial probes based on task (what to check before planning)
  generateProbes(task: string): TrialProbe[] {
    // Heuristic: check key files, deps, tests, references
    return [
      { tool: 'read', args: ['package.json'], description: 'check deps' },
      { tool: 'run', args: ['npm test -- --list'], description: 'check test suite' },
      { tool: 'grep', args: [task, 'src/'], description: 'find references' },
    ];
  }

  // Run trial probes → collect evidence
  async runTrials(
    probes: TrialProbe[],
    executor: (tool: string, args: unknown[]) => Promise<{ ok: boolean; output: string }>,
  ): Promise<TrialResult> {
    const evidence: TrialEvidence[] = [];
    for (const probe of probes) {
      const result = await executor(probe.tool, probe.args);
      const key = this.extractKey(probe, result);
      evidence.push({ probe, result: { ...result, key } });
    }
    // Confidence: based on how many probes succeeded
    const successRate = evidence.filter(e => e.result.ok).length / evidence.length;
    const confidence = successRate > 0.7 ? 'high' : successRate > 0.4 ? 'medium' : 'low';
    return { evidence, confidence };
  }

  // Extract key fact from trial result (e.g., "file exists", "dep missing")
  private extractKey(probe: TrialProbe, result: { ok: boolean; output: string }): string {
    if (probe.tool === 'read') return result.ok ? 'file exists' : 'file not found';
    if (probe.tool === 'run') return result.ok ? 'command succeeded' : 'command failed';
    return result.ok ? 'references found' : 'no references';
  }

  // Build evidence context for planner (feed trial results into plan prompt)
  buildEvidenceContext(trial: TrialResult): string {
    const lines = trial.evidence.map(e =>
      `- TRIAL [${e.probe.description}]: ${e.result.key} — ${e.result.output.slice(0, 200)}`);
    return `Trial evidence (confidence: ${trial.confidence}):\n${lines.join('\n')}\n\nPlan based on above evidence.`;
  }
}

// Usage:
// const pat = new PlanAfterTrial();
// const probes = pat.generateProbes("refactor auth");
// const trial = await pat.runTrials(probes, agentExecutor);
// const evidenceCtx = pat.buildEvidenceContext(trial);
// plan = await agent.plan(task, evidenceCtx);  // plan based on trial evidence
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan chính xác (dựa evidence, không assumption) | ❌ Latency (trial phase thêm round-trip trước plan) |
| ✅ Discover real constraints (path/API/dep thật) | ❌ Trial cost (tool exec trước plan = token/time) |
| ✅ Confidence scoring (biết plan tin cậy mấy) | ❌ Bad probe (sai probe → evidence thiếu → plan sai) |
| ✅ Re-plan trigger (unexpected → adapt) | ❌ Complexity (trial + evidence + re-plan loop) |

## Khác các hướng gần

| | 442 Explore-First | 481 Decision-Complete-Plan | RG: Plan-After-Trial |
|---|---|---|---|
| Cái gì | Explore broadly | Plan rồi confirm | **Trial exec → evidence → plan** |
| Trước plan | Explore (browse) | Explore | **Execute probes (trial)** |
| Evidence | Indirect | Exploration notes | **Direct tool results** |

## Khi nào chọn

- Task phức tạp (plan cần biết real constraints trước)
- Muốn plan dựa evidence (không assumption → ít rework)
- Cần confidence score (biết plan tin cậy mấy)
- Nối agent loop (RG = trial phase trước planning) + 442 explore-first (trial = focused probe vs explore = broad); guard probe quality (chọn probe đúng = evidence đủ → plan đúng) + trial cost (probe tối thiểu, không over-probe)
