# Hướng ABC: Team Assembly Consensus Matrix — spawn reviewer agents song song theo loại thay đổi, verdict tổng hợp theo luật consensus

> **Nguồn gốc:** fallow (.claude/rules/team-assembly.md) | **Coupling:** 🟡 — thêm team-assembler vào flow review/PR | **Agent-agnostic:** ⚠️ (phụ thuộc spawn multi-agent + vote) | **Code sẵn:** ⚠️ (có council vote + subagent pool — chưa có team matrix) | **Effort:** 2 tuần

## Nguồn gốc

**fallow** dùng **ma trận team-assembly**: mỗi **loại thay đổi** (change type) map tới một tập reviewer agent được spawn **song song** — ví dụ change về security → spawn security reviewer + test reviewer; change về performance → spawn perf reviewer + correctness reviewer. Mỗi reviewer đưa ra **verdict** riêng (APPROVE / BLOCK / CONCERN), sau đó một **luật consensus** tổng hợp: **Ship** = zero BLOCK + đa số APPROVE; **Fix first** = có ít nhất một BLOCK; **Ship with notes** = chỉ có CONCERN (không BLOCK). Verdict tổng hợp có **cấu trúc** (không phải chữ ký cảm tính). Nguyên tắc: **assembly theo change-type, consensus theo luật cứng, verdict có structure**.

## Mô tả

mya team assembly consensus matrix: khi có một thay đổi (PR / branch / patch), xác định **change type** (security / perf / correctness / docs / tests...) → tra **ma trận** lấy danh sách reviewer agents cần spawn → spawn **song song** (mỗi reviewer trong session riêng, context riêng) → thu verdict (APPROVE/BLOCK/CONCERN) → áp **luật consensus** → ra verdict cuối: Ship / Fix first / Ship with notes. mya có packages/council (council.ts fan-out + vote) + packages/agent subagent pool + packages/print role-subagent-spawn — ABC thêm **team matrix** (change-type → reviewer set) + **consensus rule** (luật tổng hợp verdict).

## Kiến trúc

```
  CHANGE (PR / branch / patch)
       │  classify change type (diff heuristic / agent classify)
       ▼
  TEAM MATRIX  { "security": [sec-reviewer, test-reviewer],
                 "perf":     [perf-reviewer, correctness-reviewer],
                 "docs":     [docs-reviewer],
                 ... }
       │  spawn SONG SONG (session riêng, context riêng)
       ▼
  REVIEWER 1 ──► verdict: APPROVE | BLOCK | CONCERN
  REVIEWER 2 ──► verdict: BLOCK
  REVIEWER 3 ──► verdict: APPROVE
       │  gather
       ▼
  CONSENSUS RULE
    zero BLOCK + majority APPROVE  ──► SHIP
    có ≥1 BLOCK                    ──► FIX FIRST
    chỉ CONCERN (no BLOCK)         ──► SHIP WITH NOTES
       ▼
  VERDICT (structured: { verdict, votes, notes })
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council council.ts — CouncilProvider fan-out + majority/judge (nền — ABC vote)
// ✅ packages/council adversarial.ts — adversarial review (nền — ABC reviewer type)
// ✅ packages/agent — spawnSubagent (nền — ABC spawn reviewer song song)
// ✅ packages/print role-subagent-spawn.ts — spawn role-subagent (nền — ABC spawn thật)
// ✅ packages/collab relay.ts — multi-user relay (liên quan — ABC chỉ đọc, không cần relay)

// ❌ THIẾU: team matrix (change-type → reviewer set)
// ❌ THIẾU: consensus rule (BLOCK/APPROVE/CONCERN → Ship/Fix-first/Ship-with-notes)
// ❌ THIẾU: verdict structure (tổng hợp votes + notes có cấu trúc)
```

## Implementation

