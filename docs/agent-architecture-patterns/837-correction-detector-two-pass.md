# Hướng AFE: Correction Detector Two-Pass — 2-pass filter: strong luôn trigger, weak chỉ trigger kèm directive, negative triệt tiêu

> **Nguồn gốc:** pi-hermes-memory | **Coupling:** 🟢 — detector thuần, gắn qua hook | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn auto-capture + trust feedback; thiếu 2-pass detector) | **Effort:** 1 tuần

## Nguồn gốc

**pi-hermes-memory** (src/handlers/correction-detector.ts): phát hiện **user correction real-time** bằng **2-pass filter**: (1) **strong patterns** — luôn trigger (rõ ràng: "no, that's wrong", "don't do that", "actually…"); (2) **weak patterns** — chỉ trigger **nếu kèm directive clause** (câu hướng dẫn hành động: "instead use X", "do Y next time"); (3) **negative patterns** — triệt tiêu (phủ định không phải correction: "not a problem", "that's fine, no change"). Kết quả: lưu **failure memory ngay** thay vì chờ nudge interval.

Giá trị: (1) **phản hồi tức thì** — correction phát hiện real-time → failure memory lưu ngay (không chờ periodic nudge — mất chi tiết); (2) **chính xác** — 2-pass giảm false positive (weak cần directive) + false negative (strong luôn trigger); negative patterns chặn "tưởng correction nhưng không phải"; (3) **rẻ** — heuristic deterministic, không tốn LLM call (giống AER).

## Mô tả

Với mya, pattern = **correction detector gắn vào input path**: (1) **trigger point** — user message mới (loop nhận input) — detector chạy trên text user, không chờ interval; (2) **3 lớp pattern** — `STRONG` (luôn), `WEAK` (cần directive kèm theo trong cùng câu), `NEGATIVE` (triệt tiêu — nếu match, bỏ qua correction này); (3) **verdict** — `isCorrection(text)` → { isCorrection, reason, suggestion? } — suggestion = directive clause trích ra; (4) **hành động** — correction → lưu **failure memory** (nối memory store + **AFC content-gate** trước khi persist) + điều chỉnh **trust** (nối `governance.ts` applyFeedback — correction = unhelpful cho hành vi cũ) + nguồn cho **AEQ graduation** (failure lặp lại → instinct graduate thành rule); (5) **khác auto-capture** — auto-capture bắt *tri thức* (fact/preference), AFE bắt *sửa sai* (correction/failure) — hai detector bù nhau cùng chạy trên user text. Đây là pattern **real-time signal extraction**: sửa sai là tín hiệu học quý nhất — bắt ngay, không để trôi.

## Kiến trúc (ASCII)

```
  USER MESSAGE MỚI (loop input path)
    │
    ▼ 2-PASS FILTER (correction-detector.ts)
  PASS 1 — STRONG patterns ──► luôn trigger
    ├─ "no, that's wrong" · "don't do that" · "actually…"
  PASS 2 — WEAK patterns ──► chỉ trigger NẾU kèm directive clause
    ├─ "should use X" · "instead do Y" (cần hướng dẫn hành động)
  PASS 3 — NEGATIVE patterns ──► TRIỆT TIÊU
    └─ "not a problem" · "that's fine, no change"
    │
    ▼ VERDICT: { isCorrection, reason, suggestion }
    ▼ HÀNH ĐỘNG (real-time — không chờ nudge interval)
  ├─ lưu FAILURE memory (qua AFC gate — scan trước khi persist)
  ├─ trust feedback (governance.ts — correction = unhelpful cũ)
  └─ nguồn AEQ graduation (failure lặp → rule)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/governance.ts — applyFeedback trust (±0.05/0.10)
//   (hành động sau correction — đã sẵn)
// ✅ packages/memory/src/auto-capture.ts — bắt tri thức từ user text
//   (cùng điểm trigger — pattern bù nhau)
// ✅ packages/memory/src/content-gate.ts (AFC) — write gate trước persist
// ✅ packages/core/src/loop.ts — input path (điểm chạy detector)
// ✅ packages/skills/src/instinct-contradiction.ts (AER) — verb-pair heuristic
//   (cùng phong cách deterministic — không LLM)

// ❌ THIẾU: 3 lớp pattern (strong/weak+directive/negative)
// ❌ THIẾU: verdict model + trích directive clause (suggestion)
// ❌ THIẾU: nối failure memory + trust + AEQ graduation
```

