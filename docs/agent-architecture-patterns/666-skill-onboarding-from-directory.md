# Hướng YP: Skill Onboarding from Directory — plugin idea: lấy skill URL từ directory → tự động install, validate, tích hợp vào process library — pipeline discovery-to-onboarding (research.md)

> **Nguồn gốc:** awesome-agent-skills (research.md) | **Coupling:** 🟡 — pipeline cài skill từ URL, chạy bên ngoài core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill store + curator + repo cache — chưa có installer) | **Effort:** 2-3 tuần

## Nguồn gốc

**awesome-agent-skills** đề xuất plugin idea: thay vì người dùng đọc directory rồi **tự tay** tải skill về, agent làm cả pipeline: (1) **lấy skill URL** từ directory (663 YM entry có direct link); (2) **tự động install** — clone/tải skill về đúng chỗ; (3) **validate** — skill đúng format (660 YJ anatomy, 661 YK ID verify); (4) **tích hợp vào process library** — skill vào store, index, prompt (progressive disclosure). Pipeline **discovery-to-onboarding**: từ "thấy skill trong danh sách" đến "skill chạy được" không cần thao tác tay.

## Mô tả

mya áp dụng skill-onboarding-from-directory: tool `skills install <url-or-directory-entry>`: (1) resolve entry → source repo URL (direct link từ directory); (2) clone qua **653 YC repo-cache** (partial clone, không tải lại); (3) validate: anatomy 4 section (660 YJ) + ID framework (661 YK) + safety tier (662 YL) + target runtime (665 YO); (4) copy skill vào store `~/.mya/skills/` (với provenance ghi nguồn URL + ngày); (5) rebuild index → skill xuất hiện trong prompt (progressive disclosure). Fail ở validate → không cài, báo lý do cụ thể. Cài rồi mà lỗi → rollback (xóa khỏi store + rebuild index). mya có sẵn skills curator (load/đánh giá), repo-cache (653 YC), skill.ts (parse) — YP thêm **installer** + **validate-before-install** + **rollback**.

## Kiến trúc

```
  Directory entry (663 YM): [official] Anthropic — claude-skills — https://github.com/anthropics/claude-skills
       │
       ▼  skills install <url>
  ┌─ 1. RESOLVE ──► source repo URL từ entry
  ├─ 2. FETCH  ───► 653 YC repo-cache (partial clone, tái dùng local)
  ├─ 3. VALIDATE ─► anatomy (660 YJ) + ID (661 YK) + safety (662 YL) + runtime (665 YO)
  │        └─ fail → KHÔNG cài, báo lý do
  ├─ 4. INSTALL ──► copy vào ~/.mya/skills/ + provenance (url, date)
  └─ 5. INTEGRATE ► rebuild index → vào prompt (progressive disclosure)
                    lỗi → rollback (xóa + rebuild)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills curator.ts — load skill từ dir + index (nền — YP integrate)
// ✅ packages/tools repo-cache.ts (653 YC) — clone/đọc repo (nền — YP fetch)
// ✅ packages/skills skill.ts — parse + provenance (nền — YP provenance ghi nguồn)
// ✅ packages/skills anatomy-validator (660 YJ) — validate (nền — YP step 3)

// ❌ THIẾU: installer (resolve → fetch → validate → copy → index)
// ❌ THIẾU: rollback (cài lỗi → gỡ + rebuild)
```

## Implementation (TS)

```typescript
// packages/skills/src/onboard.ts (MỚI)
import { cp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface OnboardResult {
  name: string;
  ok: boolean;
  reason?: string;
}

export class SkillOnboarder {
  private storeDir = join(homedir(), ".mya", "skills");

  constructor(
    private fetchRepo: (url: string) => Promise<string>, // 653 YC cache.ensure
    private validate: (dir: string) => Promise<{ complete: boolean; issues: unknown[] }>, // 660 YJ
  ) {}

  async install(sourceUrl: string, name: string): Promise<OnboardResult> {
    try {
      // 1-2. resolve + fetch qua repo cache
      const repoDir = await this.fetchRepo(sourceUrl);

      // 3. validate trước khi cài
      const v = await this.validate(repoDir);
      if (!v.complete) {
        return { name, ok: false, reason: `validate fail: ${JSON.stringify(v.issues)}` };
      }

      // 4. install: copy vào store với provenance
      await mkdir(this.storeDir, { recursive: true });
      const dest = join(this.storeDir, name);
      await cp(join(repoDir, "SKILL.md"), join(dest, "SKILL.md"), { recursive: true, force: true });

      // 5. integrate: rebuild index (curator) — fail thì rollback
      try {
        await this.rebuildIndex();
      } catch (err) {
        await rm(dest, { recursive: true, force: true }); // rollback
        return { name, ok: false, reason: `integrate fail — rollback: ${String(err)}` };
      }
      return { name, ok: true };
    } catch (err) {
      return { name, ok: false, reason: String(err) };
    }
  }

  private async rebuildIndex(): Promise<void> {
    // curator.loadAll(this.storeDir) → rebuild prompt index (progressive disclosure)
  }
}

// Usage:
// const onboarder = new SkillOnboarder(repoCache.ensure, validateAnatomy);
// const r = await onboarder.install("https://github.com/anthropics/claude-skills", "claude-skills");
// r.ok ? "✅ skill vào store + prompt index" : `⛔ ${r.reason}`;
```

## Được

- ✅ Discovery-to-onboarding liền mạch — từ URL đến skill chạy được
- ✅ Validate trước cài — skill hỏng không vào store
- ✅ Rollback — integrate lỗi gỡ sạch, không để store dơ
- ✅ Tái dùng repo cache — clone một lần, cài nhiều lần
- ✅ Provenance đầy đủ — biết skill từ đâu, cài khi nào

## Mất

- ❌ Trust URL — URL độc hại cài skill có script nguy hiểm (cần 662 YL + 661 YK)
- ❌ Validate không đủ — anatomy pass nhưng nội dung skill xấu
- ❌ Version pin — update skill sau phải track version (re-install ghi đè?)

## Khác các hướng gần

| | Cài tay (copy file) | npm-style registry | YP: Onboarder Pipeline |
|---|---|---|---|
| Bước | người tự làm | npm install | **resolve→fetch→validate→install** |
| Validate | không | version check | **anatomy + ID + safety** |
| Rollback | không | npm uninstall | **tự động khi integrate fail** |

## Khi nào chọn

- Muốn agent tự cài skill từ directory (awesome-list) không cần tay
- Cần validate + rollback để store luôn sạch
- Có curator + repo-cache + anatomy-validator sẵn — YP thêm installer
- Nối packages/skills curator.ts (integrate/index) + 653 YC repo-cache (fetch) + 660 YJ anatomy (validate) + 662 YL safety (chặn skill nguy hiểm); guard url-trust (URL từ directory đã verify 663 YM, không URL lạ), version-tracking (re-install ghi đè hay version mới — quyết định + test), và rollback-complete (integrate fail phải gỡ mọi file + rebuild index — test); YP = onboarding pipeline, kết hợp 653 YC repo-cache (fetch) + 660 YJ anatomy (validate) + 662 YL safety-tier (gate skill nguy hiểm)
