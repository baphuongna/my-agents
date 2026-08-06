# Hướng PPPPPPPP: Web Search as Grounding Tool — agent gọi search API để lấy thông tin mới + citation

> **Nguồn gốc:** Confident AI "7 Best Web Search APIs for Grounding LLMs 2026" (Firecrawl, Brave, Exa, Tavily, Parallel, Google — validated for grounding); parallel.ai "Honest 2026 comparison — web search APIs for AI agents" (3 nhóm: SERP APIs, AI-native search, native LLM tools); Vellum "Best Web Search APIs & MCPs" ("AI Grounding: structured output formatted for grounding LLM responses with verifiable sources"); You.com "Web Search API for AI Agents" (design tốt cho agents — không chỉ human); TDS "Grounding with Fresh Web Data" ("tool-use setup — LLM gọi search API khi cần external info"); Google Gemini Search Grounding (real-time grounding + citations)
> **Coupling:** 🟢 — một tool riêng, agent quyết khi gọi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (fetch/crawl có — chưa SERP API + citation)
> **Effort:** 1-2 tuần

## Nguồn gốc

Web search grounding: **thay vì crawl tự làm — agent dùng API search (Tavily/Exa/Brave/Google) lấy trang kết quả + snippet + citation — qua tool-call khi thông tin cần mới** — Confident: "grounding LLMs — reduce hallucinations"; Vellum: structured output với verifiable sources; TDS: "LLM dynamically calls search API only when it determines external info needed"; You.com: thiết kế cho agent (trả structured, không clickbait). Khác **crawl/web-agent 217** (tự điều khiển browser) — PPPP dùng API *kết quả trả sẵn* — đơn giản hơn nhiều, rẻ; thiếu DOM chi tiết/form. Khác **RAG 197** (index nội bộ) — PPPP là nguồn *bên ngoài, mới* (news, realtime). Khác **219 grounding** (verify claim vs source) — hợp tác: PPPP cung cấp nguồn để 219 check.

## Kiến trúc

```
  AGENT CẦN (thông tin mới — thời gian, không có trong RAG)
        │
        ▼
  SEARCH TOOL (Tavily/Exa/Brave/Gemini-grounding — từ-ngữ + filters)
        │
        ▼
  RESULTS (structured: title, url, snippet — verifiable source)
        │
        ▼
  RERANK (197 style — top-k theo câu hỏi)
        │
        ▼
  LLM ANSWER (trả lời + citation → user xem URL) 
   · 219 check nếu cần (answer vs pulled page content)
```

```
mya: chưa có search API — fetch/crawl chỉ khi biết URL; cần để tìm lạ
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 217 web agent — crawl khi có URL (nền)
// ✅ 162 MCP-first — sẵn mô hình thêm tool
// ✅ 209 query rewrite — sẵn cải thiện query
// ✅ 219 grounding — verify nguồn (bổ sung)

// ❌ THIẾU: search API integration (Tavily/Exa/Brave/Google)
// ❌ THIẾU: structured result (title+snippet+url) + citation
// ❌ THIẾU: chọn provider search theo query (nối 162 MCP-first)
```

## Implementation

```typescript
// packages/websearch/src/search.ts (NEW)
export async function groundingSearch(q: Query, ctx: Ctx): Promise<Grounding[]> {
  const rw = await rewrite(q);                 // 209 — tối ưu query
  const res = await provider.search(rw, { structured: true }); // Tavily/Exa/Google
  return res.slice(0, ctx.topK).map(toCitation); // title+url+snippet — verifiable
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thông tin mới — thời gian thực 24/7 (RAG-index cũ không) | ❌ Snippet ngắn nông — đôi đủ để trả lời |
| ✅ Structured + citation — verifiable (Vellum) | ❌ Chi phí/rate-limit của API search |
| ✅ Rẻ hơn hẳn crawl/Browsing (217) — API, không browser | ❌ Không làm form/gửi được — chỉ tìm hiểu |
| ✅ Chỉ gọi khi cần (tool-use) — tiết kiệm + chủ động | ❌ Kết quả SERP thương mại/không trung lập 100% |

## Khác các hướng gần

| | 217 Web-agent | 197 RAG | PPPPPPPP: Search |
|---|---|---|---|
| Mục | Tương tác DOM | Index nội bộ | **Tìm trên web mới — API** |
| Nguồn | Browser | Docs riêng | **Search engine (live)** |
| Quan hệ | Sâu hơn | Cũ; tĩnh | **Mở — realtime + citation** |

## Khi nào chọn

- Output cần thông tin mới (news, version, sản phẩm hiện tại)
- Phạm vi RAG không đủ (không cập nhật) — cần world knowledge hôm nay
- Cần trích nguồn verifiable (domain nhạy) — search API + 219
- Không khi: thông tin nội bộ/tĩnh — RAG đủ hơn (rẻ + nhanh)