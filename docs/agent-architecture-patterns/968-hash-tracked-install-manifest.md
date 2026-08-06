# Hướng AKF: Hash-Tracked Install Manifest — integration manifest ghi từng file đã tạo kèm SHA-256, uninstall chỉ xóa file hash khớp, file user sửa được giữ nguyên, path validation chống escape

> **Nguồn gốc:** spec-kit (src/specify_cli/integrations/manifest.py) | **Coupling:** 🟢 — install/uninstall bookkeeping | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có signing sha256 + pkg manifest; thiếu file manifest) | **Effort:** 1-2 tuần

## Nguồn gốc

**spec-kit** có **integration manifest** ghi **từng file đã tạo kèm SHA-256**: (1) **manifest ghi từng file** — mỗi file integration (đã copy/sinh) có entry: path + hash lúc tạo; (2) **uninstall chỉ xóa file có hash khớp** — so hash hiện tại với hash trong manifest — khớp mới xóa; (3) **file bị user sửa được giữ nguyên và báo cáo** — hash lệch = user đã đụng → KHÔNG xóa (xóa là mất công sức user), báo cáo "file đã sửa, giữ lại"; (4) **path validation chống absolute/`..` escape** — path trong manifest/tạo file phải nằm trong project root — chặn `../../etc/...` hay absolute path.

Giá trị: (1) **uninstall an toàn** — chỉ xóa cái mình tạo, không xóa nhầm file user; (2) **không mất công user** — file đã sửa được giữ; (3) **chống path traversal** — integration không thể ghi ra ngoài project; (4) **audit** — manifest là danh sách chính xác "tool đã chạm gì".

## Mô tả

Với mya, pattern = **file manifest cho mọi install/apply operation**: (1) **manifest file** — `agent-package.json` (đã có `packages/pkg` manifest) thêm `installedFiles: [{ path, sha256 }]` hoặc manifest riêng `.mya/install-manifest.json`; (2) **record on install** — mỗi file tạo/sinh: ghi path + SHA-256 (mẫu `fileSha256` từ `packages/signing/src/index.ts`); (3) **uninstall gate** — đọc manifest, từng file: hash khớp → xóa; hash lệch → giữ + báo cáo "user đã sửa"; (4) **path validation** — trước khi ghi/xóa: resolve path phải nằm trong project root (chặn `..` escape, absolute) — mẫu `packages/tools/src/path-safety.ts`; (5) nơi gắn — `packages/pkg` (install lifecycle) + `packages/tools` (apply/install tools). Đây là pattern **ownership-aware file operations**: tool biết chính xác file nào là của mình (hash), file nào là của user (hash lệch) — xóa/ghi theo ownership.

## Kiến trúc (ASCII)

```
  INSTALL — sinh/copy files
    │
    ▼ GHI MANIFEST (.mya/install-manifest.json)
  ├─ path: "src/foo.ts"  sha256: "ab12…"   (mẫu fileSha256 — signing)
  └─ path: "config.json" sha256: "cd34…"
    │
    ▼ UNINSTALL — từng file trong manifest
  ├─ hash KHỚP ──► xóa file (đúng là file mình tạo)
  └─ hash LỆCH ──► file user đã sửa → GIỮ NGUYÊN + báo cáo
    │
    ▼ PATH VALIDATION (mọi ghi/xóa)
  ├─ resolve path phải nằm trong project root
  └─ chặn absolute + ".." escape (path-safety)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/signing/src/index.ts — fileSha256 + digestSha256 (hash engine)
// ✅ packages/pkg/src/index.ts — PackageManifest + verify (nơi thêm installedFiles)
// ✅ packages/tools/src/path-safety.ts — path safety (chống escape — nền)
// ✅ packages/tools/src/hashline-edit.ts — hash-anchored edit (triết lý hash — nền)
// ✅ packages/core/src/redact.ts — redact (mẫu ghi log an toàn)
// ❌ THIẾU: install manifest (installedFiles: path + sha256)
// ❌ THIẾU: uninstall gate (hash khớp → xóa; lệch → giữ + báo cáo)
// ❌ THIẾU: path validation trước mọi ghi/xóa (chống escape khỏi root)
```

