# Contrabass → mya: Phân tích & So sánh

> Nguồn: https://github.com/junhoyeo/contrabass
> Phân tích: Aug 2026
> Kích thước: 330 files, ~26k LOC Go + React dashboard
> Định nghĩa: "A project-level orchestrator for AI coding agents"

---

## TL;DR

Contrabass là **batch orchestrator cho AI agents** — Go reimplementation của OpenAI's Symphony. Nó poll issue tracker (Linear/GitHub) → tạo git worktree per issue → launch agent CLI subprocess → monitor → verify → retry. Pattern: **CI/CD pipeline cho code agents**.

mya là **personal interactive assistant** — TS + Rust in-process runtime. Pattern: **conversation với AI agent**.

Hai pattern khác nhau, nhưng overlap nhiều hơn SSSF ở infrastructure layer (dashboard, monitoring, session management). **1 pattern đáng học hỏi nhất: agent stage classification.** Phần còn lại: mya đã có tương đương hoặc không áp dụng được.

---

## Contrabass là gì?

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTRABASS ARCHITECTURE                    │
│                                                               │
│  Issue Tracker (Linear/GitHub/Board)                          │
│       │                                                       │
│       ▼  poll every 2s                                        │
│  ┌──────────────────────────────────────────┐                 │
│  │ ORCHESTRATOR                              │                 │
│  │  • BlockedBy gating (DAG cycle detect)    │                 │
│  │  • Claim issue → create git worktree      │                 │
│  │  • Launch agent CLI subprocess            │                 │
│  │  • Monitor: stage classify + ETA          │                 │
│  │  • Verify: branch advance check           │                 │
│  │  • Retry: deterministic FNV-hash backoff  │                 │
│  │  • Recover: orphan claim on restart       │                 │
│  └──────────────────────────────────────────┘                 │
│       │               │               │                        │
│       ▼               ▼               ▼                        │
│   TUI (Charm)    Web Dashboard    JSON/SSE API                │
│                   (React/Ziikoo)                               │
└─────────────────────────────────────────────────────────────┘
```

### Core modules (Go LOC, non-test)

| Module | LOC | Chức năng |
|---|---|---|
| `internal/agent/` | 5,154 | Agent runner: codex, opencode, omx, omc (subprocess + JSONL/JSON-RPC) |
| `internal/team/` | 4,149 | Multi-agent team: phase machine, dispatch queue, heartbeat, governance |
| `internal/orchestrator/` | 2,895 | Poll → dispatch → monitor → verify → retry → recover |
| `internal/tracker/` | 2,798 | Linear (GraphQL), GitHub (REST), Internal Board (filesystem) |
| `internal/tui/` | 2,769 | Charm v2 TUI (Bubble Tea + Lip Gloss) |
| `internal/config/` | 2,166 | WORKFLOW.md parser: YAML front matter + Liquid templates |
| `internal/web/` | 1,796 | HTTP API + SSE + Streamable HTTP JSON-RPC |
| `internal/timeline/` | 869 | Workflow timeline store + Linear comment sync |
| `internal/tmux/` | 719 | tmux-based multi-process worker mode |
| `internal/workspace/` | 547 | Git worktree manager: create/cleanup/prune/recover |
| `internal/types/` | 306 | Shared types (Issue, RunAttempt, TeamPhase, etc.) |

---

## So sánh Feature-by-Feature

### 1. Agent Stage Classification ★★★ (đáng học hỏi nhất)

**Contrabass**: Phân loại agent activity thành 5 stage monotonic:

```
Exploration → Editing → Testing → Reviewing → Wrapping
   step 1      step 2     step 3     step 4      step 5

