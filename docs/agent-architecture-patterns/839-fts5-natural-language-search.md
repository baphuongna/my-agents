# Hướng AFG: FTS5 Natural-Language Search — normalize câu hỏi tự nhiên thành FTS5 query: quote term, lọc stopword, operator viết hoa pass-through

> **Nguồn gốc:** pi-hermes-memory | **Coupling:** 🟢 — query translation thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn FTS5 recall + sanitizeQuery; thiếu NL normalization) | **Effort:** 1 tuần

## Nguồn gốc

**pi-hermes-memory** (src/store/fts-query.ts): **normalize câu hỏi tự nhiên thành FTS5 query**: (1) **term thường được quote riêng** cho **implicit AND** (mỗi term thành `"term"` — FTS5 nối AND mặc định — tìm câu chứa đủ các term, không phải cụm chính xác); (2) **connector stopword** (`and`/`or`/`not` — từ nối tiếng Anh trong câu tự nhiên) **bị lọc** (không biến thành operator nhầm); (3) **operator viết hoa thì pass-through** (user gõ `OR`/`AND`/`NOT` viết hoa — chủ đích dùng operator — giữ nguyên). Mục đích: **search session dễ dùng** — user gõ câu tự nhiên ("memory về cách deploy và config" → `"deploy" "config"`) vẫn tìm đúng, không cần học cú pháp FTS5.

Giá trị: (1) **UX tự nhiên** — không bắt user biết FTS5 syntax; (2) **đúng ngữ nghĩa** — `and` trong câu tự nhiên là stopword (không phải operator), `AND` viết hoa là operator — phân biệt bằng case; (3) **implicit AND qua quote** — search mọi term đều có mặt — recall chính xác hơn OR mặc định; (4) **rẻ, deterministic** — tokenize thuần, không LLM.

## Mô tả

Với mya, pattern = **NL → FTS5 translator** trên recall path: (1) mya đã có **`memory/sqlite-recall.ts`** — FTS5 MATCH search (fts_working + fts_episodes) + **sanitizeQuery** (token → quote + join OR) + **cjk-tokenizer.ts** (FTS5 CJK bigram — rolling window); (2) pattern thêm **translateNaturalQuery** — tách token, quote từng term (implicit AND), lọc stopword connector (`and/or/not` thường), **pass-through operator viết hoa** (`OR`, `AND`, `NOT` — chủ đích); (3) **nối recall** — thay/bao quanh sanitizeQuery: câu tự nhiên → normalized FTS5 query → MATCH; (4) **CJK** — tiếng Việt không dấu/từ ghép — nối cjk-tokenizer (bigram) cho ngôn ngữ không dùng space; (5) **khác sanitizeQuery hiện tại** — sanitize chống syntax lỗi (escape quote), AFG thêm lớp ngữ nghĩa (stopword + case-sensitive operator) — hai lớp bù nhau: AFG dịch nghĩa, sanitize đảm bảo an toàn cú pháp. Đây là pattern **query ergonomics**: người dùng nói ngôn ngữ của họ, hệ thống dịch sang ngôn ngữ của search engine.

## Kiến trúc (ASCII)

```
  CÂU HỎI TỰ NHIÊN ("memory về deploy và config, không phải OR tìm cả hai")
    │
    ▼ TRANSLATE (fts-query.ts)
  ├─ tách token → term thường QUOTE riêng: "deploy" "config"
  │    (implicit AND — mọi term đều phải có mặt)
  ├─ stopword connector (and/or/not thường) → LỌC (không thành operator)
  │    ("và" tiếng Việt cũng lọc nếu có — bảng stopword)
  └─ operator VIẾT HOA (OR / AND / NOT) → PASS-THROUGH (chủ đích dùng operator)
    │
    ▼ FTS5 QUERY: "deploy" "config"  (an toàn — qua sanitizeQuery)
    ▼ MATCH (sqlite-recall — FTS5 BM25 + Weibull boost)
    ▼ CJK (cjk-tokenizer — ngôn ngữ không dùng space)
  (user gõ tự nhiên vẫn tìm đúng — không cần học FTS5 syntax)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/sqlite-recall.ts — FTS5 MATCH + sanitizeQuery (quote + escape)
//   (lớp an toàn cú pháp — nền)
// ✅ packages/memory/src/cjk-tokenizer.ts — FTS5 CJK bigram (rolling window)
//   (ngôn ngữ không dùng space — tiếng Việt/Trung/Nhật/Hàn)
// ✅ packages/memory/src/retrieve.ts — dual FTS5 + proximity rerank + fuzzy correct
// ✅ packages/memory/src/weibull.ts — decay boost (rank sau MATCH)
// ✅ packages/memory/src/ragfs.ts — context FS (search surface)

// ❌ THIẾU: NL translator (quote term + implicit AND)
// ❌ THIẾU: stopword connector lọc (and/or/not thường — không thành operator)
// ❌ THIẾU: operator viết hoa pass-through (OR/AND/NOT chủ đích)
```

