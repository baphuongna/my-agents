# Hướng SH: Deferred Simplification Ledger — comment ponytail: ghi ceiling + upgrade trigger vào debt ledger

> **Nguồn gốc:** ponytail (deferred simplification / tech-debt comment); "ceiling marker in comment"; "upgrade trigger condition"; "debt ledger for deferred simplification"; "TODO-with-trigger not TODO-forever"
> **Coupling:** 🟢 — thêm debt-ledger writer (parse comment marker → ghi ledger), không đổi build
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (source tree + lint pipeline sẵn — chưa có ponytail parser + debt ledger)
> **Effort:** 1-2 tuần

## Nguồn gốc

**ponytail** pattern: khi code có chỗ **chưa tối giản** (workaround, simplified-for-now, quick-fix), dev (hoặc agent) để **comment ponytail** — nhưng không phải TODO mù (không bao giờ làm), mà ghi rõ **ceiling** (giới hạn hiện tại) + **upgrade trigger** (điều kiện khi nào phải nâng cấp). Ví dụ: `// ponytail: max 100 files — upgrade when file count > 500`. **Debt ledger** tổng hợp tất cả ponytail comment → danh sách nợ kỹ thuật kèm **trigger** (khi trigger xảy ra → cảnh báo "phải nâng cấp chỗ X"). Nguyên tắc: **debt có hạn + có điều kiện** — không TODO vĩnh viễn; khi trigger hit → ledger cảnh báo → nâng cấp. Khác TODO thường (không có trigger) — SH là **trigger-driven debt**.

## Mô tả

mya deferred simplification ledger: (1) **Ponytail comment**: dev/agent viết `// ponytail: <ceiling> — upgrade when <trigger>` trong code. (2) **Parser**: lint pipeline scan source → extract ponytail marker (ceiling, trigger, file:line). (3) **Debt ledger**: aggregate → `{ file, line, ceiling, trigger, status }`. (4) **Trigger eval**: định kỳ (hoặc trên metric change) check trigger — ví dụ "file count > 500" → nếu hiện tại 520 → **trigger hit** → status `due`. (5) **Alert**: ledger có entry `due` → warn "deferred simplification到期 — nâng cấp <file>:<line>". mya có source tree + lint pipeline — SH thêm **ponytail parser** + **debt ledger** + **trigger evaluator**.

## Kiến trúc

```
  CODE có ponytail comment:
  ┌─────────────────────────────────────────────────────┐
  │  // ponytail: max 100 files — upgrade when count>500 │
  │  function listFiles() { ... simplified ... }         │
  └───────────────┬─────────────────────────────────────┘
                  │ lint pipeline scan
                  ▼
  ┌─── PARSER ──────────────────────────────────────────┐
  │  extract: { file: "fs.ts", line: 42,                 │
  │             ceiling: "max 100 files",                 │
  │             trigger: "file count > 500" }             │
  └───────────────┬─────────────────────────────────────┘
                  │ aggregate
                  ▼
  ┌─── DEBT LEDGER ─────────────────────────────────────┐
  │  entry 1: fs.ts:42  trigger "count>500"  status OK   │
  │  entry 2: cache.ts:8 trigger "mem>1GB"   status OK   │
  │  entry 3: loop.ts:30 trigger "turns>200" status DUE  │
  └───────────────┬─────────────────────────────────────┘
                  │ trigger eval (định kỳ)
                  ▼
  ┌─── ALERT ───────────────────────────────────────────┐
  │  turns=210 > 200 → loop.ts:30 DUE                     │
  │  WARN: "deferred simplification 到期 — nâng cấp"      │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ source tree — code with comments (nền — SH scan ponytail)
// ✅ lint pipeline (scripts/lint.mjs) — scan (nền — SH parser vào đây)
// ✅ 47 anti-patterns — tech debt awareness (gần — SH = tracked debt)

// ❌ THIẾU: ponytail parser (extract ceiling + trigger từ comment)
// ❌ THIẾU: debt ledger (aggregate ponytail → danh sách nợ)
// ❌ THIẾU: trigger evaluator (check trigger condition → status due/ok)
```

## Implementation

```typescript
// scripts/ponytail-ledger.ts (MỚI — chạy trong lint pipeline)
import { readFileSync } from 'node:fs';

interface DebtEntry { file: string; line: number; ceiling: string; trigger: string; status: 'ok' | 'due' | 'unknown' }

const PONYTAIL_RE = /\/\/\s*ponytail:\s*(.+?)\s*—\s*upgrade when\s*(.+)$/i;

class DeferredSimplificationLedger {
  private entries: DebtEntry[] = [];

  // parse 1 file → extract ponytail entries
  parse(file: string, content: string): void {
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const m = line.match(PONYTAIL_RE);
      if (m) this.entries.push({
        file, line: i + 1, ceiling: m[1]!.trim(), trigger: m[2]!.trim(), status: 'unknown',
      });
    });
  }

  // eval trigger (numeric comparison: "count>500", "mem>1GB", "turns>200")
  evalTriggers(metrics: Record<string, number>): void {
    for (const e of this.entries) {
      const m = e.trigger.match(/(\w+)\s*>\s*(\d+)/);
      if (m) {
        const metric = metrics[m[1]!];
        e.status = metric !== undefined && metric > Number(m[2]) ? 'due' : 'ok';
      }
    }
  }

  dueEntries(): DebtEntry[] { return this.entries.filter(e => e.status === 'due'); }

  report(): string {
    const due = this.dueEntries();
    if (due.length === 0) return '✅ no deferred simplification due';
    return `⚠️ ${due.length} due:\n` + due.map(e => `  ${e.file}:${e.line} — upgrade (${e.trigger})`).join('\n');
  }
}

// Usage (lint pipeline):
// const ledger = new DeferredSimplificationLedger();
// ledger.parse('src/fs.ts', readFileSync('src/fs.ts','utf8'));
// ledger.evalTriggers({ count: 520, mem: 800, turns: 210 });
// console.log(ledger.report());  // WARN if due
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Debt có trigger (không TODO vĩnh viễn — khi nào nâng cấp rõ) | ❌ Comment convention (cần dev tuân format ponytail) |
| ✅ Alert chủ động (trigger hit → cảnh báo, không quên) | ❌ Trigger eval brittle (numeric only, regex parse) |
| ✅ Ledger audit (danh sách nợ đầy đủ, file:line) | ❌ False-due (metric đo sai → cảnh báo nhầm) |
| ✅ Phối 47 anti-patterns (tracked debt) | ❌ Parser maintenance (format mới → update regex) |

## Khác các hướng gần

| | TODO thường | TODO-date | SH: Deferred-Ledger |
|---|---|---|---|
| Trigger | ❌ (mù) | Thời gian | **Điều kiện metric (count/mem)** |
| Alert | ❌ | Deadline | **Trigger hit → due** |
| Audit | ❌ | ❌ | **Ledger đầy đủ (file:line)** |

## Khi nào chọn

- Code có nhiều simplified-for-now (workaround, quick-fix)
- Muốn debt có điều kiện nâng cấp (không quên, không vĩnh viễn)
- Có metric để eval trigger (count, mem, turns, latency)
- Nối source tree + lint pipeline (scripts/lint.mjs); guard comment convention (format ponytail nhất quán) + trigger eval robustness (numeric + future boolean/regex) + CI gate (due → fail hoặc warn); phối 47 anti-patterns (debt = anti-pattern khi không tracked)
