# Hướng AFW: Startup-Scan Root-Guard — startup scan gate bằng project-root markers (.git/package.json/pyproject.toml...) và cap 2000 source files, chặn quét `$HOME` hay thư mục generic gây hang tại session start

> **Nguồn gốc:** pi-lens (clients/startup-scan.ts) | **Coupling:** 🟢 — gate thuần, không đổi agent loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có find.ts file-walk + symbol population, thiếu root-guard + cap) | **Effort:** 0.5-1 tuần

## Nguồn gốc

**pi-lens** startup scan có **gate an toàn**: chỉ quét khi phát hiện **project-root markers** (`.git` / `package.json` / `pyproject.toml` / `Cargo.toml`...) — đảm bảo đang ở project thật, không phải `$HOME` hay thư mục generic. Đồng thời **cap 2000 source files** — chặn hang do quét thư mục khổng lồ tại session start. Nguyên tắc: **không quét mù** — phải có dấu hiệu project + giới hạn cứng để không treo startup.

## Mô tả

mya startup-scan-root-guard: (1) **file-walk đã sẵn** — `packages/tools` find.ts + symbol-extractor.ts (file-walk + symbol population); (2) **root markers** — check `.git`/`package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod` tồn tại; (3) **cap 2000** — đếm file, dừng khi vượt cap; (4) **block generic dirs** — `$HOME`, `/`, thư mục không có marker → không quét; (5) **graceful** — nếu không phải project, bỏ scan (không crash). Nối AFV (lsp warmFiles).

## Kiến trúc (ASCII)

```
  SESSION START ──▶ startup scan
   │
   ▼  ROOT-GATE: có project-root marker không?
   ├─ .git / package.json / pyproject.toml / Cargo.toml / go.mod ?
   │   ├─ CÓ  ──▶ là project thật → tiếp tục quét
   │   │            ▼  CAP 2000 source files
   │   │            đếm... vượt 2000 → DỪNG (chặn hang)
   │   │            ▼  populate symbols
   │   │
   │   └─ KHÔNG ──▶ generic dir ($HOME / /) → BỎ quét (không hang)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools find.ts — file-walk (file discovery)
// ✅ packages/tools symbol-extractor.ts — file-walk + symbol population (line 305)
// ✅ packages/tools lsp-cascade.ts — symbol populate nền

// ❌ THIẾU: root-marker gate (.git/package.json/pyproject.toml...)
// ❌ THIẾU: cap 2000 source files (chặn hang)
// ❌ THIẾU: block generic dirs ($HOME)
```

## Implementation

```typescript
// packages/tools/src/startup-scan.ts (MỚI)
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", ".hg"];
const FILE_CAP = 2000;
/** Có phải project root không? (ít nhất 1 marker). */
export function isProjectRoot(dir: string): boolean {
  return ROOT_MARKERS.some((m) => existsSync(join(dir, m)));
}
/** Gate startup scan: chỉ quét project root + cap files. */
export function shouldScan(cwd: string, home: string): { scan: boolean; reason: string } {
  if (cwd === home || cwd === "/" || cwd === home.replace(/\/[^/]+$/, ""))
    return { scan: false, reason: "generic/home dir — skip" };
  if (!isProjectRoot(cwd)) return { scan: false, reason: "no project marker — skip" };
  return { scan: true, reason: "project root detected" };
}
/** Walk với cap — dừng khi vượt FILE_CAP. */
export function cappedWalk(files: string[]): { files: string[]; capped: boolean } {
  if (files.length > FILE_CAP) return { files: files.slice(0, FILE_CAP), capped: true };
  return { files, capped: false };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn hang startup (không quét $HOME) | ❌ Marker thiếu → bỏ quét project hợp lệ |
| ✅ Cap 2000 — không treo thư mục khổng lồ | ❌ Cap có thể bỏ sót file quan trọng (>2000) |
| ✅ Chỉ quét project thật | ❌ Mono-repo lớn vẫn có thể chạm cap |

## Khác các hướng gần

| | AFW Startup-Scan Root-Guard | AFV LSP Idle-Warm | find.ts |
|---|---|---|---|
| Gate | root marker + cap | idle shutdown | không |
| Mục đích | Chặn hang startup | Tiết kiệm RAM LSP | File discovery on-demand |
| Khi | session start | lifecycle | agent gọi |

## Khi nào chọn

- Startup scan có nguy cơ hang ($HOME / thư mục khổng lồ)
- Muốn chỉ quét project thật (có marker)
- Cần cap cứng để không treo
- Guard: marker list đầy đủ, cap configurable, generic-dir block, graceful skip
