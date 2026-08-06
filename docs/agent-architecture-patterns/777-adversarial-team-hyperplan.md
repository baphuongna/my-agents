# Hướng ACW: Adversarial Team Hyperplan — hyperplan tự orchestrate 5 hostile category members qua team-mode để cross-critique tàn nhẫn, chỉ insight defensible sống sót

> **Nguồn gốc:** oh-my-openagent (.opencode/skills/hyperplan/SKILL.md) | **Coupling:** 🟡 — thêm hyperplan orchestration vào planning | **Agent-agnostic:** ⚠️ (phụ thuộc multi-agent + model) | **Code sẵn:** ⚠️ (có council + adversarial — chưa có hyperplan gauntlet) | **Effort:** 2 tuần

## Nguồn gốc

**oh-my-openagent** có **hyperplan** — tự orchestrate **5 hostile category members** qua **team-mode** để **cross-critique tàn nhẫn**: `unspecified-low` (chê thiếu chi tiết), `unspecified-high` (chê thiếu tham vọng), `deep` (đào sâu khía cạnh bị bỏ qua), `ultrabrain` (đòi insight vượt trội), `artistry` (đòi tính nghệ thuật/đẹp). Mỗi member là một **hostile reviewer** — không nể nang. Chỉ **insight "defensible"** sống sót qua **gauntlet** (chuỗi critique) mới được **distill**, rồi **bàn giao bắt buộc** cho `plan` agent formalize thành **executable plan**. Nguyên tắc: **nhiều góc nhìn thù địch có chủ đích, chỉ cái chống đỡ được mới giữ, distill rồi formalize**.

## Mô tả

mya adversarial team hyperplan: (1) **5 hostile members** — mỗi member một persona critique riêng (thiếu chi tiết / thiếu tham vọng / nông / thiếu insight / thiếu artistry); (2) **team-mode orchestration** — chạy tuần tự/đồng thời, mỗi member critique bản draft, critique sau thấy critique trước (cross-critique tàn nhẫn); (3) **gauntlet survival** — insight nào bị mọi member bắn hạ thì loại; (4) **distill** — insight sống sót gom thành bản sạch; (5) **bàn giao bắt buộc cho plan agent** — distill phải thành executable plan (không dừng ở insight). Nối council.ts (fan-out) + adversarial.ts (refute) — ACW là orchestration tầng cao.

## Kiến trúc

