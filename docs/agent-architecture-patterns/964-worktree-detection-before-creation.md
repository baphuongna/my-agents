# Hướng AKB: Worktree Detection Before Creation — detect trước khi tạo worktree (GIT_DIR != GIT_COMMON, loại trừ submodule), ưu tiên native worktree tools, hỏi consent nếu chưa có preference

> **Nguồn gốc:** superpowers (skills/using-git-worktrees/SKILL.md) | **Coupling:** 🟢 — git ops helper, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có hashline-edit + find; thiếu worktree helper) | **Effort:** 1 tuần

## Nguồn gốc

**superpowers** (skills/using-git-worktrees/SKILL.md) **detect trước khi tạo worktree**: (1) **so `GIT_DIR != GIT_COMMON`** — kiểm tra mình đang ở trong worktree hay repo chính (GIT_COMMON_DIR chỉ có ở worktree — env này là dấu hiệu chắc chắn); (2) **loại trừ submodule** — dùng `show-superproject-working-tree` để chắc chắn không phải submodule (submodule cũng có vẻ "repo con" nhưng không phải worktree — tạo worktree trong submodule là sai chỗ); (3) **ưu tiên native worktree tools trước git fallback** — dùng `git worktree add` (native) trước, không tự chế bằng checkout/symlink; (4) **hỏi consent nếu chưa có preference** — user chưa khai báo thích worktree hay không → hỏi, không tự tạo; (5) **không bao giờ chiến đấu với harness** — nếu môi trường (IDE/harness) không hỗ trợ worktree thì đừng ép.

Giá trị: (1) **không tạo worktree sai chỗ** — detect trước chặn tạo trong repo chính/submodule; (2) **đúng công cụ** — native git worktree thay vì hack fallback; (3) **tôn trọng user** — consent khi chưa có preference; (4) **an toàn với môi trường** — không chiến đấu với harness.

## Mô tả

Với mya, pattern = **worktree-safe git helper**: (1) **detect context** — đọc env `GIT_COMMON_DIR` (khác rỗng = đang trong worktree) + `GIT_DIR`; chạy `git rev-parse --show-superproject-working-tree` (output khác rỗng = submodule — cấm tạo worktree); (2) **preference check** — đọc config (user preference: worktree cho phép hay không) — mya có `packages/core` config + trust (audit) — nơi lưu preference; chưa có → hỏi (ApprovalChannel — `packages/tools/src/approval.ts`); (3) **create** — ưu tiên `git worktree add <path> <branch>` native; fallback chỉ khi git không hỗ trợ (rất hiếm); (4) **harness guard** — nếu env có dấu hiệu harness không worktree-friendly (CI, IDE lock) → nêu rõ, không ép; (5) nơi gắn — `packages/tools` thêm tool `git_worktree` (mẫu theo `hashline-edit.ts`, `find.ts` — ToolImpl). Đây là pattern **environment-aware git operations**: hỏi môi trường trước, hỏi user khi thiếu thông tin, không đoán.

## Kiến trúc (ASCII)

```
  YÊU CẦU: tạo worktree
    │
    ▼ DETECT CONTEXT (trước khi tạo)
  ├─ GIT_COMMON_DIR khác rỗng? ──► đang TRONG worktree rồi — không tạo lồng
  ├─ show-superproject-working-tree ra kết quả? ──► SUBMODULE — cấm tạo
  └─ repo chính bình thường ──► được phép tạo
    │
    ▼ PREFERENCE CHECK
  ├─ đã có preference ──► theo preference
  └─ chưa có ──► HỎI CONSENT (approval) — không tự tạo
    │
    ▼ CREATE — ưu tiên NATIVE: git worktree add <path> <branch>
    (fallback git chỉ khi native không có — không tự chế checkout/symlink)
    ▼ HARNESS GUARD — môi trường không worktree-friendly → nêu rõ, không ép
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/hashline-edit.ts — ToolImpl mẫu (git-ish edit tool)
// ✅ packages/tools/src/find.ts — ToolImpl mẫu (shell wrapper pattern)
// ✅ packages/tools/src/approval.ts — ApprovalChannel (hỏi consent)
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (chạy git command)
// ✅ packages/audit/src/trust.ts — ProjectTrust (nơi lưu preference per project)
// ❌ THIẾU: worktree detection (GIT_COMMON_DIR + superproject check)
// ❌ THIẾU: native-first create (git worktree add) + fallback policy
// ❌ THIẾU: consent flow (chưa có preference → hỏi trước khi tạo)
```

