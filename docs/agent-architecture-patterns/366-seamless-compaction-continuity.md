# Hướng NB: Seamless Compaction Continuity — Compact→continue, không làm lại việc đã xong

> **Nguồn gốc:** Context compaction (Claude Code auto-compact); "never redo completed work"; "todo continuity"; Codex `AGENTS.md` todo discipline; session resume; "rolling summary"; "compact and continue" loop
> **Coupling:** 🟡 — thêm compaction + todo-state checkpoint vào agent loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (121 long-context + 182 conversational-memory sẵn — chưa có work-state-preserving compaction)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**Vấn đề context window đầy**: khi window tràn, agent phải "compact" (summarize). Nhưng compact **mù** về tiến độ → agent **làm lại việc đã xong** (re-edit file đã edit, re-run test đã pass). **Claude Code auto-compact**: khi gần đầy → summarize history. **Codex `AGENTS.md` todo discipline**: giữ todo list tường minh (done/pending) — sau compact, **todo state** cho biết đã làm gì. Nguyên tắc: **compact phải bảo toàn "work state"** (task nào done, task nào pending, decision nào đã chốt) → agent **tiếp tục đúng chỗ**, không redo. Khác **121 DQ long-context** (giữ nhiều hơn) — NB **compact + resume**; khác **362 MX event-sourced** (log event) — NB **work-state checkpoint** (todo + decision); khác **345 MG adaptive-goal** (reprioritize) — NB **continuity** (không mất tiến độ).

## Mô tả

mya seamless compaction continuity: trước khi compact, agent **checkpoint work state** — todo list (✅ done / ⬜ pending), decision log (đã chốt gì), artifact pointers (file nào đã tạo/sửa). Compact summarize history cũ **nhưng giữ nguyên work-state block**. Sau compact, agent đọc work-state → **biết chính xác** đã làm gì, còn gì → tiếp tục, **không redo**. Kết quả: agent "không bao giờ hết thời gian" — compact → continue, tiến độ không mất.

## Kiến trúc

```
  CONTEXT WINDOW gần đầy (90%)
       │
       ▼
  ┌─── PRE-COMPACT CHECKPOINT ──────────────────┐
  │  extract work state từ history:              │
  │   · TODO: [✅ A, ✅ B, ⬜ C, ⬜ D]            │
  │   · DECISIONS: "dùng JWT không session"      │
  │   · ARTIFACTS: auth.ts (edited), test (pass) │
  │   · NEXT: "implement C: refresh token"       │
  └──┬───────────────────────────────────────────┘
     ▼
  ┌─── COMPACT (summarize history cũ) ──────────┐
  │  history → rolling summary (gọn)             │
  │  work-state block → GIỮ NGUYÊN (không nén)   │
  └──┬───────────────────────────────────────────┘
     ▼
  ┌─── POST-COMPACT CONTEXT ────────────────────┐
  │  [WORK STATE]  ← nguyên vẹn                   │
  │  [SUMMARY]     ← history gọn                  │
  │  [NEW TURN]    ← tiếp tục                     │
  └──┬───────────────────────────────────────────┘
     ▼
  Agent đọc WORK STATE → tiếp tục C, KHÔNG redo A/B
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 121 DQ long-context-management — context budget (nền — NB compact policy)
// ✅ 182 FZ conversational-memory — history summarize (nền)
// ✅ 345 MG adaptive-goal-priorities — task queue (nền — NB reuse todo)
// ✅ 362 MX event-sourced-session — event log (nền — NB work-state pointer)

// ❌ THIẾU: work-state checkpoint (todo + decision + artifact trước compact)
// ❌ THIẾU: compact-and-continue loop (auto trigger khi gần đầy)
// ❌ THIẾU: redo-detection (guard: không lặp việc done)
```

## Implementation

```typescript
// packages/agent/src/compaction-continuity.ts (NEW)
interface WorkState {
  todo: { id: string; label: string; done: boolean }[];
  decisions: string[];
  artifacts: { path: string; action: 'created' | 'edited'; verified: boolean }[];
  next: string;
}

class CompactionContinuity {
  constructor(private compactThreshold = 0.9) {}

  // Trigger compact khi window gần đầy
  shouldCompact(usedRatio: number): boolean {
    return usedRatio >= this.compactThreshold;
  }

  // Checkpoint work-state trước khi compact
  async checkpoint(history: string): Promise<{ workState: WorkState; summary: string }> {
    const workState = await this.extractWorkState(history);
    const summary = await this.summarize(history, workState);
    return { workState, summary };
  }

  // Build post-compact context: work-state nguyên + summary gọn
  rebuildContext(workState: WorkState, summary: string): string {
    const todo = workState.todo.map(t => `${t.done ? '✅' : '⬜'} ${t.label}`).join('\n');
    const dec = workState.decisions.map(d => `• ${d}`).join('\n');
    const art = workState.artifacts.map(a => `• ${a.path} (${a.action}${a.verified ? ' ✓' : ''})`).join('\n');
    return [
      '## WORK STATE (preserved across compaction)',
      `### TODO\n${todo}`,
      `### DECISIONS\n${dec}`,
      `### ARTIFACTS\n${art}`,
      `### NEXT\n${workState.next}`,
      `## SUMMARY\n${summary}`,
    ].join('\n');
  }

  // Guard: agent định làm X — đã done chưa?
  isDone(workState: WorkState, taskId: string): boolean {
    return workState.todo.some(t => t.id === taskId && t.done);
  }

  private async extractWorkState(_history: string): Promise<WorkState> {
    // Parse todo/decision/artifact từ history (LLM extract hoặc rule-based)
    return { todo: [], decisions: [], artifacts: [], next: '' };
  }
  private async summarize(_h: string, _ws: WorkState): Promise<string> { return ''; }
}

// Loop:
// while (running) {
//   if (continuity.shouldCompact(usedRatio)) {
//     const { workState, summary } = await continuity.checkpoint(history);
//     context = continuity.rebuildContext(workState, summary);  // compact → continue
//   }
//   // agent làm việc — guard redo: if (continuity.isDone(ws, id)) skip;
// }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không redo việc đã xong (work-state giữ) | ❌ Checkpoint overhead (extract mỗi compact) |
| ✅ Agent "hết thời gian" → compact + tiếp tục | ❌ Work-state block tốn token (không nén) |
| ✅ Decision không mất (không đổi ý vô ý) | ❌ Extract sai → work-state thiếu (vẫn redo) |
| ✅ Nối 121 DQ + 345 MG + 362 MX | ❌ Redo-detection khó (task trùng tên) |

## Khác các hướng gần

| | 121 Long-Context Mgmt | 345 Adaptive Priorities | 362 Event-Sourced | NB: Seamless Compaction |
|---|---|---|---|---|
| Cái gì | Giữ nhiều trong window | Reprioritize task | Index event | **Compact + work-state** |
| Continuity | ❌ (giữ) | ❌ | ✅ (log) | ✅ (todo + decision) |
| No-redo | ❌ | ❌ | ❌ | ✅ |
| Auto-compact | ❌ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Task dài, context window đầy nhiều lần (auto-compact cần thiết)
- Muốn agent không redo (tiếp tục đúng chỗ sau compact)
- Cần giữ decision + artifact state qua compact
- Kết hợp 121 DQ (budget trigger) + NB (work-state checkpoint) + 345 MG (todo) + 362 MX (event pointer); guard extract correctness + redo-detection (task id unique)
