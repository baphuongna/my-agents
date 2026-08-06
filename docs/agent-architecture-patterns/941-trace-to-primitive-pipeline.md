# Hướng AJE: Trace-to-Primitive Pipeline — memory pipeline ba giai đoạn: Trace (raw turns trong buffer) → Observation (extraction judge + importance score, chưa commit) → Primitive (durable memory file YAML+markdown)

> **Nguồn gốc:** remnic | **Coupling:** 🟡 — chạm memory capture path | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (auto-capture + sqlite-manager + consolidation; thiếu judge/importance 2-phase) | **Effort:** 2 tuần

## Nguồn gốc

**remnic** memory pipeline **ba giai đoạn**: **Trace** (raw turns trong buffer) → **Observation** (extraction judge + importance score, **chưa commit**) → **Primitive** (durable memory file **YAML+markdown**). Triết lý: **"the trace is noise, the primitive is the product"** — raw conversation là nhiễu, sản phẩm là primitive đã lọc. Observation là **staging**: extraction judge quyết định cái gì đáng nhớ + chấm importance — nhưng **chưa commit** (review được trước khi ghi durable).

Nguyên tắc: **ba lớp tách rõ** — trace (tạm, buffer) / observation (staging, judge + score, chưa commit) / primitive (durable, định dạng chuẩn); **chưa commit = có thể review/loại trước khi ghi** — không ghi nhiễu vào durable; **judge có importance score** — primitive biết mức độ quan trọng (điều khiển retention/decay).

## Mô tả

Với mya, pattern = **nâng cấp capture pipeline thành 3 giai đoạn**: (1) **Trace = buffer raw turns** — mya đã có `pendingUserPrompt` + `lastAssistantTextCapture` (print/mya-bridge turn_end); (2) **Observation = extraction judge** — mya đã có **`autoCapture` (memory/auto-capture.ts)**: pattern-based heuristic + confidence + memory_type — đây chính là judge; **thiếu importance score + staging chưa commit** — autoCapture hiện ghi thẳng vào sqlite; AJE thêm **staging**: observation ghi vào bảng staging (chưa là memory thật); (3) **Primitive = durable** — mya có `sqlite-manager` (working_memory/episodic_memory) + Brain (facts/takes) — YAML+markdown tương ứng metadata JSON + content text; (4) **commit gate** — staging → primitive khi: importance ≥ ngưỡng, hoặc LLM confirm (structured output — `consolidationFn` dream-cycle pattern), hoặc quá N turn (flush); (5) **loại bỏ** — staging hạ importance/trùng lặp bị drop trước commit (dedup bằng captureHash — sqlite-manager.findByHash). Nối governance trust + weibull decay (primitive có importance → retention đúng).

## Kiến trúc (ASCII)

```
  TURNS (raw conversation)
    │
    ▼ 1. TRACE (buffer — tạm, nhiễu)
    │    pendingUserPrompt + lastAssistantTextCapture (turn_end)
    ▼ 2. OBSERVATION (extraction judge + importance score — CHƯA COMMIT)
    │    autoCapture: pattern → confidence + memory_type
    │    + importance score mới
    │    └─ staging table (chưa là memory thật — review/loại được)
    │         ├─ importance < ngưỡng ──► drop (không ghi nhiễu)
    │         ├─ trùng captureHash ──► drop (dedup)
    │         └─ ≥ ngưỡng / flush sau N turn ──► COMMIT
    ▼ 3. PRIMITIVE (durable — YAML+markdown / sqlite+JSON)
    │    working_memory + episodic (sqlite-manager)
    │    + Brain facts/takes (tier L0/L1/L2)
    └─ "the trace is noise, the primitive is the product"
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory auto-capture.ts — extraction judge (pattern + confidence + type)
//   — chính là judge của AJE (thiếu importance score + staging)
// ✅ packages/memory sqlite-manager.ts — record/recall/lifecycle + findByHash (dedup)
// ✅ packages/memory sqlite-recall.ts — FTS5 recall (primitive truy vấn)
// ✅ packages/print mya-bridge.ts — turn_end capture (Trace — buffer có sẵn)
// ✅ packages/memory tree.ts — L0/L1/L2 tiers (primitive promotion)
// ✅ packages/memory sqlite-consolidate.ts — consolidate (L0→L1, summary_of)

// ❌ THIẾU: Observation staging (chưa commit — review/loại trước ghi)
// ❌ THIẾU: importance score trong judge (autoCapture thiếu field)
// ❌ THIẾU: commit gate (ngưỡng importance / LLM confirm / flush N turn)
```

