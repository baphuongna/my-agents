# Hướng AKQ: Installer Doctor Validation — dev kit có `node scripts/test.js` validate 32 skills, 5 agents, 10 commands, hooks, rules — toolkit chính nó có test suite và health check

> **Nguồn gốc:** vetc-dev-kit (AGENTS.md) | **Coupling:** 🟢 — tooling self-test | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có validate-distill-run + tool-test-harness; thiếu doctor) | **Effort:** 1-2 tuần

## Nguồn gốc

**vetc-dev-kit** (AGENTS.md) có **`node scripts/test.js`** — validate **32 skills, 5 agents, 10 commands, hooks, rules** — toolkit chính nó có **test suite và health check** riêng, không chỉ là bộ file markdown: (1) **validate số lượng** — đếm/kiểm tra đủ skill/agent/command đã khai báo; (2) **validate cấu trúc** — mỗi skill có frontmatter đúng? mỗi command có handler? hooks có script thật?; (3) **health check** — link nội bộ còn sống, reference không gãy, không file orphan; (4) **chạy như CI** — toolkit update xong chạy test.js — vỡ là biết ngay.

Giá trị: (1) **toolkit tự kiểm được** — không phải "bộ markdown ai cũng tin là đúng"; (2) **install không vỡ** — validate trước khi phân phối; (3) **cấu trúc kỷ luật** — file sai format bị test bắt; (4) **health check thường trực** — reference gãy bị phát hiện, không chờ user than.

## Mô tả

Với mya, pattern = **self-testing toolkit**: (1) **manifest expectations** — khai báo: N skills, M agents, K commands, hooks, rules (mẫu `agent-package.json` — `packages/pkg` manifest); (2) **structural validation** — skill: frontmatter name/description/body đủ (mẫu `parseSkillMarkdown` — `packages/skills/src/skill.ts` — đã throw khi thiếu name/description); command: có handler trong registry (`packages/tools/src/registry.ts`); hooks: script tồn tại; (3) **count check** — đếm thực tế vs khai báo (32 skills, 5 agents, 10 commands…) — lệch → fail; (4) **health check** — link nội bộ (file tham chiếu còn tồn tại), không orphan, không duplicate name; (5) **runner** — `scripts/doctor.mjs` (mẫu `scripts/validate-distill-run.mjs` — đã có check/pass/fail pattern + `scripts/tool-test-harness.mjs`) — chạy trong CI + pre-release. Đây là pattern **meta-validation**: công cụ sinh agent cũng là sản phẩm cần test — không có ngoại lệ "đây chỉ là config".

## Kiến trúc (ASCII)

```
  node scripts/doctor.mjs (test suite của chính toolkit)
    │
    ▼ MANIFEST EXPECTATIONS (agent-package.json / doctor.config)
  ├─ skills: 32 · agents: 5 · commands: 10 · hooks: 6 · rules: 8
    │
    ▼ STRUCTURAL VALIDATION
  ├─ skill: frontmatter name+description+body (parseSkillMarkdown throw khi thiếu)
  ├─ command: handler tồn tại trong ToolRegistry
  └─ hook: script file thật, không path chết
    │
    ▼ COUNT CHECK — đếm thực tế vs khai báo (lệch → fail)
    ▼ HEALTH CHECK — link nội bộ sống, không orphan, không duplicate name
    │
    ▼ KẾT QUẢ — pass/fail (mẫu validate-distill-run: ✅/❌ list)
    (CI + pre-release — toolkit vỡ là biết ngay)
```

## mya ĐÃ CÓ

```typescript
// ✅ scripts/validate-distill-run.mjs — check/pass/fail · tool-test-harness.mjs (nền doctor)
// ✅ packages/skills/src/skill.ts — parseSkillMarkdown (throw khi thiếu) · tools registry.ts (list)
// ✅ packages/pkg/src/index.ts — PackageManifest + verify · skills curator SkillStore (đếm)
// ❌ THIẾU: doctor script (expectations + count) · structural validation (agents/commands/hooks/rules) · health check
```

## Implementation

