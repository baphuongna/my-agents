# Hướng PH: Cross-Agent Session Library — thư viện session chung Pi/Codex/Claude, index/search/recover

> **Nguồn gốc:** pi-session-manager (browser-dataset, sessions.ts, search.ts, stats.ts, inspect.ts); "cross-agent session library"; "unified session index"; "multi-provider session recovery"; "JSONL session parsing"
> **Coupling:** 🟡 — thêm session library layer (index/search/recover) bên trên transport/session store
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pi-session-manager dataset cache + search + stats sẵn — chưa có multi-provider adapter trong mya)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**pi-session-manager** (`browser-dataset/core.ts`, `sessions.ts`, `search.ts`) quản lý session như **thư viện thống nhất** — bất kể agent tạo session (Pi, Codex, Claude, Cursor…), đều được **index → search → recover**. Dataset cache (`core.ts`) load session JSONL → parse entries → build `RemoteDatasetCache` (sessionByPath Map) với background refresh (initial batch 24 files, background batch 24). `search.ts` search full-text trong session content. `stats.ts` aggregate tokens/cost/tool-calls/model usage. `inspect.ts` parse entry types (session_info, compaction, custom, message) + extract trace analytics (events timeline, tool call→result linking qua toolCallId). Nguyên tắc: **session là data, không phụ thuộc agent** — index một lần, search/recover bất kể nguồn. Khác **10 kanban** (task board) — PH là **session library**; khác **94 trajectory-replay** (replay trajectory) — PH là **library/search/recover**.

## Mô tả

mya cross-agent session library: mọi session (Pi/Codex/Claude/…) → **unified library** — (1) **Index**: adapter parse mỗi provider's session format (JSONL) → unified entry format (header, message, compaction, branch_summary, custom). (2) **Search**: full-text search trong session content (query → matching sessions/entries). (3) **Stats**: aggregate tokens (input/output/cacheRead/cacheWrite), cost, tool-call counts, model usage, files read/written/edited. (4) **Recover**: load session → reconstruct conversation → resume hoặc inspect. (5) **Cache**: dataset cache với background refresh (initial batch + background batch) — không block. Agent có thể query "tìm session nào edit file X" hoặc "session nào dùng nhiều token nhất" — bất kể agent nào tạo. mya có session store — PH thêm **cross-agent library** (adapter + index + search + stats).

## Kiến trúc

```
  SESSIONS (multi-provider):
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ Pi JSONL     │  │ Codex JSONL  │  │ Claude JSONL │
  │ .pi/sessions │  │ .codex/sess  │  │ .claude/sess │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         │                 │                 │
         ▼                 ▼                 ▼
  ┌─── PROVIDER ADAPTERS ──────────────────────────────┐
  │  Pi adapter    → parse JSONL → unified entries       │
  │  Codex adapter → parse JSONL → unified entries       │
  │  Claude adapter→ parse JSONL → unified entries       │
  │  (each normalizes to: header, message, compaction,   │
  │   branch_summary, custom)                             │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── UNIFIED SESSION LIBRARY (dataset cache) ────────┐
  │                                                      │
  │  sessionByPath: Map<path, RemoteDatasetSession>      │
  │  ┌────────────────────────────────────────────────┐ │
  │  │ path │ info │ entries[] │ fileSize │ content    │ │
  │  └────────────────────────────────────────────────┘ │
  │                                                      │
  │  Background refresh: initial 24 + background 24      │
  └──────────┬───────────────────────┬───────────────────┘
             │                       │
             ▼                       ▼
  ┌─── SEARCH ───────────┐  ┌─── STATS ─────────────────┐
  │  full-text search    │  │  tokens: input/output/     │
  │  "edit file X"       │  │    cacheRead/cacheWrite    │
  │  → matching sessions │  │  cost: per-model aggregate │
  │                      │  │  tool calls: counts/name   │
  │  RECOVER:            │  │  files: read/written/edit  │
  │  load → reconstruct  │  │  models: primary + all     │
  │  → resume/inspect    │  │  compaction count          │
  └──────────────────────┘  └────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session store (packages/core) — session persistence (nền — PH = cross-agent library)
// ✅ 94 trajectory-replay — replay trajectory (nền — PH = library/search/recover)
// ✅ pi-session-manager dataset cache + search + stats (source/ — reference impl)

// ❌ THIẾU: provider adapters (Pi/Codex/Claude JSONL → unified entries)
// ❌ THIẾU: unified session index (sessionByPath, dataset cache)
// ❌ THIẾU: cross-agent search (full-text across providers)
// ❌ THIẾU: stats aggregate (tokens/cost/tools/models per session)
// ❌ THIẾU: recover (load session → reconstruct → resume/inspect)
```

