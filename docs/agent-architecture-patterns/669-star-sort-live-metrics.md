# Hướng YS: Star Sort Live Metrics — sort_by_stars.py re-sort bảng theo live GitHub stars qua REST API — thứ hạng tự cập nhật, không phải snapshot tĩnh (scripts/sort_by_stars.py)

> **Nguồn gốc:** awesome-human-distillation (scripts/sort_by_stars.py) | **Coupling:** 🟢 — curation step, ngoài runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có fetch + cron — chưa có live metric sort) | **Effort:** 1 tuần

## Nguồn gốc

**awesome-human-distillation** giữ danh sách skill luôn phản ánh độ phổ biến hiện tại: `sort_by_stars.py` gọi **GitHub REST API** lấy **live stars** cho từng repo trong danh sách rồi **re-sort bảng** theo thứ hạng mới. Không phải **snapshot tĩnh** (số liệu chụp một lần rồi để đó) — mỗi lần chạy là cập nhật. Script xử lý rate limit (nhiều repo → sleep/throttle), lưu kết quả vào file. Mục đích: danh sách xếp hạng "sống" — repo hot lên hạng cao, repo chết tụt xuống — người đọc thấy thứ hạng đáng tin.

## Mô tả

mya áp dụng star-sort-live-metrics: pipeline curation (663 YM) thêm bước **re-rank**: (1) lấy danh sách repo từ directory (có direct link); (2) gọi **GitHub REST API** `GET /repos/{owner}/{repo}` lấy `stargazers_count` (throttle theo rate limit — backoff khi 403); (3) re-sort bảng theo stars giảm dần; (4) lưu `stars_snapshot.json` + ghi ngày đo. Sort theo stars là **metric thô** (stars không = chất lượng) — nên sort dùng làm thứ tự mặc định, còn badge (663 YM) giữ vai trò chất lượng. Cron chạy định kỳ (nối 670 YT) để thứ hạng luôn live. mya có sẵn tools/fetch.ts (gọi API), cron (chạy định kỳ), core/time (giờ) — YS thêm **live metric fetch** + **re-sort + snapshot**.

## Kiến trúc

```
  Directory entries (direct link repo)
       │
       ▼
  LIVE METRIC FETCH (GitHub REST API):
    GET /repos/VoltAgent/awesome-agent-skills → stargazers_count
    GET /repos/anthropics/claude-skills       → stargazers_count
    ...  (throttle theo rate limit; 403 → backoff)
       │
       ▼
  RE-SORT theo stars giảm dần ──► bảng cập nhật
       │
       ▼
  Snapshot: stars_snapshot.json { repo, stars, measuredAt }
       │
       ▼
  Cron (670 YT) chạy lại → thứ hạng luôn live, không snapshot tĩnh
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools fetch.ts — gọi HTTP API (nền — YS GET /repos)
// ✅ packages/cron — runner định kỳ (nền — YS re-sort mỗi đêm)
// ✅ packages/core time.ts — nowWallclock (nền — YS measuredAt)
// ✅ packages/tools web/security-guard.ts — bảo vệ request (nền — YS URL an toàn)

// ❌ THIẾU: live metric fetch (stars count + throttle)
// ❌ THIẾU: re-sort + snapshot (stars_snapshot.json)
```

## Implementation (TS)

```typescript
// packages/skills/src/star-sort.ts (MỚI)
import { writeFile, readFile, existsSync } from "node:fs/promises";

export interface RepoEntry { name: string; repoUrl: string; stars?: number; measuredAt?: string; }

const RATE_LIMIT_MS = 1_200; // GitHub: 60 req/h unauthenticated → ~1.2s/req

export class StarSorter {
  constructor(private fetchStars: (repoUrl: string) => Promise<number>) {}

  private parseRepo(repoUrl: string): string | null {
    const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null; // owner/repo
  }

  async rank(entries: RepoEntry[]): Promise<RepoEntry[]> {
    const out: RepoEntry[] = [];
    for (const e of entries) {
      const slug = this.parseRepo(e.repoUrl);
      if (!slug) { out.push({ ...e }); continue; } // không phải github → giữ nguyên
      try {
        const stars = await this.fetchStars(`https://api.github.com/repos/${slug}`);
        out.push({ ...e, stars, measuredAt: new Date().toISOString() });
      } catch { out.push({ ...e }); } // lỗi → giữ thứ hạng cũ, không chặn
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS)); // tránh rate limit
    }
    return out.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)); // stars giảm dần
  }

  async saveSnapshot(entries: RepoEntry[], path: string): Promise<void> {
    await writeFile(path, JSON.stringify(entries, null, 2));
  }

  async loadSnapshot(path: string): Promise<RepoEntry[]> {
    if (!existsSync(path)) return [];
    return JSON.parse(await readFile(path, "utf8")) as RepoEntry[];
  }
}

// Usage:
// const sorter = new StarSorter((url) => ghFetchStars(url));
// const ranked = await sorter.rank(entries);      // live stars → sort
// await sorter.saveSnapshot(ranked, "stars_snapshot.json"); // ngày đo ghi rõ
// cron: chạy lại mỗi đêm → thứ hạng live, không snapshot tĩnh
```

## Được

- ✅ Thứ hạng live — stars cập nhật, repo chết tụt hạng
- ✅ Không chặn khi lỗi — fetch fail giữ entry cũ
- ✅ Snapshot + measuredAt — biết số liệu đo lúc nào, audit được
- ✅ Throttle rate limit — không 403 hàng loạt
- ✅ Metric thô rõ ràng — stars chỉ là thứ tự, badge giữ chất lượng

## Mất

- ❌ Stars không = chất lượng — repo hot nhờ marketing, repo tốt ít star
- ❌ Rate limit — unauthenticated 60 req/h, danh sách lớn chạy lâu
- ❌ Chỉ GitHub — repo GitLab/self-host không sort được

## Khác các hướng gần

| | Snapshot tĩnh (sort 1 lần) | Sort tay (maintainer) | YS: Live Stars |
|---|---|---|---|
| Cập nhật | không | thủ công | **cron + API** |
| Độ tin cậy | cũ nhanh | chủ quan | **số liệu thật** |
| Chi phí | 0 | công người | **API + throttle** |

## Khi nào chọn

- Danh sách skill/repo muốn phản ánh độ phổ biến hiện tại
- Đã có cron (670 YT) — thêm bước re-sort live
- Có fetch + time sẵn — YS thêm metric fetch + snapshot
- Nối packages/tools fetch.ts (GET /repos) + cron (chạy đêm) + core/time.ts (measuredAt); guard rate-limit (unauthenticated 60/h — throttle + lưu token nếu có), snapshot-fallback (API fail → dùng snapshot cũ, không sort rỗng), và metric-transparency (ghi "sorted by stars" + ngày — không giả vờ chất lượng); YS = live star sort, kết hợp 663 YM badge-curation (badge = chất lượng, stars = thứ tự) + 670 YT cron-auto-curation (chạy định kỳ) + 649 XY measurement-first (đo trước, quyết sau)