## Implementation

```typescript
// packages/memory/src/trace-to-primitive.ts (NEW)
export type PipelineStage = "trace" | "observation" | "primitive";

export interface Observation {
  content: string;
  memoryType: MemoryType;
  confidence: number;       // từ autoCapture judge
  importance: number;       // MỚI — score 0..1
  source: string;
  captureHash: string;
}

/** Judge 2: chấm importance từ type + confidence + nội dung. */
export function scoreImportance(memoryType: MemoryType, confidence: number, content: string): number {
  const typeBase: Record<string, number> = {
    preference: 0.8, decision: 0.85, commitment: 0.9, fact: 0.6,
    learning: 0.7, instruction: 0.7, observation: 0.4, context: 0.3,
  };
  const base = typeBase[memoryType] ?? 0.4;
  const lenBoost = Math.min(0.1, content.length / 10_000);
  return Math.min(1, base * confidence + lenBoost);
}

/** Staging — observation chưa commit; drop nhiễu trước khi vào durable. */
export class ObservationStage {
  private pending = new Map<string, Observation>();
  stage(obs: Observation, dedup: (hash: string) => boolean): void {
    if (dedup(obs.captureHash)) return;                 // trùng → drop
    if (obs.importance < 0.4 && obs.confidence < 0.7) return;  // nhiễu → drop
    const prev = this.pending.get(obs.captureHash);
    if (prev && obs.importance <= prev.importance) return;     // giữ bản tốt hơn
    this.pending.set(obs.captureHash, obs);
  }
  /** Commit gate: flush observation ≥ ngưỡng (hoặc tất cả sau N turn). */
  flush(minImportance = 0.5, force = false): Observation[] {
    const out = [...this.pending.values()].filter((o) => force || o.importance >= minImportance);
    this.pending.clear();
    return out;
  }
}
// turn_end: autoCapture → scoreImportance → stage (chưa ghi thẳng);
// flush(0.5) hoặc sau 5 turn → sqlite-manager.record (Primitive).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không ghi nhiễu — staging review/loại trước commit | ❌ Thêm staging — memory chậm hơn capture trực tiếp |
| ✅ Importance score điều khiển retention đúng | ❌ Score heuristic — cần calibrate theo type |
| ✅ Nối autoCapture judge có sẵn | ❌ Flush gate phức tạp — mất observation nếu crash trước flush |
| ✅ "Primitive is the product" — durable chỉ chứa cái đáng giữ | ❌ Staging cần persist nếu muốn chống mất khi crash |

## Khác các hướng gần

| | AJE Trace→Primitive | AJF Recall-Buffer-Extract | AJI Dreams Consolidation |
|---|---|---|---|
| Trọng tâm | 3 giai đoạn capture | Luồng recall/buffer/extract | Consolidation nền |
| Cơ chế | Judge + staging + commit | Orchestrator tuần tự | Phase light/REM/deep |
| Quan hệ | Nền capture | Orchestrate capture | Nâng cấp consolidation |

## Khi nào chọn

- Memory hiện ghi nhiễu (autoCapture ghi thẳng) — muốn staging + importance trước commit
- Đã có autoCapture judge — thêm importance + staging layer
- Muốn durable chỉ chứa primitive đáng giữ (retention theo importance)
- Guard: staging chưa commit, dedup captureHash, flush gate rõ, importance calibrate