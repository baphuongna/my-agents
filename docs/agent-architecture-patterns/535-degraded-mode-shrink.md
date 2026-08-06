# Hướng TO: Degraded Mode Shrink — khi thiếu resource, giữ workflow nhưng thu hẹp bề mặt work

> **Nguồn gốc:** ClaudeSkills `SKILL.md` degraded-mode blocks; "when subagents/shell/workspace-write unavailable: keep workflow, shrink work surface"; "inline notes instead of subagent delegation"; "drop heavy evaluator"; "degrade gracefully — never crash" | **Coupling:** 🟡 — thêm capability-detect + degraded-mode branch vào workflow runner | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflow runner + DegradedResult sẵn — chưa có capability-detect + degraded-mode selection) | **Effort:** 2-3 tuần

## Nguồn gốc

**ClaudeSkills** workflow giả định **đầy đủ resource** (subagents, shell, workspace-write). Khi **thiếu** (sandbox không có bash, subagent pool cạn, FS read-only) — workflow **không crash**, mà **degrade**: (1) **Keep workflow** (vẫn làm task, không bỏ). (2) **Shrink work surface** — thay subagent delegation → inline notes (agent tự làm, không delegate); thay write artifact → inline output (không ghi file); bỏ evaluator nặng (không judge, chỉ thực hiện). Nguyên tắc: **graceful degradation** — thiếu resource không chết, chỉ chậm/hạn chế hơn. Khác error-handling (catch + fail) — TO **still deliver** (chất lượng thấp hơn nhưng có kết quả).

## Mô tả

mya degraded mode shrink: (1) **Capability detect**: check resource available (subagent pool? bash? FS write?). (2) **Degraded-mode map**: mỗi thiếu resource → degraded alternative (no subagent → inline, no bash → read-only analysis, no FS-write → inline output). (3) **Workflow branch**: workflow kiểm capability → chọn full mode hoặc degraded mode. (4) **Deliver**: degraded mode vẫn deliver kết quả (chất lượng thấp hơn nhưng có). (5) **Flag**: output đánh dấu "degraded — missing X" (user biết chất lượng giảm). mya có workflow runner + DegradedResult — TO thêm **capability detector** + **degraded-mode selector**.

## Kiến trúc

```
  WORKFLOW: "research + evaluate + report"
        │
        │  capability detect
        ▼
  ┌─── FULL MODE (đủ resource) ──────────────────────────┐
  │  step 1: delegate research → subagent (parallel)       │
  │  step 2: evaluate → heavy LLM-judge evaluator           │
  │  step 3: report → write report.md (FS write)            │
  └───────────┬───────────────────────────────────────────┘
              │ MISSING: subagents, FS-write
              ▼
  ┌─── DEGRADED MODE (thiếu resource — shrink) ──────────┐
  │  step 1: research → INLINE (agent tự làm, không        │
  │           delegate — chậm hơn nhưng làm được)            │
  │  step 2: evaluate → DROP heavy evaluator (không judge, │
  │           chỉ thực hiện — bỏ bước này)                   │
  │  step 3: report → INLINE output (không write file,      │
  │           trả text trực tiếp)                             │
  │  → FLAG: "⚠ degraded — missing subagents, FS-write"     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner/worker — workflow runner (nền — TO branch degraded ở đây)
// ✅ packages/core DegradedResult — degraded result type (nền — TO flag degraded)
// ✅ packages/agent pool — subagent pool (nền — TO detect subagent availability)
// ✅ packages/tools bash/read/write — tool registry (nền — TO detect tool availability)

// ❌ THIẾU: capability detector (check subagents/shell/FS-write available)
// ❌ THIẾU: degraded-mode selector (full → degraded alternative map)
// ❌ THIẾU: degraded workflow branch (inline/replace/drop per missing resource)
// ❌ THIẾU: degraded flag (output đánh dấu "degraded — missing X")
```

## Implementation

```typescript
// packages/workflows/src/degraded-mode.ts (MỚI)
interface Capabilities {
  subagents: boolean;
  bash: boolean;
  fsWrite: boolean;
}

type DegradedAction = "inline" | "drop" | "readonly" | "noop";

interface DegradedStep {
  step: string;
  fullMode: string;
  degradedAction: DegradedAction;
  reason: string;
}

function detectCapabilities(tools: string[], subagentPoolSize: number): Capabilities {
  return {
    subagents: subagentPoolSize > 0,
    bash: tools.includes("bash"),
    fsWrite: tools.includes("write") || tools.includes("edit"),
  };
}

// map workflow steps → degraded alternatives based on missing capabilities
function planDegraded(steps: string[], caps: Capabilities): DegradedStep[] {
  return steps.map(step => {
    if (step.includes("delegate") && !caps.subagents)
      return { step, fullMode: "subagent", degradedAction: "inline", reason: "no subagents" };
    if (step.includes("evaluate") && !caps.subagents)
      return { step, fullMode: "evaluator", degradedAction: "drop", reason: "no subagents for judge" };
    if ((step.includes("write") || step.includes("report")) && !caps.fsWrite)
      return { step, fullMode: "fs-write", degradedAction: "inline", reason: "no FS-write" };
    if (step.includes("bash") && !caps.bash)
      return { step, fullMode: "bash", degradedAction: "readonly", reason: "no bash" };
    return { step, fullMode: "full", degradedAction: "noop", reason: "available" };
  });
}

// Usage:
// const caps = detectCapabilities(tools, pool.available());
// if (!caps.subagents || !caps.fsWrite) {
//   const plan = planDegraded(workflowSteps, caps);
//   // run degraded — inline, drop, readonly
//   result.degraded = true; result.degradedReasons = plan.filter(p => p.degradedAction !== "noop");
// }
```

## Được

- ✅ Graceful degradation (không crash khi thiếu resource)
- ✅ Still deliver (kết quả chất lượng thấp hơn nhưng có)
- ✅ Transparent flag (user biết "degraded — missing X")
- ✅ Workflow reuse (cùng workflow, full + degraded — không viết 2 workflow)

## Mất

- ❌ Quality drop (degraded = kém hơn — inline thay subagent, drop evaluator)
- ❌ Complexity (capability detect + degraded branch → code phức tạp hơn)
- ❌ Hidden degradation (user miss flag → tưởng full quality)
- ❌ Testing burden (phải test cả full + degraded path)

## Khác

Khác **error-handling** (catch + fail/retry) — TO **still deliver** (degraded, không fail). Khác **TI cheap-model-delegation** (delegate cho model rẻ khi đủ resource) — TO **shrink work** khi thiếu resource. Khác **TM brief-full-delta-modes** (chọn artifact weight theo nhu cầu) — TO **chọn work surface** theo capability.

## Khi nào chọn

- Workflow chạy nhiều môi trường (sandbox, CI, local — capability khác nhau)
- Muốn graceful (thiếu resource không crash, vẫn deliver)
- Agent deploy ở môi trường hạn chế (no bash, no FS-write, no subagent)
- Nối packages/workflows runner + packages/core DegradedResult + packages/agent pool + packages/tools; guard flag visibility (degraded flag rõ — user không miss), quality calibration (degraded = lower expectation), và test coverage (test cả full + degraded path); TO = degraded mode shrink, kết hợp TJ clean-handoff-ritual (degraded → handoff khi context cạn) + TN run-summary-observability (track degraded runs)
