# Hướng AAK: Yield Shipped-vs-Reverted — đo năng suất thực bằng session nào shipped lên main vs bị revert/abandoned

> **Nguồn gốc:** codeburn (docs/architecture.md) | **Coupling:** 🟢 — thêm metric layer đọc từ git + session log | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có audit + cost — chưa có yield tracking) | **Effort:** 1-2 tuần

## Nguồn gốc

**codeburn** lệnh **yield** theo dõi **session nào shipped lên main vs bị revert/abandoned** — đo **năng suất thực (productive spend)** thay vì chỉ đếm token tiêu. Một session đốt 100k token nhưng kết quả bị revert = 0 yield; session 10k token merge lên main = yield 100%. Nguyên tắc: **đo output thực (shipped) chứ không đo input (token)** — cost tracking cho biết tiêu bao nhiêu, yield cho biết tạo ra bao nhiêu.

## Mô tả

mya yield shipped-vs-reverted: nối session log (JSONL) với **git history**: mỗi session ghi `sessionId` + branch + thời gian; sau khi session kết thúc, **reconcile với git** — commit từ session có merge lên main không (git log --author/branch), có bị revert không (git revert), hay abandoned (branch chết không merge). Tính **yield score** = shipped tokens / total tokens. Lưu kết quả vào audit log + expose qua CLI `mya yield --session <id>`. Nền: packages/print session-meta.ts + cost-tracker.ts đã có dữ liệu session; cần git adapter (đọc main/revert log).

## Kiến trúc

```
  SESSION LOG (JSONL — sessionId, branch, tokens, cost)
        │
        ▼
  ┌─── GIT RECONCILE ─────────────────────────────────┐
  │  mỗi session: tìm commits trên branch              │
  │   ├─ merge lên main?        → SHIPPED              │
  │   ├─ bị revert (git revert) → REVERTED             │
  │   └─ branch chết (no merge) → ABANDONED            │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── YIELD METRIC ──────────────────────────────────┐
  │  yield = shippedTokens / totalTokens               │
  │  per-session + aggregate (tuần/người/role)         │
  │  → audit log + CLI mya yield                       │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print session-meta.ts — session metadata (branch, id)
// ✅ packages/print runtimes/cost-tracker.ts — tokens/cost per session
// ✅ packages/audit — audit log (nơi lưu yield result)
// ✅ packages/core canonical-json.ts — ổn định cho yield snapshot
// ✅ packages/print cli.ts — command surface (nơi thêm `mya yield`)

// ❌ THIẾU: git reconcile adapter (main merge/revert detect)
// ❌ THIẾU: yield score + aggregate
```

## Implementation

```typescript
// packages/print/src/yield.ts (NEW)
import { execFileSync } from "node:child_process";

export type SessionOutcome = "shipped" | "reverted" | "abandoned" | "pending";

export interface YieldResult {
  sessionId: string;
  tokens: number;
  outcome: SessionOutcome;
  yieldScore: number; // 0..1 — shipped ? 1 : 0
}

/** Git reconcile: xác định session's commits có lên main / bị revert. */
export function reconcileWithGit(branch: string, sinceMs: number): SessionOutcome {
  const mainLog = execFileSync("git", ["log", "--oneline", "--all", "--since", new Date(sinceMs).toISOString()], { encoding: "utf8" });
  const revertHits = mainLog.match(/Revert "[^"]*"/g) ?? [];
  const branchMerged = mainLog.includes(branch) || mainLog.includes(`Merge branch '${branch}'`);
  const reverted = revertHits.some((r) => r.includes(branch));
  if (reverted) return "reverted";
  if (branchMerged) return "shipped";
  return "abandoned"; // chưa thấy merge — branch chết hoặc pending
}

/** Yield per session: shipped → 1.0, còn lại → 0 (revert = âm giá trị). */
export function computeYield(session: { sessionId: string; tokens: number; branch: string; startedAt: number }): YieldResult {
  const outcome = reconcileWithGit(session.branch, session.startedAt);
  return { sessionId: session.sessionId, tokens: session.tokens, outcome, yieldScore: outcome === "shipped" ? 1 : 0 };
}

/** Aggregate: productive spend = tổng token của session shipped. */
export function aggregateYield(results: YieldResult[]): { productive: number; wasted: number; ratio: number } {
  const productive = results.filter((r) => r.outcome === "shipped").reduce((s, r) => s + r.tokens, 0);
  const total = results.reduce((s, r) => s + r.tokens, 0);
  return { productive, wasted: total - productive, ratio: total ? productive / total : 0 };
}
// Usage: mya yield --week → đọc session log → reconcile git → ratio
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo năng suất thực (shipped) — không tự lừa bằng token | ❌ Git reconcile heuristic (branch name match) — sai khi rename |
| ✅ Phát hiện session revert/abandoned — học từ lãng phí | ❌ Pending session bị đếm abandoned nhầm |
| ✅ Aggregate theo tuần/role — nhìn xu hướng | ❌ Phụ thuộc git history đầy đủ (force-push mất dấu) |
| ✅ Nối cost — yield per dollar | ❌ Chạy git command tốn thời gian trên repo lớn |

## Khác các hướng gần

| | Cost tracker | AAK: Yield |
|---|---|---|
| Đo gì | Token/cost tiêu | **Giá trị shipped** |
| Câu hỏi | "Tốn bao nhiêu?" | **"Tạo ra bao nhiêu?"** |
| Nguồn | Runtime events | **Git history reconcile** |
| Mối quan hệ | Nền dữ liệu | **Lớp ý nghĩa trên cost** |

## Khi nào chọn

- Muốn biết token tiêu có tạo giá trị hay không (không chỉ đếm)
- Đã có session log + cost tracker — thêm git reconcile adapter
- Guard: outcome detect bằng commit/merge log (không chỉ branch name), pending window (session gần đây chưa kết luận), test với repo fixture