## Implementation

```typescript
// packages/memory/src/correction-detector.ts (NEW)
const STRONG: RegExp[] = [
  /\bno[,\s]+(that'?s|this is)\s+(wrong|incorrect|not right)\b/i,
  /\bdon'?t\s+do\s+that\b/i,
  /\bstop\s+doing\s+that\b/i,
  /^actually[,\s]+(it'?s|that'?s)\s+(wrong|not)/i,
];

const WEAK: RegExp[] = [
  /\bshould\s+(use|have|be|do)\b/i,
  /\binstead\s+(use|do|try)\b/i,
  /\bnext\s+time\s+(use|do|try)\b/i,
];

const NEGATIVE: RegExp[] = [
  /\bnot\s+a\s+problem\b/i,
  /\bthat'?s\s+fine[,\s]+no\s+change\b/i,
  /\bno\s+worries\b/i,
  /\bignore\s+that\b/i,
];

export interface CorrectionVerdict {
  isCorrection: boolean;
  reason: string;
  suggestion?: string;    // directive clause trích ra
}

/** 2-pass: strong luôn trigger · weak cần directive · negative triệt tiêu. */
export function detectCorrection(text: string): CorrectionVerdict {
  // PASS 3 — negative triệt tiêu trước (phủ định không phải correction)
  if (NEGATIVE.some((re) => re.test(text))) {
    return { isCorrection: false, reason: "negative pattern" };
  }
  // PASS 1 — strong luôn trigger
  for (const re of STRONG) {
    if (re.test(text)) return { isCorrection: true, reason: "strong pattern" };
  }
  // PASS 2 — weak chỉ trigger NẾU kèm directive clause
  for (const re of WEAK) {
    const m = text.match(re);
    if (m) return { isCorrection: true, reason: "weak + directive", suggestion: extractDirective(text, m.index) };
  }
  return { isCorrection: false, reason: "no match" };
}

function extractDirective(text: string, idx: number | undefined): string | undefined {
  if (idx === undefined) return undefined;
  return text.slice(idx).trim() || undefined;
}
// Real-time: chạy trên user message mới — không chờ nudge interval
// Hành động: failure memory qua AFC gate → trust (governance) → AEQ graduation
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt correction tức thì — không chờ nudge (chi tiết không mất) | ❌ Pattern ngôn ngữ — miss cách diễn đạt khác (cần bổ sung) |
| ✅ 2-pass giảm false positive/negative | ❌ Directive trích thô — có thể cắt sai câu |
| ✅ Deterministic, rẻ — không LLM call | ❌ Negative patterns đè cả strong (cần thứ tự đúng) |
| ✅ Nối trust + failure memory + AEQ sẵn | ❌ Correction nhiều → spam failure memory (cần dedup) |

## Khác các hướng gần

| | AFE Correction Detector | AER Contradiction | AES Confidence Decay |
|---|---|---|---|
| Trọng tâm | Bắt sửa sai real-time | Mâu thuẫn instinct | Confidence theo tuổi |
| Cơ chế | 2-pass filter | Jaccard + verb-pair | -0.05/tuần + clamp |
| Quan hệ | Nguồn failure memory | Chặn graduate | Renew khi correction pass |

## Khi nào chọn

- User hay sửa sai agent — cần học failure ngay, không chờ periodic
- Muốn phân biệt correction thật vs phủ định thường (negative patterns)
- Đã có auto-capture + governance trust + AFC gate — thêm detector
- Cần nguồn failure memory cho AEQ graduation (rule từ lỗi lặp lại)