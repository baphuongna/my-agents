# Hướng UV: Bundled Example Corpus — mỗi skill mang theo bản copy corpus ví dụ references/ lưu trong chính skill

> **Nguồn gốc:** effective-html `skill-bundle/` (`references/`, `examples/`); "each skill carries its own example corpus"; "bundled references in skill dir"; "self-contained skill"; "no external dependency for examples" | **Coupling:** 🟢 — thêm references/ bundle vào skill artifact (corpus ví dụ lưu cùng skill) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills artifact sẵn — chưa có bundled references/ + self-contained check) | **Effort:** 1-2 tuần

## Nguồn gốc

**effective-html** khi đóng gói skill không phụ thuộc URL ngoài cho ví dụ — mà **bundle** luôn corpus ví dụ vào `references/` **trong chính skill dir**. Mục đích: **self-contained** — skill mang theo mọi ví dụ nó cần, không cần fetch URL ngoài (URL có thể chết — link rot), agent dùng được offline. Mỗi ví dụ trong `references/` là **copy bản địa** (snapshot). Nguyên tắc: **skill = self-contained** — ví dụ đi theo skill, không phụ thuộc external. Khác UT (check URL live) — UV **bundled copy** (không cần check vì đã có sẵn).

## Mô tả

mya bundled example corpus: (1) **Bundle**: khi distill skill, copy corpus ví dụ vào `references/` trong skill dir. (2) **Self-contained check**: verify skill không còn external dependency (mọi ví dụ có bản địa). (3) **Snapshot**: ví dụ là snapshot tại distill-time (không fetch runtime). (4) **Reference manifest**: danh sách ví dụ + nguồn gốc (provenance). mya có skills artifact — UV thêm **references/ bundle** + **self-contained validator** + **provenance manifest**.

## Kiến trúc

```
  SKILL DIR (self-contained)
  ├── SKILL.md          (hướng dẫn chính)
  ├── references/       (corpus ví dụ BUNDLED)
  │   ├── example-1.html
  │   ├── example-2.html
  │   └── manifest.json     (ví dụ + nguồn gốc)
  └── ...
        │ (self-contained — không fetch URL runtime)
        ▼
  ┌─── AGENT dùng skill ─────────────────────────────────┐
  │  cần ví dụ? → đọc references/ (BẢN ĐỊA, không URL)     │
  │  → offline-safe, link-rot-immune                       │
  └─────────────────────────────────────────────────────┘

  MANIFEST.json (provenance):
   [ { file:"example-1.html", source:"https://...", snapshot:ts } ]
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — skill artifact (nền — UV thêm references/)
// ✅ 525 graph-edge-provenance — nguồn gốc (nền — UV manifest provenance)
// ✅ packages/tools read — file read (nền — UV đọc references)

// ❌ THIẾU: references/ bundle (copy corpus vào skill dir)
// ❌ THIẾU: self-contained validator (no external dependency)
// ❌ THIẾU: provenance manifest (ví dụ + nguồn gốc)
// ❌ THIẾU: snapshot-at-distill (copy tại distill-time)
```

## Implementation

```typescript
// packages/skills/src/bundled-corpus.ts (MỚI)
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

interface RefEntry { file: string; source: string; snapshotTs: number }

class BundledCorpus {
  constructor(private now: () => number) {}

  // bundle: copy corpus ví dụ vào references/
  async bundle(skillDir: string, sources: { url?: string; path?: string; name: string }[]): Promise<RefEntry[]> {
    const refDir = join(skillDir, 'references');
    await mkdir(refDir, { recursive: true });
    const manifest: RefEntry[] = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i]!;
      const file = `example-${i + 1}-${src.name}`;
      if (src.path) await copyFile(src.path, join(refDir, file));
      // (url: fetch then write — omitted)
      manifest.push({ file, source: src.url ?? src.path ?? 'local', snapshotTs: this.now() });
    }
    await writeFile(join(refDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  // self-contained check: skill không còn external URL dependency
  async isSelfContained(skillDir: string): Promise<{ ok: boolean; externalUrls: string[] }> {
    const skillContent = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const externalUrls = [...(skillContent.match(/https?:\/\/[^\s)]+/gi) ?? [])];
    // external URL = potential runtime fetch dependency (không self-contained)
    return { ok: externalUrls.length === 0, externalUrls };
  }

  // read reference (bản địa, không URL)
  async readReference(skillDir: string, file: string): Promise<string> {
    return readFile(join(skillDir, 'references', file), 'utf8');
  }

  // manifest (provenance)
  async readManifest(skillDir: string): Promise<RefEntry[]> {
    return JSON.parse(await readFile(join(skillDir, 'references', 'manifest.json'), 'utf8'));
  }
}

// Usage:
// const bc = new BundledCorpus(now);
// await bc.bundle(skillDir, [{ url:"https://…", name:"navbar.html" }, …]);
// const { ok } = await bc.isSelfContained(skillDir); // no external dep
// const ex = await bc.readReference(skillDir, "example-1-navbar.html"); // offline
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Self-contained (không external dependency) | ❌ Skill phình (corpus copy → nặng) |
| ✅ Offline-safe (không cần URL runtime) | ❌ Snapshot staleness (ví dụ cũ không update) |
| ✅ Link-rot-immune (đã có bản địa) | ❌ Duplicate storage (nhiều skill cùng ví dụ) |
| ✅ Provenance (manifest nguồn gốc) | ❌ Bundle cost (copy tại distill) |

## Khác các hướng gần

| | UT Source-Liveness | 142 Skill-Marketplace | UV: Bundled-Corpus |
|---|---|---|---|
| Cái gì | Check URL live | Phân phối skill | **Bundle ví dụ trong skill** |
| Dependency | External URL | Marketplace | **✅ self-contained** |
| Offline | ❌ | ❌ | **✅ bản địa** |

## Khi nào chọn

- Skill cần ví dụ luôn sẵn (offline, link-rot-immune)
- Muốn self-contained (không external fetch runtime)
- Cần provenance (biết ví dụ từ đâu)
- Nối packages/skills + 525 graph-edge-provenance + packages/tools read; guard bundle size (corpus lớn → compress/dedupe), snapshot freshness (re-bundle khi ví dụ update), và dedup (ví dụ chung → shared ref); UV = bundled example corpus, kết hợp UT source-liveness-gate (check URL trước khi bundle snapshot) + US corpus-PII-scrubbing (scrub ví dụ trước bundle)
