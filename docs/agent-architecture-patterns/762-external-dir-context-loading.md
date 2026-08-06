# Hướng ACH: External Dir Context Loading — thêm directory ngoài cwd vào session, load AGENTS.md/CLAUDE.md + skills tự động mỗi turn

> **Nguồn gốc:** pi-add-dir (README.md) | **Coupling:** 🟢 — thêm context source, prompt assembler mở rộng | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có ctxFiles + skill store — chưa có multi-dir load + skill đăng ký native) | **Effort:** 2 tuần

## Nguồn gốc

**pi-add-dir** cho phép thêm **directory ngoài cwd** vào session qua lệnh `/add-dir`. Khi thêm, **AGENTS.md, CLAUDE.md và skills của directory đó được load tự động vào context mỗi turn** — agent hiểu cả hai project cùng lúc (ví dụ agent đang làm project A nhưng cần reference shared library ở project B). Skills của directory ngoài được **đăng ký native thành `/skill:name`** qua event **`resources_discover`** — không phải quét lại từ đầu mỗi turn. Nguyên tắc: **context là tập hợp nhiều directory có chủ đích, mỗi directory đóng góp rules + skills của nó**.

## Mô tả

mya external dir context loading: (1) **`/add-dir <path>`** — thêm directory ngoài cwd vào session; (2) **auto-load mỗi turn** — AGENTS.md + CLAUDE.md của directory được đọc và đưa vào **context tier** (packages/prompts assembler.ts đã có 3-tier prompt với `ctxFiles: string[]` — mở rộng thành list có nguồn); (3) **skills đăng ký native** — SkillStore (packages/skills) discover directory ngoài, mỗi skill trở thành `/skill:name` gọi được như skill local; (4) **`resources_discover` event** — khi directory thêm/xóa, event báo cho agent biết resource set thay đổi (không phải đoán). Nối ACI (heuristic-directory-suggestion) — ACH là cơ chế load, ACI là cách gợi ý.

## Kiến trúc

```
  /add-dir <path>  (directory ngoài cwd)
       ▼
  DISCOVER (resources_discover event)
    ├─ AGENTS.md ──▶ context tier (mỗi turn)
    ├─ CLAUDE.md ──▶ context tier (mỗi turn)
    └─ skills/    ──▶ SkillStore → đăng ký /skill:name (native)
       ▼
  PROMPT ASSEMBLER (3-tier)
    stable   — identity (local project)
    context  — local files + EXTERNAL dir files (AGENTS.md/CLAUDE.md)
    volatile — memory + env
  AGENT hiểu cả 2 project cùng lúc (skills gọi native)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts assembler.ts — 3-tier prompt + ctxFiles (context tier)
//   (nền — ACH thêm external dir vào ctxFiles có nguồn)
// ✅ packages/skills curator.ts — SkillStore.discover(dir) + index + loadBody
//   (nền — ACH discover skills directory ngoài)
// ✅ packages/intercom extension-api.ts — IntercomExtensionEvent (nền — resources_discover)
// ✅ packages/tools auto-discover.ts — autoDiscoverTools(dir) (nền — discover external)
// ✅ packages/core session.ts — ctxFiles: string[] (nền — multi-dir context)

// ❌ THIẾU: /add-dir command + persistence (danh sách dir theo session)
// ❌ THIẾU: load AGENTS.md/CLAUDE.md external mỗi turn (có nguồn + thứ tự)
// ❌ THIẾU: resources_discover event khi dir thêm/xóa
```
## Implementation
```typescript
// packages/prompts/src/external-dirs.ts (MỚI)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export interface ExternalDir {
  path: string;
  /** Các rule file load được — theo thứ tự ưu tiên. */
  ruleFiles: string[];
  /** Tên skill đã đăng ký từ dir này. */
  registeredSkills: string[];
}
const RULE_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const SKILL_DIR = "skills";
/** Load rule files của một external dir — mỗi turn. */
export async function loadExternalRules(dir: ExternalDir): Promise<string[]> {
  const blocks: string[] = [];
  for (const f of RULE_FILES) {
    try {
      const text = await readFile(join(dir.path, f), "utf8");
      blocks.push(`## ${f} (${dir.path})\n${text}`);
    } catch {
      // File không tồn tại — skip (không phải lỗi).
    }
  }
  return blocks;
}
/** Đăng ký skills của external dir vào SkillStore (native /skill:name). */
export async function discoverExternalSkills(
  dir: ExternalDir,
  register: (name: string, body: string) => void,
): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  let entries: string[] = [];
  try {
    entries = await readdir(join(dir.path, SKILL_DIR), { withFileTypes: true })
      .then((es) => es.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    return; // không có skills/ — hợp lệ
  }
  for (const name of entries) {
    const skillFile = join(dir.path, SKILL_DIR, name, "SKILL.md");
    try {
      const body = await readFile(skillFile, "utf8");
      register(name, body); // native /skill:name
      if (!dir.registeredSkills.includes(name)) dir.registeredSkills.push(name);
    } catch { /* SKILL.md thiếu — bỏ qua */ }
  }
}
/** resources_discover event payload — dir thêm/xóa. */
export function resourcesDiscoverDelta(added: string[], removed: string[]): string {
  const parts: string[] = [];
  if (added.length) parts.push(`added dirs: ${added.join(", ")}`);
  if (removed.length) parts.push(`removed dirs: ${removed.join(", ")}`);
  return parts.join("; ") || "no change";
}
//        skillSetDirty = true khi registeredSkills thay đổi
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent hiểu nhiều project cùng lúc (shared library reference) | ❌ Context phình theo số dir — cần budget kiểm soát |
| ✅ Skills external gọi native — không cần mô tả lại | ❌ Rule conflict giữa các AGENTS.md phải có thứ tự ưu tiên |
| ✅ resources_discover — agent biết resource set thay đổi | ❌ Dir list phải persist theo session (restart giữ lại) |
| ✅ Context tier có nguồn (file + path) — dễ debug | ❌ External dir có thể chứa injection — phải scan (đã có inject.ts) |

## Khác các hướng gần

| | Context files (ctxFiles) | ACH: External Dir Loading |
|---|---|---|
| Nguồn | Files do transport đọc | **Directory ngoài cwd — có chủ đích /add-dir** |
| Skills | Không liên quan | **Skills external đăng ký native /skill:name** |
| Thay đổi | Rebuild khi file-set đổi | **resources_discover event tường minh** |
| Persist | Theo session | **Dir list persist + rehydrate restart** |

## Khi nào chọn

- Task cần tham chiếu shared library / project khác ngoài cwd thường xuyên
- Muốn skills của project ngoài dùng được như skill local (không copy)
- Đã có assembler 3-tier + SkillStore — thêm external dir source là tự nhiên
- Guard: scan injection mọi rule file external, thứ tự ưu tiên rõ, budget context