Cách tính:
- diffAdded/diffRemoved thay đổi?     → Editing
- diff plateaued + thời gian trôi?    → Testing (>testingAfter)
- diff plateaued + tok/min thấp?      → Reviewing (>reviewingAfter, <maxTokPerMin)
- turn/completed/failed/cancelled?    → Wrapping
- default?                            → Exploration
- Monotonic clamp: step không bao giờ giảm
```

Nguồn dữ liệu: `git diff --shortstat HEAD` chạy periodic trong workspace.

```go
// snapshot.go — classifyAgentStageWithPolicy()
switch {
case diffPlateaued && elapsed > reviewingAfter && tokensPerMin < reviewingMaxTokensPerMinute:
    stage, step = "Reviewing", 4
case diffPlateaued && elapsed > testingAfter:
    stage, step = "Testing", 3
case diffChanged:
    stage, step = "Editing", 2
default:
    stage, step = "Exploration", 1
}
```

**mya hiện tại**: Không có. Dashboard hiển thị `contextPct` (0-100%) và streaming status. Không phân biệt "agent đang đọc code" vs "agent đang viết code" vs "agent đang test".

**Đánh giá**:
- **UX value**: Cao cho dashboard monitoring background/cron sessions
- **Interactive value**: Thấp — TUI đã show real-time activity, user thấy trực tiếp
- **Effort**: Medium — cần periodic `git diff --shortstat` + tracking state qua ticks
- **Verdict**: 🟡 **Nice-to-have cho web dashboard**, không phải capability gap

---

### 2. Branch Advance Verification ★★

**Contrabass**: Trước khi mark "succeeded", verify workspace HEAD SHA khác claim-time SHA:

```go
// orchestrator_runtime.go — completeRun()
advanced, reason, err := verifyBranchAdvancedWithTimeout(ctx, workspace, branch, claimHead, ...)
switch {
case !advanced && reason == "branch_unchanged":
    // Agent claims success but made NO commits → pause for manual review
    o.pauseUnverifiedSuccess(ctx, entry, finalAttempt, "success_unverified_branch_unchanged", nil)
case advanced && reason == "git_error":
    // Persistent git failure → fail close (don't rubber-stamp)
    o.pauseUnverifiedSuccess(ctx, entry, finalAttempt, "success_unverified_workspace_invalid", err)
}
```

**mya hiện tại**: Không có. Cron job chạy prompt → record response. Không verify "agent có thực sự thay đổi gì không?"

**Đánh giá**:
- **Value**: Thấp-trung bình — hữu ích cho cron jobs có intent sửa code
- **Problem**: Không phải cron job nào cũng sửa code (phần lớn là "check & report")
- **Effort**: Thấp — snapshot `git rev-parse HEAD` trước/sau, compare
- **Verdict**: 🟡 **Hữu ích nhưng hẹp** — chỉ apply cho cron jobs loại "modify code"

---

### 3. Deterministic Backoff (FNV-hash Jitter) ★

**Contrabass**: Retry backoff dùng FNV-1a hash của (issueID, attempt, maxMs) để generate jitter. Kết quả: **reproducible across restarts** — cùng issue + attempt → cùng delay.

```go
// state.go — deterministicBackoffSeed()
func deterministicBackoffSeed(issueID string, attempt, maxMs int) uint64 {
    const (
        offsetBasis = uint64(14695981039346656037)  // FNV-1a offset basis
        prime       = uint64(1099511628211)          // FNV-1a prime
    )
    seed := offsetBasis
    for i := 0; i < len(issueID); i++ {
        seed ^= uint64(issueID[i])
        seed *= prime
    }
    seed ^= uint64(attempt)
    seed *= prime
    seed ^= uint64(maxMs)
    seed *= prime
    return seed
}
```

**mya hiện tại**: Cron system dùng grace windows + catch-up logic. Không retry failed sessions (cron job fails → chờ schedule tiếp theo).

**Đánh giá**:
- **Value**: Thấp cho mya — single-process, không cần reproducible retry
- **Concept**: Đẹp cho distributed systems, overkill cho personal assistant
- **Verdict**: ⚪ **Không áp dụng** — mya single-process, không cần deterministic jitter

---

### 4. Team Phase Machine (Plan → PRD → Exec → Verify → Fix) ★

**Contrabass**: Formal state machine cho multi-agent team coordination:

```
PhasePlan → PhasePRD → PhaseExec → PhaseVerify → PhaseComplete
                ↑                    │
                └─── PhaseFix ←──────┘
                          │
                     (max fix loops)
                          │
                    PhaseFailed
