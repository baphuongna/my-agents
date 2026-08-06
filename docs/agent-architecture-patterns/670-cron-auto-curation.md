# Hướng YT: Cron Auto Curation — 3 GitHub Actions cron (daily 01:00, weekly Mon) tự add/sort/check/badge — toàn bộ maintenance index tự động không cần maintainer (FINDINGS.md)

> **Nguồn gốc:** awesome-human-distillation (FINDINGS.md) | **Coupling:** 🟡 — cron automation, chạy ngoài runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có cron runner + supervised — chưa có auto-curation jobs) | **Effort:** 2-3 tuần

## Nguồn gốc

**awesome-human-distillation** tự động hóa toàn bộ maintenance: **3 GitHub Actions cron** — daily 01:00 và weekly Monday — chạy các bước: **add** (nhận skill mới từ issue form 667 YQ), **sort** (re-sort theo live stars 669 YS), **check** (verify link/format), **badge** (cập nhật badge 663 YM). Mục tiêu: **index tự bảo trì** — maintainer không phải chạy tay; mỗi sáng index đã mới. Cron chỉ tự động các bước **deterministic an toàn**; bước cần quyết định (approve skill lạ) vẫn để người/agent duyệt.

## Mô tả

mya áp dụng cron-auto-curation: `packages/cron` thêm job **auto-curation**: daily 01:00 — (1) **add**: đọc submission queue (667 YQ) → validate (660 YJ) → thêm entry; (2) **sort**: gọi live stars (669 YS) → re-sort; (3) **check**: link rot (653 YC verify repo tồn tại), format chuẩn; weekly Mon — (4) **badge**: re-verify official vendor (664 YN), cập nhật coverage (659 YI). Job chạy qua **supervised wrapper** (core/supervised.ts — crash-resilient, maxRestarts + backoff). Mọi job **idempotent** (chạy lại không nhân đôi) + ghi report. Việc cần người (approve skill vendor mới lạ) → chỉ tạo PR/issue, không tự merge. mya có sẵn core/cron (runner + scan), core/supervised (crash wrapper), cron-store (job state) — YT thêm **auto-curation jobs** + **idempotency check**.

## Kiến trúc

```
  CRON (daily 01:00 + weekly Mon):
    ├─ ADD    : submission queue (667 YQ) → validate (660 YJ) → thêm entry
    ├─ SORT   : live stars (669 YS) → re-sort bảng
    ├─ CHECK  : link rot (653 YC) + format anatomy (660 YJ)
    └─ BADGE  : (weekly) vendor re-verify (664 YN) + coverage (659 YI)
        │
        ▼
  Supervised wrapper (core/supervised.ts):
    crash → restart, max 5 lần/300s, backoff, counter reset khi chạy lâu
        │
        ▼
  Idempotent: chạy lại không nhân đôi entry/sort/badge
  Việc cần người → tạo PR/issue (không tự merge)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron scan.ts — cron scan runner (nền — YT job scheduler)
// ✅ packages/cron cron-store.ts — job state (nền — YT last-run tracking)
// ✅ packages/core supervised.ts — crash-resilient wrapper (nền — YT chạy job an toàn)
// ✅ packages/cron cross-process-lock.ts — tránh 2 instance chạy cùng lúc (nền — YT idempotency)

// ❌ THIẾU: auto-curation jobs (add/sort/check/badge)
// ❌ THIẾU: idempotency check (chạy lại không nhân đôi)
```

## Implementation (TS)

```typescript
// packages/cron/src/auto-curation.ts (MỚI)
import { supervisedTask } from "@my-agent/core";

export interface CurationReport {
  added: number;
  sorted: boolean;
  checked: number;
  issues: string[];
}

export class AutoCuration {
  constructor(
    private add: () => Promise<number>,
    private sort: () => Promise<boolean>,
    private check: () => Promise<{ checked: number; issues: string[] }>,
    private badge: () => Promise<boolean>, // weekly
  ) {}

  /** Idempotency: dựa trên last-run marker. */
  private marker = "";

  async runDaily(now = new Date()): Promise<CurationReport> {
    const day = now.toISOString().slice(0, 10);
    if (this.marker === day) return { added: 0, sorted: false, checked: 0, issues: [] }; // đã chạy hôm nay
    this.marker = day;

    const added = await this.add();            // submission queue → entry (dedup URL)
    const sorted = await this.sort();          // live stars → re-sort
    const { checked, issues } = await this.check(); // link rot + format
    return { added, sorted, checked, issues };
  }

  async runWeekly(now = new Date()): Promise<boolean> {
    if (now.getDay() !== 1) return false; // chỉ Monday
    return this.badge(); // vendor re-verify + coverage update
  }
}

// Usage (trong cron runner — bọc supervised):
// const job = new AutoCuration(addFromQueue, starSort, checkLinks, reVerifyBadges);
// await supervisedTask("auto-curation", async () => {
//   const r = await job.runDaily();
//   log(`added=${r.added} sorted=${r.sorted} issues=${r.issues.length}`);
//   await job.runWeekly();
// }, { maxRestarts: 5, windowMs: 300_000 });
// → crash → tự restart + backoff; chạy lại không nhân đôi (marker ngày)
```

## Được

- ✅ Index tự bảo trì — mỗi sáng mới, maintainer không chạy tay
- ✅ Job an toàn — supervised wrapper chống crash-loop
- ✅ Idempotent — chạy lại/trùng lịch không nhân đôi
- ✅ Deterministic an toàn tự động; quyết định nhạy → PR/issue
- ✅ Tái dùng cron-store + cross-process-lock — job state rõ

## Mất

- ❌ Cron phụ thuộc — máy chạy cron phải luôn bật (mya gateway chạy 24/7?)
- ❌ Tự động sai — add entry lỗi tự động vào index, cần quarantine
- ❌ Chạy lâu — sort hàng trăm repo + check link tốn thời gian/API

## Khác các hướng gần

| | Maintainer tay | Hook khi submit | YT: Cron Auto Curation |
|---|---|---|---|
| Thời điểm | khi nhớ | real-time submit | **lịch cố định (01:00)** |
| Toàn diện | tùy hứng | từng việc | **add/sort/check/badge đủ** |
| An toàn | người quyết | tự chạy | **supervised + idempotent** |

## Khi nào chọn

- Index/directory cần tự bảo trì định kỳ không cần maintainer
- Đã có cron + supervised + cross-process-lock sẵn — YT ráp job
- Muốn bước deterministic tự động, bước nhạy tạo PR/issue
- Nối packages/cron scan.ts (scheduler) + core/supervised.ts (crash-safe) + cron-store.ts (last-run) + 667 YQ/669 YS/659 YI (job logic); guard idempotency (marker/ngày + dedup URL), quarantine (entry lỗi tự động vào thư mục quarantine không vào index), và human-approve-boundary (vendor mới lạ → PR, không tự merge); YT = cron curation, kết hợp 667 YQ issue-form (input) + 669 YS star-sort (sort job) + 659 YI coverage-matrix (badge/coverage job)
