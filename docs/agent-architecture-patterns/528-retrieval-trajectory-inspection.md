# Hướng TH: Retrieval Trajectory Inspection — phơi đường retrieval đã dùng để trả lời query cho audit

> **Nguồn gốc:** codebase-memory-mcp `internal/cbm/` (`extract_unified.c`, `extract_usages.c`, `lsp_all.c`, semantic/graph extraction, query path); "expose retrieval steps used to answer"; "retrieval trajectory for audit"; "which chunks/symbols retrieved, in what order"; "transparent retrieval chain" | **Coupling:** 🟢 — thêm trajectory logger vào retrieval pipeline (log từng step → expose cho audit) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có retrieval-trajectory logger + expose API) | **Effort:** 2-3 tuần

## Nguồn gốc

**codebase-memory-mcp** retrieval không chỉ trả kết quả — mà **phơi đường retrieval** (trajectory): query → (1) LSP resolve symbol → (2) graph traversal (follow edge) → (3) semantic search fallback → (4) rerank → final chunks. Mỗi **step** được **log** (step type, input, output, source). Mục đích: **audit** — user/agent thấy **chính xác retrieval đã làm gì** để trả lời query (chunk nào lấy, theo path nào, trust bao nhiêu) → debug召回, verify grounding, trace hallucination. Nguyên tắc: **retrieval không black-box** — trajectory transparent, inspectable. Khác **GE Agentic-RAG** (retrieval là quyết định) — TH là **trajectory inspection/expose**; khác result-only — TH **step-by-step chain**.

## Mô tả

mya retrieval trajectory inspection: (1) **Step log**: mỗi retrieval step (LSP/graph/semantic/rerank) ghi `{ step, input, output, source, trust }`. (2) **Trajectory**: gom step thành chain (query → step1 → step2 → … → final). (3) **Expose**: API trả trajectory cùng kết quả (UI / agent inspect được). (4) **Audit**: user xem "để trả lời X, retrieval đã: LSP resolve Y → graph follow Y→Z → rerank → top 3 chunks". mya có retrieval pipeline — TH thêm **trajectory logger** + **step recorder** + **expose API**.

## Kiến trúc

```
  QUERY: "parseToken phụ thuộc gì?"
        │
        ▼
  ┌─── RETRIEVAL PIPELINE (mỗi step log) ────────────────┐
  │  step 1: LSP resolve "parseToken" → src/token.rs:42   │
  │  step 2: graph follow deps → [token.rs, ast.rs, lex]  │
  │  step 3: semantic fallback (cross-lang) → [util.rs]   │
  │  step 4: rerank → top 3: [token.rs, ast.rs, util.rs]  │
  └───────────────────────┬─────────────────────────────┘
                          │ (trajectory = step chain)
                          ▼
  ┌─── EXPOSE (result + trajectory) ─────────────────────┐
  │  result: [token.rs, ast.rs, util.rs]                   │
  │  trajectory:                                           │
  │    [LSP→token.rs:42] → [graph→ast.rs] →                │
  │    [semantic→util.rs] → [rerank top3]                  │
  │  → AUDIT: thấy path retrieval, trust từng step          │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools search — retrieval (nền — TH log step ở đây)
// ✅ 526 hybrid-lsp-semantic — resolver (nền — TH log LSP/semantic step)
// ✅ GE agentic-RAG — retrieval decisions (nền — TH expose trajectory)

// ❌ THIẾU: trajectory logger (per-step {step, input, output, source, trust})
// ❌ THIẾU: step recorder (gom chain)
// ❌ THIẾU: expose API (return result + trajectory)
// ❌ THIẾU: audit view (UI/agent inspect trajectory)
```

## Implementation

```typescript
// packages/agent/src/retrieval-trajectory.ts (MỚI)
type StepType = 'lsp' | 'graph' | 'semantic' | 'rerank';
interface TrajectoryStep { step: StepType; input: string; output: string[]; source: string; trust: 'high' | 'med' | 'low' }
interface RetrievalResult { chunks: string[]; trajectory: TrajectoryStep[] }

class RetrievalTrajectory {
  private steps: TrajectoryStep[] = [];
  log(step: TrajectoryStep): void { this.steps.push(step); }

  // wrap a retrieval fn — auto-log step
  async runStep<T extends string[]>(
    step: StepType, input: string, source: string, trust: TrajectoryStep['trust'],
    fn: () => Promise<T>,
  ): Promise<T> {
    const output = await fn();
    this.log({ step, input, output: [...output], source, trust });
    return output;
  }

  // final result + trajectory
  finalize(chunks: string[]): RetrievalResult {
    return { chunks, trajectory: [...this.steps] };
  }

  // audit summary (human-readable chain)
  audit(): string {
    return this.steps.map((s, i) =>
      `${i + 1}. [${s.step}/${s.trust}] ${s.input} → ${s.output.join(', ') || '∅'} (via ${s.source})`,
    ).join('\n');
  }
}

// Usage:
// traj.log or runStep wrap each retrieval step
// const r = traj.finalize(topChunks);
// → { chunks, trajectory: [LSP→..., graph→..., semantic→..., rerank→...] }
// audit: "1. [lsp/high] parseToken → token.rs:42 (via rust-analyzer) …"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Retrieval transparent (audit, debug召回) | ❌ Logging overhead (mỗi step record) |
| ✅ Trace hallucination (thấy chunk nào bị sai) | ❌ Trajectory phình (nhiều step → dài) |
| ✅ Trust per-step (LSP high, semantic med) | ❌ Expose API surface (privacy — lộ internal) |
| ✅ Grounding verify (chunk từ path nào) | ❌ Step-coupling (logger ràng buộc pipeline) |

## Khác các hướng gần

| | GE Agentic-RAG | Result-only | TH: Retrieval-Trajectory |
|---|---|---|---|
| Cái gì | Retrieval = quyết định | Chỉ trả chunks | **Phơi step-chain retrieval** |
| Audit | ❌ | ❌ | **✅ trajectory inspect** |
| Trust | ❌ | ❌ | **per-step trust** |

## Khi nào chọn

- Retrieval cần audit (debug召回/precision, trace hallucination)
- Muốn verify grounding (chunk từ path nào, trust bao nhiêu)
- Agent tự-inspect trajectory (meta: cải thiện retrieval)
- Nối packages/tools search + 526 hybrid-lsp-semantic (LSP/semantic step) + GE agentic-RAG (decision step); guard logging cost (sample/lazy log nếu nhiều step), privacy (censor sensitive path trong expose), và trajectory readability (audit summary rõ); TH = retrieval trajectory inspection, kết hợp 525 graph-edge-provenance (per-edge nguồn) + 526 hybrid-lsp (resolver layer trong trajectory)
