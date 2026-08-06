# Hướng JU: Idempotency Keys — mỗi tool call kèm key, retry không tạo hiệu ứng trùng

> **Nguồn gốc:** Stripe "Idempotency Keys" ("prevent duplicate charges — same key → same result"); HTTP `Idempotency-Key` header (RFC draft); AWS idempotent APIs; "exactly-once semantics"; Stripe idempotency (store result by key, retry returns cached); DynamoDB conditional write
> **Coupling:** 🟡 — thêm idempotency-key vào tool-call envelope
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retry GU sẵn — chưa có idempotency-key store)
> **Effort:** 1-2 tuần

## Nguồn gốc

Idempotency keys (Stripe): mỗi request kèm unique key — server lưu kết quả theo key; nếu cùng key retry → trả kết quả lưu (không thực thi lại). Mục: **chống duplicate effect khi retry** — VD charge thẻ: nếu timeout nhưng charge đã thành công, retry không charge lần 2. HTTP `Idempotency-Key` header (RFC draft) chuẩn hóa. AWS idempotent API (CreateSecurityGroup có ClientToken). Exactly-once semantics qua idempotency + at-least-once delivery. Đối với agent: tool có side-effect (write, send, pay, deploy) — khi retry (GU 203) hoặc duplicate (JJ 270, network hiccup) → cùng key → trả kết quả đầu, không thực thi trùng. Khác **GU (203) retry** (cơ chế lặp) — JU làm cho retry *an toàn* (idempotent); khác **JT (280) optimistic concurrency** (version state) — JU chống *duplicate effect*; khác **231 HW DLQ** (xử lý poison) — JU *ngăn* trùng trước khi vào DLQ.

## Mô tả

mya idempotency keys: mỗi tool call có client-generated idempotency-key (UUID/hash of call). Trước khi thực thi → check store: nếu key đã có → trả result lưu; nếu không → thực thi + lưu result by key. Retry (GU) cùng key → không trùng effect. Key TTL (giữ đủ lâu cho retry window). mya có retry (GU) nhưng chưa có idempotency-store → retry có thể trùng effect (charge 2 lần).

## Kiến trúc

```
  TOOL CALL { idempotency-key: K, tool, params }
        │
        ▼
  IDEMPOTENCY STORE lookup(K)
        │
   ┌────┴────┐
   │         │
  miss      hit (K đã thực thi)
   │         │
   ▼         ▼
  EXECUTE  RETURN stored result (KHÔNG thực thi lại)
   │
   ▼
  STORE { K → result, ts }  (TTL)
        │
   retry cùng K ──► hit ──► same result (no duplicate effect)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GU (203) retry loops — retry (sản — cần idempotent để an toàn)
// ✅ JJ (270) coalescing — dedup concurrent (bổ sung)
// ✅ GP (198) audit — record (sản)
// ✅ kanban — state store (nền cho idempotency store)

// ❌ THIẾU: idempotency-key trong tool-call envelope
// ❌ THIẾU: idempotency store (K → result, TTL)
// ❌ THIẾU: lookup-before-execute wrapper
```

## Implementation

```typescript
// packages/idem/src/index.ts (NEW)
const store = new Map<string, Promise<ToolResult>>();   // K → in-flight/done result
export async function idempotentTool(
  call: { idempotencyKey: string; tool: string; params: unknown },
  exec: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const hit = store.get(call.idempotencyKey);
  if (hit) return hit;                                   // duplicate → trả result đầu, KHÔNG effect trùng
  const p = exec().finally(() => setTimeout(() => store.delete(call.idempotencyKey), TTL));
  store.set(call.idempotencyKey, p);                     // lưu (in-flight + done)
  return p;
}
// agent/retry (GU 203) sinh cùng idempotencyKey khi retry → an toàn exactly-once effect
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Retry an toàn — không effect trùng (charge/pay 2 lần) | ❌ Chỉ áp dụng tool có side-effect (tool thuần read không cần) |
| ✅ Exactly-once effect qua at-least-once + idempotent | ❌ Store phải persistent (crash giữa → mất key) |
| ✅ Ngăn duplicate concurrent (với JJ 270) | ❌ TTL ngắn quá → retry muộn vẫn trùng |
| ✅ Proven (Stripe/AWS/HTTP) | ❌ Key collision (dùng UUID/strong-hash tránh) |

## Khác các hướng gần

| | GU Retry | JJ Coalescing | JT Optimistic | JU: Idempotency Keys |
|---|---|---|---|---|
| Mục | Lặp khi lỗi | Gộp concurrent | Version state | **Chống duplicate effect** |
| Cơ chế | Backoff | Single-flight | CAS retry | **K → stored result** |
| Quan hệ | Cần JU để an toàn | Bổ sung | Khác (state) | **Làm retry an toàn** |

## Khi nào chọn

- Tool có side-effect tốn tiền/irreversible (charge, send, pay, deploy) — bắt buộc
- Agent retry (GU 203) — phải idempotent để an toàn
- Key persistent (SQLite) + TTL dài hơn retry window + strong-key (UUID)
- Không cần cho tool thuần read (idempotent tự nhiên); kết hợp JJ để chống cả concurrent duplicate
