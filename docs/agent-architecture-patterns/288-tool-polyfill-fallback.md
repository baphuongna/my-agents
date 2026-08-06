# Hướng KB: Tool Polyfill & Fallback — tool thiếu/thất bại thì giả lập hoặc chuyển tool thay thế

> **Nguồn gốc:** Web "polyfill" (giả lập API thiếu trên browser cũ); "graceful fallback"; "feature detection vs polyfill"; "circuit breaker fallback" (Netflix); "alternative tool selection"; "shim"; "adapter pattern"
> **Coupling:** 🟡 — thêm polyfill registry tại tool layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool registry sẵn — chưa có polyfill/fallback chain)
> **Effort:** 1-2 tuần

## Nguồn gốc

Polyfill (web): browser thiếu API → JS giả lập cùng interface → code chạy như có thật. Graceful fallback (Netflix): dependency fail → trả cache/default/alternative. Feature detection: check có khả năng không → dùng polyfill nếu thiếu. Đối với agent: tool có thể thiếu (chưa cài, MCP chưa load) hoặc fail (provider down, rate-limit) → **polyfill** (giả lập cùng output — VD web search thiếu → fetch Google scrape) hoặc **fallback** (chuyển tool thay thế — VD model-A down → model-B). Khác **AP (42) circuit breaker** (dừng gọi provider chết) — KB *chuyển đường thay thế*; khác **JL (272) graceful degradation** (giảm năng lực hệ thống) — KB *giữ năng lực* qua tool thay; khác **GU (203) retry** (lặp cùng tool) — KB *đổi tool*; khác **289 KC dry-run** (chạy thử) — KB *thực thi thật* qua thay thế.

## Mô tả

mya tool polyfill/fallback: mỗi tool có fallback-chain — nếu tool chính thiếu/fail → thử tool thay (cùng semantics) hoặc polyfill (giả lập output). VD: `web_search` thiếu → `fetch+scrape` polyfill; `model-A` fail → `model-B` fallback. mya có tool registry + provider fallback — KB thêm polyfill registry + fallback chain theo tool capability.

## Kiến trúc

```
  AGENT calls TOOL T (capability: "search")
        │
        ▼
  TOOL REGISTRY — T available? healthy?
        │
   ┌────┴────┐
   │         │
  yes       no/miss/fail (AP 42 circuit)
   │         │
   ▼         ▼
  RUN T    FALLBACK CHAIN:
            T' (alternative — same capability "search")
            T'' (polyfill — emulate output)
            └─► if all fail → degrade (JL 272) or error
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool registry — chọn tool theo capability (sản)
// ✅ provider fallback — đổi provider khi fail (sản)
// ✅ AP (42) circuit breaker — detect provider chết (sản)
// ✅ JL (272) degradation — giảm năng lực (sản)
// ✅ GU (203) retry — lặp (sản)

// ❌ THIẾU: polyfill registry (giả lập tool thiếu)
// ❌ THIẾU: fallback chain per capability
// ❌ THIẾU: capability-based routing (gọi theo "search" không phải tool cụ thể)
```

## Implementation

```typescript
// packages/toolfill/src/index.ts (NEW)
const chain: Record<string, Tool[]> = {};                  // capability → ordered [primary, alt, polyfill]
function register(capability: string, tools: Tool[]) { chain[capability] = tools; }
async function callCapability(cap: string, input: unknown): Promise<Output> {
  for (const t of chain[cap] ?? []) {                       // fallback chain
    try { return await t.run(input); }                      // healthy → dùng
    catch (e) { if (isFatal(e)) throw e; /* else try next */ }
  }
  throw new ToolUnavailable(cap);                           // hết chain → degrade (JL)
}
// register("search", [tavily, bing, googleScrapePolyfill]);  // primary → alt → polyfill
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tool thiếu/fail không chết — tiếp tục (polyfill/fallback) | ❌ Polyfill chất lượng kém hơn tool thật |
| ✅ Khả năng chịu lỗi — provider down có thay thế (Netflix) | ❌ Phức — phải duy trì nhiều tool cùng capability |
| ✅ Capability-based — agent gọi theo năng lực không tên tool | ❌ Semantic khác biệt — fallback trả output hơi khác |
| ✅ Che missing MCP/tool (chưa cài) | ❌ Polyfill giả lập có thể sai (scrape) |

## Khác các hướng gần

| | AP Circuit Breaker | JL Degradation | GU Retry | KB: Polyfill/Fallback |
|---|---|---|---|---|
| Khi sự cố | Dừng gọi provider | Giảm năng lực | Lặp cùng tool | **Chuyển tool thay thế** |
| Kết quả | Fail open/closed | Tier thấp hơn | Thành công/crash | **Giữ năng lực qua thay** |
| Mục | Tránh lỗi lan | Vẫn phục vụ | Khôi phục | **Tính sẵn sàng tool** |

## Khi nào chọn

- Tool/MCP có thể thiếu (chưa cài) hoặc hay fail — cần thay thế
- Nhiều tool cùng capability (nhiều search provider, nhiều model)
- Muốn agent gọi theo capability không tên cứng
- Luôn: polyfill rõ là "giả lập" (chất lượng khác); fallback semantic tương đương; hết chain → degrade (JL)
