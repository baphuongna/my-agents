# Hướng OA: Biometric Agent Gate — WebAuthn Face ID / Touch ID cổng truy cập agent

> **Nguồn gốc:** pi-mobile (WebAuthn); FIDO2 / Passkeys; platform authenticator (Face ID / Touch ID / Windows Hello); "step-up authentication"; "human-in-the-loop confirmation"; hardware-backed attestation
> **Coupling:** 🟢 — gate layer ngoài agent core, không chạm loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (desktop + rpc + permission-prompt sẵn — chưa có WebAuthn assertion/challenge)
> **Effort:** 2-3 tuần

## Nguồn gốc

**WebAuthn / FIDO2**: browser/OS-native API đăng ký credential (public key) trên authenticator (Face ID, Touch ID, Windows Hello, security key). Mỗi lần xác thực, authenticator ký **challenge** bằng private key (không bao giờ rời device). **Passkey**: credential synced cross-device (iCloud Keychain, Google Password Manager) — sinh truy cập không cần mật khẩu. **Step-up authentication**: user đã đăng nhập (session base) nhưng hành động nhạy cảm (xoá file, deploy, gửi tiền) yêu cầu **xác thực thêm** (biometric). Nguyên tắc: **agent gate = step-up** — trước khi agent thực hiện hành động dangerous/destructive, yêu cầu WebAuthn assertion (Face ID / Touch ID). Khác **124 dynamic-permissions** (prompt allow/deny) — OA là **biometric attestation** (không thể giả mạo). pi-mobile dùng WebAuthn cho app access — OA áp dụng cho **agent action gate**.

## Mô tả

mya biometric agent gate: trước khi agent thực hiện **hazardous action** (rm, deploy, send, delete, exec shell nguy hiểm) → gate **challenge**: hiển thị mô tả hành động → yêu cầu user xác nhận bằng **WebAuthn assertion** (Face ID / Touch ID / security key). Nếu assertion hợp lệ → cho phép; nếu reject/timeout → block. Gate hoạt động trên **trust level**: action `safe` (read, list) → không gate; action `moderate` (write, edit) → confirm nhẹ (Enter); action `hazardous` (rm, deploy, exec dangerous) → **biometric**. mya có `packages/desktop` (native UI) + `packages/rpc` (IPC) + permission-prompt — OA thêm **WebAuthn challenge/verify** + **action trust-level classification** + **gate enforcement**.

## Kiến trúc

```
  AGENT wants to EXECUTE action:
  e.g. bash("rm -rf node_modules"), deploy("prod"), send($1000)
        │
        ▼
  ┌─── ACTION CLASSIFIER ────────────────────────────┐
  │                                                   │
  │  classify(action) → trust level:                  │
  │    safe      → read/list/grep        → NO GATE    │
  │    moderate  → write/edit/patch      → CONFIRM    │
  │    hazardous → rm/deploy/exec/send   → BIOMETRIC  │
  └───────────────────────┬───────────────────────────┘
                          │ (hazardous)
                          ▼
  ┌─── BIOMETRIC GATE (WebAuthn) ────────────────────┐
  │                                                   │
  │  1. Display: "Agent wants: rm -rf node_modules"   │
  │  2. Generate challenge (random nonce + origin)    │
  │  3. navigator.credentials.get({ WebAuthn })       │
  │     → Face ID / Touch ID / Windows Hello prompt   │
  │  4. Verify assertion (signature + challenge)      │
  │                                                   │
  │  ┌── ASSERTION OK ──┐   ┌── FAIL / TIMEOUT ──┐    │
  │  │ allow action     │   │ block action       │    │
  │  │ log attestation  │   │ report to agent    │    │
  │  └──────────────────┘   └────────────────────┘    │
  └───────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/desktop — native UI + system integration (nền — OA biometric prompt)
// ✅ packages/rpc — IPC transport (nền — OA challenge/verify channel)
// ✅ permission-prompt — confirm dialog (nền — OA moderate level)
// ✅ 124 dynamic-permissions — allow/deny (nền — OA là biometric attestation)
// ✅ 124 trust levels — action classification (nền — OA mở rộng)

// ❌ THIẾU: WebAuthn credential registration (đăng ký passkey cho user)
// ❌ THIẾU: challenge/verify flow (generate nonce → verify assertion)
// ❌ THIẾU: action trust-level classifier (safe/moderate/hazardous)
// ❌ THIẾU: gate enforcement hook (pre-action intercept)
```

