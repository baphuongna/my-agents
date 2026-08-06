# Hướng AIS: GitHub Clone-Not-Scrape — GitHub URL được clone local thay vì scrape HTML; agent nhận real file contents + code-search tool với fallback

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟡 — thêm code-search backend cho web tool | **Agent-agnostic:** ⚠️ (git binary + code-search provider) | **Code sẵn:** ⚠️ (có codegraph + web_fetch; chưa có clone + code-search tool) | **Effort:** 2 tuần

## Nguồn gốc

**pi-web-access** xử lý GitHub URL bằng cách **clone local thay vì scrape HTML**: agent nhận **real file contents** + **local path để explore** (grep/đọc file thật, không phải HTML render). Kèm **code-search tool `get_code_context_exa`** với fallback query builder và **token-trim marker** `[Truncated by code_search to approximately N tokens.]` — context không bao giờ vượt ngân sách token mà không báo rõ.

Nguyên tắc: **repo là source of truth về code — clone cho agent khả năng explore thật** (real files, không phải HTML); scrape chỉ cho nội dung trang, không cho cấu trúc repo; **code-search là tool riêng có token budget rõ** — không đổ cả repo vào context; **fallback chain** — clone fail → code-search → scrape (từng lớp có degrade rõ).

## Mô tả

Với mya, pattern = **GitHub → local clone → explore**: (1) **nhận diện GitHub URL** (github.com/... hoặc raw/permalink) → spawn `git clone --depth 1` vào temp dir (hoặc `git fetch` cho permalink cụ thể); (2) **agent explore local path** bằng tool có sẵn — `glob`, `grep`, `read`, `codegraph` (đã có trong packages/tools) — real file contents thay vì HTML; (3) **code-search tool mới** — `code_search` gọi provider Exa/Tavily code endpoint (nối `packages/tools/src/web/search` chain) với **token-trim marker** rõ ràng khi cắt; (4) **fallback query builder** — nếu search provider không có code index, build query từ tên symbol/đường dẫn (nối `symbol-extractor.ts` có sẵn); (5) **web_fetch vẫn là floor** — GitHub trang HTML chỉ dùng khi clone + search đều fail. Temp dir dọn sau task (nối `disk-cleanup` pattern).

## Kiến trúc (ASCII)

```
  GITHUB URL
    ├─ git clone --depth 1 (temp dir) ──► LOCAL PATH
    │      │  agent explore: glob / grep / read / codegraph (real files)
    │      └─ permalink? ──► git fetch + checkout hash
    ├─ (clone fail)
    │      ▼
    │   CODE-SEARCH TOOL (get_code_context_exa)
    │      ├─ provider code index (Exa/Tavily — nối web search chain)
    │      ├─ fallback: query builder từ symbol/đường dẫn (symbol-extractor)
    │      └─ token-trim marker: "[Truncated by code_search to ~N tokens.]"
    └─ (cả hai fail) ──► web_fetch (HTML floor — chỉ trang, không cấu trúc)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools glob/grep/read — explore local path (real files)
// ✅ packages/tools codegraph.ts — import-graph file relevance (explore helper)
// ✅ packages/tools symbol-extractor.ts — symbol extraction (nền fallback query)
// ✅ packages/tools web/search — backend chain (tavily/exa/... — nền code search)
// ✅ packages/tools web/fetch.ts — web_fetch floor (HTML→markdown)
// ✅ packages/tools disk-cleanup.ts — temp dir dọn (pattern dùng lại)

// ❌ THIẾU: git clone tool/helper cho GitHub URL
// ❌ THIẾU: code_search tool (Exa code endpoint + token-trim marker)
// ❌ THIẾU: fallback query builder từ symbol/đường dẫn
```

## Implementation

```typescript
// packages/tools/src/github-clone.ts (NEW)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** GitHub URL → (localPath, cleanup). Clone depth-1, permalink checkout nếu có. */
export function cloneGithub(url: string): { path: string; cleanup(): void } | null {
  const m = /github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?/.exec(url);
  if (!m) return null;
  const [, owner, repo, ref, filePath] = m;
  const dir = mkdtempSync(join(tmpdir(), "mya-gh-"));
  try {
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    execFileSync("git", ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), repoUrl, dir],
      { stdio: "ignore" });
    if (filePath) execFileSync("git", ["-C", dir, "checkout", ref!, "--", filePath], { stdio: "ignore" });
    return { path: join(dir, filePath ?? ""), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;   // clone fail → fallback code-search
  }
}

/** Token-trim marker cho code_search output — báo cắt rõ, không im lặng. */
export function trimCodeSearch(text: string, maxTokens: number): string {
  const approxTokens = Math.max(1, Math.ceil(text.length / 4));
  if (approxTokens <= maxTokens) return text;
  const keep = Math.max(1, Math.floor(maxTokens * 0.8));
  return (
    text.slice(0, keep * 4) +
    `\n\n[Truncated by code_search to approximately ${maxTokens} tokens.]`
  );
}
// registerWebTools: thêm `github_explore` (clone + trả path) + `code_search`
// (Exa code endpoint → trimCodeSearch → token-trim marker; fallback query builder).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Real file contents — agent explore đúng như local repo | ❌ Clone tốn disk + thời gian (repo lớn) |
| ✅ Token budget rõ — code-search cắt có marker | ❌ Cần git binary + network (offline không dùng được) |
| ✅ Fallback chain đầy đủ — không một điểm chết | ❌ Permalink checkout edge case (monorepo path) |
| ✅ Nối codegraph/symbol-extractor explore mạnh | ❌ Scrape GitHub HTML vẫn cần cho trang README/releases |

## Khác các hướng gần

| | AIS Clone-Not-Scrape | AIW Readability Pipeline | AIY Zero-Config Search |
|---|---|---|---|
| Trọng tâm | Code repo → local explore | Trang web → markdown | Search không cần key |
| Cơ chế | git clone + code-search | Readability + Turndown | Provider chain + lazy config |
| Quan hệ | Nền cho repo context | Nền cho trang context | Nền cho search |

## Khi nào chọn

- Task cần hiểu repo GitHub (code structure) chứ không phải đọc trang
- Đã có glob/grep/read/codegraph — thêm clone để tận dụng
- Muốn code-search có token budget + fallback rõ ràng
- Guard: temp dir dọn sau task, token-trim marker bắt buộc, clone fail → fallback