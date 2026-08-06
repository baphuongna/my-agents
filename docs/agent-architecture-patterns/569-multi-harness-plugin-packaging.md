# Hướng UW: Multi-Harness Plugin Packaging — cùng repo đóng gói theo plugin marketplace (Claude Code /plugin), Codex plugin, và npx skills add

> **Nguồn gốc:** effective-html `packaging/` (`claude-plugin/`, `codex-plugin/`, `npx-skills/`); "same repo packaged for multiple marketplaces"; "Claude Code /plugin install"; "Codex plugin"; "npx skills add"; "multi-target distribution" | **Coupling:** 🟡 — thêm multi-target packager vào build pipeline (1 repo → nhiều plugin format) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (bundle.mjs + skills sẵn — chưa có multi-target plugin manifest) | **Effort:** 2-3 tuần

## Nguồn gốc

**effective-html** không đóng gói 1 format — mà **multi-target**: cùng repo skill đóng gói thành **3 format** — (1) **Claude Code plugin** (`/plugin install`, manifest `plugin.json`), (2) **Codex plugin** (manifest riêng), (3) **npx skills add** (npm package). Mục đích: **reach** — skill chạy trên nhiều agent harness khác nhau, mỗi harness có format install riêng. Nguyên tắc: **1 source, N manifest** — cùng skill content, khác metadata/manifest theo target. Khác single-package — UW **multi-target từ 1 repo**.

## Mô tả

mya multi-harness plugin packaging: (1) **Single source**: skill content 1 bản (SKILL.md + references). (2) **Manifest per target**: mỗi target (Claude/Codex/npx) có manifest riêng (plugin.json, package.json, …). (3) **Packager**: build → sinh ra 3 package (1 target/folder). (4) **Install instruction**: mỗi package có install command riêng. mya có bundle.mjs + skills — UW thêm **manifest templates** + **multi-target packager** + **per-target build**.

## Kiến trúc

```
  REPO (1 skill source)
  ├── SKILL.md + references/ (single source)
        │ (multi-target packager)
        ▼
  ┌─── BUILD → 3 PACKAGE ────────────────────────────────┐
  │  dist/claude-plugin/  → plugin.json (Claude Code)      │
  │      install: /plugin install ./dist/claude-plugin     │
  │                                                         │
  │  dist/codex-plugin/   → manifest (Codex)               │
  │      install: codex plugin add ./dist/codex-plugin      │
  │                                                         │
  │  dist/npx-skills/     → package.json (npm)             │
  │      install: npx @my-agent/skill-html add              │
  └───────────────────────┬─────────────────────────────┘
                          │ (cùng content, khác manifest)
                          ▼
  USER install theo harness họ dùng (3 cách, 1 skill)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ scripts/bundle.mjs — bundler (nền — UW multi-target build)
// ✅ packages/skills — skill content (nền — UW single source)
// ✅ packages/pkg — packaging (nền — UW npx/npm target)

// ❌ THIẾU: manifest templates (Claude/Codex/npx per-target)
// ❌ THIẾU: multi-target packager (1 source → N package)
// ❌ THIẾU: install-command generator (per-target install doc)
// ❌ THIẾU: target parity check (skill chạy giống trên mọi harness)
```

## Implementation

```typescript
// scripts/pack-plugin.mjs (MỚI)
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Target { key: string; dir: string; manifest: (meta: SkillMeta) => Record<string, unknown>; installCmd: string }
interface SkillMeta { name: string; version: string; description: string; author: string }

const TARGETS: Target[] = [
  {
    key: 'claude', dir: 'dist/claude-plugin',
    manifest: m => ({ name: m.name, version: m.version, description: m.description,
      commands: [{ name: m.name, script: 'SKILL.md' }] }),
    installCmd: '/plugin install ./dist/claude-plugin',
  },
  {
    key: 'codex', dir: 'dist/codex-plugin',
    manifest: m => ({ id: m.name, version: m.version, summary: m.description, entry: 'SKILL.md' }),
    installCmd: 'codex plugin add ./dist/codex-plugin',
  },
  {
    key: 'npx', dir: 'dist/npx-skills',
    manifest: m => ({ name: `@my-agent/skill-${m.name}`, version: m.version, description: m.description,
      bin: { [m.name]: './install.mjs' } }),
    installCmd: `npx @my-agent/skill-${'$'}{m.name} add`,
  },
];

async function packAll(repoDir: string, meta: SkillMeta): Promise<string[]> {
  const installs: string[] = [];
  for (const t of TARGETS) {
    const out = join(repoDir, t.dir);
    await mkdir(out, { recursive: true });
    // copy single source (SKILL.md + references)
    await copyFile(join(repoDir, 'SKILL.md'), join(out, 'SKILL.md'));
    try { await copyFile(join(repoDir, 'references/manifest.json'), join(out, 'references/manifest.json')); } catch {}
    // write per-target manifest
    const manifestName = t.key === 'claude' ? 'plugin.json' : t.key === 'codex' ? 'codex-manifest.json' : 'package.json';
    await writeFile(join(out, manifestName), JSON.stringify(t.manifest(meta), null, 2));
    installs.push(`${t.key}: ${t.installCmd}`);
  }
  return installs;
}

// Usage:
// const installs = await packAll(repoDir, { name:'html-diagram', version:'1.0', description:'…', author:'mya' });
// → 3 package + install commands: claude /plugin, codex plugin, npx skills
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Multi-harness reach (Claude + Codex + npx) | ❌ Manifest maintenance (mỗi target format khác) |
| ✅ 1 source, N target (không duplicate content) | ❌ Harness drift (format đổi → update template) |
| ✅ User chọn harness họ dùng | ❌ Parity risk (skill chạy khác giữa harness) |
| ✅ Discoverable (3 marketplace) | ❌ Build complexity (3 package sinh) |

## Khác các hướng gần

| | 142 Skill-Marketplace | scripts/bundle.mjs | UW: Multi-Harness-Packaging |
|---|---|---|---|
| Cái gì | 1 marketplace | Bundle 1 format | **3 target từ 1 repo** |
| Target | Single | Single | **Claude/Codex/npx** |
| Manifest | 1 | 1 | **N manifest** |

## Khi nào chọn

- Skill muốn reach rộng (nhiều harness, không lock-in 1 platform)
- Repo skill dùng chung cho Claude Code + Codex + CLI
- Muốn user chọn harness họ dùng
- Nối scripts/bundle.mjs + packages/skills + packages/pkg; guard manifest sync (format update → update template), target parity test (chạy skill trên mọi harness verify giống), và single-source discipline (content 1 chỗ, chỉ manifest khác); UW = multi-harness plugin packaging, kết hợp 142 skill-marketplace (discoverable) + UV bundled-example-corpus (content self-contained across target)
