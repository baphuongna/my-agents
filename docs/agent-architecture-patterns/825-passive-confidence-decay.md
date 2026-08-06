# Hướng AES: Passive Confidence Decay — confidence giảm -0.05/tuần theo tuổi, clamp, chỉ persist khi đổi thật

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟢 — thuật toán thuần trên tri thức | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn weibull decay + trust feedback; thiếu passive decay model) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions** (src/instinct-decay.ts): **confidence giảm -0.05/tuần** theo `updated_at` — tri thức càng cũ (không được xác nhận lại) càng mất tin cậy; giá trị **clamp [0.1, 0.9]** (không xuống dưới 0.1 — dưới ngưỡng này bị **flag removal**; không vượt 0.9 — tránh quá tự tin tuyệt đối); và quan trọng: **chỉ persist khi thay đổi > 0.001** — tránh ghi đĩa thừa mỗi lần check (tri thức không đổi → không ghi).

Giá trị: (1) **tri thức cũ tự mất uy tín** — agent không mãi tin một rule từ lâu không được kiểm chứng; (2) **điểm kết thúc rõ** — dưới 0.1 → removal candidate (nối AEQ graduation cull); (3) **hiệu quả** — decay tính từ `updated_at` (lười: không cần job chạy, tính khi đọc), chỉ persist khi đáng — tiết kiệm đĩa/I/O; (4) **khác trust feedback** (governance.ts ± 0.05/0.10 theo helpful/unhelpful) — decay là *passive* (theo thời gian), trust là *active* (theo feedback) — hai chiều bổ sung.

## Mô tả

Với mya, pattern = **confidence time-decay cho tri thức** gắn với hệ đã có: (1) **model** — tri thức có `confidence`, `updatedAt`; mỗi lần đọc: `effective = clamp(confidence - 0.05 * weeksSince(updatedAt), 0.1, 0.9)` — **tính lười lúc đọc**, không cần background job; (2) **renew** — khi tri thức được confirm lại (nối AEQ confirmations / AFE correction pass) → `updatedAt = now`, confidence hồi về; (3) **persist gating** — sau khi tính, nếu `|effective - stored| > 0.001` mới ghi (tránh ghi thừa mỗi tuần); (4) **policy** — effective < 0.1 → flag removal (AEQ cull / auto-capture dedup thay thế); (5) **kết hợp** — memory đã có `weibull.ts` decay theo type (profile chậm, event nhanh) và `governance.ts` trust feedback — pattern này thêm **confidence decay tuyến tính -0.05/tuần** cho tầng instinct/rule. Đây là pattern **passive forgetting**: tri thức cũ tự phai nếu không được dùng/xác nhận.

## Kiến trúc (ASCII)

```
  TRI THỨC (instinct/rule — có confidence + updatedAt)
    │
    ▼ ĐỌC (lười — không cần job nền)
  weeks = (now - updatedAt) / 7d
  effective = clamp(confidence − 0.05·weeks, 0.1, 0.9)
    │
    ▼ PERSIST GATING
  ├─ |effective − stored| > 0.001 ──► GHI (thay đổi thật)
  └─ khác ──► KHÔNG ghi (tiết kiệm đĩa/I/O)
    │
    ▼ POLICY
  ├─ effective < 0.1 ──► flag removal (AEQ cull)
  ├─ được confirm lại   ──► updatedAt=now, confidence hồi (renew)
  └─ clamp [0.1, 0.9] — không quá tự tin / không vô dụng
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/weibull.ts — decay theo type (profile chậm, event nhanh)
//   (nền decay theo thời gian — khác: Weibull non-linear, AES linear -0.05/tuần)
// ✅ packages/memory/src/governance.ts — trust feedback ±0.05/0.10 (active)
//   (bổ sung: trust = feedback, confidence = passive decay)
// ✅ packages/memory/src/conflict.ts — supersede (thay tri thức cũ)
// ✅ packages/skills/src/graduation.ts (AEQ) — cull khi confidence thấp
// ✅ packages/core — nowWallclock (nguồn thời gian thống nhất)

// ❌ THIẾU: confidence model + decay linear -0.05/tuần
// ❌ THIẾU: persist gating (>0.001) — chỉ ghi khi đổi thật
// ❌ THIẾU: renew (confirm → updatedAt=now) + flag removal < 0.1
```

## Implementation

```typescript
// packages/skills/src/instinct-decay.ts (NEW)
export const CONFIDENCE_DECAY_PER_WEEK = 0.05;
export const CONFIDENCE_MIN = 0.1;
export const CONFIDENCE_MAX = 0.9;
export const PERSIST_EPSILON = 0.001;

export interface Decayable {
  confidence: number;
  updatedAt: number;
}

/** Tính lười lúc đọc — không cần job nền chạy định kỳ. */
export function effectiveConfidence(d: Decayable, now: number): number {
  const weeks = (now - d.updatedAt) / (7 * 86_400_000);
  const decayed = d.confidence - CONFIDENCE_DECAY_PER_WEEK * weeks;
  return Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, decayed));
}

/** Chỉ persist khi thay đổi thật (>0.001) — tránh ghi đĩa thừa. */
export function shouldPersist(stored: number, computed: number): boolean {
  return Math.abs(stored - computed) > PERSIST_EPSILON;
}

/** Renew khi được confirm — confidence hồi về mức cao. */
export function renew(d: Decayable, now: number): { confidence: number; updatedAt: number } {
  return { confidence: Math.min(CONFIDENCE_MAX, d.confidence + 0.2), updatedAt: now };
}

export function isRemovalCandidate(d: Decayable, now: number): boolean {
  return effectiveConfidence(d, now) < CONFIDENCE_MIN;   // → AEQ cull
}
// Lưu trữ: { confidence, updatedAt } — đọc qua effectiveConfidence()
// Nối AEQ: removal candidate → graduation pipeline cull
// Nối AFE/AEQ: confirm pass → renew() → updatedAt=now
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tri thức cũ tự phai — không mãi tin rule xưa | ❌ Rule ổn định nhưng ít dùng cũng bị decay (cần renew policy) |
| ✅ Tính lười lúc đọc — không cần job nền | ❌ updatedAt sai (import/backup) → decay sai |
| ✅ Persist gating — tiết kiệm đĩa/I/O | ❌ Clamp 0.1 dưới vẫn còn trong kho — chỉ flag, không tự xóa |
| ✅ Bổ sung trust feedback (governance) | ❌ Hằng số -0.05/tuần cần tune theo miền |

## Khác các hướng gần

| | AES Passive Decay | AFE Correction Detector | AEQ Graduation |
|---|---|---|---|
| Trọng tâm | Confidence theo tuổi | Phát hiện correction | Thăng cấp/cull |
| Cơ chế | -0.05/tuần + clamp + gating | 2-pass filter | Pipeline + ngưỡng |
| Quan hệ | Nguồn confidence cho AEQ | Renew/nguồn confirm | Tiêu thụ decay |

## Khi nào chọn

- Tri thức tích lũy nhiều — cần tự mất uy tín theo thời gian
- Đã có weibull + governance trust — thêm passive linear decay
- Muốn tránh ghi đĩa thừa khi decay không đáng kể
- Cần nguồn tín hiệu cho graduation cull (AEQ)