## Implementation

```typescript
// packages/agent/src/session-library.ts (MỚI — port từ pi-session-manager)
type Provider = 'pi' | 'codex' | 'claude' | 'cursor';

interface SessionEntry {
  id: string;
  type: 'header' | 'message' | 'compaction' | 'branch_summary' | 'custom';
  timestamp: string;
  message?: { role: string; content: unknown; usage?: UsageData };
  // ... provider-specific fields normalized
}

interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  name: string | null;
  created: string;
  modified: string;
  provider: Provider;
}

interface IndexedSession {
  info: SessionInfo;
  content: string;
  entries: SessionEntry[];
  fileSize: number;
}

// Provider adapter: parse provider-specific JSONL → unified entries
function parseSession(path: string, raw: string, provider: Provider): IndexedSession {
  const lines = raw.split('\n').filter(Boolean);
  const entries: SessionEntry[] = lines.map((line) => {
    const json = JSON.parse(line);
    return normalizeEntry(json, provider); // each provider has different schema
  });
  const header = entries[0] as any;
  return {
    info: {
      id: header?.id ?? path,
      path,
      cwd: header?.cwd ?? '',
      name: header?.name ?? null,
      created: header?.timestamp ?? entries[0]?.timestamp ?? '',
      modified: entries[entries.length - 1]?.timestamp ?? '',
      provider,
    },
    content: raw,
    entries,
    fileSize: raw.length,
  };
}

// Library: index + search + stats + recover
class SessionLibrary {
  private byPath = new Map<string, IndexedSession>();

  index(path: string, raw: string, provider: Provider): void {
    this.byPath.set(path, parseSession(path, raw, provider));
  }

  // Full-text search across all sessions (all providers)
  search(query: string): IndexedSession[] {
    const q = query.toLowerCase();
    return [...this.byPath.values()].filter((s) =>
      s.content.toLowerCase().includes(q),
    );
  }

  // Stats: aggregate tokens/cost/tools per session
  stats(path: string): SessionStats {
    const session = this.byPath.get(path);
    if (!session) throw new Error(`Session not found: ${path}`);
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    let toolCalls = 0, errors = 0;
    const models = new Map<string, number>();
    for (const entry of session.entries) {
      const usage = entry.message?.usage;
      if (usage) {
        input += usage.input ?? 0;
        output += usage.output ?? 0;
        cacheRead += usage.cacheRead ?? 0;
        cacheWrite += usage.cacheWrite ?? 0;
      }
      // Count tool calls, errors, models...
    }
    return { input, output, cacheRead, cacheWrite, toolCalls, errors,
      models: [...models.keys()] };
  }

  // Recover: load session → reconstruct conversation
  recover(path: string): SessionEntry[] {
    return this.byPath.get(path)?.entries ?? [];
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cross-agent (Pi/Codex/Claude — 1 thư viện chung) | ❌ Adapter maintenance (mỗi provider schema khác → adapter riêng) |
| ✅ Search (full-text — "tìm session nào edit X") | ❌ Index cost (parse + cache tất cả session) |
| ✅ Stats (tokens/cost/tools — biết session nào đắt) | ❌ Format drift (provider đổi JSONL schema → adapter break) |
| ✅ Recover (load → reconstruct → resume/inspect) | ❌ Privacy (cross-agent = chia session — cần consent) |

## Khác các hướng gần

| | 94 Trajectory-Replay | 10 Kanban-Board | PH: Session-Library |
|---|---|---|---|
| Cái gì | Replay trajectory | Task board | **Cross-agent session index** |
| Scope | 1 session | Tasks | **Mọi provider session** |
| Search | ❌ | ❌ | ✅ full-text |
| Stats | ❌ | ❌ | ✅ tokens/cost/tools |

## Khi nào chọn

- Đa provider (Pi/Codex/Claude — muốn thư viện session chung)
- Muốn search session ("tìm session nào edit file X" — bất kể agent)
- Muốn stats (tokens/cost — biết session nào đắt/tiện)
- Muốn recover (resume session cũ hoặc inspect)
- Nối 94 trajectory-replay (PH = library cung cấp data cho replay) + session store (PH = cross-agent layer); guard adapter format drift (provider đổi schema → adapter phải update)