```typescript
// packages/council/src/team-assembly.ts (MỚI)
type Verdict = "APPROVE" | "BLOCK" | "CONCERN";
type ChangeType = "security" | "perf" | "correctness" | "docs" | "tests" | "other";

interface ReviewVote { reviewer: string; verdict: Verdict; notes: string }
interface TeamVerdict { verdict: "SHIP" | "FIX_FIRST" | "SHIP_WITH_NOTES"; votes: ReviewVote[] }

/** Ma trận: change-type → danh sách reviewer (spawn song song). */
const TEAM_MATRIX: Record<ChangeType, string[]> = {
  security: ["security-reviewer", "test-reviewer"],
  perf: ["perf-reviewer", "correctness-reviewer"],
  correctness: ["correctness-reviewer", "test-reviewer"],
  docs: ["docs-reviewer"],
  tests: ["test-reviewer"],
  other: ["correctness-reviewer"],
};

function classifyChange(diff: string): ChangeType {
  if (/password|token|auth|secret|inject/i.test(diff)) return "security";
  if (/loop|await|fetch|query|index|O\(n\)/i.test(diff)) return "perf";
  return "other";
}

/** Consensus rule: zero BLOCK + majority APPROVE → SHIP; có BLOCK → FIX_FIRST; chỉ CONCERN → SHIP_WITH_NOTES. */
export function consensus(votes: ReviewVote[]): TeamVerdict {
  const blocks = votes.filter(v => v.verdict === "BLOCK");
  const approves = votes.filter(v => v.verdict === "APPROVE");
  const concerns = votes.filter(v => v.verdict === "CONCERN");
  if (blocks.length > 0) return { verdict: "FIX_FIRST", votes };
  if (concerns.length > 0 && approves.length === 0) return { verdict: "SHIP_WITH_NOTES", votes };
  if (approves.length >= votes.length / 2) return { verdict: "SHIP", votes };
  return { verdict: "SHIP_WITH_NOTES", votes };
}

// Usage:
// const type = classifyChange(diffText);
// const votes = await Promise.all(TEAM_MATRIX[type].map(r => spawnReviewer(r, diffText)));
// const { verdict } = consensus(votes); // "SHIP" | "FIX_FIRST" | "SHIP_WITH_NOTES"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phủ đúng loại thay đổi (reviewer phù hợp change type) | ❌ Spawn cost (nhiều reviewer = nhiều token/latency) |
| ✅ Consensus cứng (luật rõ: BLOCK → Fix first) | ❌ Verdict noise (reviewer BLOCK vì hiểu lầm task) |
| ✅ Song song (reviewers chạy đồng thời, nhanh) | ❌ Matrix maintenance (change-type mới → thêm dòng) |
| ✅ Verdict có cấu trúc (votes + notes, không cảm tính) | ❌ Consensus quá đơn giản (không xét severity BLOCK) |

## Khác các hướng gần

| | Single reviewer | Council majority (mọi member) | ABC: Team Matrix |
|---|---|---|---|
| Chọn reviewer | cố định | toàn bộ member | **theo change-type** |
| Spawn | 1 | N song song | **N song song theo ma trận** |
| Verdict | 1 opinion | vote majority | **consensus rule (BLOCK/APPROVE/CONCERN)** |

## Khi nào chọn

- Thay đổi có loại rõ (security / perf / correctness) → cần reviewer chuyên biệt
- Muốn verdict có luật cứng (BLOCK → fix trước, không bàn cãi)
- Đã có subagent spawn song song (packages/agent + print role-subagent-spawn)
- Nối packages/council council.ts + adversarial.ts + packages/agent + packages/print role-subagent-spawn; guard matrix-completeness (mọi change type có reviewer), consensus-threshold (majority rõ ràng, tie-break), và reviewer-context (mỗi reviewer nhận context đủ, không thiếu diff); ABC = team assembly consensus matrix, kết hợp 633 consciousness-council (multi-perspective vote) + 637 XM security-scan-gate (change security → gate)
