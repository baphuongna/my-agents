# Hướng VS: Compaction Rehydration — sau auto-compaction, ép agent đọc lại .prompt.md, đuôi log, git log — hồi phục từ sự thật nguồn không phải tóm tắt

> **Nguồn gốc:** pi-autoresearch (compaction rehydration); "after auto-compaction, force re-read source-of-truth files"; "rehydrate from .prompt.md + log tail + git log — not from summary"; "rebuild state from ground truth, not distilled recap" | **Coupling:** 🟢 — thêm rehydration step vào post-compaction hook | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (compaction + session sẵn — chưa có rehydration-from-source) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-autoresearch** đối mặt với **compaction** (LLM context đầy → tóm tắt/cắt). Vấn đề: compaction **mất chi tiết** — summary không đủ để agent tiếp tục chính xác. Giải pháp **rehydration**: sau khi compaction xảy ra, **ép agent đọc lại source-of-truth** — `.prompt.md` (mục tiêu/rule), **đuôi log** (decision gần nhất), **git log** (thay đổi đã làm) — để **hồi phục từ sự thật nguồn**, không phải từ tóm tắt đã chưng cất. Nguyên tắc: **ground truth over summary** — compaction chỉ là giảm token, rehydration bù lại độ chính xác bằng cách đọc lại facts gốc. Khác trust-summary (tin tóm tắt đủ) — VS **re-derive from source**; khác no-compaction (không bao giờ cắt) — VS **compaction + rehydration**.

## Mô tả

mya compaction rehydration: (1) **Detect compaction**: khi context bị compact (summary thay raw history). (2) **Rehydration step**: ngay sau compaction, inject hướng dẫn ép agent đọc lại: `.prompt.md` (goal/rule), `tail log.jsonl` (progress gần nhất), `git log --oneline` (thay đổi đã commit). (3) **Re-derive**: agent tái tạo hiểu biết từ ground truth — không tin summary. (4) **Continue**: agent tiếp tục với state chính xác được hồi phục. mya có compaction (spill) + session — VS thêm **rehydration protocol** + **source-read injection**.

## Kiến trúc

```
  CONTEXT FULL → AUTO-COMPACTION (summarize → cắt token)
        │
        ▼ (summary thay raw history — mất chi tiết)
  ┌─── REHYDRATION STEP (ép đọc source-of-truth) ───────────┐
  │                                                            │
  │  1. read .auto/prompt.md  → goal + rules (mutable)         │
  │  2. tail .auto/log.jsonl  → last decisions (108ms, keep)   │
  │  3. git log --oneline     → "experiment cache (jkl)"       │
  │                                                            │
  │  → agent RE-DERIVE state từ ground truth                   │
  │    (không tin compaction summary — đọc lại facts)          │
  └───────────────┬───────────────────────────────────────────┘
                  ▼
  ┌─── CONTINUE (state chính xác) ──────────────────────────┐
  │  agent biết: goal (10%), rules (keep/revert),             │
  │  progress (108ms), last change (cache) → tiếp tục đúng    │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core spill.ts — context spill/compaction (nền — VS rehydrate sau đây)
// ✅ packages/core session.ts — session state (nền — VS rehydrate surface)
// ✅ 590 VR resumable-dual-session-files — log.jsonl + prompt.md (relate — VS đọc lại)
// ✅ packages/agent sdk.ts — agent resume (nền — VS rehydrate ở đây)

// ❌ THIẾU: compaction-detect hook (biết khi nào compact xảy ra)
// ❌ THIẾU: rehydration protocol (đọc prompt.md + log tail + git log)
// ❌ THIẾU: source-read injection (ép agent đọc, không tin summary)
```

## Implementation

```typescript
// packages/agent/src/compaction-rehydration.ts (MỚI)
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

class CompactionRehydration {
  constructor(
    private promptPath: string,   // .auto/prompt.md
    private logPath: string,      // .auto/log.jsonl
    private gitLogLines: number = 10,
  ) {}

  // detect: compaction vừa xảy ra? (context bị summarize)
  // → caller báo, hoặc detect token-count drop

  // rehydrate: thu thập ground-truth → inject vào agent
  rehydrate(): string {
    const sections: string[] = [];

    // 1. prompt.md (goal + rules)
    if (existsSync(this.promptPath)) {
      sections.push('## Live Instructions (.prompt.md)\n' + readFileSync(this.promptPath, 'utf8'));
    }

    // 2. log tail (last N decisions)
    if (existsSync(this.logPath)) {
      const lines = readFileSync(this.logPath, 'utf8').trim().split('\n');
      const tail = lines.slice(-10).join('\n');
      sections.push('## Recent Experiment Log (tail)\n' + tail);
    }

    // 3. git log (recent changes)
    try {
      const gitLog = execSync(`git log --oneline -${this.gitLogLines}`, { encoding: 'utf8' }).trim();
      sections.push('## Recent Git History\n' + gitLog);
    } catch { /* not a git repo → skip */ }

    return '# COMPACTION REHYDRATION\n' +
      'You were compacted. Re-derive your state from the GROUND TRUTH below (do NOT rely on the summary):\n\n' +
      sections.join('\n\n');
  }

  // post-compaction hook: inject rehydration vào agent context
  onCompacted(): string {
    return this.rehydrate();  // caller prepend vào next agent turn
  }
}

// Usage:
// const rh = new CompactionRehydration('.auto/prompt.md', '.auto/log.jsonl');
// after compaction:
// const rehydrationPrompt = rh.onCompacted();
// agent.prependContext(rehydrationPrompt);  // ép đọc source-of-truth
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ground-truth accuracy (hồi phục từ facts, không summary) | ❌ Extra tokens (đọc lại 3 nguồn tốn context) |
| ✅ Compaction-safe (cắt được nhưng vẫn chính xác) | ❌ I/O latency (read file + git log mỗi compaction) |
| ✅ Deterministic (cùng source → cùng state) | ❌ Stale source (file chưa update → rehydrate cũ) |
| ✅ Trustworthy (git log không thể giả) | ❌ Git dependency (không phải repo nào cũng git) |

## Khác các hướng gần

| | Trust summary | No compaction | VS: Rehydration |
|---|---|---|---|
| Sau compact | Tin tóm tắt | N/A (không cắt) | **✅ đọc lại source** |
| Accuracy | ⚠ (mất chi tiết) | ✅ (giữ hết) | **✅ (re-derive)** |
| Token | Thấp | Cao (không cắt) | **Vừa (compact + rehydrate)** |

## Khi nào chọn

- Agent bị compaction thường xuyên + cần tiếp tục chính xác
- Có source-of-truth file (prompt.md, log.jsonl, git log) để rehydrate
- Muốn accuracy cao hơn trust-summary (tóm tắt không đủ tin)
- Nối packages/core spill.ts + session.ts + 590 VR dual-session-files; guard source-freshness (đảm bảo file update trước rehydrate), rehydration-cost (chỉ rehydrate khi cần, không mỗi turn), và fallback-no-git (skip git log nếu không phải repo); VS = compaction rehydration, kết hợp 590 VR (dual-file = source-of-truth để rehydrate) + 589 VQ (git log = experiment audit trail)
