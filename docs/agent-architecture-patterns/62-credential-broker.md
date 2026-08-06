# Hướng BJ: Credential Broker (CB4A) — secret không bao giờ chạm agent

> **Nguồn gốc:** IETF draft-hartman-credential-broker-4-agents; Infisical agent-vault (2025)
> **Coupling:** 🟢 — broker là proxy trong suốt, agent không biết
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (1 phần — key-rotation + oauth sẵn; thiếu proxy layer)
> **Effort:** 1 tuần

## Nguồn gốc

Credential Broker for Agents (CB4A, IETF draft): agent **không bao giờ được thấy secret** — mọi outbound request đi qua **proxy** giữ secret, proxy mint **token ngắn hạn, scoped** cho đúng request đó. Infisical agent-vault (2025): "store your keys once, route every outbound request through the proxy". Lý do: agent là LLM — prompt injection có thể ép agent đọc file key và exfiltrate. Với vault truyền thống, agent *được cấp* secret để dùng → agent cũng có thể đọc nó. CB4A cắt mối nguy tại nguồn: **agent không có quyền hạn gì để lộ** — yếu tố nền của Zero-Trust cho agentic systems.

## Mô tả

mya tool call cần credential (git push, API key cho LLM) → request đi qua **broker proxy**: broker lấy token ngắn hạn từ vault → đính kèm vào request → agent không bao giờ thấy token thật (kể cả trong log/trace — mask theo mặc định). Kết hợp: OO permission (tool nào được phép gọi) + JJJ trace (mask secrets) + 20 immune-system (chống prompt injection). mya đã có `key-rotation.ts` + `oauth.ts` — nền vault; thiếu lớp proxy trong suốt.

## Kiến trúc

```
  agent ──► TOOL CALL (git push / api call)
              │
              ▼
        CREDENTIAL BROKER (proxy trong suốt)
        │  vault: lấy token ngắn hạn, scoped (oauth.ts, key-rotation.ts)
        │  đính token → request đi
        │  agent KHÔNG thấy secret, log/trace đều mask
              ▼
        API / git remote (đích)
```

```
mya: packages/ai/src/key-rotation.ts + oauth.ts = vault core sẵn
     thiếu: proxy layer chặn giữa agent tool call và outbound
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai/src/key-rotation.ts — xoay vòng key (vault core)
// ✅ packages/ai/src/oauth.ts — token OAuth (ngắn hạn, refresh)
// ✅ packages/ai/src/registry.ts — TaintedProfile (quota/rate_limited) — chặn key tainted
// ✅ OO roles — permission gating cho tool call

// ❌ THIẾU: proxy layer — tool call hiện tự đọc key dùng trực tiếp
// ❌ THIẾU: mint token scoped cho từng request (không phải key dài hạn)
// ❌ THIẾU: mask secret trong trace/log (JJJ) mặc định
```

## Implementation

```typescript
// packages/tools/src/credential-broker.ts (NEW)
async function callWithBroker<Req extends RequestLike, Res>(
  req: Req,
  vault: Vault,                          // key-rotation + oauth hiện có
  scopes: string[],                      // scoped: ["git:push:my-repo"]
): Promise<Res> {
  const token = await vault.mintToken({   // ngắn hạn (5 phút), scoped, single-use
    scopes,
    caller: currentAgentId(),             // audit ai đã mượn
  });
  try {
    return await proxyFetch(req, token);  // token chỉ tồn tại trong proxy
  } finally {
    await vault.revoke(token);            // thu hồi ngay sau request
  }
  // NOTE: agent context/log/trace không bao giờ nhận `token`
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Prompt injection không thể exfiltrate keys (không có keys để đọc) | ❌ Thêm hop proxy (latency nhỏ) |
| ✅ Token ngắn hạn + scoped → blast radius nhỏ | ❌ Vault phải là single source of truth (hạ tầng) |
| ✅ Key-rotation + oauth sẵn — thêm proxy là chính | ❌ Dịch vụ ngoài không hỗ trợ proxy → vẫn phải pass key |
| ✅ Audit ai đã mượn token khi nào (K ledger) | ❌ Debug khi token fail khó hơn (ít context) |
| ✅ Yếu tố nền của Zero-Trust cho agent | |

## Khác các hướng gần

| | OO Tool Registry | 20 Immune System | KKK: Credential Broker |
|---|---|---|---|
| Chống gì | Tool gọi sai quyền | Agent bị tấn công | **Secret bị đọc/lộ** |
| Cơ chế | Gate trước khi gọi | Phát hiện/hồi phục | Không bao giờ cấp secret |
| Liên quan | Quyết định tool nào | Agent bệnh | Mọi outbound request |

## Khi nào chọn

- Tool call dùng secret (git push, API, deploy) — nguy cơ lộ cao
- Muốn Zero-Trust: agent không có quyền hạn để lộ secret
- Đã có key-rotation + oauth — thêm proxy layer
- Trace/log phải mask secret (kết hợp JJJ)