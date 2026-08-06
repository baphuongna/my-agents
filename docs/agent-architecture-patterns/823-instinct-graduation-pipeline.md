# Hướng AEQ: Instinct Graduation Pipeline — instinct đủ tuổi/confidence/confirmations graduate thành AGENTS.md/skill/command

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟢 — vòng đời tri thức độc lập, gắn qua hook | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn AGENTS.md load + skills curator; thiếu graduation pipeline) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-extensions** (src/graduation.ts): **instinct** (tri thức thô, chưa chắc chắn) đủ điều kiện sẽ **graduate** thành dạng bền vững hơn — **AGENTS.md / skill / command**; ngược lại quá **TTL** thì **cull** (xóa). Điều kiện graduate: **GRADUATION_MIN_AGE_DAYS** (đủ tuổi — không graduate ngay lúc mới sinh), **đủ confidence**, **đủ confirmations** (nhiều lần được xác nhận đúng). Đây là **vòng đời tri thức có điểm kết thúc rõ** (explicit lifecycle): tri thức không tồn tại vô hạn ở trạng thái mơ hồ — hoặc được thăng cấp thành nguồn chính thức (AGENTS.md/skill/command), hoặc bị loại.

Giá trị: (1) **tự thăng cấp** — tri thức lặp lại nhiều lần, đúng nhiều lần → thành quy tắc chính thức; (2) **chống rác** — tri thức không được xác nhận, quá hạn → cull, không tích lũy vô hạn; (3) **phân tầng rõ** — instinct (thô) < skill (đóng gói) < command (hành động) — mỗi tầng có ngưỡng khác nhau.

## Mô tả

Với mya, pattern = **tri thức phân tầng + pipeline thăng cấp**: (1) **tầng** — instinct (thô, session-scoped) → AGENTS.md (context chính thức) / skill (`packages/skills` — đã có SkillStore + curator) / command (hành động tái dùng); (2) **điều kiện** — age ≥ GRADUATION_MIN_AGE_DAYS + confidence ≥ ngưỡng + confirmations ≥ ngưỡng (nối AES passive decay — confidence giảm theo thời gian, instinct cũ mà không được confirm sẽ không bao giờ đủ điều kiện); (3) **pipeline** — check định kỳ (hook sau turn hoặc cron): đủ điều kiện → graduate (ghi vào AGENTS.md / tạo skill qua SkillCurator / đăng ký command); quá TTL → cull; (4) **nguồn dữ liệu** — instinct có thể đến từ auto-capture (`packages/memory/auto-capture` — bắt câu trả lời lặp lại) hoặc correction detector (nối AFE — failure memory là ứng viên graduate thành rule). Đây là pattern **knowledge lifecycle**: tri thức có tuổi, có điều kiện thăng cấp, có điểm kết thúc.

## Kiến trúc (ASCII)

```
  INSTINCT (thô — session/auto-capture/AFE failure memory)
    │  age += ngày · confidence (AES decay nếu không confirm)
    ▼
  CHECK GRADUATION (định kỳ — hook/cron)
    ├─ age ≥ MIN_AGE_DAYS
    ├─ confidence ≥ ngưỡng
    └─ confirmations ≥ ngưỡng
        │
        ▼ ĐỦ → GRADUATE
  ├─► AGENTS.md (context chính thức — core load sẵn)
  ├─► skill (packages/skills — SkillCurator)
  └─► command (hành động tái dùng)
        │
        ▼ QUÁ TTL / confidence < 0.1 (AES) → CULL (xóa)
  (tri thức không mắc kẹt mãi ở trạng thái mơ hồ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts/src/assembler.ts — load AGENTS.md vào context tier
//   (đích graduate số 1 — đã có pipeline đọc)
// ✅ packages/skills/src/skill.ts + curator.ts — SkillStore + curate()
//   (đích graduate số 2 — đã có)
// ✅ packages/memory/src/auto-capture.ts — bắt tri thức thô (nguồn instinct)
// ✅ packages/memory/src/governance.ts — trust score + feedback (confidence analog)
// ✅ packages/memory/src/weibull.ts — decay theo thời gian (nền AES)
// ✅ packages/memory/src/conflict.ts — supersede (thay tri thức cũ)

// ❌ THIẾU: instinct model (age/confidence/confirmations/TTL)
// ❌ THIẾU: graduation pipeline (check + graduate + cull)
// ❌ THIẾU: nối AGENTS.md/skills writer khi graduate
```

