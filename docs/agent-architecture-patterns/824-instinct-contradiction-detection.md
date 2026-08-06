# Hướng AER: Instinct Contradiction Detection — phát hiện instinct mâu thuẫn bằng heuristic deterministic, không tốn LLM call

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟢 — thuật toán thuần, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn conflict.ts jaccard; thiếu verb-pair heuristic) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions** (src/instinct-contradiction.ts): phát hiện **instinct mâu thuẫn** bằng **heuristic thuần deterministic**: (1) **Jaccard similarity trên trigger** — hai instinct có trigger (bối cảnh kích hoạt) giống nhau → nghi ngờ mâu thuẫn; (2) **cặp động từ đối nghịch** — `avoid/prefer`, `never/always` (và các cặp tương tự) — nếu cùng trigger mà hướng dẫn đối nghịch → kết luận mâu thuẫn. Điểm mấu chốt: **không tốn LLM call** — thuật toán chạy O(n²) trên bộ instinct, deterministic, rẻ, không phụ thuộc model.

Giá trị: (1) **rẻ** — chạy mọi lúc (sau mỗi turn/cron), không tốn token; (2) **deterministic** — cùng input ra cùng kết quả, test được chính xác; (3) **phát hiện sớm** — instinct mâu thuẫn bị gắn cờ trước khi graduate (nối AEQ) thành AGENTS.md/skill — tránh quy tắc xung đột vào nguồn chính thức. Failure mode chống: hai rule "khi X: luôn dùng A" và "khi X: không bao giờ dùng A" cùng tồn tại → agent hành xử ngẫu nhiên theo thứ tự context.

## Mô tả

