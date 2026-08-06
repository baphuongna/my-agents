# Hướng RM: Decision-Complete Plan Contract — Plan Mode 3 pha explore→intent→implementation, proposed_plan không để quyết định mở

> **Nguồn gốc:** Leaks Codex (Plan Mode conversational; `<proposed_plan>` block; "decision complete"; explore-first non-mutating; `request_user_input`); "implementer does not need to make any decisions"; "plan-only / no mutation until plan ends"
> **Coupling:** 🟡 — thêm Plan Mode gate vào agent loop (chặn mutation, thu thập quyết định, emit proposed_plan)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (plan/TODO tracking + tool-gate sẵn — chưa có explore-first gate + decision-complete contract)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Codex** định nghĩa **Plan Mode**: agent làm việc trong **3 pha hội thoại** trước khi chốt kế hoạch. **Pha 1 — Ground**: **explore-first** — khám phá repo thật (read/search/inspect, không mutate) để loại bỏ ẩn ý *trước* khi hỏi user; chỉ hỏi khi không thể phát hiện từ môi trường. **Pha 2 — Intent chat**: hỏi cho đến khi nêu rõ được goal + success criteria + scope in/out + constraints. **Pha 3 — Implementation chat**: hỏi cho đến khi spec **decision complete** — approach, interfaces, data flow, edge cases, test plan, rollout. **Finalization**: chỉ emit kế hoạch khi **decision complete** (người thực thi không cần ra quyết định thêm), bọc trong block `<proposed_plan>`. **Quy tắc cứng**: trong Plan Mode, **không mutation** (edit/write/patch/format đều cấm); nếu user ra lệnh thực thi thì vẫn coi là "plan the execution", không thực thi. Khác **475 RG plan-after-trial** (chạy trial thực thi trước) — RM **chạy trial phi-mutation** (read-only); khác **422 PF deterministic-compactor** (nén context) — RM **nén sự mơ hồ thành quyết định**.

## Mô tả

mya decision-complete plan contract: (1) **Plan Mode gate**: flag bật Plan Mode → mọi tool mutation (edit/write/bash-mutating) bị gate chặn, chỉ non-mutating (read/grep/ls/build-dry-run) được. (2) **Explore-first**: pha 1 agent tự khám phá repo (ít nhất 1 lượt explore trước khi hỏi user). (3) **Decision collector**: pha 2-3 dùng `request_user_input` (multiple-choice có nghĩa) thu từng quyết định; mỗi câu phải *thay đổi spec* hoặc *khóa giả định* hoặc *chọn tradeoff* — không hỏi trivia. (4) **Decision-complete check**: checker duyệt plan → nếu còn placeholder/TODO mở → từ chối emit, hỏi tiếp. (5) **`<proposed_plan>`**: khi complete → emit block `<proposed_plan>` (Title / Summary / Key Changes / Test Plan / Assumptions). (6) **Exit**: user rời Plan Mode → agent thực thi. mya có plan/TODO tracking — RM thêm **mutation gate** + **decision-complete checker** + **explore-first ordering**.

## Kiến trúc

```
  USER PROMPT (yêu cầu tính năng)
        │
        ▼
  ┌─── PLAN MODE GATE ────────────────────────────────┐
  │  mode = plan                                        │
  │  mutation tools (Edit/Write/Patch)  → BLOCKED ❌    │
  │  non-mutating (Read/Grep/Ls/Build-dry) → ALLOWED ✅ │
  └───────────────────────┬────────────────────────────┘
                          ▼
  ┌─── PHASE 1: EXPLORE-FIRST (ground) ────────────────┐
  │  agent tự khám phá repo (read/search/inspect)        │
  │  loại bỏ ẩn ý có thể phát hiện                       │
  │  ≥1 lượt explore TRƯỚC khi hỏi user                  │
  └───────────────────────┬────────────────────────────┘
                          ▼
  ┌─── PHASE 2: INTENT CHAT ───────────────────────────┐
  │  request_user_input: goal? scope in/out? constraints?│
  │  chỉ hỏi khi KHÔNG phát hiện được từ repo            │
  └───────────────────────┬────────────────────────────┘
                          ▼
  ┌─── PHASE 3: IMPLEMENTATION CHAT ───────────────────┐
  │  request_user_input: approach? interfaces? edge cases?│
  │  test plan? rollout?                                 │
  └───────────────────────┬────────────────────────────┘
                          ▼
  ┌─── DECISION-COMPLETE CHECK ────────────────────────┐
  │  còn TODO/placeholder/mở?  ─── YES → hỏi tiếp (về P3)│
  │                            ─── NO  ─┐                │
  └─────────────────────────────────────┴────────┬──────┘
                                                 ▼
  ┌─── EMIT <proposed_plan> ───────────────────────────┐
  │  <proposed_plan>                                    │
  │  ## Summary / ## Key Changes / ## Test Plan         │
  │  ## Assumptions                                     │
  │  </proposed_plan>                                   │
  │  (không hỏi "should I proceed?" — user tự thoát mode)│
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ plan/TODO tracking (packages/agent) — plan artifact + checklist (nền — RM = gate + contract)
// ✅ tool-gate / permission — chặn tool theo policy (nền — RM = mutation gate khi Plan Mode)
// ✅ 475 RG plan-after-trial — trial trước plan (gần — RM explore phi-mutation, không execute)
// ✅ 422 PF deterministic-compactor — nén context (đối chiếu — RM nén mơ hồ thành quyết định)

// ❌ THIẾU: Plan Mode flag (mode gate bật/tắt mutation permission)
// ❌ THIẾU: explore-first ordering (≥1 read-only pass trước request_user_input)
// ❌ THIẾU: decision-complete checker (duyệt plan còn placeholder → từ chối emit)
// ❌ THIẾU: <proposed_plan> block emission (block-tag + 5-section template)
```