```
  DRAFT PLAN
       ▼
  TEAM-MODE — 5 HOSTILE MEMBERS (cross-critique)
    ├─ unspecified-low   — "thiếu chi tiết"
    ├─ unspecified-high  — "thiếu tham vọng"
    ├─ deep              — "khía cạnh bị bỏ qua"
    ├─ ultrabrain        — "insight chưa vượt trội"
    └─ artistry          — "chưa đẹp/thanh thoát"
       │  mỗi critique thấy critique trước
       ▼
  GAUNTLET — insight nào không chống đỡ được → loại
       ▼
  DISTILL — insight defensible → bản sạch
       │  bàn giao BẮT BUỘC
       ▼
  PLAN AGENT — formalize thành executable plan
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council council.ts — CouncilProvider (fan-out N members — nền team-mode)
// ✅ packages/council adversarial.ts — adversarialReview (nền — hostile refute)
// ✅ packages/council hindsight.ts — HindsightReviewer (nền — critique sau sinh)
// ✅ packages/agent spawnSubagent — session riêng per member (nền — mỗi member 1 session)
// ✅ packages/eval harness.ts — keyFactPreserved (nền — distill giữ insight)

// ❌ THIẾU: 5 hostile category members (persona cố định)
// ❌ THIẾU: gauntlet survival (insight bị bắn hạ → loại)
// ❌ THIẾU: bàn giao bắt buộc cho plan agent (formalize)
```
## Implementation
```typescript
// packages/council/src/hyperplan.ts (MỚI)
import type { ProviderProfile, SystemPrompt } from "@my-agent/core";
export type HostileCategory = "unspecified-low" | "unspecified-high" | "deep" | "ultrabrain" | "artistry";
export const HOSTILE_MEMBERS: Array<{ category: HostileCategory; prompt: string }> = [
  { category: "unspecified-low", prompt: "Chỉ ra chỗ thiếu chi tiết đến mức không thực thi được. Không nể nang." },
  { category: "unspecified-high", prompt: "Chỉ ra chỗ thiếu tham vọng — plan quá nhỏ so với vấn đề. Ép lớn hơn." },
  { category: "deep", prompt: "Chỉ ra khía cạnh bị bỏ qua (edge case, vận hành, thất bại)." },
  { category: "ultrabrain", prompt: "Đòi insight vượt trội — plan hiện tại chỉ là lặp lại thông thường." },
  { category: "artistry", prompt: "Chỉ ra chỗ vụng về, thiếu thanh thoát về thiết kế/ngôn từ." },
];
export interface Insight { text: string; /** Số member critique đã bắn hạ — 0 = sống sót gauntlet. */ refutedBy: number }
/** Critique một member — trả về danh sách insight bị bắn hạ. */
export async function critiqueMember(profile: ProviderProfile, memberPrompt: string, draft: string, priorCritiques: string[]): Promise<string> {
  const prompt: SystemPrompt = {
    stable: memberPrompt,
    context: `## Draft plan\n${draft}\n\n## Prior critiques\n${priorCritiques.join("\n---\n") || "(chưa có)"}`,
    volatile: "Output: danh sách insight trong draft bị bắn hạ, mỗi cái kèm lý do.",
  };
  return `[${memberPrompt.split(".")[0]}] critique…`;
}
/** Gauntlet — insight sống sót qua mọi member critique. */
export function surviveGauntlet(insights: Insight[], refuted: string[][]): Insight[] {
  const hit = new Set<string>(refuted.flat());
  return insights.filter((i) => !hit.has(i.text)).map((i) => ({ ...i, refutedBy: 0 }));
}
/** Hyperplan — orchestrate 5 members rồi distill. */
export async function hyperplan(
  draft: string,
  stream: (p: SystemPrompt) => AsyncIterable<string>,
): Promise<{ distilled: string; members: string[] }> {
  const critiques: string[] = [];
  for (const m of HOSTILE_MEMBERS) {
    // Cross-critique: member sau thấy critique trước (tàn nhẫn hơn).
    const critique = await collectText(stream, critiquePrompt(m, draft, critiques));
    critiques.push(critique);
  }
  return { distilled: distill(critiques), members: critiques };
}
function critiquePrompt(m: { category: string; prompt: string }, draft: string, prior: string[]): SystemPrompt {
  return { stable: m.prompt, context: `## Draft\n${draft}\n## Prior\n${prior.join("\n---\n")}`, volatile: "" };
}
async function collectText(stream: (p: SystemPrompt) => AsyncIterable<string>, p: SystemPrompt): Promise<string> {
  let out = "";
  for await (const chunk of stream(p)) out += chunk;
  return out;
}
/** Distill — insight defensible → bản sạch (implementer: gọi plan agent formalize). */
function distill(critiques: string[]): string {
  return `## Distilled (defensible insights)\n${critiques.map((c, i) => `${i + 1}. ${c.slice(0, 80)}…`).join("\n")}`;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 5 góc nhìn thù địch — insight bị thử lửa thật | ❌ 5+ lượt critique = tốn token + latency |
| ✅ Cross-critique tàn nhẫn — critique sau thấy critique trước | ❌ Member có thể critique trùng lặp |
| ✅ Chỉ defensible sống sót — chất lượng insight cao | ❌ Distill phụ thuộc model tổng hợp tốt |
| ✅ Bàn giao bắt buộc plan agent — không dừng ở insight | ❌ Orchestration tuần tự — chậm hơn song song |

## Khác các hướng gần

| | Adversarial review (adversarial.ts) | ACW: Hyperplan |
|---|---|---|
| Đầu vào | Findings có sẵn | **Draft plan — chưa có gì** |
| Reviewer | N reviewer refute 1 finding | **5 hostile category members cross-critique** |
| Output | Filter findings | **Distill insight defensible → plan agent** |
| Mục đích | Verify finding | **Ép plan tốt hơn từ nhiều góc thù địch** |

## Khi nào chọn

- Plan quan trọng cần stress-test từ nhiều góc độ trước khi thực thi
- Muốn chống plan "an toàn nhàm chán" (thiếu tham vọng) và "mơ hồ" (thiếu chi tiết)
- Đã có council + adversarial + spawnSubagent — thêm hyperplan orchestration
- Guard: insight phải defensible, distill bắt buộc formalize, budget cho 5 lượt critique
