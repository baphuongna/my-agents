# Hướng AJQ: Grilling Interview Alignment — `/grill-me` và `/grill-with-docs` bắt agent phỏng vấn user từng câu một (kèm recommended answer) để align trước khi code; câu tự khám phá được thì tự explore codebase

> **Nguồn gốc:** skills | **Coupling:** 🟡 — interactive alignment skill | **Agent-agnostic:** ⚠️ (cần skill system + tool access) | **Code sẵn:** ⚠️ (có skill system + triggers; chưa có interactive interview flow) | **Effort:** 1.5 tuần

## Nguồn gốc

**skills** `/grill-me` và `/grill-with-docs` bắt **agent phỏng vấn user từng câu một** (**kèm recommended answer**) để **align trước khi code**; câu nào trả lời được bằng **codebase exploration** thì agent **tự khám phá** — chống failure mode **"agent không hiểu user muốn gì"**. User thường mô tả yêu cầu mơ hồ; grilling ép agent hỏi đúng câu, user confirm từng bước → spec rõ trước khi code.

Nguyên tắc: **phỏng vấn từng câu một** — không dump hết câu hỏi, hỏi tuần tự chờ trả lời; **kèm recommended answer** — agent gợi ý câu trả lời hợp lý (giúp user suy nghĩ + nhanh); **self-explore khi có thể** — câu trả lời được trong codebase → agent tự đọc (read/grep/glob), không hỏi user thừa; **align trước code** — chỉ code khi spec đã rõ (exit criteria); **fail-mode guard** — nếu user không trả lời được câu cốt lõi → agent flag ambiguity, không code mù.

## Mô tả

Với mya, pattern = **interactive alignment skill**: (1) **mya có skill system (packages/skills)** — `Skill` (SKILL.md frontmatter name/description/triggers), `SkillStore.suggest(query)`, curator trigger — nền discovery có; (2) **mya có stable tier skills index (assembler.ts)** — progressive disclosure (name+description vào prompt) — nền inject có; (3) **AJQ thêm `/grill-me` skill**: trigger → agent vào interview mode; (4) **interview flow** — agent sinh danh sách câu hỏi (LLM), lọc câu tự khám phá được (có thể trả lời bằng read/grep/glob → tự explore), còn lại hỏi user tuần tự; (5) **recommended answer** — mỗi câu kèm gợi ý (LLM dựa codebase/context); (6) **exit criteria** — spec đủ rõ (câu cốt lõi đã trả lời) → agent bắt đầu code; (7) **`/grill-with-docs`** — variant có tài liệu tham chiếu (user cung cấp doc path → agent đọc doc trước khi grill); (8) **nối AJK** — grilling ghi incident nếu ambiguity block (improvement-loop).

## Kiến trúc (ASCII)

```
  USER: "/grill-me tôi muốn thêm feature X"
    │
    ▼ TRIGGER skill (SkillStore.suggest — packages/skills)
    │
    ▼ GENERATE questions (LLM — dựa yêu cầu mơ hồ)
    │
    ▼ PARTITION questions
    ├─ tự khám phá được (trong codebase)? ──► SELF-EXPLORE (read/grep/glob) — không hỏi user
    └─ cần user quyết ──► PHỎNG VẤN TỪNG CÂU
         ┌──────────────────────────────────┐
         │  Agent: "Q1: ...? (gợi ý: ...)"   │  ← kèm recommended answer
         │  User:  "answer"                  │
         │  Agent: "Q2: ...? (gợi ý: ...)"   │
         │  ...                              │
         └──────────────────────────────────┘
    │
    ▼ EXIT CRITERIA — spec đủ rõ? (câu cốt lõi đã trả lời)
    ├─ YES ──► CODE (spec rõ)
    └─ NO  ──► FLAG ambiguity (không code mù — nối AJK incident)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — Skill { name, description, triggers },
//   parseSkillMarkdown, extract_skill_description (60-char budget)
// ✅ packages/skills curator.ts — SkillStore.suggest(query), discover(dir),
//   SkillCurator (nền trigger/discovery)
// ✅ packages/prompts assembler.ts — stable tier skills index, progressive
//   disclosure (name+description vào prompt) (nền inject)
// ✅ packages/tools builtin.ts — read/grep/glob (nền self-explore)
// ✅ packages/agent — agent loop (nền interview turn-by-turn)

// ❌ THIẾU: /grill-me interactive interview skill + flow từng câu
// ❌ THIẾU: question partition (self-explore vs ask-user) + recommended answer
// ❌ THIẾU: exit criteria (spec đủ rõ → code) + ambiguity flag
```