## Implementation

```typescript
// packages/tools/src/git-worktree.ts (NEW)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export type WorktreeContext =
  | { kind: "main"; root: string }          // repo chính — được tạo
  | { kind: "worktree"; root: string }      // đang trong worktree — không tạo lồng
  | { kind: "submodule"; root: string };    // submodule — cấm tạo
/** Detect context TRƯỚC khi tạo — env + git plumbing. */
export async function detectWorktreeContext(cwd: string): Promise<WorktreeContext> {
  const { stdout: commonDir } = await exec("git", ["rev-parse", "--git-common-dir"], { cwd });
  const isWorktree = commonDir.trim().length > 0;      // GIT_COMMON_DIR chỉ có ở worktree
  // Loại trừ submodule: show-superproject-working-tree ra path là submodule.
  const { stdout: superProj, stderr } = await exec(
    "git", ["rev-parse", "--show-superproject-working-tree"], { cwd },
  ).catch(() => ({ stdout: "", stderr: "" }));
  void stderr;
  if (superProj.trim().length > 0) return { kind: "submodule", root: cwd };
  return isWorktree ? { kind: "worktree", root: cwd } : { kind: "main", root: cwd };
}
/** Consent — chưa có preference thì hỏi, không tự tạo. */
export async function ensureConsent(
  preference: "allow" | "deny" | "ask",
  ask: () => Promise<boolean>,
): Promise<{ ok: boolean; reason: string }> {
  if (preference === "allow") return { ok: true, reason: "" };
  if (preference === "deny") return { ok: false, reason: "preference deny — không tạo worktree" };
  return (await ask()) ? { ok: true, reason: "" } : { ok: false, reason: "user từ chối consent" };
}
/** Native-first create — ưu tiên git worktree add, không tự chế fallback. */
export async function createWorktree(
  cwd: string,
  opts: { branch: string; path: string },
): Promise<{ ok: boolean; output: string }> {
  const ctx = await detectWorktreeContext(cwd);
  if (ctx.kind !== "main") {
    return { ok: false, output: `cấm tạo worktree trong ${ctx.kind}` };
  }
  try {
    const { stdout } = await exec("git", ["worktree", "add", opts.path, "-b", opts.branch], { cwd });
    return { ok: true, output: stdout };
  } catch (e) {
    return { ok: false, output: `native worktree add fail: ${String(e)}` };
  }
}
/** Harness guard — không chiến đấu với môi trường không worktree-friendly. */
export function harnessAllowsWorktree(env: NodeJS.ProcessEnv): boolean {
  if (env.CI === "true" && env.GITHUB_ACTIONS === "true") return false;   // CI checkout shallow
  return env.MYA_WORKTREE !== "deny";
}
// Nối approval: ensureConsent nối ApprovalChannel — ask() = humanPrompt Allow/Deny
// Nối trust: preference lưu trong ProjectTrust (audit/trust.ts) per project root
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không tạo worktree sai chỗ (main/submodule) — detect trước | ❌ Detect qua git plumbing — repo lạ (bare) cần test thêm |
| ✅ Native-first — git worktree add, ít tự chế | ❌ Git cũ thiếu worktree command — fallback hiếm |
| ✅ Consent — không tự tạo khi chưa có preference | ❌ Hỏi consent thêm bước — latency nhỏ |
| ✅ Harness guard — không chiến đấu với CI/IDE | ❌ Preference phân mảnh (per project) — cần quản lý |

## Khác các hướng gần

| | AKB Worktree Detection | 716 Worktree Execution | 11 Git-as-IPC |
|---|---|---|---|
| Trọng tâm | Detect trước khi tạo | Chạy task trong worktree | Git làm kênh truyền |
| Cơ chế | GIT_COMMON_DIR + superproject | Worktree isolation | Commit/branch làm message |
| Quan hệ | Điều kiện tiên quyết của 716 | Tiêu thụ AKB | Khác mục đích (IPC) |

## Khi nào chọn

- Agent hay thao tác git worktree — cần detect context trước khi tạo
- Workspace có submodule — tránh tạo worktree nhầm chỗ
- Muốn tôn trọng preference user + không ép môi trường
- Guard: detect trước, native-first, consent khi thiếu preference, harness guard