## Implementation

```typescript
// packages/desktop/src/biometric-gate.ts (MỚI)
type TrustLevel = 'safe' | 'moderate' | 'hazardous';

interface GateConfig {
  // classify action → trust level
  classify: (action: { tool: string; args: unknown }) => TrustLevel;
  // registered credential IDs (from WebAuthn registration)
  credentialIds: ArrayBuffer[];
  // relying party origin (e.g. "my-agent.local")
  rpId: string;
}

class BiometricAgentGate {
  constructor(private config: GateConfig) {}

  // Pre-action hook — call before every tool execution
  async authorize(action: { tool: string; args: unknown }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const level = this.config.classify(action);

    switch (level) {
      case 'safe':
        return { ok: true }; // no gate — read/list

      case 'moderate':
        return await this.confirm(action); // Enter-key confirm (124 permission-prompt)

      case 'hazardous':
        return await this.webAuthnChallenge(action); // biometric gate
    }
  }

  // WebAuthn challenge/verify — Face ID / Touch ID
  private async webAuthnChallenge(
    action: { tool: string; args: unknown }
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await this.requestAssertion(challenge); // navigator.credentials.get

    if (await this.verifyAssertion(assertion, challenge)) {
      this.logAttestation(action); // audit trail
      return { ok: true };
    }
    return { ok: false, reason: 'biometric verification failed or timed out' };
  }

  private async requestAssertion(challenge: Uint8Array): Promise<unknown> {
    // packages/desktop → native WebAuthn API (platform authenticator)
    // navigator.credentials.get({ publicKey: { challenge, allowCredentials, userVerification: 'required' } })
    return {}; // delegate to desktop native bridge
  }

  private async verifyAssertion(assertion: unknown, challenge: Uint8Array): Promise<boolean> {
    // verify: signature valid + challenge matches + credential registered
    return true; // delegate to WebAuthn verify library
  }

  private async confirm(action: { tool: string; args: unknown }): Promise<{ ok: true } | { ok: false; reason: string }> {
    // reuse 124 permission-prompt — lightweight Enter confirm
    return { ok: true };
  }

  private logAttestation(action: { tool: string; args: unknown }): void {
    // audit: timestamp + action + credentialId
  }
}

// classify example:
// 'read_file' → safe, 'write_file' → moderate, 'bash: rm -rf' → hazardous, 'deploy' → hazardous
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Khóa cứng (không thể giả mạo — private key trong chip) | ❌ Platform authenticator phụ thuộc device (Face ID/Touch ID/Windows Hello) |
| ✅ Step-up theo nguy hiểm (safe bỏ qua, hazardous biometric) | ❌ User friction (Face ID mỗi action hazardous) |
| ✅ Audit attestation (credentialId + timestamp log) | ❌ Headless/CI không có authenticator (fallback?) |
| ✅ Nối 124 dynamic-permissions ( OA là tier cao nhất) | ❌ Registration bootstrapping (user phải đăng ký passkey trước) |

## Khác các hướng gần

| | 124 Dynamic Permissions | permission-prompt (sẵn) | 123 Explainable Actions | OA: Biometric Gate |
|---|---|---|---|---|
| Cái gì | allow/deny rules | Enter confirm | Giải thích trước | **WebAuthn biometric gate** |
| Bảo mật | Rule-based | User quyết định | Transparency | **Hardware-backed** |
| Step-up | ❌ | ❌ | ❌ | ✅ theo trust level |
| Forgery | Rule bypass possible | Social engineering | — | ✅ khó giả mạo |

## Khi nào chọn

- Agent thực hiện hành động dangerous/destructive (rm, deploy, exec, send money)
- Cần bảo mật cao (không thể giả mạo — private key trong Secure Enclave/TPM)
- Platform có authenticator (Face ID / Touch ID / Windows Hello / security key)
- Nối 124 dynamic-permissions ( OA là tier hazardous cao nhất) + permission-prompt (tier moderate) + 123 explainable-actions (hiển thị hành động trước gate); guard headless fallback (CI cần alternative auth hoặc pre-approve)
