# Hướng ABO: Gateway Model-ID Encoding — encode model id gateway (anthropic/<provider>/<model>) khai thác heuristic capability phía client

> **Nguồn gốc:** free-claude-code (api/gateway_model_ids.py) | **Coupling:** 🟡 — thêm model-id encode/decode vào routing | **Agent-agnostic:** ⚠️ (khai thác heuristic riêng của client) | **Code sẵn:** ⚠️ (có model-routing + route-identity — chưa có encode heuristic) | **Effort:** 1-2 tuần

## Nguồn gốc

**free-claude-code** encode **model id gateway** dạng `anthropic/<provider>/<model>` và prefix `claude-3-freecc-no-thinking` để **khai thác heuristic capability phía client**: client (Claude Code) quyết định capability theo tên model — model chứa `claude-3-` bị coi là **không hỗ trợ thinking** (theo heuristic của client) → client không gửi thinking budget, tiết kiệm chi phí/token. Quan trọng: ref gốc vẫn **reversible** — gateway decode model id để **route đúng** tới provider/model thật. Nguyên tắc: **model id là carrier (encode capability hint + route info), reversible (decode để route đúng), khai thác heuristic client có chủ đích**.

## Mô tả

mya gateway model-id encoding: khi route qua gateway, model id được **encode**: `anthropic/<provider>/<model>` (+ prefix capability hint như `no-thinking`) — client thấy tên model quen (anthropic/claude-3-...) và áp heuristic capability tương ứng (VD không gửi thinking), trong khi gateway **decode** model id để **route đúng** tới provider/model thật (phần `<provider>/<model>`). mya có packages/ai model-routing.ts (phase/tier route) + route-identity.ts — ABO thêm **model-id codec** (encode + decode reversible) + **capability hint prefix**.

## Kiến trúc

```
  CLIENT (Claude Code)
  │  model: "anthropic/deepseek/deepseek-v3"   ← encode
  │  → heuristic: chứa "anthropic/claude-3-"?? 
  │     → "no-thinking" prefix → không gửi thinking budget
  ▼
  GATEWAY
  ┌─────────────────────────────────────────────┐
  │  DECODE model id (reversible)               │
  │    "anthropic/deepseek/deepseek-v3"         │
  │      → provider = deepseek                  │
  │      → model    = deepseek-v3               │
  │  + capability flags (no-thinking) → headers │
  └──────────────────────┬──────────────────────┘
                         ▼
  PROVIDER (deepseek) ← route đúng theo ref gốc
  → client heuristic đúng, route đúng — không mất ref
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai model-routing.ts — phase/tier routing (nền — ABO route decode)
// ✅ packages/ai route-identity.ts — route identity (nền — ABO id semantics)
// ✅ packages/ai provider-registry.ts — provider registry (nền — ABO provider lookup)
// ✅ packages/gateway — gateway host (nền — ABO encode/decode point)

// ❌ THIẾU: model-id codec (encode anthropic/<provider>/<model> + decode reversible)
// ❌ THIẾU: capability hint prefix (no-thinking → client heuristic)
// ❌ THIẾU: ref preservation (decode không mất model gốc)
```

## Implementation

```typescript
// packages/ai/src/model-id-codec.ts (MỚI)

export interface EncodedModel {
  provider: string;
  model: string;
  capabilities: Set<"no-thinking">;
  raw: string; // ref gốc giữ nguyên (reversible)
}

const GATEWAY_PREFIX = "anthropic/";
const NO_THINKING = "no-thinking";

/** Encode: anthropic/<provider>/<model> + prefix capability hint. */
export function encodeModelId(provider: string, model: string, opts?: { noThinking?: boolean }): string {
  const cap = opts?.noThinking ? `claude-3-${NO_THINKING}-` : "";
  return `${GATEWAY_PREFIX}${cap}${provider}/${model}`;
}

/** Decode (reversible): tách provider/model + capability, giữ raw gốc. */
export function decodeModelId(gatewayId: string): EncodedModel {
  const raw = gatewayId;
  const rest = gatewayId.startsWith(GATEWAY_PREFIX) ? gatewayId.slice(GATEWAY_PREFIX.length) : gatewayId;
  const capabilities = new Set<"no-thinking">();
  let body = rest;
  const nt = rest.indexOf(`${NO_THINKING}-`);
  if (nt >= 0) {
    capabilities.add("no-thinking");
    body = rest.slice(0, nt) + rest.slice(nt + `${NO_THINKING}-`.length);
  }
  const slash = body.indexOf("/");
  if (slash < 0) return { provider: "default", model: body, capabilities, raw };
  return { provider: body.slice(0, slash), model: body.slice(slash + 1), capabilities, raw };
}

// Usage:
// const id = encodeModelId("deepseek", "deepseek-v3", { noThinking: true });
// // → "anthropic/claude-3-no-thinking-deepseek/deepseek-v3"
// const { provider, model, capabilities } = decodeModelId(id);
// // provider="deepseek", model="deepseek-v3", capabilities={no-thinking}
// route(provider, model); // ref gốc reversible — route đúng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Client heuristic được khai thác (no-thinking → tiết kiệm) | ❌ Heuristic phụ thuộc client (client đổi heuristic → hint vô dụng) |
| ✅ Reversible (decode → route đúng, không mất ref) | ❌ Model id dài (prefix + provider + model — verbose) |
| ✅ Không đổi client (chỉ đổi model id string) | ❌ Capability prefix có thể bị hiểu nhầm (client parse khác) |
| ✅ Route tập trung (gateway biết provider/model chính xác) | ❌ Encode collision (provider/model chứa ký tự đặc biệt) |

## Khác các hướng gần

| | Model id thật (client biết hết) | Model id opaque | ABO: Encoded Gateway ID |
|---|---|---|---|
| Client capability | client tự biết | không biết | **encode hint (heuristic)** |
| Route | client tự chọn | gateway map | **decode → route đúng** |
| Ref gốc | hiện | ẩn | **giữ raw (reversible)** |

## Khi nào chọn

- Client có heuristic capability theo tên model (như Claude Code thinking)
- Muốn gateway kiểm soát route nhưng client vẫn nhận tên model "quen thuộc"
- Cần reversible id (decode để route, không mất ref gốc)
- Nối packages/ai model-routing.ts + route-identity.ts + provider-registry.ts + packages/gateway; guard ref-preservation (decode luôn giữ raw gốc — route không lệch), prefix-versioning (capability hint có version — client cũ không hiểu thì bỏ qua), và heuristic-fallback (client không parse prefix → vẫn hoạt động, chỉ mất optimization); ABO = gateway model-id encoding, kết hợp 742 ABN protocol-stable-proxy-routing (id encode nằm trong proxy route) + 744 ABP fast-path-request-detection (request đặc biệt xử lý local)
