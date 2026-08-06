# Hướng CI: TEE / Confidential Computing — agent chạy trong enclave tin cậy

> **Nguồn gốc:** "A Survey of Confidential Computing for Agentic AI" (arXiv 2605.03213, 2026); confidentialcomputing.io 2026
> **Coupling:** 🟢 — enclave thay runtime, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (cần hạ tầng TEE mới)
> **Effort:** 3-4 tuần

## Nguồn gốc

Trusted Execution Environment (TEE): **hardware-isolated** vùng chạy code+data — kể cả privileged software (OS) không đọc được; **remote attestation**: chứng minh với bên ngoài "đúng code này đang chạy trong enclave" (verified compute). Với agentic AI (arXiv 2605.03213 survey 2026): enclave bảo vệ **prompt, keys, tool output, memory** trong lúc tính toán; confidentialcomputing.io 2026: "agents from multiple owners can collaborate without trusting infrastructure". Khác **KKK Credential Broker** (secret không chạm agent — bảo vệ *credential*) — TEE bảo vệ **toàn bộ tính toán** (code + data + memory) bằng phần cứng + attestation; khác **OOO Chaos / RRR** (logic level) — TEE là *hardware root of trust*.

## Mô tả

mya chạy các thành phần nhạy cảm trong **enclave** (TDX/SEV/SGX — hoặc cloud confidential VM): agent loop + LLM calls + memory + secrets → attestation report cho user/remote (chứng minh code chính hãng, không bị sửa) → **verified compute**: output có bằng chứng chạy đúng trong enclave. Hợp tác multi-owner: 2 agent từ 2 bên tin cậy khác nhau → mỗi bên trong enclave riêng + attestation chéo → không ai tin ai nhưng vẫn hợp tác an toàn. Với mya (local, single-user): TEE giá trị khi **deploy remote** (agent chạy trên server đáng nghi) hoặc **đa bên** (multi-tenant, shared agents — IIII mesh). Nối KKK: key vẫn qua broker, nhưng broker cũng trong enclave.

## Kiến trúc

```
  ┌──────────── TEE ENCLAVE (hardware isolation) ────────────┐
  │  agent loop · LLM calls (prompt/key protected)           │
  │  memory (MM) · secrets (KKK) · tool output              │
  │  code hash định danh — không OS nào đọc được            │
  └────────────────────────┬────────────────────────────────┘
                           │ remote attestation (bằng chứng code chuẩn)
                           ▼
  user / remote agent ──► VERIFY attestation ──► tin output
  (agents từ nhiều owner: attestation chéo — hợp tác không cần tin nhau)
```

```
mya: local — TEE ít cần; deploy remote / đa bên → cần
     thiếu: enclave runtime + attestation pipeline (build mới)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/secrets + KKK — bảo vệ credential (nền, chạy trong enclave)
// ✅ packages/signing — xác thực nguồn (gần attestation — mở rộng)
// ✅ packages/audit — chứng cứ hành vi (bổ trợ attestation)
// ✅ packages/rpc — transport cho attestation report

// ❌ THIẾU: enclave runtime (TDX/SEV/SGX) cho agent loop
// ❌ THIẾU: remote attestation pipeline (verify code hash)
// ❌ THIẾU: integration multi-owner (attestation chéo)
```

## Implementation

```typescript
// packages/secure/src/enclave.ts (NEW)
interface Attestation {
  report: Buffer;              // hardware: code hash + measurement
  publicKey: string;           // key trong enclave
}

async function runInEnclave(workload: AgentWorkload): Promise<{ result; attest }> {
  const enclave = await createEnclave(workload.codeHash);  // TDX/SEV/SGX
  const attest = await enclave.attest();                   // hardware report
  const result = await enclave.run(workload);              // code+data isolated
  return { result, attest };
}

async function verifyRemoteAgent(remoteAttest: Attestation): Promise<boolean> {
  return verifyReport(remoteAttest.report, trustedMeasurements);  // tin tưởng?
  // hợp tác multi-owner: attestation chéo → không tin nhau vẫn an toàn
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hardware isolation — OS không đọc được prompt/key/memory | ❌ Cần hạ tầng TEE (cloud confidential VM / hardware) |
| ✅ Remote attestation — bằng chứng verified compute | ❌ Chi phí hạ tầng + latency |
| ✅ Multi-owner hợp tác không cần tin infra (2026 survey) | ❌ mya local đơn user — lợi ích thấp hơn cost |
| ✅ Bổ sung KKK/signing/audit thành verified stack | ❌ Enclave setup + code hash lifecycle phức tạp |
| ✅ Nguồn survey 2026 chuẩn | |

## Khác các hướng gần

| | KKK Credential Broker | RRR Firewall | JJJJ: TEE |
|---|---|---|---|
| Bảo vệ gì | Secret (proxy) | Luồng prompt | **Toàn bộ compute (hardware)** |
| Cơ chế | Token ngắn hạn | Scan/boundary | **Enclave + attestation** |
| Bằng chứng | Audit | Audit | **Hardware report** |
| Mối quan hệ | Chạy trong enclave | Chạy trong enclave | **Root of trust** |

## Khi nào chọn

- Deploy agent remote (server không tin tưởng hoàn toàn)
- Multi-owner: nhiều bên hợp tác qua agents (IIII mesh ngoài biên)
- Cần verified compute (bằng chứng output chạy đúng code)
- Sẵn sàng đầu tư hạ tầng TEE (3-4 tuần)