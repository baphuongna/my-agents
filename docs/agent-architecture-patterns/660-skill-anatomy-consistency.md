# Hướng YJ: Skill Anatomy Consistency — mỗi skill cấu trúc cố định SKILL.md + references/(standards,workflows) + scripts/ + assets/ với body bắt buộc When to Use/Prerequisites/Workflow/Verification — discoverable + executable (README.md)

> **Nguồn gốc:** Anthropic-Cybersecurity-Skills (README.md) | **Coupling:** 🟢 — convention cấu trúc thư mục + frontmatter | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill.ts progressive disclosure — chưa có anatomy validator) | **Effort:** 1-2 tuần

## Nguồn gốc

**Anthropic-Cybersecurity-Skills** chuẩn hóa **anatomy** mỗi skill: cấu trúc thư mục cố định — `SKILL.md` + `references/` (standards + workflows) + `scripts/` + `assets/`. Body SKILL.md **bắt buộc** 4 section: **When to Use** (khi nào dùng), **Prerequisites** (cần gì trước), **Workflow** (quy trình), **Verification** (làm sao biết thành công). Lợi ích kép: **discoverable** (agent đọc When to Use/Prerequisites là biết có nên dùng không — khớp progressive disclosure) + **executable** (Workflow + Verification đủ để chạy được, không phải skill "mô tả chung chung").

## Mô tả

mya áp dụng skill-anatomy-consistency: skill trong `packages/skills` phải theo layout: `SKILL.md` (frontmatter + body 4 section bắt buộc), `references/standards/` (tiêu chuẩn), `references/workflows/` (quy trình chi tiết), `scripts/` (code chạy được), `assets/` (template/hình). Lúc load, **anatomy validator** kiểm tra: (1) đủ 4 section; (2) scripts/ file có shebang + executable bit; (3) references tồn tại nếu body nhắc tới. Skill thiếu section → load được nhưng đánh dấu `incomplete` — curator/agent biết skill chưa đạt chuẩn executable. mya có sẵn skill.ts (SKILL.md parse + progressive disclosure), curator (load/đánh giá), skill-description (prompt index) — YJ thêm **anatomy validator** + **incomplete flag**.

## Kiến trúc

```
  skill/
    ├─ SKILL.md            ← frontmatter + body BẮT BUỘC:
    │                         ## When to Use
    │                         ## Prerequisites
    │                         ## Workflow
    │                         ## Verification
    ├─ references/
    │   ├─ standards/      ← tiêu chuẩn (NIST, ATT&CK ...)
    │   └─ workflows/      ← quy trình chi tiết
    ├─ scripts/            ← code chạy được (shebang + +x)
    └─ assets/             ← template / hình minh họa

  Anatomy validator:
    SKILL.md có đủ 4 section?       → nếu thiếu: incomplete ⚠️
    scripts/ có executable bit?      → nếu thiếu: warn
    references nhắc trong body tồn tại? → nếu thiếu: warn
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SKILL.md parse + frontmatter (nền — YJ body sections)
// ✅ packages/skills curator.ts — load skill từ dir (nền — YJ validate lúc load)
// ✅ packages/skills skill-description.ts — mô tả prompt (nền — YJ When to Use vào prompt)
// ✅ packages/intercom skills/ — SKILL.md mẫu trong intercom (nền — YJ ví dụ)

// ❌ THIẾU: anatomy validator (4 section + scripts executable + references)
// ❌ THIẾU: incomplete flag (skill thiếu section hiển thị rõ)
```

## Implementation (TS)

```typescript
// packages/skills/src/anatomy-validator.ts (MỚI)
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";

const REQUIRED_SECTIONS = ["When to Use", "Prerequisites", "Workflow", "Verification"];

export interface AnatomyIssue {
  kind: "missing-section" | "scripts-not-executable" | "missing-reference";
  detail: string;
}

export interface AnatomyReport {
  name: string;
  complete: boolean;      // false = incomplete ⚠️
  issues: AnatomyIssue[];
}

export async function validateAnatomy(skillDir: string): Promise<AnatomyReport> {
  const issues: AnatomyIssue[] = [];
  const md = await readFile(join(skillDir, "SKILL.md"), "utf8");

  // 1. đủ 4 section bắt buộc?
  for (const s of REQUIRED_SECTIONS) {
    if (!md.includes(`## ${s}`)) issues.push({ kind: "missing-section", detail: s });
  }

  // 2. scripts/ có executable bit?
  try {
    for (const f of await readdir(join(skillDir, "scripts"))) {
      const st = await stat(join(skillDir, "scripts", f));
      if (!(st.mode & 0o111)) issues.push({ kind: "scripts-not-executable", detail: f });
    }
  } catch { /* không có scripts/ → ok */ }

  // 3. references nhắc trong body phải tồn tại
  for (const m of md.matchAll(/references\/([\w./-]+)/g)) {
    try { await stat(join(skillDir, "references", m[1])); }
    catch { issues.push({ kind: "missing-reference", detail: m[1] }); }
  }

  return { name: skillDir.split("/").pop() ?? skillDir, complete: issues.length === 0, issues };
}

// Usage:
// const report = await validateAnatomy("skills/phishing-detection");
// report.complete || markIncomplete(report.name); // ⚠️ skill chưa đạt chuẩn executable
// → curator/agent thấy incomplete → bổ sung section trước khi dùng
```

## Được

- ✅ Discoverable — When to Use/Prerequisites vào prompt (progressive disclosure)
- ✅ Executable — Workflow + Verification đủ để chạy thật
- ✅ Validator máy được — anatomy check trong curator/CI
- ✅ Layout ổn định — references/scripts/assets chỗ nào cũng biết
- ✅ Incomplete flag — skill chưa chuẩn hiển thị rõ, không lén dùng

## Mất

- ❌ Cứng nhắc — skill nhỏ 10 dòng cũng phải đủ 4 section + thư mục
- ❌ Validator heuristic — section có tiêu đề nhưng nội dung rỗng không bắt được
- ❌ Migration cost — skill cũ không theo anatomy phải refactor hàng loạt

## Khác các hướng gần

| | Skill tự do (chỉ SKILL.md) | Frontmatter đầy đủ | YJ: Anatomy chuẩn |
|---|---|---|---|
| Cấu trúc | tự do | metadata | **thư mục + 4 section cố định** |
| Executable | tùy hứng | tùy hứng | **validator bắt buộc** |
| Discoverable | mô tả | mô tả | **When to Use vào prompt** |

## Khi nào chọn

- Skill library nhiều người viết, cần chuẩn chung đảm bảo chất lượng
- Muốn skill "đọc là chạy được" (Workflow + Verification bắt buộc)
- Có skill.ts + curator sẵn — YJ thêm validator + incomplete flag
- Nối packages/skills skill.ts (body sections) + curator.ts (validate lúc load) + skill-description.ts (When to Use vào prompt); guard empty-section (section rỗng vẫn fail — kiểm tra nội dung), migration-path (skill cũ refactor từng đợt, không force), và validator-fresh (thêm section mới phải update validator); YJ = skill anatomy, kết hợp 658 YH multi-framework-mapping (frontmatter chuẩn) + 656 YF declarative-over-imperative (Workflow declarative, không lệnh bịa)