## Implementation

```typescript
// packages/skills/src/grill.ts (NEW) — interactive alignment skill
export interface GrillQuestion {
  text: string;
  recommendedAnswer: string;   // gợi ý giúp user suy nghĩ
  selfExplorable: boolean;     // trả lời được trong codebase?
  answered?: string;
}

/** Phân tách: câu nào agent tự khám phá, câu nào hỏi user. */
export function partition(
  questions: GrillQuestion[],
  canExplore: (q: string) => boolean,
): { explore: GrillQuestion[]; askUser: GrillQuestion[] } {
  return {
    explore: questions.filter((q) => (q.selfExplorable = canExplore(q.text))),
    askUser: questions.filter((q) => !q.selfExplorable),
  };
}

/** Exit criteria — đủ rõ để code? (câu cốt lõi đã trả lời). */
export function isAligned(askUser: GrillQuestion[]): boolean {
  return askUser.every((q) => q.answered != null && q.answered.trim().length > 0);
}

/** Grilling loop — từng câu một, chờ trả lời. */
export async function grill(
  questions: GrillQuestion[],
  ask: (q: GrillQuestion) => Promise<string>,
): Promise<GrillQuestion[]> {
  const out: GrillQuestion[] = [];
  for (const q of questions) {           // tuần tự — từng câu một
    out.push({ ...q, answered: await ask(q) });
  }
  return out;
}
// SKILL.md: triggers ["/grill-me"], allowedTools [read,grep,glob].
// Flow: suggest→generate questions→partition→self-explore (read/grep)→
//   grill(ask)→isAligned?→CODE hoặc FLAG ambiguity (nối AJK).
// ask(): agent prompt "Q: {text}? (gợi ý: {recommendedAnswer})" → user trả lời.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống "agent không hiểu user muốn gì" — align trước code | ❌ Interview chậm — user phải trả lời từng câu |
| ✅ Self-explore giảm câu thừa — agent tự đọc codebase | ❌ Sinh câu hỏi (LLM) có thể sai trọng tâm |
| ✅ Recommended answer giúp user suy nghĩ + nhanh | ❌ Exit criteria chủ quan — khó đo "đủ rõ" |
| ✅ Nối skill system (có sẵn discovery/trigger) | ❌ Grilling dài → token — cần cap số câu |

## Khác các hướng gần

| | AJQ Grilling Interview | AJK Identity Anchor | AJP Tracking Analytics |
|---|---|---|---|
| Trọng tâm | Align yêu cầu trước code | Identity persistence + recovery | Đo lường tiết kiệm token |
| Cơ chế | Interview từng câu + self-explore | Anchor + incident + audit | SQLite + retention + aggregate |
| Quan hệ | Flag ambiguity → AJK incident | Khác scope (behavioral) | Khác scope (metrics) |

## Khi nào chọn

- User mô tả yêu cầu mơ hồ — cần align trước khi code
- Muốn agent tự khám phá codebase thay vì hỏi user thừa
- Đã có skill system — muốn thêm skill alignment interactived
- Guard: cap số câu (token), recommended answer kèm mỗi câu, exit criteria rõ (câu cốt lõi đã trả lời), flag ambiguity thay vì code mù (nối AJK), từng câu một không dump
