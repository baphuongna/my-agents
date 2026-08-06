# Hướng AJG: Recall-Planner Intent Gating — Recall Planner phân loại intent trước khi search: `no_recall` (bỏ search), `minimal` (operational commands, QMD capped), `full` (normal), `graph_mode` (timeline queries)

> **Nguồn gốc:** remnic | **Coupling:** 🟢 — gating thuần trước recall | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có recall path; chưa có intent gate) | **Effort:** 1 tuần

## Nguồn gốc

**remnic** Recall Planner **phân loại intent trước khi search**: `no_recall` (ack — **bỏ search hoàn toàn**), `minimal` (operational commands — **QMD capped**), `full` (normal — search đầy đủ), `graph_mode` (timeline queries — search theo đồ thị/thời gian). Mục đích: **gate recall theo nhu cầu thực** — không phải câu hỏi nào cũng cần search memory; "thanks", "ok", "run test" không cần recall → **tiết kiệm latency và token** (recall là FTS + embedding — đắt).

Nguyên tắc: **recall là chi phí — gate theo intent**; **phân loại intent rẻ (heuristic) trước search đắt**; **mỗi intent có mức recall khác nhau** — no_recall = 0 search, minimal = capped (ít kết quả, ít token), full = đầy đủ, graph_mode = query theo quan hệ/thời gian.

## Mô tả

Với mya, pattern = **intent gate trước recall path**: (1) **classifier `recallIntent(text)`** — heuristic (regex, rẻ): ack/operational keywords (`ok`, `thanks`, `run`, `test`, `deploy`...) → no_recall/minimal; timeline keywords (`when`, `timeline`, `history`, `ever`) → graph_mode; else full; (2) **nối vào before_agent_start recall** (print/mya-bridge) — hiện mọi prompt đều `sqliteMemory.recall(query, {topK: 5})`; AJG thêm gate: no_recall → bỏ recall (không inject [memory]); minimal → `topK: 2` + cắt content ngắn (QMD capped); full → `topK: 5` hiện tại; graph_mode → nối `graph.ts`/`learning-graph.ts` (timeline query qua KG edges); (3) **nối sqlite-recall** — `RecallOptions.topK` đã có; (4) **nối retrieval engine** — 4-arm RRF (bm25/substring/trigram/vector) chạy cho full/graph_mode, minimal chỉ bm25 (nhanh, rẻ); (5) **latency/token tiết kiệm** — đo qua telemetry (nối AIQ lifetime usage). Classifier heuristic fail → mặc định full (an toàn — không mất recall cần thiết).

## Kiến trúc (ASCII)

```
  PROMPT (before_agent_start)
    │
    ▼ RECALL PLANNER — classify intent (heuristic, RẺ)
    ├─ "ok" / "thanks" / "run test" ──► NO_RECALL ──► bỏ search (0 latency/token)
    ├─ "run deploy" / operational ──► MINIMAL ──► topK=2 + QMD capped (bm25 only)
    ├─ bình thường ──► FULL ──► topK=5 + 4-arm RRF (hiện tại)
    └─ "when did we" / timeline ──► GRAPH_MODE ──► KG/timeline query
         │
         ▼ recall theo mức đã gate (không search thừa)
  (heuristic fail → mặc định FULL — an toàn, không mất recall)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print mya-bridge.ts — before_agent_start recall (mọi prompt hiện
//   đều recall topK=5 — nơi áp gate)
// ✅ packages/memory sqlite-recall.ts — RecallOptions.topK (capped có sẵn)
// ✅ packages/memory retrieve.ts — 4-arm RRF (bm25/substring/trigram/vector)
// ✅ packages/memory graph.ts + learning-graph.ts — KG + timeline (graph_mode)
// ✅ packages/core telemetry.ts — đo latency/token (nối AIQ)
// ✅ packages/memory sqlite-manager.ts — recall entry point

// ❌ THIẾU: recallIntent classifier (no_recall/minimal/full/graph_mode)
// ❌ THIẾU: QMD capped cho minimal (content cắt ngắn)
// ❌ THIẾU: graph_mode path (timeline query qua KG)
```

## Implementation

```typescript
// packages/memory/src/recall-planner.ts (NEW)
export type RecallIntent = "no_recall" | "minimal" | "full" | "graph_mode";

const ACK_RE = /^(ok|okay|thanks|thank you|got it|sure|yes|no|done|👍|✅)\b/i;
const OPERATIONAL_RE = /\b(run|test|deploy|build|lint|typecheck|format|push|merge|kill|stop)\b/i;
const TIMELINE_RE = /\b(when did|timeline|history|ever|previously|before|first time|last time)\b/i;

/** Phân loại intent trước recall — rẻ (regex), fail → full (an toàn). */
export function recallIntent(text: string): RecallIntent {
  const t = text.trim();
  if (!t || ACK_RE.test(t)) return "no_recall";          // ack → bỏ search
  if (TIMELINE_RE.test(t)) return "graph_mode";           // timeline → KG
  if (OPERATIONAL_RE.test(t) && t.length < 120) return "minimal";  // lệnh vận hành
  return "full";                                          // mặc định an toàn
}

/** Mức recall theo intent — topK + arm selection. */
export function recallPlan(intent: RecallIntent): { topK: number; arms: string[]; maxContentChars: number } {
  switch (intent) {
    case "no_recall":  return { topK: 0, arms: [], maxContentChars: 0 };
    case "minimal":    return { topK: 2, arms: ["bm25"], maxContentChars: 120 };   // QMD capped
    case "graph_mode": return { topK: 5, arms: ["bm25", "graph"], maxContentChars: 200 };
    case "full":       return { topK: 5, arms: ["bm25", "substring", "trigram", "vector"], maxContentChars: 200 };
  }
}
// before_agent_start: const intent = recallIntent(prompt);
// if (intent === "no_recall") → không inject [memory];
// else plan = recallPlan(intent) → sqliteMemory.recall(prompt, { topK: plan.topK })
// + cắt content theo maxContentChars (QMD capped).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm latency/token — ack không search | ❌ Heuristic lệch — operational phrase bị phân loại nhầm |
| ✅ Minimal capped — lệnh vận hành không cần recall sâu | ❌ Graph_mode cần KG chất lượng (timeline đúng) |
| ✅ Mặc định full — fail-safe không mất recall | ❌ Thêm classifier — cần test bộ câu phân loại |
| ✅ Nối telemetry đo tiết kiệm | ❌ Intent phụ thuộc ngôn ngữ (regex EN — tiếng Việt cần mở rộng) |

## Khác các hướng gần

| | AJG Intent Gating | AFG NL Search | AJI Dreams Consolidation |
|---|---|---|---|
| Trọng tâm | Gate recall theo intent | Dịch câu tự nhiên → query | Consolidation nền |
| Cơ chế | Classifier + recall plan | Quote + stopword | Phase light/REM/deep |
| Quan hệ | Trước recall path | Đầu vào recall | Sau capture |

## Khi nào chọn

- Mọi prompt đều recall (tốn) — muốn gate theo intent thực
- Nhiều câu ack/operational (chat với agent) — no_recall/minimal tiết kiệm đáng kể
- Có KG (graph/learning-graph) — graph_mode cho timeline queries
- Guard: fail → full, regex mở rộng tiếng Việt, telemetry đo tiết kiệm thật