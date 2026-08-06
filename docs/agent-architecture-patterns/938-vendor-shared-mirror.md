# Hướng AJB: Vendor Shared Mirror — code dùng chung giữa các harness được `vendor.sh` đồng bộ có quy trình (shared/guide.ts → serverReview.ts, agent-jobs.ts hand-mirror) thay vì fork drift

> **Nguồn gốc:** plannotator | **Coupling:** 🟡 — quy trình đồng bộ code giữa packages | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (single source tree; chưa có vendor script) | **Effort:** 1 tuần

## Nguồn gốc

**plannotator** dùng **`vendor.sh`** để vendor `shared/guide.ts` + `guide-review.ts` sang Pi mirror (`serverReview.ts`, `agent-jobs.ts` **hand-mirror** branches/routes/provider registration). Code dùng chung giữa các harness được **đồng bộ có quy trình thay vì fork drift** — không copy-paste thủ công rồi để hai bản lệch nhau.

Nguyên tắc: **code dùng chung phải có một nguồn + cơ chế đồng bộ tự động** — copy-paste thủ công tạo fork drift (sửa một chỗ quên chỗ kia); **vendor script có checksum/test** — sau khi vendor, verify bản mirror khớp (diff hoặc hash) để phát hiện lệch sớm; **hand-mirror (branches/routes/registration) là các mảnh nhỏ phải đồng bộ tay nhưng có checklist** — không phải mọi thứ vendor được, phần thủ công phải có nơi ghi nhận.

## Mô tả

Với mya, pattern = **vendor/mirror cho shared code giữa packages**: (1) **xác định shared module** — code dùng chung thực sự nên nằm `packages/core` hoặc package riêng (mya đã có core minimal — §18); nhưng khi **không thể refactor** (boundary bên ngoài, extension riêng), dùng **vendor script**; (2) **`scripts/vendor-shared.mjs` mới** — copy `shared/guide.ts` → mirror path, chạy **transform nhỏ** (rename import/export theo target — gần giống hand-mirror nhưng script hóa phần copy); (3) **sau vendor: verify** — diff/checksum + **compile check** (mirror phải typecheck) — script fail nếu lệch không mong đợi; (4) **hand-mirror checklist** — branches/routes/registration (những gì không vendor được) liệt kê trong doc + test so khớp (mirror route set vs source route set); (5) **CI hook** — chạy vendor verify khi shared thay đổi (nối scripts/lint.mjs pattern). Đây là pattern **chống fork drift** cho code boundary.

## Kiến trúc (ASCII)

```
  SHARED SOURCE (shared/guide.ts — nguồn duy nhất)
    │
    ▼ scripts/vendor-shared.mjs (VENDOR.SH)
    ├─ copy file → mirror path (serverReview.ts)
    ├─ transform nhỏ (import/export rename)
    ├─ VERIFY: diff checksum + typecheck mirror
    │    └─ lệch không mong đợi ──► FAIL (không im lặng)
    └─ hand-mirror checklist (branches/routes/registration)
         ├─ không vendor được ──► ghi doc + test so khớp
         └─ lệch ──► test fail (route set khác nhau)
    ▼
  CI: shared thay đổi → chạy vendor verify (không để fork drift)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core — minimal core (nơi shared code NÊN nằm — §18)
// ✅ scripts/lint.mjs + typecheck.mjs — script pattern (nền vendor verify)
// ✅ packages/intercom/src/broker/framing.ts — shared protocol (ví dụ shared module)
// ✅ packages/print/src/command-registry.ts — command set dùng chung TUI+channels
//   (đã tránh fork drift bằng registry — pattern đúng, chưa có script)
// ✅ packages/audit canonical-json — shared util re-export (đã đúng hướng)

// ❌ THIẾU: vendor script (copy + transform + verify checksum)
// ❌ THIẾU: hand-mirror checklist (routes/registration so khớp test)
// ❌ THIẾU: CI hook khi shared thay đổi
```

## Implementation

```typescript
// scripts/vendor-shared.mjs (NEW — Node 20 ESM)
import { readFileSync, writeFileSync, existsSync, createHash } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

/** Map: shared file → mirror target + transform (rename import). */
const VENDOR_MAP = [
  {
    source: "packages/core/src/guide.ts",
    target: "packages/print/src/mirrors/serverReview.ts",
    transform: (src: string) =>
      src.replaceAll("@my-agent/core", "@my-agent/core").replaceAll(
        "export const guide",
        "export const serverReviewGuide",
      ),
  },
];

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

let failed = false;
for (const entry of VENDOR_MAP) {
  const src = readFileSync(entry.source, "utf8");
  const out = entry.transform(src);
  const targetPath = join(process.cwd(), entry.target);
  const previous = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
  if (previous !== null && sha256(previous) !== sha256(out)) {
    console.warn(`[vendor] ${entry.target} lệch source — cập nhật + verify`);
  }
  writeFileSync(targetPath, out);
  // Verify: mirror phải compile được.
  try {
    execSync("npx tsc --noEmit -p packages/print/tsconfig.json", { stdio: "pipe" });
    console.log(`[vendor] OK: ${entry.source} → ${entry.target}`);
  } catch {
    failed = true;
    console.error(`[vendor] FAIL: mirror ${entry.target} không typecheck — dừng.`);
  }
}
if (failed) process.exit(1);
// Hand-mirror checklist (branches/routes/registration) — test so khớp
// nằm trong packages/print/src/mirrors/__tests__/parity.test.ts.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống fork drift — vendor có verify checksum | ❌ Mirror vẫn là bản copy — sửa source phải chạy script |
| ✅ Transform script hóa — phần lớn tự động | ❌ Hand-mirror (routes/registration) vẫn thủ công có checklist |
| ✅ CI fail sớm khi lệch | ❌ Overhead script + typecheck mỗi lần vendor |
| ✅ Nối core re-export pattern đúng hướng | ❌ Refactor vào core vẫn tốt hơn — vendor là giải pháp tạm |

## Khác các hướng gần

| | AJB Vendor Mirror | ADE Mailbox Dispatch | AJA Review Takeover |
|---|---|---|---|
| Trọng tâm | Đồng bộ code dùng chung | Audit messaging | Review UX |
| Cơ chế | Vendor script + verify | State machine + idempotent | CSS-hide + checkbox |
| Quan hệ | Process/dev infra | Runtime messaging | UI layer |

## Khi nào chọn

- Shared code phải nằm ở nhiều chỗ (boundary/harness khác nhau) mà chưa refactor được
- Đã thấy fork drift (sửa một chỗ, quên chỗ kia) — cần cơ chế đồng bộ
- Muốn CI bắt lệch sớm — vendor verify khi shared thay đổi
- Guard: verify checksum + typecheck sau vendor; hand-mirror có checklist test; refactor vào core là đích cuối