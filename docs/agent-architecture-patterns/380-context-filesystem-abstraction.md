# Hướng NP: Context Filesystem Abstraction — memory/resource/skill là virtual FS (viking://)

> **Nguồn gốc:** OpenViking; "virtual filesystem" (FUSE, procfs); "content-addressable storage" (23); "semantic filesystem"; "knowledge graph as FS" (89); "plan9 namespace"; "hierarchical retrieval" (165); "tiered loading" (L0/L1/L2)
> **Coupling:** 🟡 — cần virtual FS layer + tiered processing pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory + file tools sẵn — chưa có viking:// virtual FS)
> **Effort:** 3-4 tuần

## Nguồn gốc

**Virtual filesystem** (Plan9, FUSE): mọi resource trông như file → `ls`, `cat`, `find`. OpenViking áp dụng cho **agent context**: memory, resource, skill đều là virtual files dưới `viking://` protocol. Agent browse context như developer browse codebase — `viking://resources/my_project/docs/api/`, `viking://user/alice/memories/preferences/writing_style`. **Tiered loading**: mỗi entry processed thành 3 tầng — L0 (abstract, ~100 tok: quick relevance check), L1 (overview, ~2k tok: structure + key points), L2 (details: full content, load on demand). Giống **165 hierarchical-memory** (multi-level memory) nhưng là **filesystem metaphor** (ls/tree/find). Giống **88 hybrid-graph-vector-memory** (graph + vector) nhưng browse như FS. Nguyên lý: **agent browse context deterministically** (ls + find) thay vì query black-box vector store.

## Mô tả

mya context filesystem abstraction: context types (memory, resource, skill) mounted dưới `viking://` virtual FS. Agent dùng `ls`/`tree`/`find` để navigate, `read` để load content. **Directory recursive retrieval**: vector search tìm highest-scoring directory → drill down layer by layer (L0 → L1 → L2). Mỗi directory có `.abstract` (L0) + `.overview` (L1) → judge relevance trước khi load full file. Session commit → extract preferences/experience → write vào `viking://user/*/memories/`. Nối 165 hierarchical-memory + 88 graph-vector-memory + 276 procedural-memory.

## Kiến trúc

```
  viking://  (virtual filesystem — agent browses like codebase)
  ├── resources/                    # project docs, repos, web pages
  │   └── my_project/
  │       ├── .abstract             # L0: ~100 tok — "React web app with auth"
  │       ├── .overview             # L1: ~2k tok — structure + key points
  │       └── docs/
  │           ├── .abstract         # L0 per directory
  │           ├── .overview         # L1 per directory
  │           └── api/
  │               ├── auth.md       # L2: full content (load on demand)
  │               └── endpoints.md
  └── user/
      └── {user_id}/
          ├── memories/
          │   └── preferences/
          │       ├── writing_style # L0: "concise, technical"
          │       └── coding_habits
          ├── skills/
          │   ├── search_code       # L0: "grep + AST search"
          │   └── analyze_data
          └── peers/

  AGENT RETRIEVAL (directory recursive):
  ┌──────────────────────────────────────────────────┐
  │  1. Vector search → highest-scoring directory    │
  │     viking://resources/my_project/docs/ (L0)     │
  │                                                   │
  │  2. Drill down: read .abstract → relevant?       │
  │     → viking://.../api/ (L0)                     │
  │                                                   │
  │  3. Read .overview (L1) → which file?            │
  │     → auth.md                                    │
  │                                                   │
  │  4. Read full content (L2) only when needed      │
  │     → token-efficient: L0+L1 cost ~2k, L2 = full │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 165 hierarchical-memory — multi-level memory (nền — NP = FS metaphor)
// ✅ 88 hybrid-graph-vector-memory — graph + vector (nền — NP = vector search + FS)
// ✅ 276 procedural-memory — skill memory (nền — NP skills/ dir)
// ✅ file tools (read/ls/grep) — sẵn (NP maps to viking://)
// ✅ 83 tool-discovery — find tools (nền — NP find command)

// ❌ THIẾU: viking:// virtual FS protocol
// ❌ THIẾU: tiered processing pipeline (L0/L1/L2 on write)
// ❌ THIẾU: directory recursive retrieval (vector → drill down)
// ❌ THIẾU: .abstract/.overview generation per directory
// ❌ THIẾU: session → memory extraction (preferences/experience)
```

