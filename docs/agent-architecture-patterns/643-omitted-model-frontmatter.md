# Hướng XS: Omitted Model Frontmatter — Bỏ field model khỏi frontmatter agent để mỗi platform fallback về default của nó — inherit là keyword riêng của Claude Code

> **Nguồn gốc:** Understand-Anything (omit model, platform default fallback) | **Coupling:** 🟢 — chỉ thay đổi frontmatter convention, không đụng loader | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (model field optional đã có — chưa có explicit omit policy) | **Effort:** <1 tuần

## Nguồn gốc

**Understand-Anything** phát hiện: khi frontmatter agent khai báo `model: claude-sonnet-...`, skill **gắn chết** vào platform đó — chạy trên host có Gemini/OpenAI thì model field vô dụng hoặc gây lỗi. Giải pháp: **bỏ field `model` khỏi frontmatter** → mỗi platform **fallback về default** của nó (Gemini host → default Gemini, OpenAI host → default OpenAI). Đặc biệt lưu ý: từ khóa `inherit` là **keyword riêng của Claude Code** (kế thừa model từ parent), không phải chuẩn chung — ghi `inherit` lên platform khác → không nhận diện → lỗi. Nguyên tắc: **omit > hardcode; để platform tự default, không bind**.

## Mô tả

mya omitted model frontmatter: SKILL.md **không khai báo `model`** (hoặc khai báo optional chỉ khi thực cần pin model cụ thể). Loader thấy `model` undefined → dùng **platform default** (provider mặc định host). Điều này giúp skill **portable**: cùng skill chạy trên Claude host → default Claude, Gemini host → default Gemini. mya đã có `SkillFrontmatter.model?: string` (optional) — XS làm explicit: **policy omit-by-default** + **warning khi gặp `inherit`** (keyword Claude-only, không portable).

## Kiến trúc

```
  ┌─── SKILL.md frontmatter ───────────────────────────────┐
  │  ❌ KHÔNG:  model: claude-sonnet-4   ← gắn chết Claude   │
  │  ❌ KHÔNG:  model: inherit           ← keyword Claude-only│
  │  ✅ CÓ:    (bỏ field model)         ← platform tự default │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── LOADER (model resolution) ──────────────────────────┐
  │  fm.model == undefined → platformDefault(provider)       │
  │  fm.model == "inherit"  → WARN: keyword Claude-only      │
  │                            → fallback platformDefault    │
  │  fm.model == "gemini-..." → dùng (explicit pin, ok)      │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SkillFrontmatter.model? (optional, nền — XS omit-by-default)
// ✅ packages/skills skill.ts — parseSkillMarkdown (nền — XS warning ở đây)
// ✅ packages/ai — provider/model resolution (nền — XS fallback default)
// ✅ packages/skills curator.ts — skill load (nền — XS lint warning)

// ❌ THIẾU: omit-by-default policy (khuyến cáo bỏ model)
// ❌ THIẾU: inherit-keyword warning (Claude-only, không portable)
// ❌ THIẾU: platformDefault fallback resolver
```

## Implementation

```typescript
// packages/skills/src/skill.ts (MỞ RỘNG — thêm lint + resolution)
export interface ResolvedModel { model: string | undefined; source: "frontmatter" | "platform-default"; warn?: string }

const CLAUDE_ONLY_KEYWORDS = new Set(["inherit"]); // keyword riêng Claude Code

function resolveModel(
  fmModel: string | undefined,
  platformDefault: () => string,
): ResolvedModel {
  if (fmModel === undefined) {
    return { model: platformDefault(), source: "platform-default" }; // omit → default
  }
  if (CLAUDE_ONLY_KEYWORDS.has(fmModel)) {
    // 'inherit' = Claude-only keyword → không portable → warn + fallback
    return {
      model: platformDefault(),
      source: "platform-default",
      warn: `model "${fmModel}" là keyword Claude-only, không portable — fallback platform default`,
    };
  }
  return { model: fmModel, source: "frontmatter" }; // explicit pin (ok nếu host support)
}

// lint: khuyến cáo omit model
function lintSkillFrontmatter(fm: SkillFrontmatter): string[] {
  const warnings: string[] = [];
  if (fm.model !== undefined) {
    warnings.push("nên bỏ field `model` để skill portable (platform tự default)");
  }
  if (fm.model && CLAUDE_ONLY_KEYWORDS.has(fm.model)) {
    warnings.push(`\`model: ${fm.model}\` không portable (Claude-only keyword)`);
  }
  return warnings;
}

// Usage:
// const resolved = resolveModel(fm.model, () => provider.defaultModel);
// const warnings = lintSkillFrontmatter(fm);
// → skill không khai model → platform default; khai inherit → warn + fallback
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Portable (skill chạy mọi platform, tự default) | ❌ Mất control (không pin model cụ thể khi cần) |
| ✅ Platform-optimal (mỗi host dùng best default) | ❌ Non-deterministic (model khác host → behavior khác) |
| ✅ No inherit bug (keyword Claude-only → warn) | ❌ Lint noise (warning mỗi skill có model) |
| ✅ Simple (bớt 1 field) | ❌ Explicit pin harder (phải chủ động thêm khi cần) |

## Khác các hướng gần

| | Hardcode model | `inherit` keyword | XS: Omit + Default |
|---|---|---|---|
| Portable | ❌ (gắn 1 platform) | ⚠️ (Claude-only) | **✅ (mọi platform)** |
| Control | ✅ full | Claude parent | **platform default** |
| Lint | ❌ | ❌ | **✅ warn inherit** |

## Khi nào chọn

- Phân phối skill cho nhiều platform (Claude, Gemini, OpenAI) → không bind model
- Muốn portable (cùng skill, mỗi host dùng default tốt nhất)
- Muốn bắt bug `inherit` (keyword Claude-only gây lỗi platform khác)
- Nối packages/skills skill.ts (SkillFrontmatter.model) + packages/ai (provider default) + curator.ts; guard explicit-pin-escape-hatch (vẫn cho phép pin model khi benchmark cần determinism), cross-platform-test (skill omit → chạy Claude + Gemini + OpenAI đều load), và default-discovery (provider.defaultModel phải đúng — test); XS = omitted model frontmatter, kết hợp 636 XL skill-frontmatter-portability (portability gate) + 594 extension-skill-separation (skill scoping)
