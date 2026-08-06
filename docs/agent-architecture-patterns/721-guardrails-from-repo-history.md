# Hướng AAS: Guardrails from Repo History — guardrails file sinh tự động từ commit conventions, architecture, code style

> **Nguồn gốc:** everything-claude-code (.claude/rules/everything-claude-code-guardrails.md) | **Coupling:** 🟢 — sinh guardrails từ git history, đọc-only | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có audit/trust — chưa có history miner) | **Effort:** 1-2 tuần

## Nguồn gốc

**everything-claude-code** sinh **guardrails file tự động từ repo history**: đọc **commit conventions** (prefix, format, scope), **architecture** (cấu trúc thư mục, package boundaries), **code style** (import order, naming), **detected workflows** (pattern lặp lại trong commits). Mục đích: **agent mới hành xử đúng convention mà không cần đọc toàn bộ codebase** — guardrails là bản tóm tắt hành vi kỳ vọng, không phải tài liệu. Nguyên tắc: **mining history thay vì hỏi người dùng** — convention đã tồn tại trong git, chỉ cần trích xuất.

## Mô tả

mya guardrails from repo history: packages/audit trust.ts (project trust) + packages/core canonical-json.ts sẵn nền. AAS thêm **history miner**: đọc `git log` (message convention: prefix type, ticket, format), `git ls-tree` + directory structure (architecture: src layout, package boundaries), config files (style: .editorconfig, tsconfig), lặp lại trong commits (workflows: "fix bug X xuất hiện nhiều lần"). Output **GUARDRAILS.md** (hoặc mya-guardrails.json): sections rõ — conventions, architecture, style, workflows. Agent mới load guardrails như context compact (không cần đọc 100k LOC). Tái sinh định kỳ (mtime/staleness) — không đứng im khi repo đổi.

## Kiến trúc

```
  REPO HISTORY (git log, ls-tree, config files)
        │
        ▼
  ┌─── HISTORY MINER ─────────────────────────────────┐
  │  commit conventions → prefix/type/scope stats      │
  │  architecture       → dir layout, package bounds   │
  │  code style         → config files (editorconfig…) │
  │  detected workflows → pattern lặp trong commits    │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── GUARDRAILS OUTPUT ─────────────────────────────┐
  │  GUARDRAILS.md: conventions/architecture/style/workflows│
  │  agent mới load như context compact                │
  │  tái sinh theo staleness (repo đổi → re-mine)      │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/audit trust.ts — project trust gate (nền load guardrails)
// ✅ packages/core canonical-json.ts — canonical (nền guardrails.json ổn định)
// ✅ packages/skills skill.ts — markdown model (nền GUARDRAILS.md format)
// ✅ packages/tools codegraph.ts — structure scan (nền architecture mining)
// ✅ packages/tools osv-check.ts — external query (nền workflow pattern)

// ❌ THIẾU: history miner (git log → conventions)
// ❌ THIẾU: guardrails format + staleness re-mine
```

## Implementation

```typescript
// packages/audit/src/guardrails.ts (NEW)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Guardrails {
  conventions: string[];   // commit prefix/format detected
  architecture: string[];  // dir layout, package boundaries
  style: string[];         // config file hints
  workflows: string[];     // lặp lại trong commits
  minedAt: number;
}

/** Mine commit conventions từ git log — thống kê prefix message. */
export function mineCommitConventions(repo: string, n = 200): string[] {
  const log = execFileSync("git", ["log", `-${n}`, "--format=%s"], { cwd: repo, encoding: "utf8" });
  const prefixCount = new Map<string, number>();
  for (const line of log.split("\n")) {
    const m = line.match(/^([a-z]+)(\([^)]+\))?!?:/i);
    if (m) prefixCount.set(m[1]!, (prefixCount.get(m[1]!) ?? 0) + 1);
  }
  return [...prefixCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, c]) => `${p}: ${c}/${n} commits`);
}

/** Mine architecture: top-level dirs + package boundaries. */
export function mineArchitecture(repo: string): string[] {
  const tree = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], { cwd: repo, encoding: "utf8" });
  return tree.split("\n").filter(Boolean).map((d) => `top-level: ${d}`);
}

/** Sinh guardrails — gọi khi thiếu hoặc staleness (repo thay đổi). */
export function mineGuardrails(repo: string): Guardrails {
  const style: string[] = [];
  for (const f of [".editorconfig", ".prettierrc", "tsconfig.json"]) {
    if (existsSync(`${repo}/${f}`)) style.push(`${f} present — theo config này`);
  }
  return {
    conventions: mineCommitConventions(repo),
    architecture: mineArchitecture(repo),
    style,
    workflows: [], // v1: bỏ trống — mining workflow pattern là v2
    minedAt: Date.now(),
  };
}

/** Load hoặc re-mine theo staleness (vd 7 ngày). */
export function loadGuardrails(repo: string, path: string, staleAfterMs = 7 * 24 * 3600 * 1000): Guardrails {
  if (existsSync(path)) {
    const g = JSON.parse(readFileSync(path, "utf8")) as Guardrails;
    if (Date.now() - g.minedAt < staleAfterMs) return g;
  }
  const fresh = mineGuardrails(repo);
  writeFileSync(path, JSON.stringify(fresh, null, 2));
  return fresh;
}
// Usage: agent mới loadGuardrails(repo, ".mya/guardrails.json")
//   → context compact về convention — không cần đọc toàn repo
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent mới đúng convention ngay — không đọc cả repo | ❌ Mining heuristic — convention lạ không bắt được |
| ✅ Tự sinh — không hỏi user | ❌ Staleness window — repo đổi giữa chừng vẫn cũ |
| ✅ Context compact (guardrails thay codebase) | ❌ Git log không đủ (squash mất detail) |
| ✅ Tái sinh theo thời gian | ❌ Workflow mining (v2) phức tạp — cần pattern detect |

## Khác các hướng gần

| | Trust gate | AAS: Guardrails |
|---|---|---|
| Nguồn | Operator quyết định | **Git history mining** |
| Nội dung | Quyền hạn | **Convention + style + workflow** |
| Thời gian | Tĩnh | **Re-mine theo staleness** |
| Mối quan hệ | Nền an toàn | **Bổ sung context cho agent mới** |

## Khi nào chọn

- Repo lớn — agent mới không thể đọc toàn bộ trước khi làm
- Convention tồn tại trong git history nhưng không có tài liệu
- Đã có trust gate + skill model — thêm miner + guardrails file
- Guard: staleness re-mine, mining read-only (không sửa repo), test với repo fixture
