# Hướng AHO: Recursive-Context-Isolation — mỗi subagent chạy như tiến trình `pi` riêng, không kế thừa context parent; toàn bộ ngữ cảnh phải nằm trong task description, worker có thể spawn scout/researcher để bảo vệ context của chính nó

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟡 — isolation model subagent | **Agent-agnostic:** ⚠️ (gắn kiến trúc process) | **Code sẵn:** ⚠️ (có separate Session + spawnSubagent; chưa có process-level isolation + scout pattern) | **Effort:** 2 tuần

## Nguồn gốc

**pi-subagents** chạy mỗi subagent như một **tiến trình `pi` riêng biệt** — không kế thừa context parent; toàn bộ ngữ cảnh phải nằm trong **task description**. Worker có thể **spawn scout/researcher** để bảo vệ context của chính nó (đọc/explore nhiều nhưng chỉ trả tóm tắt). Nguyên tắc: **context isolation cấp process** — subagent là black box, chỉ giao tiếp qua text; **context budget tự trị** — mỗi subagent có context window riêng, parent không bị rò rỉ; **recursive scoping** — worker spawn con để capsule expensive exploration (scout đọc nhiều, trả ít).

## Mô tả

Với mya, pattern = **subagent isolation cấp session + scout delegation**: (1) mya đã có subagent = **separate Session** (packages/agent) không chia transcript parent — đúng isolation; (2) AHO nhấn mạnh **task description là channel duy nhất** — parent phải đóng gói toàn bộ ngữ cảnh vào goal (không rely vào shared state); (3) **scout/researcher pattern** — worker được giao explore-heavy task tự `spawnSubagent("scout: read X, summarize")` để scout nuốt context lớn, trả tóm tắt — worker giữ context sạch; (4) mya hiện chạy subagent **in-process** (handle) — AHO mạnh hơn khi subagent là process riêng (crash isolation, memory isolation); (5) **recursive** — scout có thể spawn sub-scout. mya `spawnSubagent` đã recursive-able (separate Session).

## Kiến trúc (ASCII)

```
  PARENT SESSION (context A)
    │  spawnSubagent(goal = "toàn bộ ngữ cảnh nằm đây")
    ▼
  WORKER SESSION (context B — KHÔNG kế thừa A, process/session riêng)
    │  explore-heavy: cần đọc nhiều file
    │  ──spawnSubagent("scout: read X, Y, Z; summarize")──► SCOUT (context C)
    │                                                         │ đọc nhiều
    │                                                         ▼ trả TÓM TẮT (text ngắn)
    │  ◄──summary (context B không phình)──────────────────────┘
    ▼
  kết quả (text) ──► PARENT
  (mỗi cấp: black box, giao tiếp chỉ qua text/task description)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent — spawnSubagent(goal): subagent = separate Session, KHÔNG
//   chia transcript parent (isolation cấp session đã có)
// ✅ packages/agent — sub.wait() → text (channel duy nhất, goal = context)
// ✅ packages/agent pool.ts — AgentSessionEntry riêng (context budget tự trị)
// ✅ packages/agent — recursive: subagent có thể spawnSubagent tiếp

// ❌ THIẾU: process-level isolation (mya chạy in-process, không OS process riêng)
// ❌ THIẾU: scout/researcher role pattern (role convention trong prompt)
// ❌ THIẾU: crash isolation (subagent crash có thể ảnh hưởng parent in-process)
```

## Implementation

```typescript
// packages/agent/src/scout.ts (NEW — scout delegation convention)
import type { Agent } from "./index.js";

/** Worker spawn scout để capsule explore-heavy work — scout đọc nhiều, trả ít. */
export async function scoutAndSummarize(
  worker: Agent,
  exploreGoal: string,
  maxChars = 2000,
): Promise<string> {
  const scout = worker.spawnSubagent(
    `Bạn là SCOUT. Nhiệm vụ: ${exploreGoal}\n` +
    `Đọc/explore đầy đủ, nhưng CHỈ trả tóm tắt ≤ ${maxChars} ký tự.\n` +
    `Mục tiêu: bảo vệ context của caller — nuốt chi tiết, trả decision-ready summary.`,
  );
  const summary = await scout.wait();
  return summary; // worker nhận summary ngắn, context không phình
}
// Convention trong role prompt worker: "Khi cần explore nhiều, spawn scout thay
// vì tự đọc — giữ context sạch cho reasoning."
// Process isolation (tier 2): pool.ts spawn child_node process per subagent —
// crash subagent không crash parent (nối pool spawn pattern).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context isolation — parent không rò rỉ context | ❌ Tái truyền ngữ cảnh qua task description (overhead) |
| ✅ Scout capsule exploration — worker context sạch | ❌ In-process: subagent crash ảnh hưởng parent |
| ✅ Recursive scoping — multi-level delegation | ❌ Overhead per subagent (khởi động session) |
| ✅ mya đã có separate Session | ❌ Process isolation cần thêm tier (child process) |

## Khác các hướng gần

| | AHO Recursive-Context-Isolation | AHN Output-Head-Truncation | AIB Bounded-Context-Inheritance |
|---|---|---|---|
| Trọng tâm | Subagent KHÔNG nhận context parent | Bound output subagent | Subagent NHẬN context parent (nén) |
| Cơ chế | Separate process + scout | Head-truncate + path | Extract text + compaction |
| Quan hệ | Cực isolation | Đầu ra | Cực kế thừa (trái ngược) |

## Khi nào chọn

- Cần isolation mạnh — subagent crash/leak không ảnh hưởng parent
- Explore-heavy task — muốn scout capsule để worker giữ context sạch
- Task có thể đóng gói toàn bộ ngữ cảnh vào description (không cần shared state)
- Guard: task description self-contained, scout trả bounded summary, tier-2 process isolation khi cần crash-proof
