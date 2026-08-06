# Hướng TW: Durable Context Projection — bắt delegation/skill-refs trước compaction, tái chiếu thành hidden HumanMessage cho mỗi request

> **Nguồn gốc:** deer-flow `src/middleware/durable_context.py` (`DurableContextMiddleware`); "capture delegation/skill-refs before compaction"; "re-project as hidden HumanMessage for each request"; "durable context survives compaction — re-injected every turn" | **Coupling:** 🟡 — thêm middleware layer: pre-compaction capture + per-request re-inject | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có pre-compaction capture + hidden HumanMessage re-projection) | **Effort:** 3-4 tuần

## Nguồn gốc

**deer-flow** khi session **compact** (summarize history để tiết kiệm context), có nguy cơ **mất** critical context: (1) **Delegation** (parent đã spawn subagent cho task X — nếu compact mất → parent quên đã delegate). (2) **Skill refs** (skill X đang active — nếu compact mất → agent quên skill context). **DurableContextMiddleware** giải: (1) **Pre-compaction capture**: trước khi compact → **bắt** delegation + skill-refs (context quan trọng không được mất). (2) **Re-project**: capture → tái chiếu thành **hidden HumanMessage** (message không hiển thị user nhưng model thấy) cho **mỗi request** (sau compact, mỗi turn inject lại durable context). Nguyên tắc: **durable context survives compaction** — critical refs re-injected every turn, không bao giờ mất dù compact bao nhiêu lần.

## Mô tả

mya durable context projection: (1) **Pre-compaction capture**: trước khi session compact → scan history → extract **durable items** (active delegations, active skill refs, acceptance criteria, original question). (2) **Store durable**: durable items → store riêng (không trong history — history compact được, durable không compact). (3) **Per-request re-project**: mỗi request (turn) → inject durable items thành **hidden HumanMessage** (system-level, model thấy, user không thấy). (4) **Survive compaction**: history compact → durable items vẫn re-project → critical context không mất. mya có session + history + spill — TW thêm **pre-compaction capture** + **durable store** + **per-request hidden-message inject**.

## Kiến trúc

```
  SESSION HISTORY (sắp compact — context cạn)
  ┌─── HISTORY ───────────────────────────────────────────┐
  │  turn 1: user "refactor parser"                         │
  │  turn 2: agent spawned subagent for analysis ← DELEGATION│
  │  turn 3: skill "refactor-skill" activated ← SKILL REF   │
  │  turn 4-15: [work...]                                    │
  │  → context cạn → COMPACT pending                         │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── PRE-COMPACTION CAPTURE ────────────────────────────┐
  │  scan history → extract durable items:                  │
  │  - delegation: "subagent analyzing parser.ts"           │
  │  - skill-ref: "refactor-skill active"                   │
  │  - originalQuestion: "refactor parser"                  │
  │  - acceptanceCriteria: "tests pass, no regressions"     │
  │  → store durable (KHÔNG trong history — không compact)  │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── COMPACT (history summarize) ───────────────────────┐
  │  history → summarized (compact)                         │
  │  durable items → KHÔNG compact (store riêng)            │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── PER-REQUEST RE-PROJECT (hidden HumanMessage) ──────┐
  │  mỗi request (turn mới):                                │
  │  inject hidden HumanMessage:                             │
  │    "[DURABLE] delegation: subagent analyzing parser.ts" │
  │    "[DURABLE] skill: refactor-skill active"             │
  │    "[DURABLE] original: refactor parser"                │
  │    "[DURABLE] acceptance: tests pass, no regressions"   │
  │  → model THẤY durable context mỗi turn (không mất)      │
  │  → user KHÔNG thấy (hidden — system-level)              │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session/history — session history (nền — TW compact history)
// ✅ packages/core spill — large-value spill (nền — TW durable store có thể spill)
// ✅ packages/agent spawnSubagent — delegation (nền — TW capture delegation)
// ✅ packages/skills SkillStore — skill refs (nền — TW capture skill-refs)

// ❌ THIẾU: pre-compaction capture (scan history → extract durable items)
// ❌ THIẾU: durable store (store riêng, không compact)
// ❌ THIẾU: hidden HumanMessage re-projection (inject mỗi request)
// ❌ THIẾU: compaction hook (capture BEFORE compact trigger)
```

## Implementation

```typescript
// packages/agent/src/durable-context.ts (MỚI)
interface DurableItem { type: "delegation" | "skill-ref" | "question" | "criteria"; content: string }

class DurableContextMiddleware {
  private durable: DurableItem[] = [];

  // PRE-COMPACTION: scan history → capture durable items (before compact)
  captureBeforeCompaction(history: unknown[]): DurableItem[] {
    const items: DurableItem[] = [];
    for (const entry of history) {
      const str = JSON.stringify(entry);
      // capture delegation refs
      if (str.includes("subagent") || str.includes("delegate"))
        items.push({ type: "delegation", content: str.slice(0, 200) });
      // capture skill refs
      if (str.includes("skill"))
        items.push({ type: "skill-ref", content: str.slice(0, 200) });
    }
    this.durable = items; // store durable (không compact)
    return items;
  }

  // PER-REQUEST: re-project durable as hidden HumanMessage
  projectHiddenMessage(): string | null {
    if (this.durable.length === 0) return null;
    const lines = this.durable.map(d => `[DURABLE/${d.type}] ${d.content}`);
    return lines.join("\n"); // inject as hidden HumanMessage each turn
  }

  // add durable item explicitly (e.g., original question, acceptance criteria)
  addDurable(item: DurableItem): void { this.durable.push(item); }
}

// Usage:
// const mw = new DurableContextMiddleware();
// // before compact:
// mw.captureBeforeCompaction(session.history.entries());
// mw.addDurable({ type: "question", content: originalQuestion });
// // each request:
// const hidden = mw.projectHiddenMessage();
// if (hidden) session.history.append({ role: "system", content: hidden }); // hidden inject
```

## Được

- ✅ Critical context survives compaction (delegation/skill-refs không mất)
- ✅ Re-injected every turn (model luôn thấy durable — không quên)
- ✅ Hidden (user không thấy noise — system-level inject)
- ✅ Original question persistence (không paraphrase qua compact)

## Mất

- ❌ Token overhead (durable items inject mỗi turn → tốn token lặp)
- ❌ Capture completeness (miss durable item → mất sau compact)
- ❌ Stale durable (delegation done nhưng vẫn re-project → noise)
- ❌ Hidden-message complexity (system-level inject cần care — không break history)

## Khác

Khác **TJ clean-handoff-ritual** (start session mới khi context cạn) — TW **stay same session** (compact + re-project, không new session). Khác **TQ handoff-session-reset** (handoff file bridge session) — TW **in-session durable** (re-project mỗi turn, không bridge). Khác **auto-compaction** (summarize history) — TW **capture before compact + re-project after** (preserve critical, không chỉ summarize).

## Khi nào chọn

- Session dài, compact nhiều lần → risk mất delegation/skill-refs
- Critical context không được mất (delegation active, acceptance criteria — compact phải preserve)
- Muốn stay same session (không new session — compact + re-project đủ)
- Nối packages/core session/history + spill + packages/agent spawnSubagent + packages/skills SkillStore; guard capture completeness (scan kỹ — không miss durable item), staleness pruning (delegation done → remove khỏi durable), và token budget (durable inject mỗi turn — giữ compact, không phình); TW = durable context projection, kết hợp TJ clean-handoff-ritual (handoff alternative) + TQ handoff-session-reset (cross-session handoff)
