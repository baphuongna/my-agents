# Hướng IF: Data Lineage — truy vết nguồn dữ liệu → quyết định

> **Nguồn gốc:** Data lineage standards (Apache Atlas, OpenLineage, Amundsen); "provenance" W3C PROV; "Data Provenance for LLMs" research; Databricks Unity Catalog lineage
> **Coupling:** 🟡 — lineage metadata gắn vào mọi data/decision event
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit 198 + memory graph sẵn — thiếu provenance tracking + attribution chain)
> **Effort:** 2-3 tuần

## Nguồn gốc

Data lineage là khái niệm cốt lõi trong data governance — **truy vết** dữ liệu từ nguồn gốc qua mọi biến đổi đến kết quả cuối. W3C PROV (2013) — ontology chuẩn cho provenance: entity (dữ liệu), activity (biến đổi), agent (người/hệ tạo ra). OpenLineage (open standard) — event-based: mỗi data transformation phát event kèm input/output lineage. Trong LLM: "data provenance" — truy vết **fact nào trong output đến từ nguồn nào** (training data? RAG chunk? tool result? hallucinated?). Databricks Unity Catalog: column-level lineage — biết column "decision" derive từ column "revenue" của table X. Cho agent: mỗi fact agent dùng để ra quyết định cần có **provenance chain** — để audit (198), debug sai vì sao, xóa đúng nguồn (155 right-to-be-forgotten).

Khác **198 audit-trails** (ghi *sự kiện* — gì đã xảy ra) — IF truy vết *nguồn dữ liệu* (data đến từ đâu, biến đổi thế nào). Khác **219 answer-grounding** (trích nguồn trong câu trả lời) — IF là hạ tầng lineage toàn hệ thống. Nối **155 right-to-be-forgotten** (xóa data cần lineage để biết ảnh hưởng), **230 event-sourcing** (HV — event = lineage unit), **240** self.

## Mô tả

mya data lineage: mỗi fact/decision trong agent được gắn **provenance** — nguồn gốc (tool result, memory fact, LLM output, user input), timestamp, transformation chain. Khi agent ra quyết định "deploy v2" dựa trên fact "tests pass" → lineage: tests pass ← test-runner tool ← test files ← git commit X. Nếu sai → truy ngược tìm nguồn lỗi. mya đã có audit (198) + memory graph (packages/memory/graph.ts) — IF thêm **provenance edges** trong graph + lineage query API. Nối **230 event-sourcing** (HV — event store = lineage source).

## Kiến trúc

```
  DATA / FACT vào agent:
   · tool result: "tests pass" (source: test-runner, commit abc123)
   · memory fact: "v2 is stable" (source: user said 3 days ago)
   · RAG chunk: "deploy pattern X" (source: docs/pattern.md L42)
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  LINEAGE TRACKER (provenance edges in graph)   │
  │                                               │
  │  DECISION: "deploy v2"                         │
  │    ├─ derived_from: "tests pass"               │
  │    │    └─ source: tool(test-runner@abc123)   │
  │    ├─ derived_from: "v2 stable"                │
  │    │    └─ source: user_input (3d ago)         │
  │    └─ derived_from: "deploy pattern X"         │
  │         └─ source: rag(docs/pattern.md L42)    │
  └──────────────────┬───────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │ AUDIT    │ │ DEBUG    │ │ DELETE       │
  │ "why?"   │ │ truy gốc │ │ (155) impact │
  │ trace    │ │ sai?     │ │ khi xóa src  │
  └──────────┘ └──────────┘ └──────────────┘
```

```
mya: audit 198 + memory graph sẵn — thiếu provenance edges + lineage query + attribution chain
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — append-only event log (sự kiện — nền tảng lineage)
// ✅ packages/memory/src/graph.ts — knowledge graph (có thể thêm provenance edges)
// ✅ 198 audit-trails — event tracking (sẵn)
// ✅ 219 answer-grounding — citations (lineage ở mức answer)
// ✅ 230 event-sourcing (HV) — event store (lineage source of truth)

// ❌ THIẾU: provenance metadata trên mỗi fact/decision (source + transform chain)
// ❌ THIẾU: lineage edges trong memory graph (derived_from relationships)
// ❌ THIẾU: lineage query API ("decision X đến từ nguồn nào?")
// ❌ THIẾU: impact analysis (xóa source Y → ảnh hưởng decision nào? — 155)
```

## Implementation

```typescript
// packages/memory/src/lineage.ts (NEW)
interface Provenance {
  sourceType: "tool" | "memory" | "rag" | "user" | "llm" | "derived";
  sourceRef: string;        // "test-runner@abc123" / "docs/pattern.md:L42"
  fetchedAt: number;
  transform?: string;       // "summarized" / "aggregated" — how derived
}

interface LineagedFact {
  id: string;
  value: unknown;
  provenance: Provenance;
  derivedFrom?: string[];   // fact IDs this was derived from
}

class LineageTracker {
  constructor(private graph: KnowledgeGraph) {}

  record(fact: LineagedFact): void {
    this.graph.addNode(fact.id, { value: fact.value, provenance: fact.provenance });
    for (const parent of fact.derivedFrom ?? []) {
      this.graph.addEdge(parent, fact.id, { type: "derived_from", transform: fact.provenance.transform });
    }
  }

  // "Where did decision D come from?" → trace full provenance chain
  trace(decisionId: string): Provenance[] {
    const chain: Provenance[] = [];
    for (const node of this.graph.ancestors(decisionId)) {
      chain.push(this.graph.getNode(node).provenance);
    }
    return chain;
  }

  // "If I delete source S, what decisions become unsupported?" (nối 155)
  impact(sourceRef: string): string[] {
    return this.graph.descendantsWhere((n) => n.provenance.sourceRef === sourceRef);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Audit "tại sao?" — truy nguồn quyết định (W3C PROV) | ❌ Metadata overhead (provenance per fact) |
| ✅ Debug: tìm nguồn sai (fact sai ← tool result hỏng) | ❌ Graph phình to (lineage edges accumulate) |
| ✅ Right-to-be-forgotten: xóa đúng nguồn + impact (155) | ❌ Query latency (traversal chain dài) |
| ✅ Nối audit 198 + memory graph (1 phần) | ❌ Transform chain phức tạp (derived facts) |

## Khác các hướng gần

| | 198 Audit Trails | 219 Answer Grounding | IF: Data Lineage |
|---|---|---|---|
| Mục | Ghi sự kiện | Citation trong answer | **Truy vết nguồn → quyết định** |
| Scope | Event-level | Answer-level | **Fact/decision-level** |
| Query | "gì xảy ra?" | "source?" | **"tại sao? nguồn? impact?"** |

## Khi nào chọn

- Cần audit giải thích quyết định ("tại sao agent làm X?")
- Compliance: truy vết data source (GDPR — 155 right-to-be-forgotten)
- Debug: fact sai → truy nguồn tool/RAG lỗi
- RAG system — cần biết output dựa trên chunk nào (nối 219)
