# Hướng ABP: Fast-Path Request Detection — detector nhận diện quota probe / title generation / prefix detection rồi trả lời local không tốn API call

> **Nguồn gốc:** free-claude-code (api/optimization_handlers.py, api/detection.py) | **Coupling:** 🟡 — thêm detection layer trước khi gọi provider | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có gateway + fallback — chưa có fast-path handlers) | **Effort:** 1-2 tuần

## Nguồn gốc

**free-claude-code** có **detector** nhận diện các request không cần gọi model thật: (1) **quota probe** — request `max_tokens=1` + text chứa từ "quota" (client hỏi còn quota không); (2) **title generation** — system prompt chứa "sentence-case title" (client tự sinh title cho conversation); (3) **prefix detection** — các pattern request máy móc khác. Detector trả lời **local** — không tốn API call — qua **optimization handler** trả `MessagesResponse` (giả) hoặc `None` (không xử lý → đi tiếp). Kết quả: hàng loạt request thừa (probe, title, ping) **không bao giờ chạm provider** — tiết kiệm tiền + latency. Nguyên tắc: **detect trước khi gọi, trả local response cho request máy móc, trả None nếu không chắc (fallback đi tiếp)**.

## Mô tả

mya fast-path request detection: gateway/agent thêm **detection layer** trước khi route tới provider: nhận request → chạy detector (quota probe? title gen? prefix?) → nếu khớp → **optimization handler** trả response local (không gọi model); nếu không khớp → trả `None` → request đi tiếp bình thường. mya có packages/gateway (HTTP handler) + packages/ai fallback.ts (auth/quota handling) — ABP thêm **detector set** (probe/title/prefix) + **optimization handlers** (local response) + **None-semantics** (không chắc thì đi tiếp).

## Kiến trúc

```
  REQUEST (client → gateway)
       │
       ▼
  DETECTION LAYER (trước khi gọi provider)
  ┌──────────────────────────────────────────────┐
  │  quota probe?   max_tokens=1 + "quota"       │
  │    → handler trả local { quota: "ok" }       │
  │  title gen?     system chứa "sentence-case"  │
  │    → handler trả local title response        │
  │  prefix pattern? (ping, health)              │
  │    → handler trả local                       │
  │  không khớp → trả None → đi tiếp             │
  └──────────────────────┬───────────────────────┘
                         │  None (không chắc)
                         ▼
  PROVIDER CALL (chỉ request thật chạm provider)
  → quota probe / title gen KHÔNG tốn API call
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway index.ts — HTTP request handler (nền — ABP detection point)
// ✅ packages/ai fallback.ts — auth/quota handling (nền — ABP quota semantics)
// ✅ packages/ai mock.ts — mock provider (nền — ABP local response analog)
// ✅ packages/core loop.ts — runTurn (nền — ABP turn-level detection)

// ❌ THIẾU: detector set (quota probe / title gen / prefix)
// ❌ THIẾU: optimization handlers (local MessagesResponse)
// ❌ THIẾU: None-semantics (không khớp → đi tiếp, không block)
```

## Implementation

```typescript
// packages/gateway/src/fast-path.ts (MỚI)

export interface IncomingRequest {
  max_tokens?: number;
  messages: Array<{ role: string; content: string }>;
}

export type FastPathResult = { handled: true; response: unknown } | { handled: false };

/** Detector: nhận diện request máy móc không cần model thật. */
export function detectFastPath(req: IncomingRequest): FastPathResult {
  const text = req.messages.map(m => m.content).join("\n").toLowerCase();
  const system = req.messages.find(m => m.role === "system")?.content ?? "";

  // 1. QUOTA PROBE: max_tokens=1 + từ "quota" — client hỏi còn quota không
  if (req.max_tokens === 1 && /\bquota\b/.test(text)) {
    return { handled: true, response: { content: "quota: ok", usage: { input: 0, output: 1 } } };
  }

  // 2. TITLE GENERATION: system prompt yêu cầu sinh title ngắn
  if (/sentence-case title|generate a title/i.test(system)) {
    return { handled: true, response: { content: "Conversation", usage: { input: 0, output: 1 } } };
  }

  // 3. PREFIX DETECTION: ping/health machine pattern
  if (/^(ping|health|alive)$/i.test(text.trim())) {
    return { handled: true, response: { content: "pong", usage: { input: 0, output: 1 } } };
  }

  // KHÔNG KHỚP → None → request đi tiếp (không block, không tốn)
  return { handled: false };
}

/** Optimization handler wrapper: chạy detector, trả response local hoặc None. */
export function withFastPath(handle: (req: IncomingRequest) => Promise<unknown>) {
  return async (req: IncomingRequest): Promise<unknown> => {
    const fast = detectFastPath(req);
    if (fast.handled) return fast.response; // local — không gọi provider
    return handle(req);                      // None-semantics: đi tiếp bình thường
  };
}
// Usage:
// app.post("/v1/messages", withFastPath(realProviderCall));
// → quota probe / title gen / ping trả local, không tốn API call
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm API call (probe/title/ping không chạm provider) | ❌ False positive (nhận diện nhầm request thật là probe → trả sai) |
| ✅ Latency thấp (local response — không chờ model) | ❌ Detector brittle (client đổi pattern → không detect nữa) |
| ✅ None-semantics an toàn (không chắc → đi tiếp, không block) | ❌ Hardcode pattern (text match — phải cập nhật theo client) |
| ✅ Zero LLM cost cho request máy móc | ❌ Response shape phải khớp (local response phải đúng contract) |

## Khác các hướng gần

| | Gọi provider mọi request | Cache response | ABP: Fast-Path Detection |
|---|---|---|---|
| Quota probe | tốn call | không | **local response** |
| Title gen | tốn call | có thể | **local response** |
| Ping/health | tốn call | không | **local response** |
| Request thật | — | — | **None → đi tiếp (không đụng)** |

## Khi nào chọn

- Client (Claude Code) gửi nhiều request máy móc (quota probe, title gen, ping)
- Muốn tiết kiệm chi phí/latency cho request không cần model
- Cần an toàn (không chắc chắn → đi tiếp, không block request thật)
- Nối packages/gateway index.ts + packages/ai fallback.ts + mock.ts; guard pattern-freshness (detector theo version client — update khi client đổi), response-contract (local response đúng shape Messages API — client parse được), và none-safety (mọi detector không khớp → None, không bao giờ block); ABP = fast-path request detection, kết hợp 742 ABN protocol-stable-proxy-routing (fast-path nằm trong proxy) + 743 ABO gateway-model-id-encoding (detector có thể dựa trên model id)