```

Valid transitions enforced, fix-loop bounded (`max_fix_loops: 3`). Exceed → `PhaseFailed`.

**mya hiện tại**: Workflow system có `pipeline()`, `phase()`, `parallel()` primitives. Nhưng **gần như không dùng** (0 cron workflows, stub tools executor). Agent loop tự drive pipeline qua conversation.

**Đánh giá**:
- **Value**: Thấp — mya agent-driven, không cần explicit phase machine
- **Concept hay**: Fix-loop bounding → mya ĐÃ CÓ `IterationBudget` (Tier 1+2 ported)
- **Verdict**: ⚪ **Đã có tương đương** (IterationBudget). Formal state machine không fit agent-driven model.

---

### 5. Git Worktree per Issue ★

**Contrabass**: Mỗi issue → `workspaces/<issue-id>` git worktree. Isolation per agent run:

```go
// workspace/manager.go — Create()
// 1. Try git worktree add -b <branch> <path>
// 2. Fall back: worktree add <path> <existing-branch> (resume)
// 3. NEVER worktree add -B (silently discards commits)
// 4. Non-git fallback: mkdir (plain directory)
// 5. Verify registration with git worktree list --porcelain
// 6. Prune stale registrations before retry
```

Edge cases xử lý cẩn thận:
- Stale worktree registration (deleted dir, not pruned) → prune + retry
- macOS `/tmp` → `/private/tmp` symlink → resolveAbs trước compare
- Crash recovery: bare dir vs registered worktree distinction
- Per-issue locking (refs-counted mutex map)

**mya hiện tại**: Tất cả sessions chạy trong cùng working directory. Không worktree isolation.

**Đánh giá**:
- **Value**: Không áp dụng hiện tại — mya 1 agent/dir, sessions sequential
- **Future**: Nếu mya chạy parallel agents trên cùng repo → worktree đúng tool
- **Verdict**: ⚪ **Không cần hiện tại**. mya single-agent-per-directory đúng cho use case.

---

### 6. BlockedBy DAG Gating + Cycle Detection

**Contrabass**: Issue dependencies (BlockedBy) resolved trước dispatch. Cycle detection via DFS back-edge:

```go
// orchestrator.go — detectBlockedByCycles()
// DFS over BlockedBy graph
// Back-edge = cycle
// Cycle members: warned once, NEVER force-dispatched (unsafe order)
```

**mya**: Không có concept "issues" hay "dependencies". Cron jobs độc lập.

**Verdict**: ⚪ **Không áp dụng** — khác abstraction level.

---

### 7. Orphan Claim Recovery

**Contrabass**: Restart → scan claimed-but-not-running issues → reset to Unclaimed:

```go
// recoverOrphanedClaims(): issue.State == Claimed && not in running map
// → issues[i].State = Unclaimed
// → recoveredAttempts[issue.ID] = 2  (not 1 — proves prior run existed)
// → log once per issue per orchestrator lifetime (recoveredSet)
```

**mya**: Cron system có lease-based recovery — lease expire → job re-queued. Session pool ephemeral (no cross-restart claims).

**Verdict**: ⚪ **Đã có tương đương** (cron lease recovery, khác cơ chế).

---

### 8. Heartbeat Monitoring

**Contrabass**: File-based heartbeat per worker. Stale detection beyond threshold:

```go
// heartbeatLoop(): write heartbeat every (leaseSeconds/3)
// IsStale(): now - lastHeartbeat > staleThreshold
```

**mya**: WS event stream = live heartbeat. Events stop → client biết stalled. Cron tracks completion.

**Verdict**: ⚪ **Đã có tương đương** (WS event stream thay heartbeat).

---

### 9. ETA Estimation

**Contrabass**: Confidence-banded completion estimate:

```
ETA = startedAt + (elapsed + linearRemainingMin × uncertaintyMultiplier)

