# Hướng YM: Badge Category Curation — awesome-list hand-picked (chống AI-slop) phân loại skill theo badge + vendor (official team vs community), mỗi mục có direct link source repo (docs/reference-repos/VoltAgent/awesome-agent-skills/research.md)

> **Nguồn gốc:** awesome-agent-skills (research.md) | **Coupling:** 🟢 — curation process, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill curator — chưa có curation pipeline có badge) | **Effort:** 1-2 tuần

## Nguồn gốc

**awesome-agent-skills** là **awesome-list hand-picked** — mỗi skill phải qua tay người curation (hoặc pipeline chuẩn) chứ không tự động nhét mọi thứ vào, **chống AI-slop** (danh sách đầy skill rác do LLM sinh). Danh sách **phân loại theo badge + vendor**: badge cho biết loại (official, community, verified...) và vendor cho biết nguồn (Anthropic, Google Labs...). Mỗi mục có **direct link tới source repo** — người đọc click thẳng vào repo gốc, không qua trang trung gian. Mục tiêu: danh sách ngắn, chất lượng, phân loại rõ nguồn gốc.

## Mô tả

mya áp dụng badge-category-curation: pipeline skill directory của mya có 3 tầng: (1) **submission gate** — skill mới phải có source repo URL + mô tả (nối 667 YQ issue form); (2) **curation review** — skill được đánh giá trước khi vào danh sách (độ sâu, maintenance, license) — AI-slop bị loại; (3) **badge + vendor classification** — badge: `official` (team phát hành), `community`, `verified` (đã kiểm); vendor: tên tổ chức. Mỗi entry: `[badge] vendor — name — direct link repo`. Skill không có source repo hoặc không qua review → không vào danh sách chính. mya có sẵn skills curator.ts (đánh giá skill), 653 YC repo cache (đọc source repo) — YM thêm **curation pipeline** + **badge schema**.

## Kiến trúc

```
  Submission (667 YQ form) → repo URL + desc
       │
       ▼
  CURATION REVIEW (chống AI-slop):
    ├─ source repo tồn tại + truy cập được?  (653 YC đọc repo)
    ├─ nội dung đủ sâu (không 5 dòng sáo rỗng)?
    ├─ license / maintenance ổn?
    └─ pass → vào danh sách; fail → reject kèm lý do
       │
       ▼
  CLASSIFY: badge + vendor
    ├─ official   — Anthropic, Google Labs, Vercel...
    ├─ community  — cá nhân / tổ chức nhỏ
    └─ verified   — đã kiểm tra chất lượng
       │
       ▼
  Entry: [badge] vendor — name — direct link source repo
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills curator.ts — đánh giá skill (nền — YM review gate)
// ✅ packages/tools repo-cache (653 YC) — đọc source repo (nền — YM verify link)
// ✅ packages/skills skill.ts — provenance (nền — YM vendor/badge field)
// ✅ packages/skills skill-description.ts — mô tả ngắn (nền — YM entry desc)

// ❌ THIẾU: curation pipeline (submission → review → classify)
// ❌ THIẾU: badge schema (official/community/verified + vendor)
```

## Implementation (TS)

```typescript
// packages/skills/src/curation-pipeline.ts (MỚI)
export type Badge = "official" | "community" | "verified";
export type CurationStatus = "pending" | "approved" | "rejected";

export interface SkillSubmission {
  name: string;
  sourceRepo: string;   // direct link — bắt buộc
  description: string;
  vendor: string;       // "Anthropic" | "Google Labs" | ...
  badge: Badge;
  status: CurationStatus;
  rejectReason?: string;
}

export class CurationPipeline {
  private entries: SkillSubmission[] = [];

  submit(s: Omit<SkillSubmission, "status">): void {
    this.entries.push({ ...s, status: "pending" });
  }

  /** Review chống AI-slop: source repo thật + mô tả đủ sâu. */
  review(s: SkillSubmission, repoReadable: boolean): CurationStatus {
    const slopSignals = [
      /^(awesome|super|ultimate|best)/i.test(s.description),       // mô tả quảng cáo
      s.description.length < 40,                                   // quá ngắn
      !repoReadable,                                               // repo không đọc được
    ];
    if (slopSignals.some(Boolean)) {
      s.status = "rejected";
      s.rejectReason = "AI-slop signal: cần source repo thật + mô tả cụ thể ≥ 40 ký tự";
    } else {
      s.status = "approved";
    }
    return s.status;
  }

  /** Danh sách đã phân loại — badge + vendor + direct link. */
  listing(filter: Badge[] = ["official", "verified", "community"]): string {
    return this.entries
      .filter((e) => e.status === "approved" && filter.includes(e.badge))
      .map((e) => `- [${e.badge}] **${e.vendor}** — ${e.name} — ${e.sourceRepo}`)
      .join("\n");
  }
}

// Usage:
// const pipe = new CurationPipeline();
// pipe.submit({ name: "mya-skill", sourceRepo: "https://github.com/x/mya-skill", description: "..." , vendor: "community", badge: "community" });
// pipe.review(entry, await repoReadable(entry.sourceRepo)); // chống slop
// console.log(pipe.listing()); // → [official] Anthropic — claude-skills — <direct link>
```

## Được

- ✅ Chống AI-slop — review gate loại skill rác trước khi vào danh sách
- ✅ Phân loại rõ — badge (official/community/verified) + vendor minh bạch
- ✅ Direct link — click thẳng source repo, không trang trung gian
- ✅ Pipeline máy được — review heuristic + status track
- ✅ Kết hợp 653 YC — verify source repo thật bằng cache đọc

## Mất

- ❌ Review heuristic — slop signal không bắt được skill "dài nhưng rỗng"
- ❌ Thủ công vẫn cần — badge verified cần người/tự động sâu hơn
- ❌ Link rot — repo bị xóa/đổi URL sau khi vào danh sách (cần re-check định kỳ)

## Khác các hướng gần

| | Auto-aggregate (mọi skill) | Chỉ link thô | YM: Badge Curation |
|---|---|---|---|
| Chất lượng | thấp (slop) | trung bình | **review gate** |
| Phân loại | không | không | **badge + vendor** |
| Trust | không rõ | không rõ | **official/verified rõ** |

## Khi nào chọn

- Skill directory mya cần chất lượng cao, không muốn AI-slop tràn vào
- Muốn người đọc biết nguồn gốc (official team vs community)
- Có skills curator + repo cache sẵn — YM thêm pipeline + badge
- Nối packages/skills curator.ts (review) + 653 YC repo-cache (verify source) + skill.ts (provenance); guard link-rot (re-check repo định kỳ — cron + 653 YC), badge-truth (official chỉ khi vendor chính thức — không tự nhận), và review-bias (heuristic không loại skill niche hợp lệ — whitelist); YM = badge curation, kết hợp 663 kế tiếp YN vendor-grouped-skill-org (taxonomy theo vendor) + 667 YQ issue-form-submission (submission gate đầu vào)
