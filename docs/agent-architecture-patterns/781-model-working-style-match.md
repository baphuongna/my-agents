# Hướng ADA: Model-Working-Style Match — mỗi agent gắn model hợp tính cách làm việc; prompt khác nhau theo family, auto-detect qua isGptModel()

> **Nguồn gốc:** oh-my-openagent (docs/guide/agent-model-matching.md) | **Coupling:** 🟢 — config/routing layer, provider không đổi | **Agent-agnostic:** ⚠️ (phụ thuộc model capability) | **Code sẵn:** ⚠️ (có model-routing + provider-discovery — chưa có working-style match) | **Effort:** 1-2 tuần

## Nguồn gốc

**oh-my-openagent** gắn **mỗi agent với model hợp tính cách làm việc**: (1) **Sisyphus (orchestrator)** dùng **Claude/Kimi/GLM** vì prompt của nó **~1100 dòng checklist** — model này tuân checklist tốt; (2) **Hephaestus (deep worker)** dùng **GPT-5.5** vì **principle-driven** — làm việc theo nguyên tắc hơn là bước cứng; (3) agent hỗ trợ **cả hai family** — **auto-detect qua `isGptModel()`** và **switch prompt** cho phù hợp (checklist-style cho Claude-family, principle-style cho GPT-family). Nguyên tắc: **model không phải công tắc giống nhau — chọn model theo kiểu làm việc, prompt switch theo family**.

## Mô tả

mya model-working-style match: (1) **working style per agent role** — orchestrator (checklist-driven, ưu Claude/Kimi/GLM), deep worker (principle-driven, ưu GPT); (2) **model → family detect** — `isGptModel(modelId)` / `isClaudeFamily(modelId)` (packages/ai model-routing.ts đã có tier hints — mở rộng family detect); (3) **prompt switch** — cùng role nhưng family khác → prompt style khác (checklist vs principles); (4) **config mapping** — mỗi agent role khai báo model ưu tiên + fallback; (5) **resolveModelForPhase** (đã có) nối với working-style. Nối model-routing.ts + provider-discovery.ts — ADA là lớp match role → model → prompt style.

## Kiến trúc

```
  AGENT ROLE
    ├─ Orchestrator (Sisyphus) ── checklist-driven (~1100 dòng)
    │     model: Claude / Kimi / GLM
    └─ Deep worker (Hephaestus) ── principle-driven
          model: GPT-5.5
       ▼
  FAMILY DETECT (isGptModel / isClaudeFamily)
       ▼
  PROMPT SWITCH theo family
    Claude-family ──▶ checklist prompt
    GPT-family    ──▶ principle prompt
       ▼
  PROVIDER (cùng registry — không đổi)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai model-routing.ts — resolveModelForPhase + ModelTier + tier hints
//   (nền — ADA chọn model theo phase)
// ✅ packages/ai provider-discovery.ts — manifestToProfile (nền — danh sách provider)
// ✅ packages/ai registry.ts — ProviderRegistry (nền — swap model profile)
// ✅ packages/ai key-rotation.ts — key management (nền — nhiều provider)
// ✅ packages/prompts assembler.ts — 3-tier prompt (nền — prompt switch theo family)

// ❌ THIẾU: isGptModel / isClaudeFamily detect
// ❌ THIẾU: working-style mapping (role → model → prompt style)
// ❌ THIẾU: prompt switch theo family (checklist vs principle)
```
## Implementation
```typescript
// packages/ai/src/working-style.ts (MỚI)
export type ModelFamily = "gpt" | "claude" | "kimi" | "glm" | "other";
const GPT_HINTS = ["gpt", "o1", "o3", "o4"];
const CLAUDE_HINTS = ["claude", "opus", "sonnet", "haiku"];
const KIMI_HINTS = ["kimi", "moonshot"];
const GLM_HINTS = ["glm", "zhipu"];
/** Family detect — isGptModel() analog, mở rộng đa family. */
export function detectFamily(modelId: string): ModelFamily {
  const id = modelId.toLowerCase();
  if (GPT_HINTS.some((h) => id.includes(h))) return "gpt";
  if (CLAUDE_HINTS.some((h) => id.includes(h))) return "claude";
  if (KIMI_HINTS.some((h) => id.includes(h))) return "kimi";
  if (GLM_HINTS.some((h) => id.includes(h))) return "glm";
  return "other";
}
export function isGptModel(modelId: string): boolean {
  return detectFamily(modelId) === "gpt";
}
export type WorkingStyle = "checklist-driven" | "principle-driven";
export interface RoleModelPref {
  role: string;
  style: WorkingStyle;
  /** Model ưu tiên theo thứ tự — chọn model đầu tiên có family phù hợp. */
  preferredModels: string[];
}
/** Chọn model theo working style — family phù hợp nhất với style. */
export function resolveByWorkingStyle(
  pref: RoleModelPref,
  available: string[],
): { model: string; family: ModelFamily; style: WorkingStyle } | null {
  for (const model of pref.preferredModels) {
    if (!available.includes(model)) continue;
    const family = detectFamily(model);
    const styleOk =
      pref.style === "checklist-driven"
        ? family === "claude" || family === "kimi" || family === "glm"
        : family === "gpt";
    if (styleOk) return { model, family, style: pref.style };
  }
  // Fallback: model đầu tiên có sẵn — style chấp nhận degraded.
  const fallback = available[0];
  if (!fallback) return null;
  return { model: fallback, family: detectFamily(fallback), style: pref.style };
}
/** Prompt switch theo family — cùng role, style khác nhau. */
export function promptForStyle(style: WorkingStyle, role: string): string {
  return style === "checklist-driven"
    ? `Bạn là ${role} (checklist-driven). Tuân theo danh sách bước cứng — không bỏ bước, đánh dấu từng bước hoàn thành.`
    : `Bạn là ${role} (principle-driven). Làm việc theo nguyên tắc — suy luận từ nguyên tắc, không cần bước cứng.`;
}
//        promptForStyle(r.style, "orchestrator") → prompt đúng family
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Model hợp tính cách — chất lượng theo kiểu làm việc | ❌ Mapping role→model phải calibrate thủ công |
| ✅ Prompt switch theo family — tận dụng thế mạnh từng model | ❌ Checklist prompt 1100 dòng tốn token riêng |
| ✅ Fallback — không có model ưa thích vẫn chạy | ❌ Family detect bằng hint chuỗi — model mới có thể miss |
| ✅ Nối resolveModelForPhase — routing có sẵn | ❌ Multi-family = prompt phải duy trì nhiều bản |

## Khác các hướng gần

| | Model routing (model-routing.ts) | ADA: Working-Style Match |
|---|---|---|
| Tiêu chí | Phase (small/medium/big tier) | **Tính cách làm việc (checklist vs principle)** |
| Detect | Tier hints | **Family detect (isGptModel…)** |
| Prompt | Không đổi | **Switch prompt theo family** |
| Quan hệ | Nền | **Lớp trên — match role → model → style** |

## Khi nào chọn

- Nhiều role agent khác nhau — orchestrator vs deep worker cần model khác
- Muốn tận dụng thế mạnh family (Claude checklist, GPT principle)
- Đã có model-routing + provider-discovery — thêm working-style layer
- Guard: fallback luôn có, family detect có test, prompt style per family
