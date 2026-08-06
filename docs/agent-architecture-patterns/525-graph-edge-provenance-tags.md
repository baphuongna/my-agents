# Hướng TE: Graph-Edge Provenance Tags — mỗi edge code-graph mang provenance (origin/commit/tool)

> **Nguồn gốc:** graphify `graphify/symbol_resolution.py` (`ImportedSymbol` — `local_name`, `imported_name`, `module_stem`, `source_file`, `source_location`), `graphify/ids.py` (`make_id`), `graphify/dedup.py`, `paths.py` (`disambiguate_ambiguous_candidates`); "deterministic symbol resolution evidence"; "edge provenance — origin/commit/tool"; "disambiguate with evidence" | **Coupling:** 🟢 — thêm provenance tag vào mỗi code-graph edge (origin/commit/tool/timestamp) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (code-graph + symbol resolution sẵn — chưa có edge-provenance tag + audit) | **Effort:** 2-3 tuần

## Nguồn gốc

**graphify** giải quyết symbol cross-file **deterministic** bằng **evidence**: mỗi symbol resolution mang **provenance** — `source_file` (file nào định nghĩa), `source_location` (vị trí), `module_stem` (module nguồn). Mở rộng ra **mỗi edge trong code-graph** đều mang **provenance tag**: **origin** (import / co-change / call), **commit** (commit nào tạo edge), **tool** (graphify / agent-edit / lsp), **timestamp**. Mục đích: edge không mù — biết **tại sao edge tồn tại** (ai tạo, khi nào, nguồn gì) → audit, trust, disambiguate. Nguyên tắc: **edge có nguồn** — không phải edge ma; provenance cho traceability + dedup (cùng edge từ nhiều nguồn → merge). Khác **523 community-detection** (gom cụm) — TE là **per-edge provenance**; khác graph thuần — TE **tagged, auditable**.

## Mô tả

mya graph-edge provenance tags: (1) **Edge create**: mỗi edge (import/co-change/call) gắn provenance `{ origin, commit, tool, ts }`. (2) **Multi-source merge**: cùng edge từ nhiều nguồn (import + co-change) → merge provenance list (không trùng lặp edge). (3) **Audit**: query edge → thấy toàn bộ nguồn (ai tạo, khi nào). (4) **Trust**: edge từ LSP (deterministic) > edge từ heuristic > edge từ LLM-guess. (5) **Dedup**: provenance trùng → gộp. mya có code-graph + symbol resolution — TE thêm **provenance tagger** + **multi-source merger** + **audit query**.

## Kiến trúc

```
  CODE-GRAPH EDGE: parser.rs ──imports── token.rs
        │
        ▼
  ┌─── PROVENANCE TAG (mỗi edge) ────────────────────────┐
  │  origin:   "import"  (hoặc co-change / call)           │
  │  commit:   "abc123"  (commit nào tạo)                  │
  │  tool:     "lsp"     (lsp > heuristic > llm-guess)     │
  │  ts:       2026-08-06                                   │
  │  source:   parser.rs:5  (vị trí import)                │
  └───────────────────────┬─────────────────────────────┘
                          │ (multi-source)
                          ▼
  ┌─── MULTI-SOURCE MERGE ───────────────────────────────┐
  │  edge import (lsp, commit abc123)                      │
  │  + edge co-change (git-log, commits [def456, ghi789])  │
  │  → 1 edge, provenance list = [import/lsp, cochange/git]│
  └───────────────────────┬─────────────────────────────┘
                          │ (audit query)
                          ▼
  ┌─── AUDIT (edge → toàn bộ nguồn) ──────────────────────┐
  │  "tại sao parser.rs↔token.rs?"                          │
  │  → import (lsp, abc123) + co-change (git, 3 commits)   │
  │  → trust HIGH (lsp deterministic)                      │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ MJ AST-Code-Knowledge-Graph — code-graph (nền — TE tag edge)
// ✅ graphify symbol_resolution — deterministic resolution (nền — TE evidence)
// ✅ bash git log — commit info (nền — TE commit provenance)

// ❌ THIẾU: provenance tagger (origin/commit/tool/ts per edge)
// ❌ THIẾU: multi-source merger (cùng edge nhiều nguồn → merge list)
// ❌ THIẾU: audit query (edge → all provenance)
// ❌ THIẾU: trust rank (lsp > heuristic > llm-guess)
```

