# Hướng MZ: Fetch-Index-Then-Search — Fetch→index→search, raw HTML không vào context

> **Nguồn gốc:** "Fetch then index"; RAG over fetched web content; "index before context"; reader-retriever (Reader-LM); extractive summarization; "web content distillation"; "don't paste raw HTML"
> **Coupling:** 🟢 — thêm fetch→index→search pipeline vào web tool
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (217 web-browsing + 223 web-search-grounding sẵn — chưa có index-before-context)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**Anti-pattern**: agent cần info từ web → fetch trang → paste **raw HTML** (hàng nghìn token, đầy thẻ/tag/script) vào context → window tràn, model khó đọc. **Fetch-Index-Then-Search**: **fetch** trang → **index** (extract text, chunk, embedding/FTS5) → agent **search** trong index → chỉ **đoạn cần** vào context. Raw HTML **không bao giờ** chạm context window — chỉ kết quả search (đoạn nhỏ, relevant) mới vào. **Reader-LM / reader-retriever**: model chuyên distill web content. Nguyên tắc: **web content là raw material, không phải context** — phải qua index+search trước. Khác **217 HI web-browsing** (browse raw) — MZ **index-mediated**; khác **223 HO web-search-grounding** (search engine result) — MZ **index trang đã fetch**.

## Mô tả

mya fetch-index-then-search: tool web làm 3 bước — (1) **fetch** URL raw HTML, (2) **extract+index** (strip tag, chunk, lưu FTS5/embedding vào ephemeral store), (3) agent **search** ("đoạn nói về X") → chỉ chunk relevant vào context. Raw HTML bị drop ngay sau index. Kết quả: context chỉ có **vài chunk gọn** (chứ không cả trang). Nối 217 HI web-browsing (fetch) — MZ là **index layer** giữa fetch và context.

## Kiến trúc

```
  Agent cần info: "How does X work?"
       │
       ▼
  ┌─── FETCH ──────────────────────────────────┐
  │  GET https://example.com/docs               │
  │  → raw HTML (50KB, đầy thẻ)  ❌ KHÔNG vào context
  └──┬──────────────────────────────────────────┘
     ▼
  ┌─── EXTRACT + INDEX ────────────────────────┐
  │  strip tag → plain text                     │
  │  chunk (512 token) → [c1, c2, c3, ...]      │
  │  index: FTS5 + embedding → ephemeral store  │
  └──┬──────────────────────────────────────────┘
     ▼  (raw HTML dropped ✅)
  ┌─── SEARCH (agent query) ───────────────────┐
  │  search index: "how does X work"            │
  │  → top-k chunks: [c2, c7]                   │
  └──┬──────────────────────────────────────────┘
     ▼
  CONTEXT chỉ nhận: c2 + c7  (≈ 1KB, relevant)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 217 HI web-browsing-agents — fetch web (nền — MZ thêm index layer)
// ✅ 223 HO web-search-grounding — search engine (nền)
// ✅ 218 HJ tool-output-compression — nén output (sau extract)
// ✅ 362 MX event-sourced-session — FTS5 (reuse index infra)

// ❌ THIẾU: HTML→text extractor (strip tag)
// ❌ THIẾU: chunker + ephemeral index store (per-fetch)
// ❌ THIẾU: search-then-return-chunks tool (raw HTML never returns)
```

## Implementation

```typescript
// packages/agent/src/web-index.ts (NEW)
interface Chunk { id: number; text: string; url: string; score?: number; }

class FetchIndexSearch {
  private store: Map<string, Chunk[]> = new Map(); // url → chunks

  // Bước 1+2: fetch + index (raw HTML KHÔNG trả)
  async fetchAndIndex(url: string): Promise<number> {
    const html = await this.httpGet(url);
    const text = this.stripHtml(html);           // HTML → plain text
    const chunks = this.chunk(text, 512);        // chia chunk
    const stored = chunks.map((t, i) => ({ id: i, text: t, url }));
    this.store.set(url, stored);
    return stored.length; // agent biết "đã index N chunk"
  }

  // Bước 3: search → chỉ chunk relevant vào context
  async search(url: string, query: string, topK = 3): Promise<Chunk[]> {
    const chunks = this.store.get(url) ?? [];
    // FTS5 match hoặc embedding cosine (đơn giản: keyword score)
    const scored = chunks.map(c => ({ ...c, score: this.score(c.text, query) }));
    return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
  }

  private stripHtml(html: string): string {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  private chunk(text: string, size: number): string[] {
    const words = text.split(' '); const out: string[] = [];
    for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '));
    return out;
  }
  private score(text: string, query: string): number {
    return query.toLowerCase().split(/\s+/).filter(w => text.toLowerCase().includes(w)).length;
  }
  private async httpGet(_url: string): Promise<string> { return ''; }
}

// Tool (agent gọi):
// await web.fetchAndIndex('https://example.com/docs');  // → "indexed 24 chunks"
// const chunks = await web.search('https://example.com/docs', 'how X works'); // → 3 chunk vào context
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Raw HTML không vào context (window gọn) | ❌ Index overhead (extract + chunk) |
| ✅ Chỉ chunk relevant (model đọc dễ) | ❌ Extract sai → mất nội dung (tag nặng) |
| ✅ Search nhiều lần (index tái dùng) | ❌ Ephemeral store cleanup (memory leak) |
| ✅ Nối 217 HI (fetch) + 223 HO (search) | ❌ JS-heavy page → extract trống (cần render) |

## Khác các hướng gần

| | 217 Web Browsing | 223 Web Search Grounding | 218 Tool Output Compress | MZ: Fetch-Index-Search |
|---|---|---|---|---|
| Cái gì | Browse raw | Search engine result | Nén output | **Index trang rồi search** |
| Raw HTML | ✅ vào context | ❌ | ❌ | ❌ (index xong drop) |
| Index | ❌ | ❌ | ❌ | ✅ |
| Search recall | ❌ | ✅ (engine) | ❌ | ✅ (local index) |

## Khi nào chọn

- Agent fetch trang web dài (docs, article) vào context
- Raw HTML/full page quá lớn cho window
- Cần search nhiều lần trong cùng trang
- Kết hợp 217 HI (fetch) + MZ (index+search layer) + 218 HJ (nén chunk); guard JS-heavy page (cần headless render) + extract correctness