## Implementation

```typescript
// packages/memory/src/fts-query.ts (NEW)
const CONNECTOR_STOPWORDS = new Set(["and", "or", "not", "the", "a", "an", "about", "for"]);
const OPERATORS = new Set(["AND", "OR", "NOT"]);   // viết hoa = chủ đích

/**
 * Normalize câu hỏi tự nhiên → FTS5 query.
 * - term thường: quote riêng → implicit AND (mọi term đều có mặt)
 * - stopword connector (and/or/not thường): lọc — không thành operator nhầm
 * - operator viết hoa (OR/AND/NOT): pass-through — user chủ đích
 */
export function translateNaturalQuery(query: string): string {
  const tokens = query.trim().split(/\s+/);
  const parts: string[] = [];

  for (const tok of tokens) {
    const upper = tok.toUpperCase();
    if (OPERATORS.has(upper)) {          // "OR" viết hoa → giữ operator
      parts.push(upper);
      continue;
    }
    const lower = tok.toLowerCase();
    if (CONNECTOR_STOPWORDS.has(lower)) continue;   // "and/or/not" thường → lọc
    parts.push(`"${tok.replace(/"/g, '""')}"`);     // quote riêng → implicit AND
  }
  return parts.join(" ");
}

/** Nối recall: câu tự nhiên → translated → sanitize (an toàn cú pháp) → MATCH. */
export function naturalLanguageMatch(db: SqliteDatabase, query: string): MemoryHit[] {
  const translated = translateNaturalQuery(query);
  const safe = sanitizeQuery(translated);     // lớp an toàn — escape quote, chặn syntax lỗi
  return recallFts(db, safe);                 // sqlite-recall MATCH path
}
// CJK: query có ký tự CJK → cjk-tokenizer bigram trước (đã có)
// Hai lớp bù nhau: AFG dịch nghĩa (stopword/case) + sanitize đảm bảo an toàn cú pháp
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User gõ tự nhiên — không cần học FTS5 syntax | ❌ Stopword lọc nhầm term quan trọng ("for" là keyword) |
| ✅ Phân biệt bằng case — `and` vs `AND` đúng nghĩa | ❌ Operator viết thường bị lọc — user quen gõ `or` mất operator |
| ✅ Implicit AND — recall chính xác hơn OR mặc định | ❌ Câu hỏi dài → nhiều term → ít hit (cần rerank) |
| ✅ Deterministic, rẻ — tokenize thuần không LLM | ❌ Tiếng Việt không dấu/không space cần cjk-tokenizer nối chuẩn |

## Khác các hướng gần

| | AFG FTS5 NL Search | AET Test Parser | ADQ Rewrite Registry |
|---|---|---|---|
| Trọng tâm | Dịch câu tự nhiên → query | Parse kết quả test | Quyết định rewrite |
| Cơ chế | Quote + stopword + case | Regex theo runner | 3 đường quyết định |
| Quan hệ | Đầu vào recall (memory) | Khác miền (eval) | Khác miền (output) |

## Khi nào chọn

- User tìm memory bằng câu tự nhiên — không muốn học cú pháp FTS5
- Đã có sqlite-recall (FTS5) + sanitizeQuery — thêm NL translator
- Muốn implicit AND (đủ term) thay vì OR mặc định — recall chính xác
- Cần phân biệt operator chủ đích (viết hoa) với từ nối thường (stopword)