linearRemainingMin = (estimatedTotalFiles - currentFiles) / filesPerMin

Confidence bands:
- low:    elapsed < minElapsed OR velocity too low
- medium: elapsed > mediumConfidenceAfter (3min default)
- high:   elapsed > highConfidenceAfter AND stageStep >= 3

Parameters:
- estimatedFilesMultiplier: 1.5 (estimate total = current × 1.5)
- minEstimatedFiles: 5
- fallbackRemainingMinutes: 5
- uncertaintyMultiplier: 1.5
```

**mya**: `contextPct` (0-100%) hiển thị context window usage. Ít precise hơn nhưng functional.

**Verdict**: ⚪ **mya có contextPct** — đủ cho interactive use. ETA precision chỉ cần cho long batch runs.

---

### 10. Subprocess Agent Runners

**Contrabass**: Launches agent CLI processes (codex, opencode, omx, omc), speaks JSONL/JSON-RPC:

```
codex app-server:
  initialize → initialized → thread/start → turn/start
  → stream notifications + tokenUsage
  → turn/completed | turn/failed | turn/cancelled
  → close stdin on terminal event

Error handling:
  -32001 (server overload) → exponential backoff retry (max 5)
  Stream stall → configurable read timeout
```

**mya**: **In-process runtime** (PiInProcessRuntime). Agent loop chạy trong cùng process Node.js. Không subprocess overhead.

**Verdict**: ✅ **mya TỐT HƠN** — in-process = faster, no IPC, WS push real-time.

---

## Tổng hợp: Contrabass vs mya

```
┌────────────────────────────┬──────────────────┬──────────────────┬───────────┐
│ Capability                 │ Contrabass       │ mya              │ Ai học?   │
├────────────────────────────┼──────────────────┼──────────────────┼───────────┤
│ Agent runtime              │ subprocess CLI   │ in-process ✅    │ mya tốt   │
│ Multi-agent coordination   │ team + worktree  │ delegate/subagent│ tie       │
│ Issue/task tracking        │ Linear/GitHub ✅  │ không có         │ không cần │
│ Stage classification       │ 5-stage ✅       │ không có         │ 🟡 maybe  │
│ ETA estimation             │ confidence-banded│ contextPct       │ tie       │
│ Branch advance verify      │ ✅               │ không có         │ 🟡 maybe  │
│ Fix-loop bounding          │ phase machine    │ IterationBudget ✅│ đã có    │
│ Backoff/retry              │ FNV-hash ✅      │ cron grace       │ không cần │
│ Workspace isolation        │ git worktree ✅  │ working dir      │ không cần │
│ Orphan recovery            │ claim scan ✅    │ cron lease ✅    │ đã có     │
│ Heartbeat                  │ file-based       │ WS events ✅     │ đã có     │
│ Memory system              │ KHÔNG CÓ         │ Brain+Dream ✅   │ mya tốt   │
│ Cron/scheduling            │ KHÔNG CÓ         │ full system ✅   │ mya tốt   │
│ Provider routing           │ hardcoded config │ SmartRouter ✅   │ mya tốt   │
│ Prompt enrichment          │ Liquid template  │ MemoryEnricher ✅│ mya tốt   │
│ Web dashboard              │ React/SSE ✅     │ React/WS ✅      │ tie       │
│ Config hot-reload          │ fsnotify ✅      │ restart needed   │ 🟡 maybe  │
│ MCP endpoint               │ Streamable HTTP  │ không có         │ 🟡 maybe  │
│ tmux worker mode           │ ✅               │ không có         │ không cần │
└────────────────────────────┴──────────────────┴──────────────────┴───────────┘
```

---

## Bài học rút ra

### 1. Hai pattern, hai product

```
Contrabass:  Poll → Dispatch → Monitor → Verify → Retry → Recover
             ─────────────────────────────────────────────────
             Pattern: CI/CD pipeline cho agent runs
             Use case: "Quản lý 100 issues tự động bằng AI agents"

