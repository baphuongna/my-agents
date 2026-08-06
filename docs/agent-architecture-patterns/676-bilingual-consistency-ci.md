# Hướng YZ: Bilingual Consistency CI — check-repository-consistency.mjs assert README ZH/EN có URL giống hệt, sort giống nhau, không dup — tính nhất quán song ngữ do CI bắt, không phải review
> **Nguồn gốc:** awesome-persona-distill-skills (scripts/check-repository-consistency.mjs) | **Coupling:** 🟢 — thêm consistency script vào CI scripts/ | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (scripts/ có lint.mjs, lint-deps.mjs — chưa có consistency checker) | **Effort:** 1 tuần

## Nguồn gốc

**awesome-persona-distill-skills** có README **song ngữ ZH/EN** — nội dung dịch nhưng **URL, thứ tự mục, danh sách không được lệch** (URL lệch → link hỏng bản kia; sort lệch → khó so sánh 2 bản). Thay vì dựa vào review, họ viết **check-repository-consistency.mjs** chạy trong CI: assert (1) **URL giống hệt** giữa 2 bản, (2) **sort giống nhau**, (3) **không duplicate** entry. Script fail → CI fail → PR không merge được. Nguyên tắc: **consistency là machine-checkable — đưa vào CI, không phụ thuộc kỷ luật reviewer**.

## Mô tả

mya bilingual consistency CI: (1) **Extract**: parse README ZH + EN, lấy danh sách entry (URL + title). (2) **Assert URL parity**: mọi URL bản ZH phải có mặt bản EN (và ngược lại) — không lệch 1 link. (3) **Assert sort parity**: thứ tự 2 bản giống nhau (hoặc cả 2 cùng sort rule). (4) **Assert no-dup**: không entry trùng URL/title trong cùng 1 bản. (5) **CI gate**: script chạy trong lint pipeline — fail → chặn merge. mya có scripts/lint.mjs + lint-deps.mjs (nền CI) — YZ thêm **consistency checker script** + **wire vào lint pipeline**.

## Kiến trúc

```
  ┌─── README.zh.md ───┐      ┌─── README.en.md ───┐
  │  - [A](url1)        │      │  - [A](url1)        │
  │  - [B](url2)        │      │  - [B](url2)        │
  │  - [C](url3)        │      │  - [C](url3)        │
  └────────┬───────────┘      └────────┬───────────┘
           └──────────┬───────────────┘
                      ▼
  ┌─── check-repository-consistency.mjs ──────────────┐
  │  1. extractEntries(zh) vs extractEntries(en)        │
  │  2. assert URL set bằng nhau (parity)               │
  │  3. assert order giống nhau (sort parity)           │
  │  4. assert không duplicate trong từng bản           │
  │  fail → exit 1 → CI chặn merge                      │
  └───────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ scripts/lint.mjs — lint pipeline (nền — YZ chạy cùng lint)
// ✅ scripts/lint-deps.mjs — dep consistency (nền — YZ analog cho docs)
// ✅ packages/audit — AuditLog (relate — YZ ghi kết quả check)

// ❌ THIẾU: consistency checker cho tài liệu song ngữ (URL parity)
// ❌ THIẾU: sort-parity assert (thứ tự 2 bản)
// ❌ THIẾU: no-dup assert (entry trùng trong cùng bản)
```

## Implementation

```typescript
// scripts/check-consistency.mjs (MỚI — port check-repository-consistency.mjs)
import { readFile } from "node:fs/promises";

// Extract entries: [title, url] từ markdown list
function extractEntries(md) {
  const entries = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (m) entries.push({ title: m[1], url: m[2] });
  }
  return entries;
}

function assertEqualUrls(zh, en) {
  const zhUrls = new Set(zh.map(e => e.url));
  const enUrls = new Set(en.map(e => e.url));
  const onlyZh = [...zhUrls].filter(u => !enUrls.has(u));
  const onlyEn = [...enUrls].filter(u => !zhUrls.has(u));
  if (onlyZh.length || onlyEn.length) {
    throw new Error(`URL mismatch — only-zh: ${onlyZh.join(", ")} | only-en: ${onlyEn.join(", ")}`);
  }
}

function assertSameOrder(zh, en) {
  const zhUrls = zh.map(e => e.url);
  const enUrls = en.map(e => e.url);
  for (let i = 0; i < zhUrls.length; i++) {
    if (zhUrls[i] !== enUrls[i]) {
      throw new Error(`Order mismatch at ${i}: zh=${zhUrls[i]} en=${enUrls[i]}`);
    }
  }
}

function assertNoDup(entries, lang) {
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.url)) throw new Error(`Duplicate url ${e.url} in ${lang}`);
    seen.add(e.url);
  }
}

export async function checkConsistency(zhPath, enPath) {
  const [zh, en] = await Promise.all([readFile(zhPath, "utf8"), readFile(enPath, "utf8")]);
  const zhEntries = extractEntries(zh);
  const enEntries = extractEntries(en);
  assertEqualUrls(zhEntries, enEntries);
  assertSameOrder(zhEntries, enEntries);
  assertNoDup(zhEntries, "zh");
  assertNoDup(enEntries, "en");
  return { zh: zhEntries.length, en: enEntries.length };
}
// Usage (CI): node scripts/check-consistency.mjs docs/README.zh.md docs/README.en.md
// → fail exit 1 → PR không merge được — consistency do CI bắt
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ URL parity máy bắt, không cần review | ❌ Chỉ bắt được consistency cấu trúc, không bắt nghĩa dịch |
| ✅ Sort parity (2 bản dễ so sánh) | ❌ Entry regex không match mọi markdown variant |
| ✅ No-dup (tránh entry trùng, link hỏng) | ❌ Thêm 1 script phải maintain |
| ✅ Fail CI → không merge nhầm | ❌ Chỉ áp dụng cho docs có cấu trúc list |

## Khác các hướng gần

| | Manual review | i18n toolchain | YZ: Consistency CI |
|---|---|---|---|
| Bắt URL lệch | ⚠️ sót | ✅ | **✅ deterministic** |
| Chi phí | Human | Tool nặng | **Script nhẹ** |
| Gate | Review | build | **CI fail** |

## Khi nào chọn

- Tài liệu/README song ngữ nhiều URL, thứ tự — lệch dễ xảy ra
- Muốn consistency machine-checked trong CI thay vì dựa reviewer
- Danh sách entry có cấu trúc markdown ổn định
- Nối scripts/lint.mjs + lint-deps.mjs (chạy cùng lint pipeline); guard regex-coverage (entry format đủ pattern), fail-fast (exit 1 ngay lỗi đầu), và scope-hẹp (chỉ assert cấu trúc, không assert nội dung dịch); YZ = bilingual consistency CI, kết hợp 684 ZH quality-convergence (consistency score) + scripts/lint.mjs (pipeline sẵn)
