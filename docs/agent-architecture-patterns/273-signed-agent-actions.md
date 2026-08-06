# Hướng JM: Signed Agent Actions — ký số mỗi hành động agent, chứng minh ai-thực-thi-gì-khi-nào

> **Nguồn gốc:** RFC 7515 JSON Web Signature (JWS); in-toto attestation framework (CNCF); SLSA provenance ("verifiable build provenance"); Sigstore/cosign (artifact signing); "non-repudiation" cryptography; W3C Verifiable Credentials; AWS "request signing" (SigV4 — mỗi API call có chữ ký)
> **Coupling:** 🟡 — chèn signer tại action boundary
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit log sẵn GP — chưa có chữ ký số)
> **Effort:** 2-4 tuần

## Nguồn gốc

Ký số hành động: mỗi action agent thực thi kèm **chữ ký** (JWS/Sigstore) — hash của (action, params, timestamp, agent identity, parent agent). Bất kỳ ai có public key đều **xác minh** hành động đó đúng do agent X phát, không bị sửa, không thể chối (non-repudiation). in-toto/SLSA áp cho software supply chain: mỗi bước build có attestation — chain có thể verify end-to-end. Sigstore cosign ký container artifact. AWS SigV4 ký mỗi API request. Áp cho agent: agent tự hành động (write file, call API, deploy) — cần **trách nhiệm giải trình được** (accountability) khi sai: ai ra lệnh, agent nào thực thi, params gì, cha nào ủy quyền (199). Khác **GP (198) audit trails** (ghi log — nhưng log có thể sửa/xóa) — JM log *được ký*, phát hiện giả mạo; khác **DS (123) explainable actions** (giải thích *lý do*) — JM chứng minh *nguồn gốc tính toàn vẹn*; khác **226 human approval** (người duyệt trước) — JM *chứng minh* sự kiện đã xảy ra sau khi xong.

## Mô tả

mya signed actions: tại action boundary (tool call, file write, external API), signer tạo JWS: payload = {action, params, ts, agentId, parentChain, hash(giá trị thực thi)}, signature = sign(privateKey). Signature lưu cùng audit event (GP) — tạo chain verifiable. Khi có tranh chấp/sai: verify chain → biết chính xác hành động nào xảy ra, do ai, không thể chối. Key per agent (hoặc org CA) — rotatable. mya có audit trail (GP) — chỉ cần thêm signer layer + key management.

## Kiến trúc

```
  AGENT decides action (write file / call API / deploy)
        │
        ▼
  SIGNER ──► payload = { action, params, ts, agentId, parent }
        │        sig = sign(payload, agentPrivateKey)
        ▼
  EXECUTE action (commit side-effect)
        │
        ▼
  AUDIT EVENT { payload, sig }  ──►  store (chính append-only — GP)
        │
  später: VERIFIER ──► verify(sig, publicKey) ──► ✓ authentic / ✗ tampered
        │
  CHAIN: action ← parent ← grandparent ... (199 delegation chain verifiable)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GP (198) audit trails — sẵn ghi event (nền)
// ✅ 199 delegated authority — chain agent cha-con (sẵn)
// ✅ DS (123) explainable — lý do hành động (sẵn)
// ✅ 149 delegated agent identity — identity nền

// ❌ THIẾU: crypto signer (JWS/Ed25519)
// ❌ THIẾU: key management (per-agent key, rotation, CA)
// ❌ THIẾU: verifier + tamper detection (verify chain)
// ❌ THIẾU: append-only / hash-chain log (chống sửa log)
```

## Implementation

```typescript
// packages/signed-action/src/signer.ts (NEW)
import { sign, verify } from "@noble/ed25519";
interface SignedAction { payload: string; sig: Uint8Array; }   // JWS-like

async function signAction(a: {
  action: string; params: unknown; ts: number; agentId: string; parent?: string;
}, privKey: Uint8Array): Promise<SignedAction> {
  const payload = JSON.stringify(a);                       // canonical (byte-faithful)
  return { payload, sig: await sign(Buffer.from(payload), privKey) };
}
async function verifyAction(s: SignedAction, pubKey: Uint8Array): Promise<boolean> {
  return verify(s.sig, Buffer.from(s.payload), pubKey);    // ✓ authentic / ✗ forged
}
// audit.append(await signAction(...)) — log có chữ ký; verify chain phát hiện giả mạo
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Non-repudiation — không chối được hành động (crypto) | ❌ Key management gánh nặng (rotation, CA, leak = thảm họa) |
| ✅ Phát hiện giả mạo log (verify sig) — GP chỉ ghi chưa | ❌ Overhead: sign mỗi action (latency + storage) |
| ✅ Chain verifiable end-to-end (SLSA/in-toto) | ❌ Key bị compromise → toàn bộ lịch sử bị nghi ngờ |
| ✅ Tuân compliance (SOX/HIPAA cần accountability) | ❌ Privacy: payload có thể lộ thông tin (cần cân nhắc) |

## Khác các hướng gần

| | GP Audit Trails | DS Explainable | 226 Approval | JM: Signed Actions |
|---|---|---|---|---|
| Cái gì | Ghi event | Giải thích lý do | Duyệt trước | **Chứng minh nguồn gốc+tính toàn vẹn** |
| Chống sửa | ❌ (log sửa được) | — | — | **✓ (sig phát hiện tamper)** |
| Khi nào | Mọi action | Khi cần minh bạch | Trước rủi ro | **Sau/song song — giải trình** |

## Khi nào chọn

- Hành động có hậu quả cao (deploy, pay, write production) — cần accountability
- Compliance (SOX/HIPAA/GDPR) yêu cầu non-repudiation
- Nhiều agent ủy quyền lẫn nhau (199) — cần verify chain ai-ra-lệnh
- Luôn: append-only hash-chain log (chống sửa) + key rotation + CA; không dùng nếu hành động rẻ/không nhạy (overhead không đáng)
