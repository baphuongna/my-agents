# Hướng XE: Skill Shell Placeholders — skill body nhận placeholder kiểu shell $1/$ARGUMENTS/${@:N:L} + ${SKILL_DIR} + !cmd! với shell-timeout frontmatter

> **Nguồn gốc:** rpiv-mono (skill placeholder DSL); "$1/$ARGUMENTS/${@:N:L}", "${SKILL_DIR}", "!cmd! shell-timeout frontmatter" | **Coupling:** 🟡 — thêm placeholder expansion vào skill engine | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skill store + bash sẵn — chưa có shell-placeholder DSL + shell-timeout frontmatter) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** cho skill body nhận **placeholder kiểu shell**: `$1`, `$2` (tham số vị trí), `$ARGUMENTS` (toàn bộ tham số), `${@:N:L}` (slice từ N độ dài L — giống bash array slice), `${SKILL_DIR}` (đường dẫn thư mục skill), `!cmd!` (shell escape — substitute kết quả command). Mỗi skill có **frontmatter** `shell-timeout` (ms) giới hạn khi `!cmd!` chạy shell. Nguyên tắc: **skill = template shell-style** — người viết quen cú pháp shell, engine expand placeholder + chạy command có timeout. Khác template thuần — XE **shell-native** (slice, command substitution, dir var).

## Mô tả

mya skill shell placeholders: skill body có placeholder → engine expand trước khi chạy: `$N` (tham số), `$ARGUMENTS` (toàn bộ), `${@:N:L}` (slice), `${SKILL_DIR}` (dir skill), `!cmd!` (command substitution + timeout từ frontmatter). mya có skill store + bash — XE thêm **shell-placeholder expansion** + **frontmatter shell-timeout**.

## Kiến trúc

```
  SKILL BODY (raw, có placeholder):
  ┌────────────────────────────────────────────────────┐
  │  ---                                                 │
  │  shell-timeout: 5000   ← frontmatter (ms)            │
  │  ---                                                 │
  │  Inspect $1 in ${SKILL_DIR}                          │
  │  Args: $ARGUMENTS                                    │
  │  Slice: ${@:1:2} (2 args đầu)                        │
  │  Branch: !git rev-parse --abbrev-ref HEAD!           │  ← command substitution
  └───────────────────────┬────────────────────────────┘
                          │ (expand)
                          ▼
  ┌─── PLACEHOLDER EXPANSION ────────────────────────────┐
  │  $1          → "parser.ts"        (tham số vị trí)    │
  │  $ARGUMENTS  → "parser.ts refactor"                   │
  │  ${@:1:2}    → "parser.ts refactor" (slice)           │
  │  ${SKILL_DIR}→ "/skills/inspect/"                     │
  │  !git rev-parse...! → "main" (substitution, timeout)  │
  └───────────────────────┬───────────────────────────────┘
                          ▼
  EXPANDED BODY (model/tool nhận text đã substitute)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills skill.ts — skill (nền — XE body ở đây)
// ✅ packages/skills curator.ts — skill curator (nền — XE resolve)
// ✅ packages/tools bash — shell exec (nền — XE !cmd! chạy ở đây)

// ❌ THIẾU: shell-placeholder expansion ($N, $ARGUMENTS, ${@:N:L})
// ❌ THIẾU: ${SKILL_DIR} var + !cmd! substitution
// ❌ THIẾU: shell-timeout frontmatter
```

## Implementation

```typescript
// packages/skills/src/shell-placeholders.ts (MỚI)
import { execSync } from "node:child_process";

interface SkillFrontmatter { shellTimeout?: number }

function expandSlice(args: string[], n: number, l?: number): string {
  const slice = l === undefined ? args.slice(n - 1) : args.slice(n - 1, n - 1 + l); // ${@:N:L}
  return slice.join(" ");
}

function expandSkillBody(
  body: string, args: string[], skillDir: string, fm: SkillFrontmatter,
): string {
  let out = body
    .replace(/\$ARGUMENTS\b/g, args.join(" "))
    .replace(/\$\{SKILL_DIR\}/g, skillDir)
    .replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, n, l) => expandSlice(args, Number(n), l ? Number(l) : undefined))
    .replace(/\$(\d+)/g, (_, n) => args[Number(n) - 1] ?? "");
  // !cmd! command substitution (timeout từ frontmatter)
  out = out.replace(/!([^!]+)!/g, (_, cmd) => {
    try {
      return execSync(cmd, { encoding: "utf8", timeout: fm.shellTimeout ?? 10000 }).trim();
    } catch { return ""; } // timeout/fail → empty
  });
  return out;
}

// Usage:
// const expanded = expandSkillBody(rawBody, ["parser.ts","refactor"], "/skills/inspect", { shellTimeout: 5000 });
// → "Inspect parser.ts in /skills/inspect ..." + branch="main"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Shell-native (người viết quen bash syntax) | ❌ Placeholder/escape conflict (skill text có $ có thể nhầm) |
| ✅ Command substitution (!cmd!, dynamic) | ❌ Security risk (!cmd! chạy shell — injection) |
| ✅ Slice/array (${@:N:L}, linh hoạt) | ❌ Timeout complexity (frontmatter parse + exec guard) |
| ✅ ${SKILL_DIR} (tham chiếu tài nguyên skill) | ❌ Shell dependency (!cmd! cần bash available) |

## Khác các hướng gần

| | Plain template | Env-var only | XE: Shell-Placeholder |
|---|---|---|---|
| Positional $N | ❌ | ❌ | **✅ $1/$2** |
| Slice | ❌ | ❌ | **✅ ${@:N:L}** |
| Cmd subst | ❌ | ❌ | **✅ !cmd! + timeout** |

## Khi nào chọn

- Skill cần tham số động + command substitution (vd lấy branch git, build file)
- Người viết quen shell syntax ($N, ${@:N:L}, !cmd!)
- Nối packages/skills skill.ts + curator.ts + packages/tools bash; guard injection-sanitize (escape input trước !cmd!, không paste raw user vào shell), escape-literal (cho phép escape \$ để text có $ literal), và timeout-default (shell-timeout bắt buộc, không default mở); XE = skill shell placeholders, kết hợp 624 WZ tool-capability-reconciliation (skill !cmd! cần tool cap) + 630 XF pluggable-web-providers (web fetch từ placeholder)
