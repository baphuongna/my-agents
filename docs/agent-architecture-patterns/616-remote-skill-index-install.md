# Hướng WR: Remote Skill Index Install — skill discovery fetch index từ URL rồi tải từng file về global cache, throttle concurrent

> **Nguồn gốc:** opencode `remote skill discovery` (fetch skill index từ remote URL; tải từng skill file về global cache; throttle concurrent downloads); "fetch index from URL", "download files to global cache", "throttle concurrent" | **Coupling:** 🟡 — thêm remote index fetch + concurrent download vào skill system | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills + curator sẵn — chưa có remote index + concurrent download + throttle) | **Effort:** 2 tuần

## Nguồn gốc

**opencode** skill discovery mở rộng ra **remote** — skill registry không chỉ local mà còn **remote URL** (vd `https://skills.example.com/index.json`). Flow: (1) **Fetch index**: GET URL → nhận JSON index (list skill: name, description, fileURL). (2) **Download files**: mỗi skill trong index → tải file về **global cache** (vd `~/.cache/skills/`). (3) **Throttle concurrent**: tải nhiều skill cùng lúc nhưng **giới hạn concurrent** (vd max 5 download song song) — chống flood server + giới hạn bandwidth. (4) **Cache**: file tải về cache global → lần sau không tải lại (etag/hash check). Nguyên tắc: **remote index + concurrent download + throttle + global cache**.

## Mô tả

mya remote skill index install: (1) **Remote index fetch**: discovery scan remote URL → JSON index (skill list). (2) **Merge**: remote index + local index → combined skill list. (3) **Download**: skill chưa cache → tải file về global cache. (4) **Throttle**: concurrent download ≤ maxConcurrent (chống flood). (5) **Cache check**: skill đã cache + hash match → skip download. mya có skills + curator — WR thêm **remote index fetch** + **concurrent download throttle** + **global cache**.

## Kiến trúc

```
  ┌─ 1. FETCH REMOTE INDEX ───────────────────────────────┐
  │  GET https://skills.example.com/index.json             │
  │  → [{ name:"deploy", desc:"deploy helper",              │
  │       url:".../deploy.md", hash:"abc123" }, ...]        │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─ 2. CACHE CHECK (~/.cache/skills/) ────────────────────┐
  │  deploy: cached + hash match → SKIP                     │
  │  test-gen: not cached → DOWNLOAD                        │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─ 3. CONCURRENT DOWNLOAD (throttle maxConcurrent=5) ───┐
  │  ┌─ worker1: test-gen.md ───┐                          │
  │  ├─ worker2: old-skill.md ──┤ (song song, ≤ 5)         │
  │  └─ ... ────────────────────┘ → không flood server     │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─ 4. STORE GLOBAL CACHE ───────────────────────────────┐
  │  ~/.cache/skills/test-gen.md → saved → lần sau skip    │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills curator.ts — skill curator (nền — WR remote scan ở đây)
// ✅ packages/skills skill.ts — skill loading (nền — WR cache load)
// ✅ packages/sync — sync/download (nền — WR download + throttle)
// ✅ packages/core budget.ts — budget/limit (nền — WR throttle analog)

// ❌ THIẾU: remote index fetch (GET URL → JSON index)
// ❌ THIẾU: concurrent download throttle (maxConcurrent)
// ❌ THIẾU: global cache + hash check (skip re-download)
```

## Implementation

```typescript
// packages/skills/src/remote-skill-index.ts (MỘI)
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

interface RemoteSkillEntry { name: string; description: string; url: string; hash: string }

class RemoteSkillInstaller {
  constructor(
    private cacheDir: string,
    private maxConcurrent: number,
  ) { mkdirSync(cacheDir, { recursive: true }); }

  // fetch index → download missing → return local skill paths
  async install(indexURL: string): Promise<Record<string, string>> {
    // 1. fetch remote index
    const res = await fetch(indexURL);
    const index: RemoteSkillEntry[] = await res.json();

    // 2. filter: only download if not cached or hash mismatch
    const toDownload = index.filter(e => this.needsDownload(e));
    const cached = index.filter(e => !this.needsDownload(e));

    // 3. concurrent download with throttle
    const downloaded = await this.throttleMap(toDownload, e => this.downloadOne(e), this.maxConcurrent);

    // 4. build result map (name → cached path)
    const result: Record<string, string> = {};
    for (const e of cached) result[e.name] = this.cachePath(e.name);
    for (const e of downloaded) result[e.name] = this.cachePath(e.name);
    return result;
  }

  private needsDownload(e: RemoteSkillEntry): boolean {
    const path = this.cachePath(e.name);
    if (!existsSync(path)) return true; // not cached
    return readFileSync(path, "utf8").length === 0; // simplified hash check
  }

  private async downloadOne(e: RemoteSkillEntry): Promise<RemoteSkillEntry> {
    const res = await fetch(e.url);
    const content = await res.text();
    writeFileSync(this.cachePath(e.name), content); // store global cache
    return e;
  }

  // throttle: run async fn over array, max N concurrent
  private async throttleMap<T, R>(arr: T[], fn: (t: T) => Promise<R>, max: number): Promise<R[]> {
    const results: R[] = new Array(arr.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(max, arr.length) }, async () => {
      while (i < arr.length) {
        const idx = i++;
        results[idx] = await fn(arr[idx]!);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private cachePath(name: string): string { return join(this.cacheDir, `${name}.md`); }
}

// Usage:
// const installer = new RemoteSkillInstaller("~/.cache/skills", 5);
// const skills = await installer.install("https://skills.example.com/index.json");
// → concurrent download (max 5), global cache, hash check skip
```

## Được

- ✅ Remote skill (skill từ URL — không chỉ local)
- ✅ Concurrent + throttle (nhanh nhưng không flood server)
- ✅ Global cache (download 1 lần, dùng nhiều — save bandwidth)
- ✅ Hash check (skill update → re-download, stale → skip)

## Mất

- ❌ Network dependency (offline → remote skill không tải)
- ❌ Security risk (remote skill = untrusted code → cần verify)
- ❌ Cache invalidation (hash mismatch → re-download, nhưng miss → stale)
- ❌ Throttle tuning (maxConcurrent sai → slow hoặc flood)

## Khác

Khác **WJ skill-description-only-discovery** (local desc → on-demand content) — WR **remote install** (fetch URL → cache global). Khác **142 skill-marketplace** (marketplace concept) — WR **concurrent download mechanics** (throttle + cache). Khác **local-only skills** (scan local dir) — WR **remote fetch** (URL index + download).

## Khi nào chọn

- Skill registry remote (team/company skill repo — URL index)
- Muốn concurrent + throttle (nhiều skill tải nhanh, không flood)
- Cần global cache (download 1 lần, share nhiều session)
- Nối packages/skills curator.ts + skill.ts + packages/sync + packages/core budget.ts; guard skill-verification (remote skill = untrusted — verify hash/signature), throttle-tuning (maxConcurrent theo bandwidth), và cache-cleanup (stale cache → cleanup); WR = remote skill index install, kết hợp WJ skill-description-only-discovery (local discovery) + 142 skill-marketplace (registry concept)
