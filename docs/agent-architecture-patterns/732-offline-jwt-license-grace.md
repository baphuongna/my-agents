# Hướng ABD: Offline JWT License Grace — verify license offline bằng Ed25519 JWT (alg pinned) với thang grace 7/30/hard-fail

> **Nguồn gốc:** fallow (crates/license/) | **Coupling:** 🟡 — thêm license verifier vào startup/activation path | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có signing + x402 crypto — chưa có license JWT + grace) | **Effort:** 1-2 tuần

## Nguồn gốc

**fallow** verify license **offline** bằng **Ed25519 JWT**: (1) **alg pinned** — chỉ chấp nhận EdDSA (Ed25519), không cho attacker chỉ định alg (tránh `alg=none` / HS256 confusion); (2) **file + env load precedence** — public key đọc từ file, env override; (3) **thang grace 7/30/hard-fail** — license hết hạn < 7 ngày → cảnh báo nhẹ; < 30 ngày → cảnh báo rõ + giảm tính năng phụ; quá 30 ngày → **hard-fail** (chặn tính năng trả phí). Kết quả: tính năng trả phí **vẫn chạy offline** (không cần phone-home), có **đường lui thân thiện** khi license sắp hết (grace period, không cut đột ngột). Nguyên tắc: **verify cục bộ, alg pin, grace thang bậc, fail mềm trước fail cứng**.

## Mô tả

mya offline JWT license grace: startup (hoặc activation) load **public key** (file → env precedence), đọc license JWT (Ed25519, alg pinned `EdDSA`), verify signature + expiry **hoàn toàn offline**; nếu license còn hạn → đủ quyền; hết hạn trong grace → warning + giảm feature (pro-only tính năng tắt dần); hết hạn quá hard-fail threshold → chặn. mya có packages/signing (sigstore verify) + packages/x402 (ECDSA wallet) — ABD thêm **license verifier** (JWT Ed25519 offline) + **grace ladder** (7/30/hard-fail) + **feature gating**.

## Kiến trúc

```
  LICENSE JWT (Ed25519, alg=pinned "EdDSA")
  header.payload.signature
       │
       ▼
  KEY LOAD  file(license.pub) ──► env(PUBLIC_KEY) override
       │
       ▼
  VERIFY (offline, không phone-home)
    ├─ alg != "EdDSA"        ──► REJECT (alg confusion)
    ├─ signature invalid     ──► REJECT (tamper)
    └─ signature OK ──► check expiry
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
      expiry < 7d  ──► GRACE-1  warning + giữ tính năng
      expiry < 30d ──► GRACE-2  warning rõ + tắt feature phụ
      expiry ≥ 30d ──► HARD-FAIL chặn tính năng trả phí
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/signing index.ts — sigstore bundle verify (nền — ABD verify offline analog)
// ✅ packages/x402 — Wallet ECDSA + verify (nền — ABD crypto verify pattern)
// ✅ packages/secrets — key storage (nền — ABD key file placement)
// ✅ packages/audit trust.ts — trust/recovery (liên quan — ABD trust boundary)

// ❌ THIẾU: JWT Ed25519 license verifier (alg pinned EdDSA)
// ❌ THIẾU: file+env key load precedence
// ❌ THIẾU: grace ladder (7d / 30d / hard-fail) + feature gating
```

## Implementation

```typescript
// packages/signing/src/license.ts (MỚI)
import { createPublicKey, verify } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

type GraceStage = "ok" | "grace1" | "grace2" | "hard-fail";

export interface LicenseResult {
  stage: GraceStage;
  daysLeft: number;
  features: "full" | "reduced" | "blocked";
}

const GRACE1_DAYS = 7;
const GRACE2_DAYS = 30;
const ALG_PINNED = "EdDSA"; // Ed25519 — tuyệt đối không chấp nhận alg khác

/** Load public key: file trước, env override (precedence rõ). */
export function loadPublicKey(filePath: string, envKey = "MYA_LICENSE_PUBKEY"): string {
  if (process.env[envKey]) return process.env[envKey]!;
  if (existsSync(filePath)) return readFileSync(filePath, "utf8");
  throw new Error("license: no public key (file or env)");
}

/** Verify + đánh giá grace, hoàn toàn offline. */
export function verifyLicense(jwt: string, pubPem: string, nowDays = Date.now() / 86_400_000): LicenseResult {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return { stage: "hard-fail", daysLeft: 0, features: "blocked" };
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string };
  if (header.alg !== ALG_PINNED) return { stage: "hard-fail", daysLeft: 0, features: "blocked" }; // alg pin
  const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as { exp: number };
  const ok = verify("ed25519", Buffer.from(`${h}.${p}`), createPublicKey(pubPem), Buffer.from(s, "base64url"));
  if (!ok) return { stage: "hard-fail", daysLeft: 0, features: "blocked" }; // tamper
  const daysLeft = (payload.exp - nowDays * 86_400) / 86_400;
  if (daysLeft < 0) return { stage: "hard-fail", daysLeft, features: "blocked" };
  if (daysLeft < GRACE1_DAYS) return { stage: "grace1", daysLeft, features: "full" };
  if (daysLeft < GRACE2_DAYS) return { stage: "grace2", daysLeft, features: "reduced" };
  return { stage: "ok", daysLeft, features: "full" };
}
// Usage:
// const pub = loadPublicKey("~/.mya/license.pub");
// const { stage, features } = verifyLicense(licenseJwt, pub);
// features === "blocked" → chặn pro-only tools
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Offline (không phone-home — hoạt động không mạng) | ❌ Revocation khó (license bị thu hồi không biết cho tới khi hết hạn) |
| ✅ Alg pinned (chống alg confusion / forge) | ❌ Clock manipulation (user đổi giờ hệ thống để kéo dài grace) |
| ✅ Grace ladder (7/30/hard-fail — đường lui thân thiện) | ❌ Key distribution (public key phải ship kèm binary — replace khó) |
| ✅ Deterministic (verify thuần, không cần network) | ❌ Hard-fail UX (chặn đột ngột nếu clock sai) |

## Khác các hướng gần

| | Online license (phone-home) | Signed plain (HMAC) | ABD: Offline JWT Grace |
|---|---|---|---|
| Mạng | cần | không | **không** |
| Alg | nhiều | 1 (bí mật) | **Ed25519 pinned** |
| Hết hạn | server quyết | check thô | **grace 7/30/hard-fail** |
| Chống forge | server | shared secret | **public-key verify** |

## Khi nào chọn

- Tính năng trả phí phải chạy offline (edge, air-gap, không mạng ổn định)
- Muốn chống forge mạnh (public-key crypto, không shared secret)
- Muốn user không bị cut đột ngột (grace period trước hard-fail)
- Nối packages/signing + packages/x402 + packages/secrets; guard clock-consistency (dùng nowWallclock, cảnh báo nếu clock lệch), key-rotation (public key đổi → license cũ vô hiệu, có đường re-issue), và alg-pin (từ chối mọi alg ≠ EdDSA); ABD = offline JWT license grace, kết hợp 733 ABE deterministic-security-candidates (license check là candidate deterministic) + signing trust chain
