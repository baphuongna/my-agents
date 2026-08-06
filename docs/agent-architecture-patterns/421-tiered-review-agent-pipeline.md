# Hướng PE: Tiered Review Agent Pipeline — 3-agent review (GitHub/PR) + LSP stale-comment detection

> **Nguồn gốc:** codebase-memory-mcp (knowledge graph, review_change_impact prompt, tree-sitter AST, LSP); multi-agent tiered review patterns; "PR review automation"; "stale code comment detection via LSP"; "impact cascade diagnostics"
> **Coupling:** 🟡 — thêm 3-agent review pipeline + graph-based stale detection vào code-review orchestrator
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (codebase-memory-mcp graph + impact analysis sẵn — chưa có 3-tier agent pipeline + stale-comment guard)
> **Effort:** 2-3 tuần

## Nguồn gốc

**codebase-memory-mcp** xây knowledge graph từ tree-sitter AST (158 ngôn ngữ) — mỗi function/class/call-chain là node, mỗi edge là quan hệ (call, contain, import). Tool `review_change_impact` dùng graph để **truy vết cascade** — khi một symbol đổi, graph trả về mọi file/node bị ảnh hưởng (impact analysis), thay vì phải grep thủ công. **Hybrid LSP** giải semantic type resolution cho 10 ngôn ngữ (TS/JS, Python, Go, Rust, C#…). Nguyên tắc review: **3 tầng agent** — (1) **Structural** agent dùng graph kiểm tra call-chain, dead code, cross-service HTTP links; (2) **Semantic** agent dùng LSP check type errors, stale comments (comment tham chiếu symbol đã đổi/xóa — graph biết symbol đổi, LSP biết comment ở đâu); (3) **Advisory** agent tổng hợp thành review comment trên GitHub PR. **Stale-comment detection**: graph biết symbol nào đổi (diff → node change), LSP biết comment nào reference symbol đó → nếu symbol đổi mà comment không đổi = stale. Khác **87 agent-topology** (topology chung) — PE là **review-specific pipeline**; khác **84 llm-as-judge** (judge 1 output) — PE là **3-tier parallel review**.

## Mô tả

mya tiered review agent pipeline: khi có PR/diff → **3-tier agent review** — (1) **Structural tier**: agent query codebase-memory-mcp graph (impact analysis, dead code, call-chain, cross-service links) → structural findings. (2) **Semantic tier**: agent dùng LSP diagnostics (type errors, unused imports) + **stale-comment detection** (graph biết symbol đổi → tìm comment reference symbol đó → flag stale). (3) **Advisory tier**: agent tổng hợp structural + semantic → viết GitHub PR review comment (actionable, specific line). Pipeline **parallel** (tier 1+2 chạy song song, tier 3 đợi cả hai) và **deduplicated** (cùng finding từ 2 tier → 1 comment). mya có **87 agent-topology** + **84 llm-as-judge** + code-review skills — PE thêm **3-tier review pipeline** + **graph-based stale-comment detection**.

## Kiến trúc

```
  PR / DIFF:
  "feat: rename getUser() to fetchUser()"
        │
        ├──► STRUCTURAL TIER (graph agent) ─────────────┐
        │   • query graph: impact cascade                │
        │   • who calls getUser()? → 5 files             │
        │   • dead code? orphaned routes?                │
        │   • cross-service HTTP links?                  │
        │                                                 │ findings
        ├──► SEMANTIC TIER (LSP agent) ─────────────────┤
        │   • LSP diagnostics: type errors               │
        │   • STALE COMMENT detection:                   │
        │     graph: symbol getUser changed              │
        │     LSP: comment "// uses getUser" at line 42  │
        │     → STALE (comment ref changed symbol)       │
        │                                                 │
        ▼                                                 ▼
  ┌─── ADVISORY TIER (synthesis agent) ────────────────────┐
  │                                                         │
  │  merge structural + semantic findings                   │
  │  dedup (same finding from 2 tiers → 1 comment)          │
  │  rank by severity (blocking / warning / nit)            │
  │  map to PR line (graph → file:line)                     │
  │                                                         │
  │  → post GitHub PR review (3 blocking, 2 warning, 1 nit) │
  └─────────────────────────────────────────────────────────┘

  STALE-COMMENT DETECTION (cross-tier signal):
    graph change: getUser → fetchUser (renamed)
    comment scan: "// relies on getUser signature"
    → STALE: comment references renamed symbol
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 87 agent-topology — multi-agent topology (nền — PE = review-specific topology)
// ✅ 84 llm-as-judge — judge output (nền — PE = 3-tier review)
// ✅ code-review skills — review patterns (nền)
// ✅ codebase-memory-mcp graph (source/ — impact analysis, call-chain, dead code)
// ✅ pi-lens LSP diagnostics (source/ — type errors, semantic analysis)

// ❌ THIẾU: 3-tier review pipeline (structural → semantic → advisory)
// ❌ THIẾU: graph-based stale-comment detection (symbol changed → comment stale)
// ❌ THIẾU: cross-tier dedup (same finding from 2 tiers → 1 comment)
// ❌ THIẾU: PR line mapping (graph finding → file:line for GitHub comment)
```

## Implementation

```typescript
// packages/agent/src/tiered-review.ts (MỚI)
type ReviewTier = 'structural' | 'semantic' | 'advisory';
type Severity = 'blocking' | 'warning' | 'nit';

interface ReviewFinding {
  tier: ReviewTier;
  file: string;
  line: number;
  message: string;
  severity: Severity;
  symbolRef?: string;     // graph symbol this finding references
  isStaleComment?: boolean; // stale-comment detection flag
}

interface DiffSummary {
  changedFiles: Array<{ path: string; symbolsChanged: string[] }>;
}

class TieredReviewPipeline {
  // Tier 1: Structural — graph-based impact analysis
  async runStructural(diff: DiffSummary): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    for (const file of diff.changedFiles) {
      for (const symbol of file.symbolsChanged) {
        // Query graph: who calls this symbol? (impact cascade)
        const callers = await graphQuery('impact', symbol);
        for (const caller of callers) {
          findings.push({
            tier: 'structural', file: caller.file, line: caller.line,
            message: `Calls changed symbol "${symbol}" — verify signature`,
            severity: 'warning', symbolRef: symbol,
          });
        }
        // Dead code: symbol removed but still referenced?
        const orphans = await graphQuery('dead_code', symbol);
        orphans.forEach((o) => findings.push({
          tier: 'structural', file: o.file, line: o.line,
          message: `References removed symbol "${symbol}"`,
          severity: 'blocking', symbolRef: symbol,
        }));
      }
    }
    return findings;
  }

  // Tier 2: Semantic — LSP diagnostics + stale-comment detection
  async runSemantic(diff: DiffSummary): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    // LSP type errors on changed files
    const diags = await lspDiagnostics(diff.changedFiles.map((f) => f.path));
    diags.forEach((d) => findings.push({
      tier: 'semantic', file: d.file, line: d.line,
      message: d.message, severity: d.severity === 'error' ? 'blocking' : 'warning',
    }));
    // Stale-comment detection: symbol changed → comment references it?
    for (const file of diff.changedFiles) {
      for (const symbol of file.symbolsChanged) {
        const staleComments = await findCommentsReferencing(symbol, file.path);
        staleComments.forEach((c) => findings.push({
          tier: 'semantic', file: file.path, line: c.line,
          message: `Stale comment references "${symbol}" which was changed`,
          severity: 'nit', symbolRef: symbol, isStaleComment: true,
        }));
      }
    }
    return findings;
  }

  // Tier 3: Advisory — merge + dedup + post review
  async runAdvisory(
    structural: ReviewFinding[],
    semantic: ReviewFinding[],
  ): Promise<ReviewFinding[]> {
    const all = [...structural, ...semantic];
    // Dedup: same file+line+symbolRef from 2 tiers → keep highest severity
    const deduped = dedupFindings(all);
    // Rank: blocking > warning > nit
    return deduped.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }
}

// Usage:
// const [structural, semantic] = await Promise.all([
//   pipeline.runStructural(diff), pipeline.runSemantic(diff),
// ]);
// const review = await pipeline.runAdvisory(structural, semantic);
// → post to GitHub PR
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân tích sâu (graph structural + LSP semantic — 2 góc nhìn) | ❌ 3 agent = 3× cost (mỗi tier chạy LLM) |
| ✅ Stale-comment detection (graph biết symbol đổi → flag comment cũ) | ❌ Graph index cost (full-index repo mỗi lần) |
| ✅ Dedup (2 tier cùng finding → 1 comment — không spam PR) | ❌ False positive stale comment (symbol đổi nhưng comment vẫn đúng) |
| ✅ Actionable (map tới PR line — review comment cụ thể) | ❌ Latency (graph query + LSP + agent synthesis) |

## Khác các hướng gần

| | 84 LLM-as-Judge | 87 Agent-Topology | PE: Tiered-Review |
|---|---|---|---|
| Cái gì | Judge 1 output | Topology chung | **3-tier review pipeline** |
| Signal | LLM opinion | Agent arrangement | **Graph + LSP** |
| Stale detection | ❌ | ❌ | ✅ symbol changed → comment |
| Parallel tiers | ❌ | Tùy | ✅ structural ‖ semantic |

## Khi nào chọn

- Cần code review tự động trên PR (actionable, line-specific)
- Có codebase-memory-mcp graph (structural analysis) + LSP (semantic analysis)
- Muốn phát hiện stale comment (comment tham chiếu symbol đã đổi/xóa)
- Nối 87 agent-topology (PE = review-specific 3-tier topology) + 84 llm-as-judge (advisory tier = judge) + pi-lens (LSP semantic tier); graph + LSP phải sẵn — guard false positive (stale comment nhưng nội dung vẫn đúng → cần agent confirm)
