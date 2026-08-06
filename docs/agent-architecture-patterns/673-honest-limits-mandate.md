# Hướng YW: Honest Limits Mandate — mọi skill bắt buộc có Honest Boundaries ≥3 giới hạn + research date, edge question phải tỏ ra uncertainty thay vì tự tin giả — "skill không nói giới hạn là skill không đáng tin" (FINDINGS.md)

> **Nguồn gốc:** awesome-human-distillation (FINDINGS.md) | **Coupling:** 🟢 — content requirement + validation, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill validator + governance — chưa có honest-limit check) | **Effort:** 1-2 tuần

## Nguồn gốc

**awesome-human-distillation** đặt quy tắc trung tâm: **"skill không nói giới hạn là skill không đáng tin"**. Mỗi skill bắt buộc có: (1) **Honest Boundaries — tối thiểu 3 giới hạn** rõ ràng (skill này KHÔNG làm gì, KHÔNG áp dụng khi nào); (2) **research date** — ngày nghiên cứu/kiểm chứng, để người đọc biết thông tin cũ hay mới; (3) **edge question phải tỏ ra uncertainty** — câu hỏi biên (ngoài phạm vi, thiếu dữ kiện) phải trả lời "không chắc/không đủ thông tin" thay vì **tự tin giả** (bịa câu trả lời chắc nịch). Mục đích: chống overclaiming — skill càng tự nhận làm được mọi thứ càng đáng ngờ.

## Mô tả

mya áp dụng honest-limits-mandate: anatomy validator (660 YJ) thêm section bắt buộc **Honest Boundaries**: ≥ 3 bullet giới hạn (mỗi bullet dạng "Không áp dụng khi...", "Không hỗ trợ...", "Độ chính xác giới hạn...") + **researchDate** trong frontmatter. Validator: (1) đếm boundary bullet ≥ 3 — thiếu → skill `incomplete` (kèm 660 YJ flag); (2) researchDate ≤ 180 ngày — cũ → warning stale; (3) scan body tìm **overclaim phrase** ("luôn luôn đúng", "chắc chắn 100%", "mọi trường hợp") → cảnh báo. Edge question: skill body có hướng dẫn "khi thiếu dữ kiện → nói không đủ thông tin" — enforcement qua prompt (656 YF declarative) + review. mya có sẵn 660 YJ anatomy validator (validate skill), skills curator, prompts/assembler (chèn honesty instruction) — YW thêm **boundary counter** + **overclaim scan** + **research date check**.

## Kiến trúc

```
  SKILL.md BẮT BUỘC:
    ## Honest Boundaries
      - Không áp dụng khi: [điều kiện 1]
      - Không hỗ trợ: [giới hạn 2]
      - Độ chính xác: [giới hạn 3]
    frontmatter: researchDate: 2026-08-01

  HONEST-LIMIT VALIDATOR:
    ├─ boundary bullets ≥ 3?      → thiếu → incomplete (nối 660 YJ)
    ├─ researchDate ≤ 180 ngày?   → cũ → warn stale
    └─ overclaim scan: "luôn luôn|100%|mọi trường hợp"
        → có → cảnh báo, yêu cầu sửa thành uncertainty

  Runtime: edge question → body hướng dẫn "không đủ dữ kiện → nói không chắc"
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills anatomy-validator.ts (660 YJ) — validate skill (nền — YW mở rộng)
// ✅ packages/skills skill.ts — frontmatter parse (nền — YW researchDate field)
// ✅ packages/skills curator.ts — đánh giá skill (nền — YW chạy trong curator)
// ✅ packages/prompts assembler.ts — ghép prompt (nền — YW chèn honesty instruction)
// ✅ packages/core time.ts — nowWallclock (nền — YW researchDate check)

// ❌ THIẾU: boundary counter (≥ 3 bullets)
// ❌ THIẾU: overclaim scan (phrase tự tin giả)
// ❌ THIẾU: research date staleness check
```

## Implementation (TS)

