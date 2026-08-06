# Hướng MQ: Memory Provenance Traceability — trace ngược memory về observation/source ban đầu

> **Nguồn gốc:** agentmemory (provenance per memory entry); "data lineage" / "data provenance" (truy ngược origin); "chain of custody"; "evidence chain"; W3C PROV (provenance standard); "memory audit trail"; "source attribution"
> **Coupling:** 🟡 — thêm provenance chain (backref) vào mỗi memory entry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (graph.ts + grounding.ts + audit sẵn — chưa có provenance backref chain)
> **Effort:** 2-3 tuần

## Nguồn gốc

**W3C PROV**: standard cho data provenance — mọi entity có **wasGeneratedBy** (ai tạo, khi nào, từ gì). **Data lineage**: truy ngược dữ liệu về **origin** — "fact này đến từ đâu? observation nào? tool call nào?". **agentmemory**: mỗi memory entry lưu **provenance chain**: entry → consolidation step → source observation → tool call → user input. Nguyên tắc: **mọi fact có nguồn** — agent có thể trả lời "tôi biết điều này từ đâu?" → trace ngược về raw observation. Khác **240 data-lineage** (dataset lineage) — MQ là **memory entry provenance**; khác **grounding.ts** (output có dựa source) — MQ **trace chain** (nhiều bước); khác **198 audit** (log event) — MQ **structured backref**.

## Mô tả

mya memory provenance: mỗi memory entry có `sourceChain` — danh sách backref: entry ← consolidated from ← source facts ← raw observation ← tool call ← user message. Agent query "fact này từ đâu?" → walk provenance chain → trả raw source. VD: "Dự án X dùng Rust" ← consolidated from 3 notes ← note từ session 42 ← tool call `read_file("package.json")`. Nối grounding.ts (output grounding), graph.ts (provenance edge), 198 audit (event log), 240 data-lineage (dataset pattern). **Transitive**: consolidation tạo entry mới → provenance = union của sources.

## Kiến trúc

```
  RAW OBSERVATION (tool result / user message)
       │
       ▼
  FACT (level 0 — raw extract)
   provenance: [tool_call, timestamp, raw_output]
       │
       │  CONSOLIDATION (lifecycle.ts)
       ▼
  FACT (level 1 — consolidated)
   provenance: [derivedFrom: fact_A, fact_B, fact_C]
       │
       │  RETRIEVAL
       ▼
  AGENT cites fact → user asks "từ đâu?"
       │
       ▼
  PROVENANCE WALK:
   fact_L1 → [fact_A, fact_B, fact_C]
   fact_A  → [tool_call: read_file, raw: "rust-version = ..."]
   → "Tôi biết từ package.json (session 42, tool read_file)"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/grounding.ts — output grounding (nền — MQ là trace chain)
// ✅ packages/memory/src/graph.ts — graph store (provenance edge — cần add)
// ✅ 198 GP audit — event log (raw observation source)
// ✅ 240 data-lineage — dataset lineage (pattern — MQ cho memory)
// ✅ packages/memory/src/lifecycle.ts — consolidation (derivedFrom chain)

// ❌ THIẾU: provenance backref per entry (wasGeneratedBy chain)
// ❌ THIẾU: provenance walk (trace entry → raw observation)
// ❌ THIẾU: provenance on consolidation (derivedFrom = union sources)
// ❌ THIẾU: provenance query API ("fact này từ đâu?")
```

## Implementation

```typescript
// packages/memory/src/provenance.ts (NEW)
interface ProvenanceNode {
  type: 'observation' | 'consolidation' | 'user_input' | 'tool_result' | 'inference';
  ref: string;         // raw observation ID / parent fact ID
  detail: string;      // human-readable origin
  timestamp: number;
}

interface ProvenancedMemory {
  id: string;
  content: string;
  provenance: ProvenanceNode[];  // chain of custody
}

class ProvenanceTracker {
  // Record raw observation → fact with full provenance
  observe(content: string, source: ProvenanceNode): ProvenancedMemory {
    return { id: crypto.randomUUID(), content, provenance: [source] };
  }

  // Consolidation — new fact derived from multiple → union provenance
  consolidate(content: string, parents: ProvenancedMemory[]): ProvenancedMemory {
    const sources = parents.flatMap(p => p.provenance);
    const derived: ProvenanceNode = {
      type: 'consolidation',
      ref: parents.map(p => p.id).join(','),
      detail: `Consolidated from ${parents.length} facts`,
      timestamp: Date.now(),
    };
    return {
      id: crypto.randomUUID(),
      content,
      provenance: [derived, ...sources], // chain: derived ← raw sources
    };
  }

  // Walk provenance — trace fact to raw observation
  trace(entry: ProvenancedMemory): string[] {
    return entry.provenance
      .filter(n => n.type === 'observation' || n.type === 'tool_result' || n.type === 'user_input')
      .map(n => `[${n.type}] ${n.detail} (${new Date(n.timestamp).toISOString()})`);
  }

  // User query: "how do you know X?"
  explain(entry: ProvenancedMemory): string {
    const sources = this.trace(entry);
    return sources.length > 0
      ? `Tôi biết "${entry.content}" từ:\n${sources.map(s => `  • ${s}`).join('\n')}`
      : `Không có nguồn ghi nhận cho "${entry.content}".`;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Trace fact về raw observation (W3C PROV) | ❌ Provenance storage (chain per entry) |
| ✅ "Tôi biết từ đâu?" — trust + transparency | ❌ Chain explosion (deep consolidation) |
| ✅ Audit chain of custody (compliance) | ❌ Provenance on retroactive migration |
| ✅ Detect hallucination (no provenance = suspect) | ❌ Walk cost (deep chain traversal) |

## Khác các hướng gần

| | grounding.ts | 198 GP Audit | 240 Data-Lineage | MQ: Provenance |
|---|---|---|---|---|
| Cái gì | Output có source | Event log | Dataset origin | **Memory entry backref chain** |
| Trace | 1 level | Forward | Dataset | **Transitive (entry→raw)** |
| Per-entry | ❌ (per output) | ❌ (per event) | ❌ | **✅ per memory** |

## Khi nào chọn

- Agent cần giải thích "tôi biết điều này từ đâu?" (trust)
- Audit/compliance (chain of custody cho facts)
- Detect hallucination (fact không có provenance = suspect)
- Kết hợp grounding.ts (output cite) + 198 audit (raw log) + 240 data-lineage (pattern) + graph.ts (provenance edge); cap chain depth (avoid explosion)