Với mya, pattern = **contradiction detector + policy** trên tri thức: (1) **nền sẵn có** — `packages/memory/conflict.ts` đã có **Jaccard similarity** cho conflict detection + supersede (chỉ khác: conflict.ts so *nội dung*, pattern này so *trigger* + *động từ hướng dẫn*); (2) **detector** — nhóm instinct theo trigger similarity ≥ ngưỡng (Jaccard), trong nhóm tìm cặp **verb-pair đối nghịch** (avoid/prefer, never/always, do/don't, must/must-not, tăng/giảm…); (3) **policy** — phát hiện mâu thuẫn → **không tự xóa** (surfacing, học từ governance.ts: "contradiction detection surfaces, does NOT auto-resolve" — human-in-loop); gắn cờ `conflictsWith[]` để AEQ graduation **chặn graduate** cho tới khi giải quyết; (4) **chạy định kỳ** — sau turn (hook) hoặc cron, O(n²) với n nhỏ (instinct ít). Đây là pattern **deterministic validation**: rẻ + chắc chắn cho một lớp lỗi cụ thể, LLM không cần tham gia.

## Kiến trúc (ASCII)

```
  INSTINCT SET (n — nhỏ)
    │
    ▼ 1. NHÓM THEO TRIGGER (Jaccard similarity ≥ ngưỡng)
  ├─ trigger "khi build fail"  → { i1: "luôn chạy typecheck", i2: "tránh typecheck" }
  ├─ trigger "khi commit"      → { i3: "never tự commit", i4: "always tự commit" }
    │
    ▼ 2. TÌM CẶP ĐỘNG TỪ ĐỐI NGHỊCH (trong từng nhóm)
  ├─ (avoid, prefer) · (never, always) · (do, don't) · (must, must-not) …
  └─→ MÂU THUẪN: i1 ↔ i2, i3 ↔ i4
    │
    ▼ 3. POLICY (không tự xóa — human-in-loop, như governance.ts)
  ├─ gắn cờ conflictsWith[] — AEQ chặn graduate 2 instinct đó
  └─ surface cho user/agent giải quyết
  (không tốn LLM call — deterministic, test được)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/conflict.ts — Jaccard similarity + supersede
//   (nền thuật toán — chỉ khác: so nội dung, pattern này so trigger+verb)
// ✅ packages/memory/src/governance.ts — contradiction SURFACES, không auto-resolve
//   (chính sách human-in-loop — dùng chung)
// ✅ packages/memory/src/auto-capture.ts — nguồn instinct (text để so sánh)
// ✅ packages/skills/src/graduation.ts (AEQ) — chặn graduate khi conflictsWith
// ✅ packages/core — hook sau turn (ToolHookSink postTool — điểm chạy định kỳ)

// ❌ THIẾU: trigger extraction + Jaccard trên trigger
// ❌ THIẾU: verb-pair đối nghịch dictionary (avoid/prefer, never/always…)
// ❌ THIẾU: conflictsWith[] gắn cờ + policy chặn graduate
```

## Implementation

```typescript
// packages/skills/src/instinct-contradiction.ts (NEW)
const OPPOSITE_VERBS: ReadonlyArray<[RegExp, RegExp]> = [
  [/\bavoid\b/i, /\bprefer\b/i],
  [/\bnever\b/i, /\balways\b/i],
  [/\bdon'?t\b/i, /\bdo\b/i],
  [/\bmust not\b/i, /\bmust\b/i],
];

export interface InstinctTrigger { id: string; trigger: string; body: string; }

/** Jaccard similarity trên trigger (đã có nền conflict.ts — tái dùng). */
export function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const sb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  const inter = [...sa].filter((t) => sb.has(t)).length;
  return inter / (sa.size + sb.size - inter);
}

/** Tìm cặp mâu thuẫn: trigger giống + động từ đối nghịch. */
export function findContradictions(
  instincts: InstinctTrigger[],
  triggerThreshold = 0.6,
): Array<[InstinctTrigger, InstinctTrigger, string]> {
  const out: Array<[InstinctTrigger, InstinctTrigger, string]> = [];
  for (let i = 0; i < instincts.length; i++) {
    for (let j = i + 1; j < instincts.length; j++) {
      const a = instincts[i]!, b = instincts[j]!;
      if (jaccard(a.trigger, b.trigger) < triggerThreshold) continue;
      for (const [reA, reB] of OPPOSITE_VERBS) {
        const aHas = reA.test(a.body), bHas = reB.test(b.body);
        const swapped = reB.test(a.body) && reA.test(b.body);
        if ((aHas && bHas) || swapped) {
          out.push([a, b, `opposite verbs on shared trigger`]);
        }
      }
    }
  }
  return out;
}
// Policy: không tự xóa (như governance.ts) — gắn cờ conflictsWith[]
// AEQ graduation: instinct có conflictsWith → chặn graduate tới khi giải quyết
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rẻ — không tốn LLM call, chạy thường xuyên | ❌ Chỉ bắt mâu thuẫn *từ vựng* — nghĩa đối nghịch khác từ ngữ bị sót |
| ✅ Deterministic — test chính xác, không phụ thuộc model | ❌ Jaccard thô trên trigger — từ đồng nghĩa không nhận ra |
| ✅ Phát hiện sớm — chặn graduate trước khi vào nguồn chính thức | ❌ Verb-pair dictionary phải bảo trì (thêm cặp mới) |
| ✅ Đã có nền (conflict.ts Jaccard + governance policy) | ❌ False positive — cần surface chứ không tự xóa |

## Khác các hướng gần

| | AER Contradiction | AFC Content Scanner | AEQ Graduation |
|---|---|---|---|
| Trọng tâm | Mâu thuẫn giữa instinct | Chống injection/secret | Thăng cấp tri thức |
| Cơ chế | Jaccard + verb-pair | Pattern block + secret scan | Pipeline + ngưỡng |
| Quan hệ | Chặn graduate (AEQ) | Lớp an toàn lưu trữ | Tiêu thụ flags của AER |

## Khi nào chọn

- Nhiều instinct/rule tích lũy — nguy cơ xung đột hướng dẫn
- Muốn kiểm tra rẻ + deterministic, không tốn token
- Đã có conflict.ts (Jaccard) + governance policy — thêm verb-pair
- Cần chặn quy tắc mâu thuẫn graduate vào AGENTS.md/skill