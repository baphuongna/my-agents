# Hướng XL: Skill Frontmatter Portability — Mỗi SKILL.md: metadata single-line JSON, required_environment_variables top-level, license + allowed-tools riêng — portability qua mọi host

> **Nguồn gốc:** scientific-agent-skills (skill packaging format) | **Coupling:** 🟢 — chỉ mở rộng skill metadata field, không đụng loader logic | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có frontmatter YAML + allowedTools — chưa có required_env + license + portable metadata) | **Effort:** 1 tuần

## Nguồn gốc

**scientific-agent-skills** đóng gói skill để **portable qua mọi host** — một SKILL.md phải tự mô tả đủ để mọi agent runtime nạp đúng. Định dạng: (1) **metadata single-line JSON** ở đầu file (compact, parse nhanh, không lệch indent như YAML). (2) **`required_environment_variables`** ở top-level (khai báo env var skill cần — host thiếu → từ chối nạp, không crash runtime). (3) **`license`** riêng mỗi skill (skill thương mại vs MIT vs proprietary — host kiểm trước khi load). (4) **`allowed-tools`** riêng (whitelist tool skill được dùng — không kế thừa toàn quyền host). Nguyên tắc: **skill tự khai báo đủ để host decide** load hay không — zero guesswork.

## Mô tả

mya skill frontmatter portability: mỗi SKILL.md mở rộng frontmatter thêm `requiredEnv` (env var bắt buộc), `license` (giấy phép), và giữ `allowedTools` (đã có). Khi load, curator **kiểm portability gate**: env var có đủ? license compatible? allowed-tools tồn tại trong host? — thiếu → skill skip + log, không crash. mya đã có `SkillFrontmatter` (name, description, triggers, model, allowedTools) + `parseSkillMarkdown` — XL thêm **requiredEnv + license field** + **portability gate** trong curator.

## Kiến trúc

```
  ┌─── SKILL.md (frontmatter mở rộng) ──────────────────────┐
  │  {"name":"bench","description":"...","requiredEnv":["API_KEY"],  │
  │   "license":"MIT","allowedTools":["codeexec","find"]}      │
  │  ---                                                       │
  │  # Skill body...                                           │
  └─────────────────────────┬─────────────────────────────────┘
                            ▼
  ┌─── PORTABILITY GATE (curator check) ───────────────────┐
  │  1. requiredEnv → process.env có đủ?  thiếu → SKIP       │
  │  2. license → compatible host policy?  ❌ → SKIP         │
  │  3. allowedTools → tool tồn tại trong host?  thiếu → SKIP│
  │  4. name + description → đủ (đã có)?                      │
  │  ✓ → LOAD vào index (progressive disclosure)              │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SkillFrontmatter (name, description, triggers, model, allowedTools)
// ✅ packages/skills skill.ts — parseSkillMarkdown + splitFrontmatter (nền — XL mở rộng field)
// ✅ packages/skills curator.ts — SkillStore load/index (nền — XL portability gate ở đây)
// ✅ packages/tools dispatch.ts — tool registry (nền — XL check allowedTools tồn tại)

// ❌ THIẾU: requiredEnv field (env var bắt buộc top-level)
// ❌ THIẾU: license field (giấy phép mỗi skill)
// ❌ THIẾU: portability gate (env/license/tool check trước load)
```

## Implementation

```typescript
// packages/skills/src/skill.ts (MỞ RỘNG SkillFrontmatter)
export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  model?: string;
  allowedTools?: string[];
  requiredEnv?: string[];   // MỚI — env var bắt buộc (XL)
  license?: string;         // MỚI — giấy phép (XL)
}

// packages/skills/src/curator.ts (THÊM portability gate)
interface PortabilityResult { ok: boolean; reason?: string }

function checkPortability(
  fm: SkillFrontmatter,
  env: NodeJS.ProcessEnv,
  availableTools: Set<string>,
  allowedLicenses?: Set<string>,
): PortabilityResult {
  // 1. requiredEnv
  for (const e of fm.requiredEnv ?? []) {
    if (!(e in env)) return { ok: false, reason: `thiếu env ${e}` };
  }
  // 2. license
  if (fm.license && allowedLicenses && !allowedLicenses.has(fm.license)) {
    return { ok: false, reason: `license ${fm.license} không được phép` };
  }
  // 3. allowedTools tồn tại
  for (const t of fm.allowedTools ?? []) {
    if (!availableTools.has(t)) return { ok: false, reason: `tool ${t} không có` };
  }
  return { ok: true };
}

// Usage trong loadSkill:
// const fm = parseSkillMarkdown(content).frontmatter;
// const gate = checkPortability(fm, process.env, toolSet, allowedLic);
// if (!gate.ok) { log.warn(`skip skill ${fm.name}: ${gate.reason}`); return; }
// → skill chỉ nạp khi pass portability gate
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Portable (skill chạy mọi host có gate check) | ❌ Gate overhead (check mỗi load) |
| ✅ Fail-safe (thiếu env/tool → skip, không crash) | ❌ Silent skip (skill thiếu env → biến mất, user confused) |
| ✅ License enforcement (host chặn skill proprietary) | ❌ License sprawl (nhiều skill nhiều license khác nhau) |
| ✅ Tool scoping (allowedTools whitelist) | ❌ Fragile tool name (tool đổi tên → skill skip) |

## Khác các hướng gần

| | YAML frontmatter | XL: Portable Metadata | agentskills.io registry |
|---|---|---|---|
| Env declare | ❌ | **✅ requiredEnv** | ❌ |
| License | ❌ | **✅ mỗi skill** | ❌ |
| Tool check | allowedTools (không verify) | **✅ verify tồn tại** | ❌ |
| Gate trước load | ❌ | **✅** | remote registry |

## Khi nào chọn

- Phân phối skill cho nhiều host (env, tool, license khác nhau)
- Muốn skill fail-safe (thiếu dependency → skip + log, không crash runtime)
- Nối packages/skills skill.ts + curator.ts + packages/tools dispatch.ts; guard skip-visibility (log rõ lý do skip cho user — không silent disappear), env-leak-defense (không log giá trị env, chỉ check tồn tại), và tool-name-stability (pin tool version — tool đổi tên phá skill); XL = skill frontmatter portability, kết hợp 643 XS omitted-model-frontmatter (bỏ model field để platform tự default) + 594 extension-skill-separation (skill vs extension scoping)