```typescript
// packages/skills/src/honest-limits.ts (MỚI)
import { nowWallclock } from "@my-agent/core";

export interface HonestReport {
  boundaryCount: number;
  researchDate: string | null;
  overclaims: string[];
  ok: boolean;       // ≥ 3 boundaries + không overclaim
  stale: boolean;    // researchDate > 180 ngày
}

const MIN_BOUNDARIES = 3;
const MAX_AGE_DAYS = 180;
const OVERCLAIM = /\b(luôn luôn đúng|chắc chắn 100%|mọi trường hợp|never fails|always correct|guaranteed)\b/i;

export function checkHonestLimits(body: string, researchDate: string | null): HonestReport {
  // 1. đếm boundary bullets — dạng "- Không..." hoặc "- Chỉ..."
  const boundarySection = body.split("## Honest Boundaries")[1] ?? "";
  const bullets = boundarySection.split("\n").filter((l) => /^\s*[-*]\s/.test(l));
  const boundaries = bullets.filter((b) => /\b(không|chỉ|giới hạn|không áp dụng|không hỗ trợ)\b/i.test(b));

  // 2. overclaim scan toàn body
  const overclaims = [...body.matchAll(OVERCLAIM)].map((m) => m[0]);

  // 3. research date staleness
  const stale = researchDate ? (Date.now() - new Date(researchDate).getTime()) / 86_400_000 > MAX_AGE_DAYS : true;

  return {
    boundaryCount: boundaries.length,
    researchDate,
    overclaims,
    ok: boundaries.length >= MIN_BOUNDARIES && overclaims.length === 0,
    stale,
  };
}

// Usage:
// const r = checkHonestLimits(skill.body, skill.frontmatter.researchDate);
// r.ok || markIncomplete(skill.name, `Honest Boundaries cần ≥ ${MIN_BOUNDARIES} (có ${r.boundaryCount})`);
// r.stale && warn(`${skill.name}: researchDate cũ > ${MAX_AGE_DAYS} ngày`);
// r.overclaims.length && warn(`overclaim: ${r.overclaims.join(", ")} — sửa thành uncertainty`);
```

## Được

- ✅ Chống tự tin giả — skill phải khai giới hạn, không overclaim
- ✅ Boundary ≥ 3 bắt buộc — validator chặn skill "làm được hết"
- ✅ Research date — người đọc biết thông tin cũ/mới
- ✅ Overclaim scan máy được — phrase tự tin giả bị cảnh báo
- ✅ Edge question có hướng — "không đủ dữ kiện → nói không chắc"

## Mất

- ❌ Boundary đếm lỏng — bullet "Không..." chung chung vẫn đếm
- ❌ Overclaim regex hời — tự tin giả dùng câu văn khác không bắt được
- ❌ Research date khai sai — skill tự khai ngày gần đây dù nội dung cũ

## Khác các hướng gần

| | Skill không giới hạn | Disclaimer đuôi trang | YW: Honest Limits |
|---|---|---|---|
| Vị trí | không | ngoài lề | **section bắt buộc** |
| Cưỡng chế | không | không | **validator đếm ≥ 3** |
| Freshness | không | không | **researchDate + stale check** |

## Khi nào chọn

- Skill library bị overclaim (skill tự nhận chính xác tuyệt đối)
- Muốn validator chặn skill thiếu giới hạn (nối 660 YJ anatomy)
- Có anatomy-validator + skill.ts + time sẵn — YW thêm checks
- Nối packages/skills anatomy-validator.ts (mở rộng) + skill.ts (researchDate field) + curator.ts (chạy) + prompts/assembler.ts (chèn honesty instruction vào prompt); guard boundary-quality (bullet chung chung "Không hoàn hảo" không tính — đòi cụ thể), overclaim-context (trích dẫn người khác chứa "guaranteed" — loại trừ quote), và date-truth (researchDate lấy từ git commit/provenance, không tin frontmatter mù); YW = honest limits, kết hợp 660 YJ skill-anatomy (section bắt buộc) + 671 YU triple-gate (epistemic filter) + 672 YV stylometry (đo certainty tone)
