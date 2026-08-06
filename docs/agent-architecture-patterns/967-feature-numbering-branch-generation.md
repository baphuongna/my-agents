# Hướng AKE: Feature Numbering & Branch Generation — `/speckit.specify` scan spec đánh số feature kế tiếp (001, 002…), sinh semantic branch name từ description, tạo branch tự động, mỗi feature là branch merge độc lập

> **Nguồn gốc:** spec-kit (spec-driven.md, extensions/git/commands/speckit.git.feature.md) | **Coupling:** 🟢 — git + spec convention | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có workflows + git tools; thiếu numbering + branch gen) | **Effort:** 1-2 tuần

## Nguồn gốc

**spec-kit** có **`/speckit.specify`**: (1) **scan spec hiện có để tự đánh số feature kế tiếp** — đọc thư mục spec, tìm số feature lớn nhất, số tiếp theo là 001, 002… (không trùng, không phải tự bịa); (2) **sinh semantic branch name từ description** — description → branch name có nghĩa (vd "add user login" → `feature/002-add-user-login`) — không phải branch/abc123; (3) **tạo branch tự động** — chạy xong lệnh là branch được tạo, không phải hướng dẫn user tự tạo; (4) **sequential hoặc timestamp numbering theo git-config** — chọn kiểu đánh số theo config (sequential 001/002 hay timestamp); (5) **dựng `specs/[branch-name]/` structure** — mỗi feature có thư mục spec riêng; (6) **mỗi feature là một branch có thể merge độc lập** — feature branch độc lập, merge từng cái.

Giá trị: (1) **không trùng số** — numbering tự động từ scan, không đoán; (2) **branch có nghĩa** — semantic name dễ review, dễ tìm; (3) **tự động hóa** — một lệnh xong spec + branch + thư mục; (4) **merge độc lập** — mỗi feature là một đơn vị có thể chốt riêng.

## Mô tả

Với mya, pattern = **feature branch factory** gắn vào workflow: (1) **scan** — quét thư mục spec (nối AKD spec-first: `specs/` structure) đọc số feature hiện có; (2) **next number** — max + 1 (sequential) hoặc timestamp (theo config); (3) **slugify** — description → semantic branch name (lowercase, hyphen, bỏ ký tự đặc biệt, giới hạn độ dài); (4) **create** — `git checkout -b feature/<num>-<slug>` (chạy qua codeexec — `packages/tools/src/codeexec.ts`) + dựng `specs/<branch-name>/`; (5) **idempotent** — branch đã tồn tại → không tạo lại, báo số đã dùng; (6) nơi gắn — `packages/workflows` (workflow script) + `packages/tools` (tool `spec_feature` mẫu theo ToolImpl). Đây là pattern **deterministic artifact naming**: số và tên sinh từ dữ liệu thật (scan + description), không phải sáng tạo tự do.

## Kiến trúc (ASCII)

```
  /speckit.specify "<description>"
    │
    ▼ SCAN spec hiện có (specs/ — nối AKD)
  ├─ đọc số feature đã dùng: 001, 002… → max = 002
    │
    ▼ NEXT NUMBER (theo git-config)
  ├─ sequential ──► 003 (max+1)
  └─ timestamp  ──► 20260806-...
    │
    ▼ SLUGIFY description → semantic branch name
  "add user login" → feature/003-add-user-login
    │
    ▼ CREATE TỰ ĐỘNG
  ├─ git checkout -b feature/003-add-user-login (idempotent — tồn tại thì thôi)
  └─ dựng specs/feature/003-add-user-login/ (spec thư mục riêng)
    │
    ▼ MERGE ĐỘC LẬP — mỗi feature một branch merge riêng
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (chạy git command)
// ✅ packages/workflows/src/runner.ts — workflow runner (nơi gắn spec_feature)
// ✅ packages/tools/src/hashline-edit.ts — ToolImpl mẫu (tool pattern)
// ✅ packages/memory/src/store.ts — store (nơi lưu spec artifact paths)
// ✅ packages/audit/src/trust.ts — config per project (nơi lưu numbering preference)

// ❌ THIẾU: feature numbering scan (đọc spec → max → next)
// ❌ THIẾU: slugify description → semantic branch name
// ❌ THIẾU: auto-create branch + specs/<branch>/ (idempotent)
```

