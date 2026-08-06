# Hướng UP: Search-Site-Module Routing — web-search-agent bắt buộc load source-module theo loại query trước khi WebSearch

> **Nguồn gốc:** Deep-Research-skills `web-search-agent/` (`source_modules/`: `github.md`, `stackoverflow.md`, `academic.md`, `chinese-tech.md`); "load source-module by query type before WebSearch"; "site-specific search strategy"; "routing rule" | **Coupling:** 🟢 — thêm source-module router vào search agent (classify query → load module → site-restricted search) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tools search sẵn — chưa có source-module loader + query router) | **Effort:** 2-3 tuần

## Nguồn gốc

**Deep-Research-skills** khi web-search không search chung chung — mà **route theo loại query**: query về code → load `github.md` module (chỉ search `site:github.com`, dùng syntax code search); query học thuật → load `academic.md` (`site:arxiv.org`, scholar); query Q&A → `stackoverflow.md`; query tech Trung Quốc → `chinese-tech.md`. Mỗi **source-module** là 1 file hướng dẫn: **site restriction** + **search syntax** + **ranking heuristic** riêng. Nguyên tắc: **search đúng nơi, đúng cách** — route query → module → site-restricted + syntax-tuned search. Khác generic web search — UP **source-aware routing**.

## Mô tả

mya search-site-module routing: (1) **Classify**: query → loại (code / academic / qa / chinese-tech / general). (2) **Load module**: nạp source-module tương ứng (site restriction + search syntax). (3) **Site-restricted search**: WebSearch chỉ trong site/module quy định. (4) **Module heuristic**: ranking/filter theo module (vd github: ưu tiên starred repo). mya có tools search — UP thêm **query classifier** + **source-module loader** + **site-restricted search**.

## Kiến trúc

```
  QUERY: "how does Raft handle split vote?"
        │
        ▼
  ┌─── CLASSIFY (query → loại) ──────────────────────────┐
  │  code/impl? → github        academic? → scholar        │
  │  Q&A? → stackoverflow       cn-tech? → chinese-tech    │
  │  → classified: "Q&A" (how does X)                      │
  └───────────────────────┬─────────────────────────────┘
                          │ (load module)
                          ▼
  ┌─── SOURCE-MODULE (site + syntax + heuristic) ────────┐
  │  stackoverflow.md:                                     │
  │    site:stackoverflow.com                              │
  │    syntax: "split vote" raft                           │
  │    rank: accepted-answer first                         │
  └───────────────────────┬─────────────────────────────┘
                          │ (site-restricted search)
                          ▼
  ┌─── WebSearch (restricted) ───────────────────────────┐
  │  site:stackoverflow.com "raft split vote"              │
  │  → relevant SO answers (accepted first)                │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools search — WebSearch (nền — UP site-restricted)
// ✅ packages/skills — skill loader (nền — UP source-module load)
// ✅ packages/ai — LLM classify (nền — UP query classify)

// ❌ THIẾU: source-module format (site + syntax + heuristic .md)
// ❌ THIẾU: query classifier (query → module key)
// ❌ THIẾU: site-restricted search builder (module → site: query)
// ❌ THIẾU: module heuristic ranker (filter/rank theo module)
```

## Implementation

```typescript
// packages/tools/src/search-site-router.ts (MỚI)
interface SourceModule {
  key: string; sites: string[]; queryTransform: (q: string) => string;
  rank: (results: SearchResult[]) => SearchResult[];
}
interface SearchResult { url: string; title: string; snippet: string; score: number }

class SearchSiteRouter {
  private modules = new Map<string, SourceModule>();
  constructor(
    private classify: (query: string) => Promise<string>, // query → module key
    private webSearch: (q: string) => Promise<SearchResult[]>,
  ) {}

  register(m: SourceModule): void { this.modules.set(m.key, m); }

  // route query → load module → site-restricted search
  async search(query: string): Promise<SearchResult[]> {
    const key = await this.classify(query);
    const mod = this.modules.get(key) ?? this.modules.get('general')!;
    // build site-restricted query
    const siteQ = mod.sites.length
      ? `${mod.queryTransform(query)} ${mod.sites.map(s => `site:${s}`).join(' OR ')}`
      : mod.queryTransform(query);
    let results = await this.webSearch(siteQ);
    results = mod.rank(results); // module heuristic
    return results;
  }
}

// builtin modules
const GITHUB: SourceModule = {
  key: 'github', sites: ['github.com'],
  queryTransform: q => q,
  rank: rs => rs.sort((a, b) => b.score - a.score), // starred/heuristic
};
const SO: SourceModule = {
  key: 'stackoverflow', sites: ['stackoverflow.com'],
  queryTransform: q => q,
  rank: rs => rs.sort((a, b) => (b.url.includes('accepted') ? 1 : 0) - (a.url.includes('accepted') ? 1 : 0)),
};

// Usage:
// const router = new SearchSiteRouter(classifyLLM, webSearchFn);
// router.register(GITHUB); router.register(SO); router.register(GENERAL);
// const r = await router.search("Raft split vote"); // → SO module → site-restricted
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Search chính xác (site-restricted đúng nơi) | ❌ Classify sai (route nhầm module) |
| ✅ Syntax-tuned (mỗi site có search syntax riêng) | ❌ Module coverage (site không có module → fallback) |
| ✅ Ranking heuristic (ưu tiên theo site logic) | ❌ Over-restriction (chỉ 1 site → thiếu đa dạng) |
| ✅ Module hoá (thêm site = thêm module) | ❌ Maintenance (module syntax đổi → update) |

## Khác các hướng gần

| | Generic WebSearch | 083 Tool-Discovery | UP: Search-Site-Router |
|---|---|---|---|
| Cái gì | Search toàn web | Tìm tool phù hợp | **Route query → site-module** |
| Restriction | ❌ | N/A | **site-restricted + syntax** |
| Ranking | ❌ | ❌ | **per-module heuristic** |

## Khi nào chọn

- Search cần chính xác (code → github, academic → scholar)
- Mỗi loại query có site + syntax tối ưu riêng
- Muốn module hoá (thêm site dễ, không hardcode)
- Nối packages/tools search + packages/skills (module format) + packages/ai (classify); guard classify accuracy (route đúng module), module fallback (site không match → general search), và diversity (cho phép multi-site khi 1 module hạn hẹp); UP = search-site-module routing, kết hợp UO outline-first-research (plan trước) + 88 hybrid-graph-vector-memory (search backend)
