# Hướng TV: Subagent Turn-Budget Recovery — subagent hết max_turns bị catch riêng, status max_turns_reached + khôi phục partial result từ chunk stream cuối

> **Nguồn gốc:** deer-flow `src/subagent/lifecycle.py` (`max_turns_reached` handler, chunk stream recovery); "subagent hitting max_turns caught separately"; "status = max_turns_reached"; "recover partial result from last chunk stream"; "don't lose work when budget exhausted" | **Coupling:** 🟡 — thêm max_turns catch + partial-result recovery vào subagent lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent pool + lifecycle sẵn — chưa có max_turns catch + chunk recovery) | **Effort:** 2-3 tuần

## Nguồn gốc

**deer-flow** subagent chạy với **max_turns** (giới hạn turn — chống infinite loop). Khi subagent **hết max_turns** (không done trong budget): (1) **Catch riêng**: không throw error crash — mà **catch** như 1 status riêng (`max_turns_reached`). (2) **Partial result**: khôi phục **partial result** từ **chunk stream cuối** (subagent đã produce output trước khi hết budget — không mất). (3) **Report**: parent nhận `status: max_turns_reached` + `partialResult` (không phải crash, không phải empty). Nguyên tắc: **budget exhausted ≠ total failure** — subagent đã làm việc, partial result có giá trị, catch + recover thay vì discard.

## Mô tả

mya subagent turn-budget recovery: (1) **max_turns**: subagent có budget turn (ví dụ 10 turn). (2) **Budget check**: mỗi turn → check if turns >= max → **catch** (không crash). (3) **Chunk recovery**: thu thập **chunk stream** cuối (text/output subagent đã produce trước khi hết) → partial result. (4) **Status**: `max_turns_reached` (không phải `done`, không phải `error`). (5) **Parent receive**: parent nhận partial result + status → quyết định retry (spawn lại) hoặc accept partial. mya có subagent pool + lifecycle — TV thêm **max_turns catch** + **chunk stream recovery** + **partial-result status**.

## Kiến trúc

```
  SUBAGENT (max_turns = 10)
        │
        │  turn 1 → 2 → ... → 9 (produce chunks mỗi turn)
        ▼
  ┌─── TURN 10 (budget exhausted) ───────────────────────┐
  │  turns >= max_turns → CATCH (không crash)              │
  │  status = "max_turns_reached"                           │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── CHUNK STREAM RECOVERY (partial result) ───────────┐
  │  thu thập chunk cuối từ stream:                         │
  │    chunk 1: "Analyzing parser.ts..."                    │
  │    chunk 2: "Found 3 issues: ..."                       │
  │    chunk 3: "Fixing issue 1..."  (cut off — hết budget) │
  │  → partialResult = "Analyzing... Found 3 issues...     │
  │     Fixing issue 1..." (không mất — recover được)       │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── PARENT RECEIVE ────────────────────────────────────┐
  │  { status: "max_turns_reached",                         │
  │    partialResult: "Analyzing... Found 3 issues...",     │
  │    turnsUsed: 10 }                                      │
  │  → parent quyết định:                                   │
  │    - accept partial (đủ info) → dùng partialResult      │
  │    - retry (cần full) → spawn lại (tiếp tục)            │
  │    - fallback → tự làm                                  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent spawnSubagent — subagent lifecycle (nền — TV catch max_turns ở đây)
// ✅ packages/agent SubagentHandle — handle + status (nền — TV thêm max_turns_reached status)
// ✅ packages/core iteration-budget — iteration budget (nền — TV max_turns check)
// ✅ packages/core RuntimeEvent stream — event stream (nền — TV chunk recovery)

// ❌ THIẾU: max_turns catch (budget exhausted → catch, không crash)
// ❌ THIẾU: chunk stream recovery (thu thập partial từ stream cuối)
// ❌ THIẾU: max_turns_reached status (khác done/error)
// ❌ THIẾU: parent decision (accept partial / retry / fallback)
```

## Implementation

```typescript
// packages/agent/src/subagent-budget-recovery.ts (MỚI)
type SubagentStatus = "running" | "done" | "error" | "max_turns_reached";

interface SubagentResult {
  status: SubagentStatus;
  output: string;       // full if done, partial if max_turns
  turnsUsed: number;
}

class SubagentBudgetRecovery {
  // run subagent with max_turns — catch budget exhaustion, recover partial
  async run(
    goal: string,
    maxTurns: number,
    runTurn: (turn: number) => Promise<{ done: boolean; chunks: string[] }>,
  ): Promise<SubagentResult> {
    const allChunks: string[] = [];
    for (let turn = 1; turn <= maxTurns; turn++) {
      const { done, chunks } = await runTurn(turn);
      allChunks.push(...chunks); // accumulate chunks mỗi turn
      if (done) return { status: "done", output: allChunks.join(""), turnsUsed: turn };
    }
    // BUDGET EXHAUSTED — catch (không crash), recover partial
    return {
      status: "max_turns_reached",
      output: allChunks.join(""),  // partial result from accumulated chunks
      turnsUsed: maxTurns,
    };
  }
}

// Usage:
// const recovery = new SubagentBudgetRecovery();
// const result = await recovery.run("review code", 10, async (turn) => {
//   const chunks = await runOneSubagentTurn(turn);
//   return { done: chunks.includes("[DONE]"), chunks };
// });
// if (result.status === "max_turns_reached") {
//   // partial result available — accept or retry
//   console.log("Partial:", result.output);
// }
```

## Được

- ✅ Không mất work (partial result recover — không discard)
- ✅ No crash (budget exhausted → catch, parent decide — không throw)
- ✅ Clear status (`max_turns_reached` ≠ `error` — parent distinguish)
- ✅ Parent flexibility (accept partial / retry / fallback — parent decide)

## Mất

- ❌ Partial result quality (cut off giữa chừng — có thể không usable)
- ❌ Chunk accumulation memory (giữ tất cả chunk → memory grow)
- ❌ Retry cost (accept partial không đủ → retry = tốn thêm budget)
- ❌ Status ambiguity (parent không biết partial đủ không → phải inspect)

## Khác

Khác **error-handling** (catch error → retry/fail) — TV catch **budget exhaustion** (không phải error — subagent still running, just out of budget). Khác **TI cheap-model-delegation** (delegate task to cheaper model) — TV là **budget recovery** (recover partial when budget runs out). Khác **TO degraded-mode-shrink** (shrink work surface khi thiếu resource) — TV **recover partial** khi budget hết (không shrink, không retry — recover).

## Khi nào chọn

- Subagent task dài (nhiều turn) → risk hết budget trước khi done
- Partial result có giá trị (analysis in-progress — đủ info để dùng)
- Muốn no-crash (budget exhausted → graceful, không throw)
- Nối packages/agent spawnSubagent + SubagentHandle + packages/core iteration-budget + RuntimeEvent; guard chunk recovery completeness (thu thập hết chunk — không mất), partial-result validation (parent inspect trước accept), và retry policy (retry khi partial không đủ — không retry vô hạn); TV = subagent turn-budget recovery, kết hợp TI cheap-model-delegation (delegate) + TJ clean-handoff-ritual (budget cạn → handoff)
