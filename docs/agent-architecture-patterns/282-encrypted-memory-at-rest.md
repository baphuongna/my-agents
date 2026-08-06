# Hướng JV: Encrypted Memory at-Rest — mã hóa bộ nhớ agent lưu đĩa, key quản lý riêng

> **Nguồn gốc:** NIST encryption at-rest; AWS KMS (key management service); HashiCorp Vault; "envelope encryption" (DEK/KEK); SQLCipher (encrypted SQLite); disk encryption (LUKS); Tink/crypto library; "confidential computing" (encrypted memory)
> **Coupling:** 🟡 — chèn crypto layer tại memory persistence
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory store sẵn — chưa có encryption layer)
> **Effort:** 2-4 tuần

## Nguồn gốc

Encryption at-rest (NIST): dữ liệu lưu đĩa phải **mã hóa** — nếu disk bị đánh cắp/truy cập vật lý, không đọc được plaintext. AWS KMS / HashiCorp Vault: key quản lý tập trung — không hardcode key trong app. Envelope encryption: KEK (key encryption key) trong KMS mã hóa DEK (data encryption key) dùng mã hóa data thật — rotate DEK dễ không chạm KMS. SQLCipher: SQLite mã hóa toàn file. Đối với agent: memory chứa hội thoại, fact nhạy (PII, secret, lịch sử user) → mã hóa at-rest để disk leak không lộ. Khác **HF (214) PII redaction** (lọc PII *trước khi gửi LLM*) — JV mã hóa *lưu trữ*; khác **JM (273) signed actions** (chứng minh nguồn gốc) — JV *bảo mật nội dung*; khác **283 JW data classification** (gắn nhãn) — JV áp dụng lớp bảo vệ dựa trên nhãn; kết hợp **284 JX minimization** (ít data hơn → ít cần mã hóa).

## Mô tả

mya encrypted memory: mọi record memory (episodic, semantic, procedural) mã hóa trước khi ghi disk — envelope encryption (KEK trong KMS/Vault, DEK per-record hoặc per-tenant). Key không trong code. mya hiện memory lưu SQLite plaintext — JV thêm crypto layer (SQLCipher hoặc app-level envelope). Key rotation không giải mã toàn bộ (envelope).

## Kiến trúc

```
  AGENT MEMORY (record)
        │
        ▼
  ENCRYPT (AES-GCM)
   · DEK = random per-record (hoặc per-tenant)
   · ciphertext = AES-GCM(DEK, plaintext, aad=recordId)
   · wrapped DEK = RSA/KMS(KEK, DEK)      ← envelope encryption
        │
        ▼
  DISK: store { ciphertext, wrappedDEK, nonce, tag }   (plaintext KHÔNG lưu)
        │
  read: KMS.unwrap(wrappedDEK, KEK) → DEK → AES-GCM.decrypt → plaintext
        │
  KEY MGMT: KEK in KMS/Vault (rotate); DEK rotate mà không re-encrypt all
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ memory store (FI 165 / kanban-sqlite) — chỗ chèn crypto (sản)
// ✅ HF (214) PII redaction — lọc trước LLM (lớp khác)
// ✅ JM (273) signed actions — provenance (lớp khác)
// ✅ 284 JX minimization — ít data hơn (kết hợp)

// ❌ THIẾU: encryption layer (AES-GCM at write/read)
// ❌ THIẾU: key management (KMS/Vault — không hardcode)
// ❌ THIẾU: envelope encryption (KEK/DEK + rotation)
```

## Implementation

```typescript
// packages/encmem/src/index.ts (NEW)
import { createCipheriv, randomBytes, createDecipheriv } from "node:crypto";
async function encryptRecord(plain: Buffer, kms: Kms): Promise<Encrypted> {
  const dek = randomBytes(32);                                  // per-record DEK
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, nonce);
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const wrappedDek = await kms.wrap(dek);                        // envelope — KEK trong KMS
  return { ct, nonce, wrappedDek };
}
// store { ct, nonce, wrappedDek }; read → kms.unwrap → decrypt; KEK rotate không re-encrypt all
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Disk leak không lộ plaintext (NIST at-rest) | ❌ Key management gánh nặng (rotation, KMS, leak = thảm họa) |
| ✅ Envelope — rotate DEK không chạm KMS | ❌ Performance: encrypt/decrypt mỗi read/write |
| ✅ Tuân compliance (HIPAA/SOC2/GDPR at-rest) | ❌ Key trong memory runtime (không mã hóa RAM — cần confidential computing) |
| ✅ Tenant isolation — DEK per-tenant | ❌ Backup cũng phải mã hóa (mất key = mất data vĩnh viễn) |

## Khác các hướng gần

| | HF PII Redaction | JM Signed Actions | 283 JW Classification | JV: Encrypted at-Rest |
|---|---|---|---|---|
| Cái gì | Lọc PII trước LLM | Chứng minh nguồn gốc | Gắn nhãn nhạy cảm | **Mã hóa lưu trữ** |
| Khi nào | Trước LLM | Mỗi action | Tagging | **Persistence layer** |
| Mục | Không gửi nhạy | Accountability | Phân loại | **Chống disk leak** |

## Khi nào chọn

- Memory chứa dữ liệu nhạy (PII, secret, lịch sử user) — disk leak rủi ro
- Compliance (HIPAA/SOC2/GDPR) yêu cầu at-rest encryption
- Luôn: KMS/Vault (không hardcode key), envelope (KEK/DEK + rotation), backup cũng mã hóa
- Không dùng nếu: memory công khai/thử nghiệm; key management không khả thi
