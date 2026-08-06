# Hướng VH: Nested-Repo Boundary — checkpoint scan tự loại trừ git repo lồng, tránh outer snapshot nuốt ownership inner repo

> **Nguồn gốc:** oh-my-pi (nested repo boundary); "checkpoint excludes nested git repos"; "outer snapshot must not swallow inner repo ownership"; "detect .git, skip subtree"; "boundary-aware workspace scan" | **Coupling:** 🟢 — thêm nested-repo exclusion vào checkpoint scan (VF) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (git-checkpoint sẵn — chưa có nested .git detection/skip) | **Effort:** 2-3 tuần

## Nguồn gốc

**oh-my-pi** checkpoint engine (VF) scan toàn workspace để snapshot. Nhưng workspace có thể **chứa git repo lồng** (submodule, vendored repo, `node_modules/.git`, monorepo sub-pkg). Nếu outer snapshot **nuốt** cả inner repo → **ownership conflict**: outer checkpoint ghi đè inner repo history, corrupt hoặc trùng ownership. Giải pháp: checkpoint scan **tự phát hiện `.git`** trong subtree → **loại trừ** subtree đó khỏi outer snapshot (boundary-aware). Nguyên tắc: **mỗi repo có ownership riêng** — outer không nuốt inner. Khác **VF thuần** (add -A hết) — VH **boundary-aware skip**; khác `.gitignore` tĩnh — VH **dynamic .git detection**.

## Mô tả

mya nested-repo boundary: (1) **Scan**: duyệt workspace tìm thư mục chứa `.git` (nested repo). (2) **Exclude**: thêm các nested repo vào exclude list (không stage vào outer checkpoint). (3) **Boundary mark**: ghi nhận boundary (outer checkpoint biết "đây là inner repo, skip"). (4) **Sealed inner**: inner repo không bị outer corrupt — giữ ownership + history riêng. mya có VF checkpoint (git add -A) — VH thêm **nested .git detector** + **exclude list** + **boundary annotation**.

## Kiến trúc

```
  WORKSPACE:
    /proj/
      src/...
      lib/
        vendored/        ← có .git (NESTED REPO)
      node_modules/
        some-pkg/        ← có .git (NESTED REPO)
        │
        │ (checkpoint scan — VF git add -A)
        ▼
  ┌─── NESTED-REPO DETECTOR ──────────────────────────────┐
  │  duyệt cây → phát hiện:                                 │
  │    /proj/lib/vendored/.git      → BOUNDARY             │
  │    /proj/node_modules/some-pkg/.git → BOUNDARY         │
  │  → thêm vào EXCLUDE LIST                                │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── BOUNDARY-AWARE SNAPSHOT ───────────────────────────┐
  │  git add -A  NHƯNG skip exclude list:                  │
  │    :!/proj/lib/vendored/  :!/proj/node_modules/some-pkg/│
  │  → outer checkpoint KHÔNG nuốt inner repo (sealed)     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 578 git-bare-checkpoint (VF) — snapshot (nền — VH = boundary-aware scan)
// ✅ packages/tools glob/ls — file scan (nền — VH = nested detect)
// ✅ .gitignore — static ignore (relate — VH = dynamic .git detect)

// ❌ THIẾU: nested .git detector (duyệt cây → tìm .git)
// ❌ THIẾU: exclude list builder (pathspec :! skip)
// ❌ THIẾU: boundary annotation (checkpoint biết inner repo sealed)
```

## Implementation

```typescript
// packages/agent/src/nested-repo-boundary.ts (MỚI)
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

class NestedRepoBoundary {
  constructor(
    private workdir: string,
    private bare: string,
  ) {}

  // duyệt cây → tìm thư mục chứa .git (nested repo)
  private findNestedRepos(): string[] {
    const nested: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      if (entries.includes('.git')) {
        // .git ở đây → nested repo (trừ root workspace)
        if (dir !== this.workdir) nested.push(relative(this.workdir, dir));
        return; // không xuống sâu hơn (sealed boundary)
      }
      for (const e of entries) {
        if (e === 'node_modules' && dir === this.workdir) {
          // vẫn scan node_modules để bắt .git trong sub-pkg
        }
        const full = join(dir, e);
        try { if (statSync(full).isDirectory()) walk(full); } catch {}
      }
    };
    walk(this.workdir);
    return nested;
  }

  // checkpoint nhưng skip nested repos (boundary-aware)
  snapshot(turnId: string): string {
    const nested = this.findNestedRepos();
    const excludes = nested.map(n => `':!${n}'`).join(' ');
    const g = `git --git-dir="${this.bare}" --work-tree="${this.workdir}"`;
    execSync(`${g} add -A ${excludes}`, { cwd: this.workdir });
    execSync(`${g} commit -m "checkpoint ${turnId} (sealed: ${nested.length} nested)" --allow-empty`,
      { cwd: this.workdir });
    return execSync(`${g} rev-parse HEAD`, { cwd: this.workdir, encoding: 'utf8' }).trim();
  }
}

// Usage:
// boundary.snapshot('turn-1');
//   → finds lib/vendored/.git, node_modules/x/.git → exclude
//   → outer checkpoint KHÔNG nuốt inner repo ownership
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tránh ownership conflict (inner repo sealed) | ❌ Scan overhead (duyệt cây mỗi checkpoint) |
| ✅ Outer không corrupt inner history | ❌ Skip nhầm (thư mục user muốn snapshot) |
| ✅ Hỗ trợ submodule/vendored/monorepo | ❌ node_modules sâu → scan chậm |
| ✅ Dynamic (không cần .gitignore tĩnh) | ❌ Symlink .git edge case |

## Khác các hướng gần

| | VF add -A thuần | .gitignore tĩnh | VH: Nested-Boundary |
|---|---|---|---|
| Inner repo | Nuốt (corrupt) | Skip nếu list | **Dynamic .git detect → skip** |
| Cấu hình | ❌ | Tĩnh (quên update) | **Tự động (scan)** |
| Submodule | ❌ | ⚠️ | **✅ sealed** |

## Khi nào chọn

- Workspace chứa repo lồng (submodule, vendored, monorepo sub-pkg)
- Checkpoint engine nuốt inner repo → ownership conflict
- Muốn outer snapshot sạch, không lẫn inner history
- Nối 578 git-bare-checkpoint (VF, snapshot) + packages/tools glob (scan) + .gitignore; guard scan cost (cache nested list, re-scan khi fs event), false-skip (cho phép override include), và symlink handling (.git file vs dir); VH = nested-repo boundary, kết hợp 578 VF (engine) + 579 split-scope-restore (restore cũng tôn trọng boundary)
