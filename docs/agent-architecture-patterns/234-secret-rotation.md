# Hướng HZ: Secret Rotation — xoay vòng key, credential ngắn hạn, vault

> **Nguồn gốc:** HashiCorp Vault "Dynamic Secrets" (lease-based short-lived); AWS Secrets Manager "automatic rotation"; NIST SP 800-57 "Key Management" (cryptoperiods); Google "Workload Identity / SPIFFE short-lived credentials"
> **Coupling:** 🟡 — SecretStore nằm giữa runtime và mọi secret consumer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (SecretStore.rotate/revoke sẵn — thiếu scheduler lease + dual-key overlap)
> **Effort:** 2-3 tuần

## Nguồn gốc

Secret rotation là nguyên tắc cổ điển trong key management: NIST SP 800-57 định nghĩa **cryptoperiod** — tuổi thọ tối đa của một key trước khi phải thay. HashiCorp Vault phổ biến hoá **dynamic secrets**: credential được tạo theo yêu cầu, có **lease + TTL ngắn** (phút/giờ) thay vì key tĩnh tồn tại mãi mãi. AWS Secrets Manager tự động hoá rotation theo lịch (Lambda rotation function), còn SPIFFE/SPIRE đi xa hơn — workload identity dạng **short-lived cryptographic credential** (SVID) cấp cho từng workload, hết hạn trong phút. Điểm cốt lõi: giảm **blast radius** — key bị lộ chỉ dùng được trong TTL ngắn, và **lâu dài** thì không có "long-lived key" nào để lộ.

Khác **188 least-privilege** (giới hạn *phạm vi* quyền — key nào có quyền gì) — HZ tập trung *tuổi thọ* (key sống bao lâu). Khác **168 guardrails** (chặn hành động) — HZ là hạ tầng nền. Nối **198 audit** (ghi rotate event + fingerprint), **229 distributed-locking** (không 2 agent rotate cùng lúc), **231 DLQ** (rotate fail → quarantine).

## Mô tả

mya đã có `packages/secrets` với `SecretStore.rotate()` + `revoke()` + `fingerprint()` — nhưng đó là rotate **thủ công** (gọi khi cần). HZ nâng lên rotation **tự động theo lịch**: (1) scheduler (nối **148 scheduled-agents** / cron) kiểm tra `rotatedAt` của mỗi registered secret; (2) sắp hết cryptoperiod → rotate (generate new → dual-key overlap → re-point consumers → revoke old); (3) credential ngắn hạn từ vault/STS — TTL phút, auto-refresh; (4) audit mỗi rotate event (198). Fail-closed vẫn giữ (§14.2): rotate fail → không bao giờ fallback key cũ đã hết hạn, mà error + alert.

## Kiến trúc

```
  ROTATION SCHEDULER (cron tick mỗi N phút)
        │
        │  for each registered secret:
        │    age = now - rotatedAt
        │    if age > cryptoperiod * 0.8:   ← rotate TRƯỚC khi hết hạn
        ▼
  ┌──────────────────────────────────────────────┐
  │  ROTATE (dual-key overlap)                    │
  │                                               │
  │  1. GENERATE new secret (vault/STS/random)   │
  │  2. REGISTER new — consumers see new value   │
  │  3. OVERLAP window (grace — old vẫn dùng)     │
  │  4. REVOTE old after grace expires            │
  └──────────────────┬───────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────────┐
  │ AUDIT    │ │ ALERT    │ │ LEASE CHECK  │
  │ (198)    │ │ (227)    │ │ short-lived  │
  │ rotate   │ │ rotate   │ │ TTL < 1h?    │
  │ event    │ │ fail →   │ │ refresh      │
  └──────────┘ │ page     │ └──────────────┘
               └──────────┘
```

```
mya: SecretStore.rotate/revoke/fingerprint sẵn — thiếu scheduler + dual-key overlap + lease auto-refresh
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/secrets — SecretStore.rotate(), revoke(), fingerprint() (sẵn!)
// ✅ packages/secrets — SecretRef union (env/file/exec/keyring) + fail-closed resolve
// ✅ packages/secrets — makeSecretRedactor (scrub resolved values before audit)
// ✅ packages/cron — scheduler (để tick rotation check)
// ✅ 198 audit trails — append-only event log (ghi rotate)
// ✅ packages/signing — signing keys (ứng viên rotation)

// ❌ THIẾU: rotation scheduler (cron tick → check rotatedAt → auto-rotate)
// ❌ THIẾU: dual-key overlap (new + old cùng dùng trong grace window)
// ❌ THIẾU: lease/TTL auto-refresh (short-lived credential từ vault/STS)
// ❌ THIẾU: cryptoperiod config per-secret (NIST SP 800-57)
```

## Implementation

```typescript
// packages/secrets/src/rotation.ts (NEW)
interface RotationPolicy {
  ref: SecretRef;
  cryptoperiodMs: number;   // NIST — max age before mandatory rotate
  rotateBeforeMs: number;    // rotate early (0.8 * cryptoperiod)
  graceMs: number;           // dual-key overlap after rotate
}

class RotationScheduler {
  private policies = new Map<string, RotationPolicy>();

  constructor(private store: SecretStore, private audit: AuditLog) {}

  register(policy: RotationPolicy): void { this.policies.set(this.key(policy.ref), policy); }

  // Cron tick — called every N minutes
  async tick(): Promise<void> {
    for (const policy of this.policies.values()) {
      const entry = this.store.snapshot().get(this.key(policy.ref));
      if (!entry) continue;
      const age = nowWallclock() - entry.rotatedAt;
      if (age > policy.cryptoperiodMs - policy.rotateBeforeMs) {
        await this.rotateWithOverlap(policy);
      }
    }
  }

  private async rotateWithOverlap(policy: RotationPolicy): Promise<void> {
    // dual-key: rotate (new value) → keep old valid during grace → revoke old after
    this.store.rotate(policy.ref);             // generate new, bump rotatedAt
    this.audit.append({ type: "secret.rotate", ref: policy.ref, fp: fingerprint(/*new*/) });
    setTimeout(() => this.store.revokeOld(policy.ref), policy.graceMs); // revoke stale
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Blast radius nhỏ — key lộ chỉ TTL ngắn (Vault/NIST) | ❌ Dual-key overlap complexity |
| ✅ Không có long-lived key tĩnh để lộ | ❌ Rotate fail cần fail-closed + alert |
| ✅ Auto (scheduler) — không quên rotate thủ công | ❌ Latency: refresh short-lived credential mỗi phút |
| ✅ Audit mọi rotate event (198) | ❌ Vault/STS dependency (ngoài env/file) |
| ✅ SecretStore.rotate/revoke sẵn (1 phần) | |

## Khác các hướng gần

| | 188 Least-Privilege | 168 Guardrails | HZ: Secret Rotation |
|---|---|---|---|
| Trục | Phạm vi quyền | Chặn hành động | **Tuổi thọ key** |
| Khi | Static — luôn | Real-time | **Theo lịch + lease** |
| Mục | Key làm ít nhất | Hành động an toàn | **Key sống ngắn** |

## Khi nào chọn

- Agent dùng API key/credential có thể bị lộ (log, memory dump, leak)
- Compliance yêu cầu cryptoperiod (NIST, SOC2, ISO 27001)
- Credential từ vault/STS (short-lived lease) cần auto-refresh
- Muốn giảm blast radius — không có key tĩnh tồn tại mãi mãi
