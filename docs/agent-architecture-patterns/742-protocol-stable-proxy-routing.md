# Hướng ABN: Protocol-Stable Proxy Routing — proxy giữ ổn định protocol phía client (Anthropic Messages API) trong khi route tới 8 provider backend

> **Nguồn gốc:** free-claude-code (README.md) | **Coupling:** 🟡 — thêm proxy layer giữa client và providers | **Agent-agnostic:** ⚠️ (protocol proxy gắn với client cụ thể) | **Code sẵn:** ⚠️ (có gateway + model-routing — chưa có protocol-stable proxy) | **Effort:** 2-3 tuần

## Nguồn gốc

**free-claude-code** là một **proxy**: phía client giữ nguyên **Anthropic Messages API** (client không cần thay đổi — Claude Code vẫn gọi API như cũ), phía backend **route traffic tới 8 provider** — NVIDIA NIM, Kimi, DeepSeek, LM Studio, llama.cpp, Ollama... Proxy chịu trách nhiệm **dịch protocol**: nhận request Messages API (client), convert sang format từng provider, gọi provider, convert response về Messages API (client). **Stable protocol = client không đổi, backend thay đổi thoải mái**. Nguyên tắc: **client contract bất biến, adapter per provider, route theo model/config**.

## Mô tả

mya protocol-stable proxy routing: một **proxy layer** đứng giữa agent client và model providers — client luôn nói một protocol (VD Anthropic Messages hoặc OpenAI chat), proxy **route** tới provider theo model/config: mỗi provider có **adapter** (dịch request/response), proxy chọn adapter theo route. mya có packages/gateway (HTTP server + channel) + packages/ai model-routing.ts (phase/tier routing) + provider-registry.ts — ABN thêm **protocol adapter layer** (Messages API ↔ provider format) + **stable client contract** + **route table (8 backend)**.

## Kiến trúc

```
  CLIENT (Claude Code / agent client — KHÔNG đổi)
  ┌──────────────────────────────────────┐
  │  POST /v1/messages (Anthropic API)   │
  └───────────────┬──────────────────────┘
                  │ (protocol giữ nguyên)
                  ▼
  PROXY (protocol-stable)
  ┌──────────────────────────────────────┐
  │  route table: model-id → provider    │
  │  ├─ nvidia-nim   → adapter NIM       │
  │  ├─ kimi         → adapter Kimi      │
  │  ├─ deepseek     → adapter DeepSeek  │
  │  ├─ lm-studio    → adapter LM Studio │
  │  ├─ llama.cpp    → adapter llama.cpp │
  │  └─ ollama       → adapter Ollama    │
  └───────────────┬──────────────────────┘
                  │ (adapter dịch format)
                  ▼
  PROVIDER BACKENDS (8 provider — thay đổi thoải mái)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway index.ts — HTTP server + routes (nền — ABN proxy host)
// ✅ packages/ai model-routing.ts — phase/tier model routing (nền — ABN route table)
// ✅ packages/ai provider-registry.ts — provider registry (nền — ABN backend list)
// ✅ packages/ai openai.ts + pi-ai-bridge.ts — adapters (nền — ABN adapter pattern)

// ❌ THIẾU: protocol adapter layer (Messages API ↔ provider format)
// ❌ THIẾU: stable client contract (client không đổi khi backend đổi)
// ❌ THIẾU: route table multi-provider (8 backend + fallback)
```

## Implementation

```typescript
// packages/gateway/src/protocol-proxy.ts (MỚI)

export interface MessagesRequest {
  model: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  max_tokens?: number;
}

export interface ProviderAdapter {
  id: string;
  /** Dịch request Messages API → format provider. */
  toProvider(req: MessagesRequest): unknown;
  /** Dịch response provider → Messages API (client contract ổn định). */
  toMessages(raw: unknown): { content: string; usage: { input: number; output: number } };
}

/** Route table: model-id → adapter (8 provider backend, client không đổi). */
export class ProtocolProxy {
  constructor(private adapters: Map<string, ProviderAdapter>) {}

  /** Route request tới provider theo model, trả response chuẩn Messages API. */
  async route(req: MessagesRequest, call: (adapter: ProviderAdapter, body: unknown) => Promise<unknown>): Promise<{ content: string; usage: { input: number; output: number } }> {
    const adapter = this.pickAdapter(req.model);
    const providerBody = adapter.toProvider(req);        // dịch ra
    const raw = await call(adapter, providerBody);        // gọi backend
    return adapter.toMessages(raw);                       // dịch về — client contract nguyên vẹn
  }

  private pickAdapter(model: string): ProviderAdapter {
    for (const [prefix, adapter] of this.adapters) {
      if (model.startsWith(prefix)) return adapter;
    }
    throw new Error(`proxy: no adapter for model ${model}`);
  }
}

// Usage:
// const proxy = new ProtocolProxy(new Map([
//   ["nvidia/", nimAdapter], ["kimi", kimiAdapter], ["deepseek", deepseekAdapter],
//   ["lm-studio", lmStudioAdapter], ["llama", llamaCppAdapter], ["ollama", ollamaAdapter],
// ]));
// const reply = await proxy.route(clientReq, fetchProvider); // client thấy Messages API như cũ
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Client không đổi (protocol stable — zero client migration) | ❌ Adapter chồng (mỗi provider 1 adapter — bảo trì) |
| ✅ Nhiều backend (8 provider — chọn rẻ/nhanh theo nhu cầu) | ❌ Protocol gap (provider thiếu feature — thinking, tool call — proxy phải xử lý) |
| ✅ Route theo model (model-id → provider rõ ràng) | ❌ Latency (thêm 1 hop proxy) |
| ✅ Fallback dễ (provider chết → route sang backend khác) | ❌ Error mapping (provider lỗi → phải map về format client) |

## Khác các hướng gần

| | Direct call (client gọi provider) | Provider registry (chọn provider) | ABN: Protocol Proxy |
|---|---|---|---|
| Client contract | theo provider | theo provider | **cố định (Messages API)** |
| Backend thay đổi | client đổi theo | client đổi | **proxy hấp thụ** |
| Nhiều provider | phải code client | registry chọn | **route + adapter** |

## Khi nào chọn

- Client có sẵn (Claude Code, agent cũ) không muốn đổi — chỉ đổi backend
- Muốn chạy nhiều provider (local + cloud) sau một API ổn định
- Cần route model → provider linh hoạt (rẻ/nhanh/local)
- Nối packages/gateway index.ts + packages/ai model-routing.ts + provider-registry.ts + openai.ts; guard contract-stability (client contract đóng băng — mọi adapter dịch về đúng shape), adapter-coverage (mọi provider có adapter — không fallback mù), và error-mapping (provider error → format client hiểu); ABN = protocol-stable proxy routing, kết hợp 743 ABO gateway-model-id-encoding (model-id encode route) + 744 ABP fast-path-request-detection (quota probe xử lý local không tốn backend)