## Implementation

```typescript
// packages/agent/src/context-fs.ts (NEW)
type ContextType = 'memory' | 'resource' | 'skill';

interface ContextEntry {
  uri: string;          // viking://resources/my_project/docs/api/auth.md
  type: ContextType;
  tiers: {
    L0?: string;  // abstract (~100 tok)
    L1?: string;  // overview (~2k tok)
    L2?: string;  // full content (on demand)
  };
}

class ContextFilesystem {
  private entries = new Map<string, ContextEntry>();

  // Browse: ls a virtual directory
  ls(uri: string): string[] {
    const prefix = uri.endsWith('/') ? uri : uri + '/';
    return [...this.entries.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length).split('/')[0]!)
      .filter((v, i, a) => a.indexOf(v) === i); // unique
  }

  // Read: load content at specified tier
  read(uri: string, tier: 'L0' | 'L1' | 'L2' = 'L1'): string | null {
    const entry = this.entries.get(uri);
    return entry?.tiers[tier] ?? null;
  }

  // Write: process content into 3 tiers on ingest
  async write(uri: string, type: ContextType, fullContent: string): Promise<void> {
    const L0 = await this.summarize(fullContent, 100); // ~100 tok abstract
    const L1 = await this.summarize(fullContent, 2000); // ~2k tok overview
    this.entries.set(uri, { uri, type, tiers: { L0, L1, L2: fullContent } });
    // Also generate .abstract/.overview for parent directories
    await this.updateDirectoryAbstracts(uri);
  }

  // Directory recursive retrieval: vector search → drill down
  async retrieve(query: string): Promise<string[]> {
    // 1. Vector search across all L0 abstracts → highest-scoring directory
    const topDir = await this.vectorSearch(query, 'L0');
    // 2. Read L0 of children → drill to relevant subdirectory
    const children = this.ls(topDir);
    let best = topDir;
    for (const child of children) {
      const childL0 = this.read(`${topDir}/${child}`, 'L0');
      if (childL0 && await this.isRelevant(query, childL0)) best = `${topDir}/${child}`;
    }
    // 3. Read L1 overview → identify specific file
    // 4. Read L2 full content only when needed
    const overview = this.read(best, 'L1');
    return overview ? [overview] : [];
  }

  // Session commit → extract memory
  async extractFromSession(sessionLog: string, userId: string): Promise<void> {
    const preferences = await this.extractPreferences(sessionLog);
    for (const [key, value] of Object.entries(preferences)) {
      await this.write(`viking://user/${userId}/memories/preferences/${key}`, 'memory', value);
    }
  }

  private async summarize(content: string, maxTokens: number): Promise<string> { return content.slice(0, maxTokens * 4); }
  private async updateDirectoryAbstracts(uri: string): Promise<void> {}
  private async vectorSearch(query: string, tier: string): Promise<string> { return 'viking://'; }
  private async isRelevant(query: string, content: string): Promise<boolean> { return true; }
  private async extractPreferences(log: string): Promise<Record<string, string>> { return {}; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic browsing (ls/tree/find, not black-box vector) | ❌ Tiered processing cost (L0+L1 generation on write) |
| ✅ Token-efficient (L0/L1 cheap, L2 only when needed) | ❌ Virtual FS complexity (mount/protocol layer) |
| ✅ Observable retrieval (trajectory visible — debug-friendly) | ❌ Directory abstract maintenance (regenerate on change) |
| ✅ Unified (memory + resource + skill = one FS) | ❌ Cold start (empty FS → no retrieval until ingested) |

## Khác các hướng gần

| | 165 Hierarchical-Memory | 88 Graph-Vector-Memory | 276 Procedural-Memory | NP: Context-FS |
|---|---|---|---|---|
| Metaphor | Layers | Graph | Skill store | **Virtual filesystem (viking://)** |
| Browse | ❌ | Graph query | ❌ | **ls/tree/find** |
| Tier | ✅ (levels) | ❌ | ❌ | **L0/L1/L2 tiered loading** |

## Khi nào chọn

- Agent cần browse context deterministically (not black-box vector store)
- Token-efficient retrieval (L0 cheap relevance, L2 load on demand)
- Unified context (memory + resource + skill = one FS namespace)
- Nối 165 hierarchical-memory (tiered) + 88 graph-vector (retrieval) + 276 procedural (skills/) + 82 memory-consolidation (session → memory)
