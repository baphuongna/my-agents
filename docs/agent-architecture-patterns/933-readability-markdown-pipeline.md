# Hướng AIW: Readability Markdown Pipeline — HTML → Readability (linkedom) → Turndown markdown với CONCURRENT_LIMIT/MIN_USEFUL_CONTENT/NON_RECOVERABLE_ERRORS

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟢 — pipeline thuần trong web tool | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có htmlToMarkdown regex; chưa có Readability DOM) | **Effort:** 1 tuần

## Nguồn gốc

**pi-web-access** chuẩn hóa content extraction: **HTML → Readability (linkedom) → Turndown markdown** với **CONCURRENT_LIMIT 3**, **MIN_USEFUL_CONTENT 500 chars**, **NON_RECOVERABLE_ERRORS list** — content extraction chuẩn hóa cho agent, **fallback cho PDF và video**. Readability (mozilla) loại nav/sidebar/quảng cáo, Turndown chuyển DOM sạch → markdown chuẩn — tốt hơn nhiều so với regex strip.

Nguyên tắc: **content extraction phải hiểu cấu trúc DOM (Readability), không phải regex** — regex không phân biệt article vs sidebar; **kiểm soát đồng thời + ngưỡng nội dung tối thiểu** — CONCURRENT_LIMIT 3 tránh quá tải, MIN_USEFUL_CONTENT 500 chars chặn trang rỗng; **lỗi phân loại** — NON_RECOVERABLE_ERRORS (timeout/auth) không retry vô ích, lỗi recoverable (transient) thì retry.

## Mô tả

Với mya, pattern = **nâng cấp web_fetch pipeline**: (1) **webFetch (fetch.ts) hiện dùng htmlToMarkdown regex-based** — thay/bao quanh bằng **Readability + Turndown**: fetch HTML → parse linkedom → `Readability(dom).parse()` → article DOM sạch → Turndown → markdown; (2) **concurrency control** — CONCURRENT_LIMIT 3 (semaphore — nối bounded-search pattern); (3) **MIN_USEFUL_CONTENT 500** — parse xong dưới 500 chars → coi như extract fail (fallback raw htmlToMarkdown); (4) **error classification** — NON_RECOVERABLE_ERRORS (DNS fail, 4xx auth, TLS) không retry; transient (5xx, timeout) retry có backoff (nối `search/parallel.ts` pattern); (5) **fallback PDF/video** — PDF dùng text extraction (pdf-parse), video nối AIU (transcript/frame) — cùng contract markdown output. Security: vẫn giữ stripHiddenDom + stripInvisibleUnicode (Readability có thể giữ ẩn injection).

## Kiến trúc (ASCII)

```
  FETCH HTML
    │
    ▼ PARSE (linkedom DOM)
    ▼ READABILITY — trích article content (bỏ nav/sidebar/ads)
    ▼ TURNDOWN — DOM sạch → MARKDOWN chuẩn
    │
    ├─ nội dung < MIN_USEFUL_CONTENT (500 chars)?
    │    └─► fallback htmlToMarkdown (regex — vẫn lấy được gì đó)
    ├─ error?
    │    ├─ NON_RECOVERABLE (DNS/4xx/TLS) ──► báo lỗi, KHÔNG retry
    │    └─ transient (5xx/timeout) ──► retry có backoff
    └─ OK ──► markdown (qua stripInvisibleUnicode + truncation)
  CONCURRENT: semaphore giới hạn 3 fetch song song
  FALLBACK: PDF (pdf-parse) / video (AIU transcript+frames)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools web/fetch.ts — webFetch (HTML→markdown, regex-based floor)
// ✅ packages/tools web/fetch.ts — stripHiddenDom + stripInvisibleUnicode (giữ)
// ✅ packages/tools web/bounded-search.ts — semaphore/deadline pattern (nền concurrency)
// ✅ packages/tools web/search/parallel.ts — parallel search pattern (nền retry)
// ✅ packages/tools web/orchestrator.ts — resilience actions (Retry/Abort/Circuit — nền)
// ✅ packages/tools web/config.ts — web.* config (nền MIN_USEFUL_CONTENT config)

// ❌ THIẾU: Readability (linkedom) + Turndown trong pipeline
// ❌ THIẾU: CONCURRENT_LIMIT 3 semaphore cho fetch
// ❌ THIẾU: MIN_USEFUL_CONTENT 500 + NON_RECOVERABLE_ERRORS classification
```

## Implementation

```typescript
// packages/tools/src/web/readability-markdown.ts (NEW)
export const CONCURRENT_LIMIT = 3;
export const MIN_USEFUL_CONTENT = 500;
export const NON_RECOVERABLE_ERRORS = [
  "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT",      // DNS / connect
  "401", "403", "404", "410",                     // auth / gone
  "TLS", "CERT",                                   // cert lỗi
];

/** Semaphore — giới hạn fetch song song (CONCURRENT_LIMIT). */
export class FetchSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= CONCURRENT_LIMIT) {
      await new Promise<void>((r) => this.queue.push(r));
    }
    this.active++;
    try { return await fn(); }
    finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/** Readability → Turndown pipeline với ngưỡng nội dung + error classification. */
export async function readabilityToMarkdown(html: string): Promise<string | null> {
  const { JSDOM } = await import("linkedom");
  const { Readability } = await import("@mozilla/readability");
  const TurndownService = (await import("turndown")).default;
  const dom = new JSDOM(html);
  const article = new Readability(dom.window.document).parse();
  if (!article || article.textContent.length < MIN_USEFUL_CONTENT) {
    return null;   // trang rỗng/không phải article → fallback regex pipeline
  }
  return new TurndownService().turndown(article.content);
}

/** Retry policy: NON_RECOVERABLE → không retry; transient → retry backoff. */
export function isNonRecoverable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return NON_RECOVERABLE_ERRORS.some((k) => msg.includes(k));
}
// webFetch: htmlToMarkdown giữ làm floor; thử readabilityToMarkdown trước.
// Semaphore bao quanh fetch network. isNonRecoverable quyết định retry.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Article sạch — bỏ nav/sidebar/ads tốt hơn regex nhiều | ❌ Dependency linkedom + Readability + turndown (bundle lớn hơn) |
| ✅ MIN_USEFUL_CONTENT chặn trang rỗng/không nội dung | ❌ Trang không theo semantic HTML (article) có thể bị cắt nhầm |
| ✅ Concurrency + error classification ổn định | ❌ Fallback regex vẫn cần — hai pipeline phải test song song |
| ✅ Nối PDF/video fallback cùng contract | ❌ Readability thêm DOM parse — chậm hơn regex một chút |

## Khác các hướng gần

| | AIW Readability Pipeline | AIT RSC Extraction | AIS Clone-Not-Scrape |
|---|---|---|---|
| Trọng tâm | HTML → markdown chuẩn | RSC payload → content | Repo → local explore |
| Cơ chế | Readability + Turndown | Parse JSON chunks | git clone + code-search |
| Quan hệ | Lớp extract tổng quát | Lớp extract RSC | Lớp extract code |

## Khi nào chọn

- Content extraction hiện tại (regex) kém trên trang có nav/sidebar — cần article sạch
- Đã có web_fetch pipeline — nâng bằng Readability + Turndown
- Muốn concurrency + retry policy ổn định cho fetch
- Guard: giữ stripHiddenDom/stripInvisibleUnicode, fallback regex, ngưỡng 500 chars