# Hướng NK: Differential Workflow Resume — resume sau sửa script: replay từ journal, chỉ re-run phần edit

> **Nguồn gốc:** pi-dynamic-workflows (resumeFromRunId); "event sourcing replay" (230); "journal/checkpoint recovery"; "deterministic replay"; "incremental build" (make); "memoization" (277); "diff-based re-execution"; "build cache invalidation"
> **Coupling:** 🟡 — cần workflow journal + call-graph diffing
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent + workflow sẵn — chưa có journal-based differential resume)
> **Effort:** 3-4 tuần

## Nguồn gốc

**Incremental build** (make, Bazel): chỉ rebuild những gì thay đổi (dependency tracking). **Event sourcing replay** (230): reconstruct state bằng cách replay event log. pi-dynamic-workflows kết hợp: khi workflow script bị sửa giữa chừng, `resumeFromRunId` **replay** các `agent()` call chưa đổi từ journal (cache) — chỉ re-run call **đã edit hoặc mới thêm**. Giống **memoization** (277): call cùng input → trả cache. Khác ở chỗ: NK **diff script cũ vs mới** (AST-level) → xác định chính xác node nào đổi → chỉ re-run node đó + downstream. Nguyên lý: **1 prompt sai không nên bắt trả tiền re-run toàn workflow**.

## Mô tả

mya differential workflow resume: (1) mỗi `agent()` call ghi journal entry {callId, prompt, args, result, tokens, cost}; (2) khi user sửa script → `resumeFromRunId(runId)`; (3) runtime diff script cũ vs mới (callId match) → unchanged calls replay từ cache (0 token), changed/new calls re-run; (4) downstream (calls phụ thuộc output của changed call) → re-run cascade. VD: sửa prompt call #5 → replay #1-4 (free), re-run #5, #6-8 (downstream). Nối 230 event-sourcing + 277 memoization + 73 durable-execution.

## Kiến trúc

```
  WORKFLOW RUN (original script):
  ┌──────────────────────────────────────────────┐
  │  agent#1 (list files)     ✅ done  120 tok   │
  │  agent#2 (scan A)         ✅ done  500 tok   │
  │  agent#3 (scan B)         ✅ done  500 tok   │
  │  agent#4 (verify)         ✅ done  800 tok   │  ← journal entries
  │  agent#5 (synthesize)     💥 FAILED          │
  └──────────────────────────────────────────────┘
        │
        │  User edits script: fixes prompt in agent#5
        │
        ▼
  resumeFromRunId(runId):
  ┌─── DIFF: old script vs new script ───────────────┐
  │                                                   │
  │  agent#1  unchanged → REPLAY (0 token, from journal)│
  │  agent#2  unchanged → REPLAY (0 token)            │
  │  agent#3  unchanged → REPLAY (0 token)            │
  │  agent#4  unchanged → REPLAY (0 token)            │
  │  agent#5  EDITED    → RE-RUN (fresh, new tokens)  │
  │                                                   │
  │  cost saved: 120 + 500 + 500 + 800 = 1920 tokens │
  │  re-run cost: only agent#5                        │
  └───────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 230 event-sourcing-outbox — journal/replay (nền — NK uses journal)
// ✅ 277 reasoning-memoization — cache results (nền — NK = memoize agent calls)
// ✅ 73 durable-execution — durable workflow (nền)
// ✅ subagent — agent() calls (sẵn)

// ❌ THIẾU: workflow journal (per-call: id, prompt, args, result, tokens, cost)
// ❌ THIẾU: script diffing (old vs new → changed/new/removed call nodes)
// ❌ THIẾU: replay-from-journal (unchanged calls = 0 token)
// ❌ THIẾU: downstream cascade (changed call → dependents re-run)
// ❌ THIẾU: resumeFromRunId API
```

## Implementation

```typescript
// packages/workflows/src/differential-resume.ts (NEW)
interface JournalEntry {
  callId: string;       // stable hash of (prompt + args signature)
  prompt: string;
  args: unknown;
  result: unknown;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  status: 'done' | 'failed';
}

interface CallNode {
  callId: string;
  prompt: string;
  args: unknown;
  dependencies: string[]; // callIds this node depends on (data flow)
}

class DifferentialWorkflowResume {
  constructor(private journal: Map<string, JournalEntry[]>) {} // runId → entries

  // Resume: diff old vs new script → replay unchanged, re-run changed
  async resume(runId: string, newScript: CallNode[]): Promise<unknown[]> {
    const oldEntries = this.journal.get(runId) ?? [];
    const oldById = new Map(oldEntries.map((e) => [e.callId, e]));

    const results: unknown[] = [];
    for (const node of newScript) {
      const cached = oldById.get(node.callId);

      if (cached && cached.status === 'done' && !this.hasUpstreamChange(node, results, oldById)) {
        // UNCHANGED + no upstream change → replay from journal (0 token)
        results.push(cached.result);
      } else {
        // CHANGED or NEW or UPSTREAM CHANGED → re-run fresh
        const result = await this.runAgentCall(node);
        results.push(result);
      }
    }
    return results;
  }

  // Check if any dependency (upstream) was re-run (changed)
  private hasUpstreamChange(node: CallNode, results: unknown[], oldById: Map<string, JournalEntry>): boolean {
    // If a dependency was re-run (not replayed), this node must also re-run
    return node.dependencies.some((depId) => {
      const dep = oldById.get(depId);
      // Simplified: if dep result differs, upstream changed
      return dep?.status !== 'done';
    });
  }

  // Stable callId: hash of prompt + args (so same prompt+args = same id = replay)
  static computeCallId(prompt: string, args: unknown): string {
    return hash(prompt + JSON.stringify(args));
  }

  private async runAgentCall(node: CallNode): Promise<unknown> {
    // fresh agent() call — costs real tokens
    return null;
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h.toString(36);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sửa prompt sai → chỉ re-run 1 call (tiết kiệm token) | ❌ Script diffing complexity (AST compare) |
| ✅ Journal replay = deterministic (cùng input → cùng output) | ❌ Upstream change cascade (re-run nhiều hơn dự kiến) |
| ✅ Resume across sessions (journal persisted) | ❌ CallId stability (refactor đổi callId → lose cache) |
| ✅ Cost visibility (fresh vs cache tokens) | ❌ Journal storage (large runs = big journal) |

## Khác các hướng gần

| | 230 Event-Sourcing | 277 Memoization | 73 Durable-Execution | NK: Differential-Resume |
|---|---|---|---|---|
| Mục | Replay events | Cache result | Survive crash | **Replay unchanged, re-run edited** |
| Diff | ❌ | Key match | Checkpoint | **Script diff (old vs new)** |
| Save | Full replay | 1 call | Restart | **Only changed calls + downstream** |

## Khi nào chọn

- Workflow dài (nhiều agent() calls) — sửa 1 prompt không muốn re-run toàn bộ
- Cần cost-efficient resume (journal replay = 0 token)
- Deterministic orchestration (script = JavaScript, editable)
- Nối 230 event-sourcing (journal) + 376 model-tier-routing (re-run dùng đúng tier) + 73 durable-execution