## Implementation

```typescript
// packages/agent/src/edge-provenance.ts (MỚI)
type EdgeOrigin = 'import' | 'cochange' | 'call';
type EdgeTool = 'lsp' | 'heuristic' | 'llm-guess' | 'git';
interface Provenance { origin: EdgeOrigin; commit: string; tool: EdgeTool; ts: number; source: string }

const TRUST: Record<EdgeTool, number> = { lsp: 3, git: 2, heuristic: 1, 'llm-guess': 0 };

class EdgeProvenance {
  // edge key → provenance list (multi-source)
  private edges = new Map<string, Provenance[]>();

  private key(from: string, to: string): string { return `${from}→${to}`; }

  // tag edge with provenance (merge if exists)
  tag(from: string, to: string, p: Provenance): void {
    const k = this.key(from, to);
    const list = this.edges.get(k) ?? [];
    // dedup: skip if same origin+commit already tagged
    if (!list.some(e => e.origin === p.origin && e.commit === p.commit)) list.push(p);
    this.edges.set(k, list);
  }

  // audit: all provenance for an edge
  audit(from: string, to: string): Provenance[] {
    return this.edges.get(this.key(from, to)) ?? [];
  }

  // trust rank (highest tool trust)
  trust(from: string, to: string): number {
    const list = this.audit(from, to);
    return list.length ? Math.max(...list.map(p => TRUST[p.tool])) : -1;
  }
}

// Usage:
// provenance.tag('parser.rs', 'token.rs', { origin:'import', commit:'abc123', tool:'lsp', ts:now, source:'parser.rs:5' });
// provenance.tag('parser.rs', 'token.rs', { origin:'cochange', commit:'def456', tool:'git', ts:now, source:'git-log' });
// provenance.audit('parser.rs','token.rs') → [import/lsp, cochange/git]
// provenance.trust(...) → 3 (lsp highest)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Edge có nguồn (audit, traceability) | ❌ Provenance overhead (tag mỗi edge) |
| ✅ Trust rank (lsp > heuristic > llm) | ❌ Provenance stale (commit cũ chưa prune) |
| ✅ Multi-source merge (không trùng edge) | ❌ Merge conflict (nguồn trái chiều) |
| ✅ Disambiguate (evidence-based) | ❌ Storage (provenance list phình) |

## Khác các hướng gần

| | MJ AST-Knowledge-Graph | 523 Community-Detection | TE: Edge-Provenance |
|---|---|---|---|
| Cái gì | Symbol graph | Gom cụm | **Per-edge nguồn tag** |
| Edge | Mù (chỉ from/to) | ❌ | **origin/commit/tool/ts** |
| Audit | ❌ | ❌ | **✅ edge → all sources** |

## Khi nào chọn

- Code-graph cần audit (biết edge từ đâu, trust bao nhiêu)
- Nhiều nguồn tạo edge (lsp + git + heuristic) → cần merge + rank
- Muốn disambiguate deterministic (evidence-based)
- Nối MJ AST-Code-Knowledge-Graph + graphify symbol_resolution (evidence) + git log (commit); guard provenance freshness (prune commit cũ), merge correctness (nguồn trái chiều → flag), và trust calibration (lsp reliable, llm-guess low); TE = edge provenance cho code-graph, kết hợp 523 community-detection (cụm từ tagged graph) + 526 hybrid-lsp (lsp làm nguồn trust cao)
