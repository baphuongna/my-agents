# Hướng TF: Hybrid LSP Semantic Resolution — LSP symbolic, fallback semantic-index khi LSP miss

> **Nguồn gốc:** codebase-memory-mcp `internal/cbm/lsp_all.c`, `lsp/rust_lsp.c`, `lsp/java_lsp.c`, `extract_unified.c`, `extract_semantic.c` (`extract_semantic`), `lsp/generated/*_stdlib_data.c`; "LSP symbolic resolution"; "semantic-index fallback when LSP miss"; "hybrid resolution"; "LSP first, semantic when no language server" | **Coupling:** 🟡 — thêm 2-layer resolver (LSP deterministic → semantic-index fallback) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có LSP integration + semantic fallback — cần 2-layer resolver) | **Effort:** 4-5 tuần

## Nguồn gốc

**codebase-memory-mcp** resolve symbol **2 lớp**: (1) **LSP** (Language Server Protocol) — **deterministic**, chính xác (goto-definition, find-references qua language server thật — rust-analyzer, jdtls). (2) **Semantic-index fallback** — khi **LSP miss** (ngôn ngữ không có LSP, LSP chưa index, cross-language) → fallback **semantic index** (`extract_semantic` — embedding/symbol heuristics). Nguyên tắc: **LSP first** (deterministic, trust cao), **semantic fallback** (cover gap) — không bỏ symbol nào. Hybrid: LSP trả kết quả → dùng; LSP miss → semantic; gộp. Khác **MJ AST-Code-Knowledge-Graph** (tree-sitter) — TF là **LSP + semantic hybrid**; khác LSP-thuần — TF **graceful fallback**.

## Mô tả

mya hybrid LSP semantic resolution: (1) **LSP query**: resolve symbol (definition/references) qua language server (rust-analyzer/jdtls/pyright). (2) **Hit?**: LSP trả kết quả → dùng (deterministic, high-trust). (3) **Miss fallback**: LSP miss (no server / not indexed / cross-lang) → semantic-index (embedding match + symbol heuristic). (4) **Merge**: gộp kết quả (LSP trust cao, semantic tag lower-trust). (5) **Coverage**: không bỏ symbol (LSP cover mainstream, semantic cover rest). mya có code search — TF thêm **LSP client** + **semantic-index fallback** + **trust-merge**.

## Kiến trúc

```
  QUERY: "định nghĩa của function parseToken ở đâu?"
        │
        ▼
  ┌─── LSP RESOLUTION (deterministic, first) ────────────┐
  │  rust-analyzer → gotoDefinition(parseToken)            │
  │  → src/token.rs:42  ✓ HIT (high-trust, deterministic)  │
  └───────────┬───────────────────────────┬───────────────┘
            HIT                           MISS (no LSP / cross-lang)
               ▼                              ▼
  ┌─── USE LSP RESULT ──────────┐  ┌─── SEMANTIC FALLBACK ────────┐
  │  src/token.rs:42              │  │  extract_semantic:            │
  │  (trust HIGH)                 │  │  embedding match + heuristic  │
  └───────────────────────────────┘  │  → maybe src/token.rs:42      │
                                     │  (trust MED, tag fallback)     │
                                     └──────────────┬─────────────────┘
                                                    ▼
  ┌─── MERGE (LSP trust > semantic) ─────────────────────┐
  │  result: src/token.rs:42  (LSP deterministic wins)     │
  │  coverage: LSP mainstream + semantic gap = full cover  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools find/search — code search (nền — TF semantic layer)
// ✅ MJ AST-Code-Knowledge-Graph — tree-sitter (nền — TF bổ sung LSP)
// ✅ packages/ai embedding — semantic (nền — TF fallback index)

// ❌ THIẾU: LSP client (rust-analyzer/jdtls/pyright integration)
// ❌ THIẾU: semantic-index fallback (embedding + symbol heuristic)
// ❌ THIẾU: trust-merge (LSP result wins, semantic tag lower-trust)
// ❌ THIẾU: coverage tracker (LSP hit-rate, semantic fill-rate)
```

## Implementation

```typescript
// packages/agent/src/hybrid-resolution.ts (MỚI)
interface Resolution { symbol: string; location: string; trust: 'high' | 'med'; source: 'lsp' | 'semantic' }

class HybridLspSemantic {
  constructor(
    private lspResolve: (symbol: string) => Promise<string | null>, // gotoDefinition
    private semanticResolve: (symbol: string) => Promise<string | null>, // embedding+heuristic
  ) {}

  async resolve(symbol: string): Promise<Resolution | null> {
    // 1. LSP first (deterministic, high-trust)
    const lspLoc = await this.lspResolve(symbol);
    if (lspLoc) return { symbol, location: lspLoc, trust: 'high', source: 'lsp' };

    // 2. semantic fallback (cover gap)
    const semLoc = await this.semanticResolve(symbol);
    if (semLoc) return { symbol, location: semLoc, trust: 'med', source: 'semantic' };

    return null; // unresolved
  }

  // batch: resolve many, track coverage
  async resolveBatch(symbols: string[]): Promise<{ resolutions: Resolution[]; lspHitRate: number }> {
    const resolutions = await Promise.all(symbols.map(s => this.resolve(s)));
    const valid = resolutions.filter(Boolean) as Resolution[];
    const lspHits = valid.filter(r => r.source === 'lsp').length;
    return { resolutions: valid, lspHitRate: valid.length ? lspHits / valid.length : 0 };
  }
}

// Usage:
// const r = await resolver.resolve('parseToken');
// → { location:'src/token.rs:42', trust:'high', source:'lsp' }  (LSP hit)
// if LSP miss → { location:'src/token.rs:42', trust:'med', source:'semantic' }
// coverage: lspHitRate = % resolved by LSP (rest = semantic fill)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic khi có LSP (high-trust) | ❌ LSP setup cost (language server per lang) |
| ✅ Semantic fallback (cover gap, no miss) | ❌ Semantic false-positive (embedding match sai) |
| ✅ Full coverage (LSP mainstream + semantic rest) | ❌ Latency (LSP cold-start chậm) |
| ✅ Trust-merge (LSP wins, semantic tag) | ❌ Index maintenance (LSP + semantic reindex) |

## Khác các hướng gần

| | MJ AST-Knowledge-Graph | LSP-thuần | TF: Hybrid-LSP-Semantic |
|---|---|---|---|
| Cái gì | tree-sitter graph | Language server only | **LSP first + semantic fallback** |
| Determinism | tree-sitter | ✅ (LSP) | **✅ (LSP) + fallback** |
| Coverage | Syntax only | Có LSP mới được | **Full (LSP + semantic gap)** |

## Khi nào chọn

- Cần symbol resolution chính xác (goto-def/find-refs) đa ngôn ngữ
- Có LSP cho主流 ngôn ngữ nhưng không cover hết (cross-lang/legacy)
- Muốn deterministic khi có thể + graceful fallback
- Nối packages/tools find + MJ AST-Code-Knowledge-Graph (tree-sitter) + packages/ai embedding (semantic); guard LSP cold-start (warm/indexahead), semantic precision (embedding false-positive filter), và index freshness (reindex khi code đổi); TF = hybrid LSP + semantic, kết hợp 525 graph-edge-provenance (LSP = trust-high source) + 528 retrieval-trajectory (phơi resolver layer)
