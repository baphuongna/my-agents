# Hướng AJV: Explicit Skill Requests — repo test kỹ trigger skill qua nhiều phrasing, description frontmatter được tối ưu để model tự chọn skill đúng

> **Nguồn gốc:** superpowers (tests/explicit-skill-requests/, README.md) | **Coupling:** 🟢 — test + frontmatter convention | **Agent-agnostic:** ⚠️ (phụ thuộc model chọn skill) | **Code sẵn:** ⚠️ (có skill index + triggers; thiếu test corpus + description tuning) | **Effort:** 1-2 tuần

## Nguồn gốc

**superpowers** (tests/explicit-skill-requests/) test kỹ **trigger skill**: `tests/explicit-skill-requests/prompts/*.txt` chứa **nhiều phrasing khác nhau** — action-oriented ("create a plan for…"), "claude suggested it" (model gợi ý thì dùng), mid-conversation (giữa hội thoại user nhắc lại) — chạy qua agent để **xác nhận skill được invoke đúng**. Kèm đó, **description frontmatter được tối ưu để model tự chọn skill**: description không phải cho người đọc, mà là tín hiệu cho model biết *khi nào* nên gọi skill.

Giá trị: (1) **invocation đáng tin** — không phải "hy vọng model gọi đúng", mà có test chứng minh; (2) **phrasing đa dạng** — cùng một intent, nhiều cách nói — skill phải trigger được ở mọi cách; (3) **description tối ưu cho model** — frontmatter là model-facing contract; (4) **regression** — prompt mới không làm vỡ invocation cũ.

## Mô tả

Với mya, pattern = **skill-invocation test corpus** gắn vào eval: (1) **corpus** — `test/features/07-skills/` (đã có) thêm thư mục `explicit-skill-requests/prompts/*.txt`: mỗi file một phrasing của cùng intent (action-oriented / suggested-it / mid-conversation); (2) **invocation assertion** — chạy prompt qua agent (dùng MockProvider — `packages/ai` có mock), assert skill X được invoke (skill.tool gọi đúng tên) — không cần network; (3) **description tuning loop** — khi test fail: sửa frontmatter description (thêm trigger phrase rõ hơn) → chạy lại corpus → xanh; (4) **index budget** — mya có `SKILL_PROMPT_DESC_LIMIT = 60` (skill.ts) — description phải đủ ý trong 60 ký tự — tuning phải tôn trọng budget; (5) nơi gắn — `packages/eval` (harness + tiers) chạy corpus như integration tier. Đây là pattern **contract-testing cho skill discovery**: model là "compiler", frontmatter là "API contract", test là bằng chứng contract hoạt động.

## Kiến trúc (ASCII)

```
  tests/explicit-skill-requests/prompts/*.txt
  ├─ create-a-plan-action.txt     ("make a plan for the release")
  ├─ suggested-it.txt             ("claude suggested I use the plan skill")
  └─ mid-conversation.txt         ("ok let's actually plan it now")
    │
    ▼ RUN qua agent (MockProvider — không network)
    ▼ ASSERT: skill X được invoke (tool call đúng tên)
  ├─ PASS ──► description frontmatter giữ nguyên
  └─ FAIL ──► TUNE description (thêm trigger phrase, trong 60-char budget)
              → chạy lại corpus → regression xanh
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills/src/skill.ts — SKILL_PROMPT_DESC_LIMIT=60 + extract_skill_description
//   (description index budget — ràng buộc tuning)
// ✅ packages/skills/src/curator.ts — SkillStore (index name+description → prompt)
// ✅ packages/ai/src/mock.ts — MockProvider (chạy test không network)
// ✅ packages/eval/src/harness.ts + tiers.ts — IntegrationTier (nơi chạy corpus)
// ✅ packages/core/src/loop.ts — runTurn (nền — agent loop cho test)

// ❌ THIẾU: explicit-skill-requests corpus (nhiều phrasing per skill)
// ❌ THIẾU: invocation assertion (assert skill tool được gọi đúng tên)
// ❌ THIẾU: description tuning loop (fail → sửa frontmatter → regression)
```