mya:         User → Prompt → Agent Loop → Events → User
             ──────────────────────────────────────────
             Pattern: Interactive conversation với AI
             Use case: "AI assistant cá nhân thông minh"

→ Cùng infrastructure concerns (dashboard, monitoring, sessions)
→ Khác core abstraction (issues+worktrees vs conversations+memory)
```

### 2. Contrabass shine ở đâu

Contrabass **xuất sắc** ở batch orchestration engineering:
- BlockedBy DAG + cycle detection — giải dependency graph đúng cách
- Branch advance verification — fail-close khi agent "fake success"
- Deterministic backoff — reproducible retry timing
- Worktree lifecycle — handle mọi edge case (stale, crash, symlink, prune)
- Team phase machine — formal state transitions với fix-loop bounding

Đây là **production-grade orchestration code**. mya không cần những thứ này vì không phải batch orchestrator. Nhưng **đáng học hỏi về engineering rigor**.

### 3. mya shine ở đâu

mya **tốt hơn** ở interactive + personal assistant layer:
- **In-process runtime** — no subprocess overhead, faster startup, WS push
- **Memory system** — Brain + DreamCycle, Contrabass không có memory
- **Cron scheduling** — full system, Contrabass không có scheduling
- **SmartRouter** — multi-provider routing, Contrabass hardcode model
- **Prompt enrichment** — memory injection vào system prompt

---

## Nếu muốn adopt gì từ Contrabass

### Tier 1: Đáng xem xét (nice-to-have, không phải gap)

| Pattern | Effort | Value | Ghi chú |
|---|---|---|---|
| **Stage classification** | Medium | UX | Dashboard hiển thị "Editing" thay vì chỉ "streaming". Cần periodic `git diff --shortstat`. |
| **Branch advance verify** | Low | Cron | Verify cron jobs có intent sửa code thực sự thay đổi. Snapshot HEAD trước/sau. |
| **Config hot-reload** | Medium | Ops | Contrabass dùng fsnotify. mya cần restart gateway khi đổi config. |

### Tier 2: Đã có tương đương (không cần)

| Pattern | mya equivalent |
|---|---|
| Fix-loop bounding | `IterationBudget` |
| Orphan recovery | Cron lease recovery |
| Heartbeat monitoring | WS event stream |
| ETA estimation | `contextPct` |
| Session pool | `RuntimePool` + MAX_SESSIONS |

### Tier 3: Không áp dụng

| Pattern | Lý do |
|---|---|
| Git worktree per issue | mya single-agent-per-directory |
| BlockedBy DAG | mya không có issues/tasks |
| Subprocess runners | mya in-process runtime |
| tmux worker mode | mya không multi-process |
| Team phase machine | mya agent-driven, không pipeline-driven |
| Linear/GitHub tracker | mya không issue tracker |

---

## So sánh với SSSF

| | SSSF | Contrabass |
|---|---|---|
| Loại | CI pipeline (Python scripts) | Batch orchestrator (Go) |
| Agent interaction | Subprocess (pi) | Subprocess (codex/opencode CLI) |
| Pipeline owner | Code (deterministic) | Code (orchestrator loop) |
| Memory | Không có | Không có |
| Scheduling | Không có | Không có (poll-based) |
| Overlap với mya | Thấp | **Trung bình** (dashboard, monitoring, sessions) |
| Giá trị học hỏi | Comparative validation | Stage classification concept |

Contrabass **gần mya hơn** SSSF — cùng loại product (agent orchestration platform) nhưng khác use case (batch vs interactive). Overlap ở infrastructure layer nhiều hơn, nhưng core abstractions vẫn khác.

---

## Tóm tắt 1 câu

**Contrabass là batch orchestrator xuất sắc cho AI coding agents — engineering grade cao, xử lý edge cases kỹ lưỡng. mya là interactive assistant với in-process runtime + memory system. Pattern đáng học hỏi nhất là agent stage classification (UX improvement cho dashboard), nhưng phần còn lại mya đã có tương đương hoặc không áp dụng được.**
