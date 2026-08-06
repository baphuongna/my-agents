# Hướng ADS: Skill Invocation Axis — phân biệt user-invoked vs model-invoked qua invocation.md

> **Nguồn gốc:** mattpocock-skills | **Coupling:** 🟢 — thuần frontmatter + convention | **Agent-agnostic:** ✅ — mọi model đọc description | **Code sẵn:** ⚠️ (sẵn skill store; thiếu invocation axis) | **Effort:** 1 tuần

## Nguồn gốc

**mattpocock-skills** có **`.agents/invocation.md`** phân biệt hai trục gọi skill: **user-invoked** — khai báo `disable-model-invocation: true`, description hướng **con người** (human-facing), chỉ human chạy được; **model-invoked** — description hướng **model** với **trigger phrases** (model đọc description để biết khi nào nên gọi).

Hai rule quan trọng: (1) **user-invoked skill không thể gọi user-invoked skill khác** — human-invoked không được tự chain; (2) **dependency thể hiện bằng `/skill`-style prose invocation** — skill A cần skill B thì nói trong prose "chạy /B khi..." chứ không phải import/API. Mục đích: description là **giao diện** — viết cho ai đọc thì người/model đó hiểu đúng, không lẫn lộn.

## Mô tả

Với mya, `packages/skills` đã có `SkillFrontmatter` (name, description, triggers, model, allowedTools) và `extract_skill_description`. Pattern thêm **trục invocation**: field `disable-model-invocation` + quy ước description human-facing vs model-facing. `SkillStore` khi load phải tôn trọng trục: skill user-invoked chỉ expose qua lệnh user (không đưa description vào model context — tiết kiệm token, tránh model tự gọi nhầm); skill model-invoked thì description + triggers vào context. Dependency qua prose — không cần graph phức tạp.

## Kiến trúc (ASCII)

```
  SKILL.md (frontmatter)
    ├─ disable-model-invocation: true  ──► USER-INVOKED
    │     description human-facing (chỉ human đọc hiểu)
    │     chỉ chạy bằng lệnh user (/skill X)
    │     KHÔNG gọi được user-invoked skill khác
    └─ disable-model-invocation: false ──► MODEL-INVOKED
          description model-facing + trigger phrases
          model đọc description để quyết định gọi
          dependency: "/skill"-style prose invocation
            │
            ▼
  SKILL STORE (mya)
    ├─ user-invoked  ──► không đưa description vào model context
    └─ model-invoked ──► description + triggers vào context
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills/src/skill.ts — SkillFrontmatter + parseSkillMarkdown
//   (name/description/triggers/model/allowedTools)
// ✅ packages/skills/src/curator.ts — discover + load SKILL.md, truncate description
// ✅ packages/skills/src/skill.ts — extract_skill_description (human vs model hint)
// ✅ packages/skills/src/skill.ts — triggers[] (nền model-invoked trigger phrases)

// ❌ THIẾU: disable-model-invocation field + quy ước human-facing
// ❌ THIẾU: store phân trục — user-invoked không vào model context
// ❌ THIẾU: enforcement — user-invoked không gọi user-invoked khác
```

## Implementation

```typescript
// packages/skills/src/invocation.ts (NEW)
export type InvocationAxis = "user" | "model";

export interface InvocationMeta {
  axis: InvocationAxis;
  modelDescription?: string;   // trigger phrases cho model
  dependencies: string[];      // "/skill"-style prose refs
}

export function invocationAxis(fm: SkillFrontmatter): InvocationAxis {
  return fm["disable-model-invocation"] === true ? "user" : "model";
}

export function modelContextSkills(skills: Skill[]): Skill[] {
  // user-invoked KHÔNG vào model context (tiết kiệm token, tránh tự gọi nhầm)
  return skills.filter((s) => invocationAxis(s.frontmatter) === "model");
}

export function enforceNoUserChain(target: Skill, ctx: { invokedBy: "user" | "model" }): boolean {
  // user-invoked skill không thể gọi user-invoked skill khác
  if (invocationAxis(target.frontmatter) === "user" && ctx.invokedBy === "model") {
    return false;   // model không được gọi skill user-invoked
  }
  return true;
}

export function extractDependencies(body: string): string[] {
  // dependency bằng prose: "/skill X" — không cần graph import
  return [...body.matchAll(/\/skill\s+([\w-]+)/g)].map((m) => m[1] ?? "");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Description đúng đối tượng đọc — không lẫn | ❌ Viết sai trục → skill không bao giờ được gọi |
| ✅ User-invoked khỏi model context — tiết kiệm token | ❌ Prose dependency khó verify tự động |
| ✅ Model tự gọi đúng lúc qua trigger phrases | ❌ User-invoked ít được dùng (phải chạy tay) |
| ✅ Dependency không cần graph phức tạp | ❌ Chain user-invoked bị chặn — có thể bất tiện |

## Khác các hướng gần

| | ADS Invocation Axis | ADZ Preamble Env | ADT Design Vocabulary |
|---|---|---|---|
| Trọng tâm | Ai gọi skill (user/model) | Runtime context khi chạy | Ngôn ngữ thiết kế chung |
| Cơ chế | disable-model-invocation + description | bash preamble in skill | Shared vocabulary |
| Mục đích | Đúng người đọc description | Skill như executable | Thiết kế deep module |

## Khi nào chọn

- Skill có hai loại: cần human xác nhận vs model tự chạy
- Model tự gọi nhầm skill nguy hiểm (approval, destructive)
- Đã có skill store — thêm trục invocation
- Muốn tiết kiệm token (user-invoked không vào context)