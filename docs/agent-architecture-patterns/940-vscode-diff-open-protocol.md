# Hướng AJD: VSCode Diff-Open Protocol — plan server có route mở diff trong VS Code; review surface kết nối editor ngoài browser qua HTTP protocol nhẹ

> **Nguồn gốc:** plannotator | **Coupling:** 🟡 — thêm HTTP route + editor integration | **Agent-agnostic:** ⚠️ (VS Code availability) | **Code sẵn:** ⚠️ (gateway HTTP routes có sẵn; chưa có diff-open route) | **Effort:** 1 tuần

## Nguồn gốc

**plannotator** có route `/api/plan/vscode-diff` mở diff trong VS Code — **review surface kết nối được với editor ngoài browser qua HTTP protocol nhẹ**. User đang review trong web, click "mở diff" → server mở VS Code diff view (code — window) với đúng file/đoạn — thay vì phải rời review surface, mở file tay, tìm dòng.

Nguyên tắc: **review surface + editor là hai màn hình bổ trợ** — browser cho tổng quan/annotation, editor cho diff chính xác (syntax highlight, context thật); **HTTP protocol nhẹ là cầu** — server biết file/diff, editor mở đúng chỗ (không cần plugin nặng, dùng `code` CLI có sẵn); **action có tham số rõ** — path, line range, ref (trước/sau) — editor mở diff đúng nội dung.

## Mô tả

Với mya, pattern = **gateway route mở editor**: (1) **gateway thêm route** `POST /api/diff/open` (pattern route có sẵn trong handleHttp — `/sessions/:id`, `/cron/jobs/...`); body `{ path, baseHash?, refA?, refB? }`; (2) **validate** — path containment (realpath — pattern path-safety.ts có sẵn), file tồn tại; (3) **diff resolution** — nếu có `refA/refB` dùng `git diff` (nối output-compress git reducer pattern) hoặc `hashline` (hash-anchored line range — `packages/tools/hashline.ts`); (4) **mở VS Code** — spawn `code --diff <fileA> <fileB>` (hoặc `code --goto <file>:<line>` cho single-file) — spawn child (pattern builtin.ts spawn); (5) **trả kết quả** — `{ ok: true, opened: "vscode", pid }`; VS Code không có → trả lỗi rõ (degrade: trả diff text để user copy); (6) **nối AJA Review Takeover** — nút "Open in VS Code" trong per-file diff gọi route này. Auth: route sau wsToken gate (browser origin check có sẵn).

## Kiến trúc (ASCII)

```
  REVIEW UI (packages/web — per-file diff)
    │  "Open in VS Code" ──► POST /api/diff/open
    ▼
  GATEWAY (handleHttp — route mới)
    ├─ validate: path containment (path-safety) + file tồn tại
    ├─ diff resolution: refA/refB (git diff) | hashline (line range)
    │    └─ single file ──► code --goto <file>:<line>
    │    └─ diff pair   ──► code --diff <fileA> <fileB>
    ├─ spawn (builtin spawn pattern) + wsToken/auth gate
    └─ trả { ok, opened: "vscode", pid } | lỗi rõ (không có code CLI)
    ▼
  VS CODE mở đúng diff — browser giữ tổng quan/annotation
  (HTTP protocol nhẹ — không plugin nặng, dùng code CLI có sẵn)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway index.ts — handleHttp routes (mẫu route có sẵn, auth gate)
// ✅ packages/tools path-safety.ts — path containment (validate file)
// ✅ packages/tools hashline.ts — hash-anchored line range (nền diff)
// ✅ packages/tools output-compress.ts — git diff reducer (nền diff resolution)
// ✅ packages/tools builtin.ts — child spawn pattern (nền spawn code CLI)
// ✅ packages/web — dashboard (nút "Open in VS Code" trong review)

// ❌ THIẾU: POST /api/diff/open route
// ❌ THIẾU: diff resolution (git/hashline) + code CLI spawn
// ❌ THIẾU: degrade khi VS Code không có (trả diff text)
```

## Implementation

```typescript
// packages/gateway/src/diff-open.ts (NEW)
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { realpathSync, existsSync } from "node:fs";

export interface DiffOpenRequest {
  path: string;          // file tuyệt đối (hoặc resolve từ workspace)
  refA?: string;         // ví dụ "HEAD" | hash
  refB?: string;
  line?: number;         // single-file goto line
}

/** Mở diff trong VS Code — code CLI có sẵn; trả ok + pid hoặc lỗi rõ. */
export async function openVscodeDiff(req: DiffOpenRequest, workspace: string): Promise<{ ok: boolean; detail: string; pid?: number }> {
  const abs = realpathSync(existsSync(req.path) ? req.path : `${workspace}/${req.path}`);
  if (!abs.startsWith(realpathSync(workspace))) {
    return { ok: false, detail: "path outside workspace" };
  }
  if (!existsSync(abs)) return { ok: false, detail: `file not found: ${abs}` };
  try {
    execFileSync("code", ["--version"], { stdio: "ignore" });   // check CLI
  } catch {
    return { ok: false, detail: "VS Code CLI (code) không có — dùng diff text bên dưới" };
  }
  const args = req.refA && req.refB
    ? ["--diff", await gitShow(req.refA, abs), await gitShow(req.refB, abs)]
    : req.line
      ? ["--goto", `${abs}:${req.line}`]
      : [abs];
  const child = spawn("code", args, { stdio: "ignore", detached: true });
  child.unref();
  return { ok: true, detail: `opened ${abs}`, pid: child.pid };
}

async function gitShow(ref: string, path: string): Promise<string> {
  // git show <ref>:<relative> → temp file cho --diff (nối git pattern output-compress).
  return execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}
// Gateway handleHttp: route POST /api/diff/open → openVscodeDiff → send JSON.
// Review UI (AJA): nút "Open in VS Code" → fetch route này.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Review + editor hai màn hình — diff chính xác có context | ❌ Cần VS Code + code CLI trên máy |
| ✅ HTTP protocol nhẹ — không plugin nặng | ❌ Spawn detached process — cần dọn nếu user không đóng |
| ✅ Degrade rõ — không code CLI → trả diff text | ❌ Path containment phải chặt (realpath) |
| ✅ Nối hashline/git diff resolution | ❌ Chỉ VS Code — các editor khác cần adapter riêng |

## Khác các hướng gần

| | AJD VSCode Diff-Open | AJA Review Takeover | AJB Vendor Mirror |
|---|---|---|---|
| Trọng tâm | Mở diff ngoài editor | Review UX trong dashboard | Đồng bộ code |
| Cơ chế | HTTP route + code CLI | CSS-hide + checkbox | Vendor script + verify |
| Quan hệ | Editor integration | Review surface | Dev infra |

## Khi nào chọn

- Review trong web nhưng user cần diff chính xác trong editor (context, highlight)
- Đã có gateway HTTP routes + path-safety + hashline — thêm diff-open route
- Muốn protocol nhẹ (không plugin), degrade rõ khi thiếu editor
- Guard: path containment realpath, wsToken auth, spawn detached + unref, lỗi rõ khi không có code CLI