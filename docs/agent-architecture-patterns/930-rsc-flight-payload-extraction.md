# Hướng AIT: RSC Flight Payload Extraction — Next.js RSC pages parse nội dung từ `self.__next_f.push([...])` JSON chunks trong `<script>` thay vì render JavaScript

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟢 — extractor thuần cho web tool | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (web_fetch HTML→markdown; chưa parse RSC flight) | **Effort:** 1 tuần

## Nguồn gốc

**pi-web-access** extract nội dung từ **Next.js RSC (React Server Components) pages** bằng cách **parse flight payload** — nội dung nằm trong `self.__next_f.push([...])` JSON chunks trong `<script>` — **thay vì render JavaScript**. Lý do: RSC trang là HTML shell + script (client JS không chạy trong trình duyệt headless đơn giản, và render JS tốn tài nguyên); flight payload chứa **serialized server-rendered nội dung** — parse JSON chunks lấy được **title + content sạch** trực tiếp.

Nguyên tắc: **RSC flight payload là nguồn nội dung chuẩn** (server đã render — parse JSON an toàn, deterministic); render JavaScript là lớp không cần thiết (chậm, fragile với JS runtime); **chunk parser phải handle cả string escape + JSON nesting** (flight payload là mảng push các string chunk).

## Mô tả

Với mya, pattern = **RSC extractor trong web pipeline**: (1) **web_fetch (fetch.ts)** nhận HTML RSC trang → detect `self.__next_f.push` pattern; (2) **rsc-extract helper mới** — parse từng `self.__next_f.push([...])` chunk: cắt chuỗi, decode escape (chuỗi flight có `\\"` double-escape), JSON.parse từng chunk; (3) **trích title + text content** từ payload đã parse (chunk chứa `title` metadata + text segments); (4) **fallback** — không phải RSC (không có `__next_f`) → pipeline HTML→markdown hiện tại (htmlToMarkdown regex-based); (5) nối **security guard + hidden DOM strip** — RSC extract cũng phải qua `stripInvisibleUnicode` (nội dung flight có thể chứa ẩn injection). Đây là **content extraction cho agent**: agent nhận nội dung thật, không phải script tag.

## Kiến trúc (ASCII)

```
  RSC PAGE (Next.js HTML)
    │  <script>self.__next_f.push([...])</script> × N
    ▼
  RSC EXTRACTOR
    ├─ detect "self.__next_f.push("
    ├─ cắt từng chunk string (handle escape \\")
    ├─ JSON.parse payload (server-rendered serialized content)
    └─ trích title + text content
    │
    ▼  CONTENT SẠCH (không render JS, không script)
    ▼  security: stripInvisibleUnicode + hidden-DOM strip (nối web_fetch)
  ── không phải RSC? ──► htmlToMarkdown (pipeline hiện tại — fallback)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools web/fetch.ts — webFetch: HTML→markdown (htmlToMarkdown regex)
// ✅ packages/tools web/fetch.ts — stripHiddenDom + stripInvisibleUnicode
//   (anti prompt-injection — RSC extract cũng phải qua)
// ✅ packages/tools web/fetch.ts — title extraction (extractTitle)
// ✅ packages/tools web/fetch.ts — DEFAULT_MAX_CHARS truncation
// ✅ packages/tools web/search — web_extract (backend chain → web_fetch floor)

// ❌ THIẾU: RSC flight payload parser (self.__next_f.push chunks)
// ❌ THIẾU: chunk decode escape (double-escape string flight)
// ❌ THIẾU: RSC path trong webFetch pipeline (trước htmlToMarkdown)
```

## Implementation

```typescript
// packages/tools/src/web/rsc-extract.ts (NEW)
/** Parse RSC flight payload chunks từ HTML — self.__next_f.push([...]). */
export function extractRscContent(html: string): { title: string; text: string } | null {
  const out: string[] = [];
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)/g;
  let m: RegExpExecArray | null;
  let title = "";
  while ((m = re.exec(html)) !== null) {
    try {
      // Chunk có thể là JSON array — parse từng phần tử.
      const chunk = JSON.parse(m[1]!) as unknown[];
      for (const part of chunk) {
        if (typeof part !== "string") continue;
        // Flight string double-escape — decode trước khi dùng.
        const decoded = part.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        // Chuỗi chứa title metadata hoặc text content.
        if (!title) {
          const tm = /"title":"([^"]+)"/.exec(decoded);
          if (tm) title = tm[1]!;
        }
        // Text segments — bỏ script/style metadata JSON noise.
        if (/^[^"{}\[\]]{4,}$/.test(decoded.trim()) && !decoded.startsWith("$")) {
          out.push(decoded.trim());
        }
      }
    } catch { /* chunk lỗi — bỏ qua, tiếp tục chunk khác */ }
  }
  if (out.length === 0 && !title) return null;   // không phải RSC → fallback
  return { title, text: out.join("\n\n") };
}
// webFetch pipeline: nếu html chứa "__next_f" → extractRscContent trước;
// nếu null → htmlToMarkdown (fallback cũ). Output luôn qua stripInvisibleUnicode.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nội dung thật không cần render JS — nhanh + deterministic | ❌ Chỉ áp cho RSC (Next.js) — trang SSR khác không lợi |
| ✅ Title + content sạch từ server payload | ❌ Flight format thay đổi theo phiên bản Next.js (parser fragile) |
| ✅ Không tốn headless browser | ❌ Chunk lỗi bị bỏ — có thể mất phần nội dung |
| ✅ Nối security guard có sẵn | ❌ Double-escape decode phức tạp — test kỹ edge case |

## Khác các hướng gần

| | AIT RSC Extraction | AIW Readability Pipeline | AIU Video Extraction |
|---|---|---|---|
| Trọng tâm | Next.js RSC flight payload | HTML → markdown chuẩn | Video → context có cấu trúc |
| Cơ chế | Parse JSON chunks | Readability + Turndown | ffmpeg/yt-dlp frames |
| Quan hệ | Lớp extract cho RSC | Lớp extract tổng quát | Lớp extract đa phương tiện |

## Khi nào chọn

- Thường xuyên gặp Next.js pages (docs/site hiện đại) — nội dung trong flight payload
- Muốn extract nhanh, không render JS, deterministic
- Đã có web_fetch pipeline — thêm RSC path trước fallback
- Guard: parser fail → fallback htmlToMarkdown; luôn stripInvisibleUnicode sau extract