## Implementation

```typescript
// packages/workflows/src/feature-branch.ts (NEW)
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Scan spec dir — đọc số feature đã dùng, trả max (0 nếu chưa có). */
export function scanFeatureNumbers(specsDir: string): number[] {
  if (!readdirSync(specsDir, { withFileTypes: true }).some((e) => e.isDirectory())) return [];
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{3}/.test(e.name))
    .map((e) => Number(e.name.slice(0, 3)))
    .sort((a, b) => a - b);
}

/** Next number — sequential (max+1) hoặc timestamp theo config. */
export function nextFeatureNumber(specsDir: string, numbering: "sequential" | "timestamp" = "sequential"): string {
  if (numbering === "timestamp") return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const max = scanFeatureNumbers(specsDir).at(-1) ?? 0;
  return String(max + 1).padStart(3, "0");
}

/** Slugify — description → semantic branch name (lowercase, hyphen, limit). */
export function slugify(description: string): string {
  const slug = description
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "feature";
}

/** Tạo branch + specs dir — idempotent: branch tồn tại thì không tạo lại. */
export async function createFeatureBranch(
  run: (cmd: string) => Promise<{ stdout: string; exitCode: number | null }>,
  opts: { cwd: string; specsDir: string; description: string; numbering?: "sequential" | "timestamp" },
): Promise<{ branch: string; number: string; created: boolean }> {
  const number = nextFeatureNumber(opts.specsDir, opts.numbering);
  const branch = `feature/${number}-${slugify(opts.description)}`;
  const { exitCode } = await run(`git rev-parse --verify ${branch}`).catch(() => ({ stdout: "", exitCode: 1 }));
  if (exitCode === 0) return { branch, number, created: false };   // idempotent
  await run(`git checkout -b ${branch}`);
  await run(`mkdir -p ${join(opts.specsDir, branch)}`);
  return { branch, number, created: true };
}

/** Semantic branch name từ description — deterministic, không bịa. */
export function branchNameFor(description: string, number: string): string {
  return `feature/${number}-${slugify(description)}`;
}
// Nối AKD: specs/[branch-name]/ structure — spec-first, mỗi feature thư mục riêng
// Nối workflows: spec_feature tool gọi createFeatureBranch — một lệnh xong spec+branch
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không trùng số — scan thật, không đoán | ❌ Scan spec dir lệch chuẩn (tên khác format) — số sai |
| ✅ Branch semantic — dễ review, dễ tìm | ❌ Slugify tiếng Việt bỏ dấu — tên có thể khó đọc |
| ✅ Tự động — một lệnh xong spec + branch | ❌ Auto-create branch đổi trạng thái git — cần rõ ràng |
| ✅ Merge độc lập — mỗi feature một đơn vị | ❌ Nhiều feature branch cùng lúc — conflict khi merge |

## Khác các hướng gần

| | AKE Feature Branch | AKD Spec Source of Truth | 803 Change Stacking |
|---|---|---|---|
| Trọng tâm | Sinh số + branch từ spec | Spec là primary artifact | dependsOn/provides metadata |
| Cơ chế | Scan + slugify + checkout | spec → plan → code | Change graph |
| Quan hệ | Công cụ của AKD (branch per feature) | Chứa AKE | Quản lý thứ tự thay đổi |

## Khi nào chọn

- Spec-first project (AKD) — mỗi feature cần branch + thư mục riêng
- Muốn số feature + tên branch deterministic — không trùng, không bịa
- Đã có codeexec + workflows — thêm numbering + slugify là rẻ
- Guard: scan thật trước khi số, slugify chuẩn, idempotent, merge độc lập per feature