## Implementation

```typescript
// packages/agent/src/plan-mode.ts (MỚI)
type PlanPhase = "explore" | "intent" | "implementation";

interface PlanModeState {
  active: boolean;
  phase: PlanPhase;
  explored: boolean;          // đã có ≥1 lượt read-only?
  decisions: Decision[];      // quyết định đã thu thập
  openItems: string[];        // TODO/placeholder chưa đóng
}

interface Decision {
  question: string;
  options: string[];          // multiple-choice có nghĩa
  chosen: string | null;      // null = chưa trả lời (giả định)
  isAssumption: boolean;      // true nếu dùng default khi user im
}

const MUTATION_TOOLS = new Set(["edit", "write", "bash-mutating", "patch"]);

class PlanModeGate {
  private st: PlanModeState = { active: false, phase: "explore", explored: false, decisions: [], openItems: [] };

  enter(): void { this.st.active = true; this.st.phase = "explore"; }

  // mutation gate: chặn tool mutating khi Plan Mode đang bật
  canRunTool(tool: string, isMutating: boolean): { ok: boolean; reason?: string } {
    if (!this.st.active) return { ok: true };
    if (isMutating || MUTATION_TOOLS.has(tool))
      return { ok: false, reason: "Plan Mode: mutation bị chặn — chỉ explore (read/grep/ls)" };
    this.st.explored = true;          // tool non-mutating = 1 lượt explore
    return { ok: true };
  }

  // record một câu hỏi (chỉ hỏi khi thay đổi spec / khóa giả định / chọn tradeoff)
  recordDecision(d: Decision): void {
    if (d.chosen === null) d.isAssumption = true;   // default khi user im
    this.st.decisions.push(d);
  }

  // checker: plan có decision-complete?
  isDecisionComplete(): { complete: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!this.st.explored) missing.push("chưa explore repo (≥1 read-only pass)");
    for (const d of this.st.decisions)
      if (d.chosen === null && !d.isAssumption) missing.push(`chưa trả lời: ${d.question}`);
    if (this.st.openItems.length) missing.push(...this.st.openItems);
    return { complete: missing.length === 0, missing };
  }

  // emit proposed_plan (chỉ khi complete)
  emitProposedPlan(plan: { title: string; summary: string; keyChanges: string[]; testPlan: string[]; assumptions: string[] }): string | null {
    const { complete, missing } = this.isDecisionComplete();
    if (!complete) {
      this.st.phase = "implementation";   // quay lại hỏi
      return null;                         // caller: hỏi tiếp các missing
    }
    return [
      `<proposed_plan>`,
      `# ${plan.title}`,
      `## Summary`, plan.summary,
      `## Key Changes`, ...plan.keyChanges.map(c => `- ${c}`),
      `## Test Plan`, ...plan.testPlan.map(t => `- ${t}`),
      `## Assumptions`, ...plan.assumptions.map(a => `- ${a}`),
      `</proposed_plan>`,
    ].join("\n");
  }

  exit(): void { this.st.active = false; }
}

// Usage:
// gate.enter();                                  // Plan Mode bật
// gate.canRunTool("edit", true);                 // → BLOCKED
// gate.canRunTool("read", false);                // → ok, explored=true
// gate.recordDecision({ question: "sync hay async?", options: ["sync","async"], chosen: null });
// const out = gate.emitProposedPlan(plan);       // null nếu chưa complete
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan không còn quyết định mở (implementer thực thi ngay) | ❌ Chậm hơn (3 pha hỏi trước khi làm) |
| ✅ Explore-first → ít hỏi thừa (tự phát hiện từ repo) | ❌ Cần flag mutate/non-mutate trên từng tool |
| ✅ Mutation gate an toàn (Plan Mode không phá code) | ❌ Tool-gate có thể cản workflow quen thuộc |
| ✅ proposed_plan có cấu trúc (Summary/Changes/Test/Assumptions) | ❌ Decision checker phải duyệt placeholder thủ công |

## Khác các hướng gần

| | 475 Plan-After-Trial | 422 Deterministic-Compactor | RM: Decision-Complete Plan |
|---|---|---|---|
| Cái gì | Chạy trial thực thi → plan | Nén context | **Plan 3-pha, không mutation, decision-complete** |
| Trial | Thực thi thật (có mutate) | ❌ | **Phi-mutation (read-only)** |
| Đầu ra | Plan từ evidence | Context nén | **`<proposed_plan>` không quyết định mở** |

## Khi nào chọn

- Cần lên plan chi tiết trước khi agent đụng code (review trước khi thực thi)
- Muốn plan "decision complete" — giao engineer/agent khác thực thi ngay
- User muốn được hỏi các quyết định quan trọng (scope/tradeoff) chứ không đoán
- Nối plan/TODO tracking (RM = gate + contract) + tool-gate (mutation block) + 475 RG (đối chiếu trial); guard mutation-gate override (user rời Plan Mode → thực thi) + decision-complete check (chưa đóng → hỏi tiếp, không emit) + explore-first ordering (read-only trước hỏi)