## Implementation

```typescript
// packages/eval/src/explicit-skill-requests.ts (NEW)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { History, ProviderProfile } from "@my-agent/core";

export interface SkillInvocationCase {
  prompt: string;          // một phrasing của intent
  kind: "action" | "suggested" | "mid-conversation";
  expectedSkill: string;   // skill phải được invoke
}

/** Load corpus — mỗi .txt trong prompts/ là một case. */
export function loadInvocationCorpus(dir: string): SkillInvocationCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8").trim();
      const kind = f.includes("suggested") ? "suggested"
        : f.includes("mid") ? "mid-conversation" : "action";
      // convention: tên file "create-a-plan.action.txt" → expected skill "create-a-plan"
      const expectedSkill = f.replace(/\.(action|suggested|mid).*\.txt$/, "").replace(/-/g, "-");
      return { prompt: text, kind, expectedSkill };
    });
}

/** Chạy một case qua agent (MockProvider) — assert skill được invoke đúng tên. */
export async function assertSkillInvoked(
  runTurn: (prompt: string) => Promise<{ toolCalls: Array<{ name: string }> }>,
  c: SkillInvocationCase,
): Promise<{ ok: boolean; reason: string }> {
  const { toolCalls } = await runTurn(c.prompt);
  const invoked = toolCalls.some((t) => t.name === `skill_${c.expectedSkill}`);
  if (invoked) return { ok: true, reason: "" };
  return {
    ok: false,
    reason: `phrasing "${c.kind}" không invoke skill "${c.expectedSkill}" — tool calls: ${toolCalls.map((t) => t.name).join(", ") || "(none)"}`,
  };
}

/** Description tuning hint — fail case → gợi ý trigger phrase từ prompt. */
export function suggestTriggerPhrase(c: SkillInvocationCase, budget = 60): string {
  // Trích cụm có nghĩa từ prompt làm trigger candidate (trong budget).
  const words = c.prompt.toLowerCase().split(/\s+/).slice(0, 10);
  const phrase = words.join(" ").slice(0, budget - 3) + (words.join(" ").length > budget - 3 ? "…" : "");
  return phrase;
}
// Nối eval: chạy corpus trong IntegrationTier (MockProvider) — mỗi skill một bộ case
// Nối skills: fail → sửa frontmatter description (trong SKILL_PROMPT_DESC_LIMIT) → re-run
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Invocation có test — không "hy vọng model gọi đúng" | ❌ Corpus tốn công duy trì theo từng skill |
| ✅ Nhiều phrasing — bắt invocation lỏng sớm | ❌ Model mới có thể đổi hành vi — phải re-run |
| ✅ Description tối ưu cho model — index 60-char vẫn đủ ý | ❌ Tuning mù — cần corpus phủ đủ intent |
| ✅ Regression — prompt mới không vỡ cũ | ❌ "Suggested it" case phụ thuộc model gợi ý — khó assert |

## Khác các hướng gần

| | AJV Explicit Skill Requests | 799 Invocation Axis | 776 Two-Stage Routing |
|---|---|---|---|
| Trọng tâm | Test trigger skill | Trục user/model invoked | Giảm token listing skill |
| Cơ chế | Corpus + assertion | frontmatter flag | Routing 2 tầng |
| Quan hệ | Bằng chứng cho 799 hoạt động | Cấu hình invocation | Giảm chi phí discovery |

## Khi nào chọn

- Skill nhiều, model hay gọi nhầm/bỏ sót — muốn invocation có bằng chứng
- Muốn description frontmatter là contract được test (model-facing)
- Đã có eval harness + MockProvider — thêm corpus là rẻ
- Guard: corpus phủ nhiều phrasing, assert tên skill thật, description trong 60-char budget