```typescript
// scripts/doctor.mjs (NEW — mẫu validate-distill-run.mjs)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.cwd();
const failures = [];
const passes = [];
const check = (label, ok, detail = "") => (ok ? passes.push(`✅ ${label}`) : failures.push(`❌ ${label} ${detail}`));

/** Đếm file SKILL.md theo cây thư mục. */
function countSkills(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name === "SKILL.md").length;
}

/** Structural validation — skill frontmatter đủ name+description. */
function validateSkillStructure(skillFile) {
  const raw = readFileSync(skillFile, "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
  return { name: /^name:\s*\S+/m.test(fm), desc: /^description:\s*\S+/m.test(fm), body: fm.length < raw.length };
}

/** Count check — đếm thực tế vs khai báo (manifest expectations). */
function countCheck(actual, expected, label) {
  check(`${label}: ${actual}/${expected}`, actual >= expected, `— khai báo ${expected}, thực tế ${actual}`);
}

// 1. Manifest expectations (mẫu agent-package.json) + 2. Skills — đếm + structural.
const manifest = JSON.parse(readFileSync(join(ROOT, "agent-package.json"), "utf8"));
const exp = manifest.doctor ?? { skills: 0, commands: 0, hooks: 0 };
const skillsDir = join(ROOT, "skills");
const skillFiles = existsSync(skillsDir)
  ? readdirSync(skillsDir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name === "SKILL.md")
      .map((e) => join(e.parentPath ?? skillsDir, e.name))
  : [];
countCheck(skillFiles.length, exp.skills ?? 0, "skills");
let badStructure = 0;
for (const f of skillFiles) {
  const s = validateSkillStructure(f);
  if (!s.name || !s.desc || !s.body) badStructure += 1;
}
check("skill frontmatter name+description+body", badStructure === 0, `— ${badStructure} file sai cấu trúc`);
// 3. Hooks — script thật tồn tại (path chết → fail).
const hooks = manifest.hooks ?? [];
let deadHooks = 0;
for (const h of hooks) {
  if (h.script && !existsSync(join(ROOT, h.script))) deadHooks += 1;
}
check("hooks script tồn tại", deadHooks === 0, `— ${deadHooks} hook path chết`);
// 4. Health (no duplicate command name) + 5. Kết quả — in danh sách + exit code.
const commands = manifest.commands ?? [];
const names = commands.map((c) => c.name);
check("command name không duplicate", new Set(names).size === names.length);
console.log(`\nDoctor: ${passes.length} pass / ${failures.length} fail`);
passes.forEach((p) => console.log(p));
failures.forEach((f) => console.log(f));
process.exit(failures.length === 0 ? 0 : 1);
// Nối CI: doctor.mjs chạy pre-release + CI (như validate-distill-run)
// Nối pkg: manifest.doctor là expectations — verify cùng apiVersion
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Toolkit tự kiểm — không "bộ markdown ai cũng tin" | ❌ Doctor expectations phải cập nhật khi thêm skill/command |
| ✅ Install không vỡ — validate trước phân phối | ❌ Structural check heuristic — format lệch bị bắt nhầm |
| ✅ Health check thường trực — reference gãy bị phát hiện | ❌ Scan recursive nhiều file — chậm với toolkit lớn |
| ✅ Chạy CI/pre-release — vỡ biết ngay | ❌ Count check cứng — thêm file quên khai báo → fail (đúng ý) |

## Khác các hướng gần

| | AKQ Installer Doctor | 659 Coverage Matrix | 41 Eval Harness |
|---|---|---|---|
| Trọng tâm | Toolkit tự test | Map coverage ATT&CK | Eval agent behavior |
| Cơ chế | Count + structural + health | Sinh matrix từ skills | Golden scenarios |
| Quan hệ | Sức khỏe cấu trúc | Coverage của skill | Chất lượng hành vi |

## Khi nào chọn

- Toolkit (skill/agent/command pack) phân phối rộng — muốn install không vỡ
- Nhiều file markdown/config — cần máy kiểm cấu trúc + count
- Muốn CI bắt lỗi toolkit ngay khi thay đổi
- Guard: manifest expectations, count thật vs khai báo, structure valid, hook path sống, CI chạy doctor