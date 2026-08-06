# Hướng AAQ: Platform Portability Rules — mọi file reference trong plan là repo-relative path, honor user-named resources

> **Nguồn gốc:** compound-engineering-plugin (plugins/compound-engineering/skills/ce-plan/SKILL.md) | **Coupling:** 🟢 — quy tắc cho plan content, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có path-safety — chưa có plan lint rule) | **Effort:** 1 tuần

## Nguồn gốc

**compound-engineering-plugin** có quy tắc bắt buộc trong plan: **mọi file reference phải là repo-relative path** (không bao giờ absolute) để plan dùng được **xuyên máy, worktree, và teammate**. Kèm quy tắc **honor user-named resources** — nếu người dùng đặt tên file/branch/service thì giữ nguyên, không tự thay thế. Nguyên tắc: **plan là portable artifact** — relative path + tên do user đặt = plan chạy được ở mọi nơi, không vỡ vì máy khác có đường dẫn khác.

## Mô tả

mya platform portability rules: packages/tools path-safety.ts đã có path resolution (lexical write / canonical read). AAQ thêm **plan lint rule**: khi plan được sinh (AAL loop), chạy validator: (1) **relative-only** — mọi file path phải bắt đầu `./` hoặc không có `/` đầu; absolute path (`/home/...`, `C:\...`) → fail; (2) **no `..` escape** — không được trỏ ra ngoài repo root; (3) **honor user-named** — tên file/resource do user đặt (trong prompt hoặc spec) phải xuất hiện nguyên vẹn trong plan, không được rename. Lint fail → plan bị reject sớm (rẻ hơn sửa giữa execution).

## Kiến trúc

```
  PLAN (sinh từ brainstorm — AAL loop)
        │
        ▼
  ┌─── PLAN LINT (portability rules) ──────────────────┐
  │  1. relative-only: mọi path bắt đầu ./ hoặc tên     │
  │     /home/... | C:\... → FAIL (absolute)           │
  │  2. no .. escape: path không trỏ ra ngoài root      │
  │  3. honor user-named: tên user đặt giữ nguyên       │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── REJECT SỚM / PASS ─────────────────────────────┐
  │  fail → trả về lỗi lint (sửa plan trước khi chạy)   │
  │  pass → plan portable: chạy được mọi máy/worktree    │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools path-safety.ts — resolveInsideWorkspace (nền lexical check)
// ✅ packages/tools find.ts — globToRegex (nền path matching)
// ✅ packages/workflows runner.ts — plan/execution (nơi chèn lint)
// ✅ packages/core canonical-json.ts — canonical (nền so tên ổn định)
// ✅ packages/tools lsp-cascade.ts — file impact (nền path analysis)

// ❌ THIẾU: plan lint rule (relative-only + honor user-named)
```

## Implementation

```typescript
// packages/workflows/src/plan-lint.ts (NEW)
import { isAbsolute, normalize, sep, posix } from "node:path";

export interface LintIssue { rule: "relative-only" | "no-escape" | "honor-user-named"; path: string; detail: string }

/** Tách mọi path khỏi plan text (quy ước: mục "Files:" hoặc backtick path). */
export function extractPaths(plan: string): string[] {
  return [...plan.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!).filter((p) => p.includes(".") || p.includes("/"));
}

/** Lint plan: relative-only + không escape repo root. */
export function lintPlanPaths(plan: string, root = process.cwd()): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const p of extractPaths(plan)) {
    if (isAbsolute(p)) {
      issues.push({ rule: "relative-only", path: p, detail: "absolute path — plan không portable" });
      continue;
    }
    const norm = normalize(p);
    if (norm.startsWith(`..${sep}`) || norm === "..") {
      issues.push({ rule: "no-escape", path: p, detail: "trỏ ra ngoài repo root" });
    }
  }
  return issues;
}

/** Honor user-named resources: tên trong prompt/spec phải nguyên vẹn trong plan. */
export function lintHonorUserNamed(plan: string, userProvided: string[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const name of userProvided) {
    if (name.trim() && !plan.includes(name)) {
      issues.push({ rule: "honor-user-named", path: name, detail: "tên user đặt bị thay thế/thiếu trong plan" });
    }
  }
  return issues;
}

/** Gate: plan có lỗi portability → reject sớm (trước execution). */
export function assertPortablePlan(plan: string, userProvided: string[], root?: string): void {
  const issues = [...lintPlanPaths(plan, root), ...lintHonorUserNamed(plan, userProvided)];
  if (issues.length) {
    throw new Error(`PLAN KHÔNG PORTABLE:\n${issues.map((i) => `- [${i.rule}] ${i.path}: ${i.detail}`).join("\n")}`);
  }
}
// Usage: trong AAL loop, sau phase plan — assertPortablePlan(plan, userFiles)
// → fail sớm, sửa plan, không chạy execution với path hỏng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan chạy được mọi máy/worktree/teammate | ❌ Backtick heuristic có thể miss path không wrap |
| ✅ Fail sớm — không chạy execution với path hỏng | ❌ User-named detect cần nguồn tên (prompt/spec) |
| ✅ Honor user-named — không tự ý đổi tên | ❌ `..` legit (vd chạy script từ subdir) bị chặn |
| ✅ Rẻ — pure function lint | ❌ Path trong string literals (vd test fixture) false positive |

## Khác các hướng gần

| | Path-safety (runtime) | AAQ: Plan Lint |
|---|---|---|
| Thời điểm | Lúc tool chạy | **Lúc plan sinh (sớm hơn)** |
| Mục đích | Chặn escape/TOCTOU | **Portability + honor tên** |
| Cơ chế | Resolve + check | **Lint rule trên text** |
| Mối quan hệ | Runtime gate | **Lint gate trước runtime** |

## Khi nào chọn

- Plan chia sẻ xuyên máy/worktree/teammate (compound loop)
- Người dùng đặt tên resource — không muốn agent tự đổi
- Đã có path-safety — thêm lint layer cho plan content
- Guard: whitelist `..` hợp lệ (nếu cần), nguồn user-named rõ, lint chạy sau phase plan
