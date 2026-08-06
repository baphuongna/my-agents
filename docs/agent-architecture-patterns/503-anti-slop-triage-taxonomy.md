# Hướng SI: Anti-Slop Triage Taxonomy — phân loại triage issue/PR: bug/docs/feature/duplicate/slop/unsafe

> **Nguồn gốc:** claw-code (issue/PR triage taxonomy); "anti-slop classification"; "bug/docs/feature/duplicate/slop/unsafe labels"; "automated triage taxonomy"; "slop detection (low-quality/auto-generated noise)"
> **Coupling:** 🟢 — thêm triage classifier layer (label issue/PR → 6 bucket), không đổi core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai LLM client sẵn — chưa có triage taxonomy + classifier prompt)
> **Effort:** 1-2 tuần

## Nguồn gốc

**claw-code** maintainer workload: hàng tá issue/PR đến, cần **triage nhanh** — phân loại đúng bucket để xử lý đúng thứ tự. **Anti-slop taxonomy** = 6 nhãn: (1) **bug** (lỗi thật, cần fix), (2) **docs** (tài liệu, không code), (3) **feature** (yêu cầu tính năng), (4) **duplicate** (trùng issue cũ), (5) **slop** (low-quality / auto-generated noise — spam, AI-vomit, không action được), (6) **unsafe** (rủi ro bảo mật — inject, leak). Nguyên tắc: **mỗi issue/PR vào đúng bucket** → maintainer ưu tiên (unsafe > bug > feature > docs > duplicate; slop → close). Đặc biệt **slop detection**: phát hiện issue/PR AI-generated rác (không repro, mơ hồ, copy-paste) → close nhanh, không tốn thời gian.

## Mô tả

mya anti-slop triage taxonomy: (1) **Extract**: issue/PR → text (title, body, comments, diff). (2) **Classify**: LLM classify theo 6 bucket (bug/docs/feature/duplicate/slop/unsafe) + confidence + reason. (3) **Duplicate check**: so sánh với issue cũ (semantic match → duplicate). (4) **Slop signal**: detector riêng (no repro steps? copy-paste template? gibberish? → slop). (5) **Action map**: bucket → action (bug→assign, docs→label, feature→backlog, duplicate→close-link, slop→close, unsafe→security-team). (6) **Confidence gate**: low confidence → flag human review (không auto-close). mya có LLM client — SI thêm **taxonomy classifier** (prompt 6-bucket) + **duplicate matcher** + **slop detector**.

## Kiến trúc

```
  ISSUE/PR (title + body + diff):
        │
        ▼
  ┌─── EXTRACT ─────────────────────────────────────────┐
  │  text: "App crashes when I click X" + body + diff    │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── CLASSIFY (6-bucket) ─────────────────────────────┐
  │  ┌─ duplicate check (vs old issues)                  │
  │  ├─ slop detector (no repro? template? gibberish?)   │
  │  └─ LLM taxonomy → { bucket, confidence, reason }    │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── ACTION MAP ──────────────────────────────────────┐
  │  bug      → assign (priority)                         │
  │  docs     → label docs                                │
  │  feature  → backlog                                   │
  │  duplicate→ close + link old                          │
  │  slop     → close (rác, không action)                 │
  │  unsafe   → security-team (URGENT)                    │
  │  low conf → FLAG human review (no auto-close)         │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — LLM client (nền — SI classify qua nó)
// ✅ 084 llm-as-judge — LLM classification (nền — SI = triage classify)
// ✅ 107 canary-honeypot — unsafe/security detection (gần — SI unsafe bucket)

// ❌ THIẾU: triage taxonomy prompt (6-bucket classify)
// ❌ THIẾU: duplicate matcher (semantic so với old issues)
// ❌ THIẾU: slop detector (no repro / template / gibberish signal)
// ❌ THIẾU: action map (bucket → action) + confidence gate
```

## Implementation

```typescript
// packages/agent/src/anti-slop-triage.ts (MỚI)
import type { LLMClient } from './llm-types';

type Bucket = 'bug' | 'docs' | 'feature' | 'duplicate' | 'slop' | 'unsafe';

interface TriageResult { bucket: Bucket; confidence: number; reason: string; action: string }

const ACTION_MAP: Record<Bucket, string> = {
  bug: 'assign (priority)', docs: 'label docs', feature: 'backlog',
  duplicate: 'close + link old', slop: 'close (no action)', unsafe: 'security-team (URGENT)',
};

class AntiSlopTriage {
  constructor(private llm: LLMClient, private oldIssues: { id: string; title: string }[] = []) {}

  async classify(title: string, body: string): Promise<TriageResult> {
    // 1. duplicate check (semantic so old issues)
    const dup = this.findDuplicate(title);
    if (dup) return { bucket: 'duplicate', confidence: 0.9, reason: `matches #${dup.id}`, action: ACTION_MAP.duplicate };
    // 2. slop detector (signal-based)
    if (this.isSlop(body)) return { bucket: 'slop', confidence: 0.7, reason: 'no repro / template / gibberish', action: ACTION_MAP.slop };
    // 3. LLM 6-bucket taxonomy
    const prompt = `Classify this issue into ONE of: bug, docs, feature, duplicate, slop, unsafe.\nTitle: ${title}\nBody: ${body}\nRespond JSON {bucket, confidence(0-1), reason}.`;
    const r = await this.llm.complete(prompt);
    const parsed = JSON.parse(r);
    return { ...parsed, action: ACTION_MAP[parsed.bucket as Bucket] ?? 'human review' };
  }

  private findDuplicate(title: string): { id: string } | null {
    const t = title.toLowerCase();
    return this.oldIssues.find(o => o.title.toLowerCase().includes(t.slice(0, 20))) ?? null;
  }

  private isSlop(body: string): boolean {
    if (body.trim().length < 20) return true; // quá ngắn
    if (/^(test|asdf|lorem|123)/i.test(body.trim())) return true; // gibberish/template
    if (!/(repro|steps|error|stack|trace|expected|actual)/i.test(body) && body.length < 100) return true; // no repro
    return false;
  }
}

// Usage:
// const r = await triage.classify(issue.title, issue.body);
// if (r.confidence < 0.6) → FLAG human review (no auto-close)
// else apply r.action
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Triage nhanh (6-bucket, maintainer ưu tiên đúng) | ❌ Classifier sai (label nhầm → close issue đúng) |
| ✅ Anti-slop (AI-rác close nhanh, không tốn thời gian) | ❌ Slop false-positive (issue ngắn nhưng thật → close nhầm) |
| ✅ Action map (bucket → hành động cụ thể) | ❌ Confidence gate (low → vẫn cần human) |
| ✅ Duplicate detect (close + link, giảm trùng) | ❌ LLM cost (classify mỗi issue) |

## Khác các hướng gần

| | 084 LLM-as-Judge | Simple Label | SI: Anti-Slop-Triage |
|---|---|---|---|
| Mục đích | Chấm chất lượng | 1 nhãn tự do | **6-bucket + slop/duplicate** |
| Slop detect | ❌ | ❌ | **✅ (no repro/template)** |
| Action | ❌ | ❌ | **✅ bucket → action** |

## Khi nào chọn

- Maintainer workload lớn (nhiều issue/PR, cần triage)
- Nhiều slop (AI-generated rác, spam, low-quality)
- Muốn ưu tiên đúng (unsafe > bug > feature)
- Nối packages/ai (LLM) + 084 llm-as-judge + 107 honeypot (unsafe); guard slop false-positive (issue ngắn nhưng thật — confidence gate) + duplicate fuzzy (không close nhầm) + human review fallback (low confidence); never auto-close without confidence threshold