## Implementation

```typescript
// packages/skills/src/graduation.ts (NEW)
export interface Instinct {
  id: string;
  text: string;
  createdAt: number;
  confidence: number;        // 0..1 (AES decay theo tuổi)
  confirmations: number;
  kind: "rule" | "skill" | "command";
}

export const GRADUATION_MIN_AGE_DAYS = 14;
export const GRADUATION_MIN_CONFIDENCE = 0.8;
export const GRADUATION_MIN_CONFIRMATIONS = 3;
export const INSTINCT_TTL_DAYS = 90;

export function graduationStatus(i: Instinct, now: number): "pending" | "graduate" | "cull" {
  const ageDays = (now - i.createdAt) / 86_400_000;
  if (ageDays > INSTINCT_TTL_DAYS || i.confidence < 0.1) return "cull";  // AES: quá hạn/decay
  if (ageDays >= GRADUATION_MIN_AGE_DAYS &&
      i.confidence >= GRADUATION_MIN_CONFIDENCE &&
      i.confirmations >= GRADUATION_MIN_CONFIRMATIONS) return "graduate";
  return "pending";
}

export async function runGraduation(
  instincts: Instinct[],
  now: number,
  sinks: {
    toAgentsMd: (text: string) => Promise<void>;   // ghi AGENTS.md
    toSkill: (text: string) => Promise<void>;      // SkillCurator
    toCommand: (text: string) => Promise<void>;
    cull: (id: string) => Promise<void>;
  },
): Promise<{ graduated: number; culled: number }> {
  let graduated = 0, culled = 0;
  for (const i of instincts) {
    const s = graduationStatus(i, now);
    if (s === "graduate") {
      if (i.kind === "rule") await sinks.toAgentsMd(i.text);
      else if (i.kind === "skill") await sinks.toSkill(i.text);
      else await sinks.toCommand(i.text);
      graduated++;
    } else if (s === "cull") {
      await sinks.cull(i.id);
      culled++;
    }
  }
  return { graduated, culled };
}
// Nguồn instinct: auto-capture + AFE failure memory → lưu Instinct[]
// AES: confidence giảm theo tuổi — instinct già không confirm sẽ cull
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tri thức tự thăng cấp — không cần người gõ lại rule | ❌ Graduate nhầm → quy tắc xấu vào AGENTS.md (cần undo) |
| ✅ Chống tích lũy rác (TTL + cull) | ❌ Ngưỡng age/confidence khó tune (tùy miền) |
| ✅ Vòng đời rõ: thô → chính thức → hết hạn | ❌ Confirmations cần nguồn đếm đáng tin (tránh self-confirm) |
| ✅ Nối sẵn AGENTS.md + skills + memory | ❌ Command graduate cần registry — thêm surface |

## Khác các hướng gần

| | AEQ Graduation | AES Confidence Decay | AFE Correction Detector |
|---|---|---|---|
| Trọng tâm | Thăng cấp/cull tri thức | Confidence giảm theo tuổi | Phát hiện correction |
| Cơ chế | Pipeline + ngưỡng | -0.05/tuần + clamp | 2-pass filter |
| Quan hệ | Tiêu thụ confidence (AES) | Nguồn confidence | Nguồn instinct mới |

## Khi nào chọn

- Agent lặp lại cùng tri thức nhiều lần — muốn tự động hóa thành rule
- Đã có AGENTS.md + skills curator + auto-capture — thêm pipeline
- Muốn vòng đời tri thức có điểm kết thúc (graduate/cull) rõ ràng
- Cần chống memory rác tích lũy vô hạn