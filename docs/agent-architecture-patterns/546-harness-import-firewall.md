# Hướng TZ: Harness Import Firewall — rule ngược: harness packages không bao giờ import app, CI bắt vi phạm

> **Nguồn gốc:** deer-flow `packages/harness/` (deeflow.* modules), `test_harness_boundary` CI check; "harness never imports app", "test_harness_boundary CI gate", "dependency direction firewall", "harness is leaf, app is root" | **Coupling:** 🟢 — thêm static import scanner + CI gate | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (lint-deps sẵn — chưa có harness-specific firewall + CI gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**deer-flow** có quy tắc kiến trúc **đảo ngược intuition**: `packages/harness/` (deeflow.*) là **leaf** — nó test/đo lường app, nhưng **không bao giờ import** `app.*` (nghĩa là harness không phụ thuộc vào app implementation; app phụ thuộc harness contract, không ngược lại). Lý do: nếu harness import app thì **circular dependency** — thay app → break harness → không test được app. CI check `test_harness_boundary` scan static import: bất kỳ `import ... from 'app/...'` trong `packages/harness/` → **fail build**. Nguyên tắc: **dependency direction một chiều** — app→harness OK, harness→app FORBIDDEN. Firewall này giữ harness stable khi app thay.

## Mô tả

mya harness import firewall: (1) **Boundary**: định nghĩa harness packages (test/eval/audit tooling) là leaf — không import app packages (agent/core/tools). (2) **Static scan**: quét import statement trong harness source, match pattern `@my-agent/agent`, `@my-agent/core`, `@my-agent/tools`. (3) **CI gate**: `test_harness_boundary` — vi phạm → fail build. (4) **Allowlist**: harness chỉ import stdlib + chính nó (test utilities, fixtures). mya có lint-deps — TZ thêm **boundary-scanner** + **forbidden-import-detector** + **CI-gate**.

## Kiến trúc

```
  ALLOWED direction:         FORBIDDEN direction:

  app ──imports──▶ harness   harness ──imports──▶ app
  (agent, core, tools)         (test, eval, audit)   ❌ BLOCKED
  ✅ OK                                              CI: test_harness_boundary FAIL

  ┌─── CI GATE: test_harness_boundary ───────────────────────┐
  │  scan packages/{test,eval,audit}/**/*.ts                   │
  │  for each import:                                          │
  │    match '@my-agent/(agent|core|tools)' → VIOLATION         │
  │    → exit 1 (block merge)                                   │
  │  harness chỉ import: node:*, ./fixtures, ./helpers          │
  └────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ scripts/lint-deps.mjs — dependency lint (nền — TZ firewall mở rộng cái này)
// ✅ packages/eval — eval harness (leaf candidate)
// ✅ packages/audit — audit tooling (leaf candidate)
// ✅ test/features — test suite (harness layer)

// ❌ THIẾU: boundary definition (harness set = leaf, app set = root)
// ❌ THIẾU: static import scanner (parse import, match forbidden pattern)
// ❌ THIẾU: CI gate test_harness_boundary (violation → fail build)
// ❌ THIẾU: allowlist (harness chỉ import stdlib + own fixtures)
```

## Implementation

```typescript
// scripts/lint-harness-boundary.mjs (MỚI)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const HARNESS_PKGS = ['packages/eval', 'packages/audit', 'test/features'];
const FORBIDDEN = /from\s+['"]@my-agent\/(agent|core|tools|memory|prompts|skills)['"]/;
const TS_FILE = /\.tsx?$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (!e.includes('node_modules')) walk(p, out); }
    else if (TS_FILE.test(e)) out.push(p);
  }
  return out;
}

let violations = 0;
for (const pkg of HARNESS_PKGS) {
  for (const file of walk(pkg)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) {
        console.error(`VIOLATION ${relative('.', file)}:${i + 1}: ${line.trim()}`);
        violations++;
      }
    });
  }
}
if (violations > 0) {
  console.error(`\n✗ ${violations} harness→app import(s) FORBIDDEN. Harness is leaf.`);
  process.exit(1);
}
console.log('✓ harness boundary OK (no harness→app imports)');
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không circular dependency (harness stable khi app thay) | ❌ Fixture duplication (harness phải tự copy type thay vì import) |
| ✅ CI bắt vi phạm sớm (trước merge) | ❌ False positive (import type-only có thể hợp lệ) |
| ✅ Dependency direction rõ (app→harness one-way) | ❌ Boundary maintenance (thêm harness pkg phải update set) |
| ✅ Harness portable (không ràng app internals) | ❌ Strictness tax (mỗi PR phải pass gate) |

## Khác các hướng gần

| | Lint-deps (circular) | tsconfig paths | TZ: Harness-Firewall |
|---|---|---|---|
| Cái gì | Phát circular import | Resolve path alias | **Cấm harness→app direction** |
| Direction | Bidirectional (cycle) | ❌ | **One-way (app→harness only)** |
| CI gate | ⚠ (warn) | ❌ | **✅ fail build** |

## Khi nào chọn

- Harness/test/eval layer cần stable khi app internals thay
- Muốn dependency direction rõ ràng (app phụ thuộc harness contract)
- CI cần gate kiến trúc (bắt vi phạm trước merge)
- Nối scripts/lint-deps.mjs (mở rộng) + tsconfig.base.json (path alias) + vitest.config.ts (test boundary trong CI); guard false-positive (allowlist type-only import nếu hợp lệ), boundary-set accuracy (cập nhật khi thêm/xóa harness pkg), và fixture strategy (harness tự-contained type thay vì import app); TZ = harness import firewall — rule ngược, kết hợp 545 TY config-boundary (field-level boundary) — cùng chủ đề ranh giới kiến trúc
