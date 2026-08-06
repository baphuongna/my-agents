# Hướng ZZ: Auto-Clarity Escape Hatch — tự tắt nén khi gặp cảnh báo an toàn, hành động không hoàn tác được, hoặc chuỗi nhiều bước dễ đọc nhầm

> **Nguồn gốc:** caveman (skills/caveman/SKILL.md) | **Coupling:** 🟡 — chèn vào pipeline nén prompt/context trước LLM call | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có compressors + DriftGrader — chưa có escape-hatch trigger) | **Effort:** 1-2 tuần

## Nguồn gốc

**caveman** có cơ chế **auto-clarity**: khi agent đang nén prompt/context để tiết kiệm token, một số tình huống bắt buộc **tự tắt nén** và dùng text đầy đủ. Trigger gồm 3 loại: (1) **Security warning** — cảnh báo bảo mật xuất hiện; (2) **Irreversible action** — hành động không thể hoàn tác (xóa, overwrite, force-push); (3) **Multi-step chain dễ đọc nhầm** — chuỗi nhiều bước mà việc tóm tắt làm mất thứ tự/logic. Nguyên tắc: **an toàn và chính xác ưu tiên hơn tiết kiệm token** — compression chỉ an toàn khi context "đọc nhầm cũng không gây hại".

## Mô tả

mya auto-clarity escape hatch: chèn **gate** vào pipeline nén (packages/prompts compressors.ts): trước khi áp compressor, scan context cho 3 trigger — `security_warning` (regex/pattern), `irreversible_action` (tool name + arg heuristic), `multi_step_chain` (số bước liên tiếp > ngưỡng). Nếu trigger kích hoạt → **bypass compressor** (giữ nguyên text) + emit RuntimeEvent `{kind:"clarity", reason}` để telemetry đo được tần suất. Kết hợp DriftGrader hiện có (đo drift) — escape hatch là gate **trước** compression, còn DriftGrader là gate **sau**.

## Kiến trúc

```
  PROMPT/CTX TRƯỚC NÉN
        │
        ▼
  ┌─── ESCAPE-HATCH GATE ──────────────────────────────┐
  │  scan triggers:                                     │
  │   ├─ security_warning?     (regex: CVE, exploit…)   │
  │   ├─ irreversible_action?  (rm -rf, force-push…)    │
  │   └─ multi_step_chain?     (≥ N bước liên tiếp)     │
  │  → ANY true ⇒ BYPASS compressor (giữ nguyên)       │
  │  → all false ⇒ nén bình thường                     │
  └──────────────┬──────────────────┬──────────────────┘
                 ▼                  ▼
        LLM call (đầy đủ)   LLM call (nén — DriftGrader đo sau)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts compressors.ts — windowCompressor + summarizeCompressor
// ✅ packages/prompts drift.ts — DriftGrader (gate SAU compression)
// ✅ packages/prompts compress.ts — CompressPipeline (nơi chèn gate)
// ✅ packages/core redact.ts — pattern scan nền cho trigger regex
// ✅ packages/tools permission.ts — irreversible tool list nền (rm, delete…)
// ✅ packages/core telemetry.ts — đo tần suất bypass

// ❌ THIẾU: escape-hatch gate (scan trigger → bypass)
// ❌ THIẾU: multi-step chain detector (đếm bước liên tiếp)
// ❌ THIẾU: RuntimeEvent {kind:"clarity"} khi bypass
```

## Implementation

```typescript
// packages/prompts/src/clarity-gate.ts (NEW)
import type { Compressor, History, RuntimeEvent } from "@my-agent/core";

export type ClarityTrigger =
  | "security_warning" | "irreversible_action" | "multi_step_chain";

const SECURITY_RE = /\b(CVE-\d{4}-\d+|exploit|breach|vulnerab|0-day|malware)\b/i;
const IRREVERSIBLE = new Set(["rm", "delete", "overwrite", "force-push", "drop_table", "format"]);
const CHAIN_MIN_STEPS = 4;

export interface ClarityDecision { bypass: boolean; triggers: ClarityTrigger[] }

export function shouldBypassCompression(ctx: {
  text: string; toolCalls: string[]; stepCount: number;
}): ClarityDecision {
  const triggers: ClarityTrigger[] = [];
  if (SECURITY_RE.test(ctx.text)) triggers.push("security_warning");
  if (ctx.toolCalls.some((t) => IRREVERSIBLE.has(t))) triggers.push("irreversible_action");
  if (ctx.stepCount >= CHAIN_MIN_STEPS) triggers.push("multi_step_chain");
  return { bypass: triggers.length > 0, triggers };
}

export function gateCompression(
  compressor: Compressor,
  emit: (e: RuntimeEvent) => void,
): Compressor {
  return {
    compress(history: History, opts) {
      const d = shouldBypassCompression({ text: JSON.stringify(history), toolCalls: opts.tools ?? [], stepCount: opts.steps ?? 0 });
      if (d.bypass) {
        emit({ kind: "clarity", stage: "compress-bypass", reason: d.triggers.join(",") });
        return history; // giữ nguyên — an toàn hơn token
      }
      return compressor.compress(history, opts);
    },
    ratio: compressor.ratio,
  };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ An toàn: security warning không bị tóm tắt mất ý | ❌ Mất token saving trên đoạn bypass |
| ✅ Hành động không hoàn tác được luôn thấy đủ context | ❌ Trigger regex có thể false-positive |
| ✅ Chuỗi nhiều bước giữ nguyên thứ tự logic | ❌ Phải đo tần suất (telemetry) để tinh trigger |
| ✅ Agent-agnostic — chèn ở lớp nén, không đụng agent | ❌ Chain detector heuristic (số bước) cần chỉnh |

## Khác các hướng gần

| | DriftGrader | Clarity Escape Hatch |
|---|---|---|
| Vị trí | Sau nén (đo drift) | **Trước nén (bypass)** |
| Chi phí | Replay golden trace (tốn) | **Regex scan (rẻ)** |
| Bảo vệ | Chất lượng output | **An toàn + chính xác** |
| Mối quan hệ | Gate sau | **Gate trước — bổ sung** |

## Khi nào chọn

- Đã có compressor (window/summarize) mà lo ngại mất thông tin quan trọng
- Agent thao tác hành động không hoàn tác được (delete/force-push)
- Chuỗi nhiều bước dài — cần giữ nguyên context cho đúng thứ tự
- Kết hợp DriftGrader: escape-hatch chặn trước, DriftGrader kiểm sau; đo tần suất bypass bằng telemetry để tránh lạm dụng