## Implementation

```typescript
// packages/pkg/src/install-manifest.ts (NEW)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, rmSync, existsSync, resolve, relative } from "node:fs";
import { join } from "node:path";

export interface InstalledFile { path: string; sha256: string }
export interface InstallManifest { packageName: string; installedAt: number; files: InstalledFile[] }

/** SHA-256 của file (mẫu fileSha256 — signing). */
export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Path validation — resolve phải nằm trong project root; chặn ".." escape/absolute. */
export function assertInsideRoot(projectRoot: string, filePath: string): { ok: boolean; reason: string } {
  const rel = relative(resolve(projectRoot), resolve(projectRoot, filePath));
  if (rel.startsWith("..") || (resolve(rel) === rel && rel.includes(".."))) {
    return { ok: false, reason: `path "${filePath}" escape project root — bị chặn` };
  }
  return { ok: true, reason: "" };
}

/** Ghi manifest — sau install, record từng file kèm hash. */
export function recordInstalled(manifestPath: string, projectRoot: string, pkg: string, files: string[]): InstallManifest {
  const manifest: InstallManifest = {
    packageName: pkg,
    installedAt: Date.now(),
    files: files.map((f) => {
      if (!assertInsideRoot(projectRoot, f).ok) throw new Error(`path escape: ${f}`);
      return { path: f, sha256: fileSha256(join(projectRoot, f)) };
    }),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

/** Uninstall gate — hash khớp → xóa; lệch (user sửa) → giữ + báo cáo. */
export function uninstallByManifest(manifest: InstallManifest, projectRoot: string): { removed: string[]; kept: Array<{ path: string; reason: string }> } {
  const removed: string[] = [];
  const kept: Array<{ path: string; reason: string }> = [];
  for (const f of manifest.files) {
    const full = join(projectRoot, f.path);
    if (!existsSync(full)) { kept.push({ path: f.path, reason: "đã không còn" }); continue; }
    if (!assertInsideRoot(projectRoot, f.path).ok) { kept.push({ path: f.path, reason: "path escape — giữ" }); continue; }
    if (fileSha256(full) === f.sha256) { rmSync(full); removed.push(f.path); }
    else kept.push({ path: f.path, reason: "user đã sửa (hash lệch) — giữ nguyên" });
  }
  return { removed, kept };
}
// Nối pkg: install lifecycle gọi recordInstalled; uninstall gọi uninstallByManifest
// Nối path-safety: assertInsideRoot dùng chung với tool path safety hiện có
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Uninstall an toàn — chỉ xóa file hash khớp | ❌ Hash tính tại install — file thay đổi sau đó bị giữ (đúng ý) |
| ✅ Không mất công user — file đã sửa được giữ | ❌ Manifest lệch (tay sửa) — uninstall báo cáo thay vì xóa |
| ✅ Chống path traversal — không ghi ra ngoài root | ❌ Manifest file phát sinh — cần dọn khi uninstall |
| ✅ Audit — biết chính xác tool đã chạm gì | ❌ SHA-256 tốn IO với nhiều file — chấp nhận được |

## Khác các hướng gần

| | AKF Hash Manifest | 368 Hash-Anchored Editing | 809 Apply Log Verification |
|---|---|---|---|
| Trọng tâm | Track file đã tạo (ownership) | Địa chỉ dòng bằng hash | Audit trail từng dòng |
| Cơ chế | path + sha256 manifest | content-hash anchor | Log verification table |
| Quan hệ | Hồ sơ file install | Sửa nội dung an toàn | Audit thay đổi |

## Khi nào chọn

- Tool sinh/copy file vào project — cần uninstall sạch, không xóa nhầm
- User hay sửa file sau khi tool tạo — muốn giữ công sức user
- Integration đụng nhiều file — path validation chống escape là bắt buộc
- Guard: hash khớp mới xóa, hash lệch giữ + báo cáo, path trong root, manifest audit