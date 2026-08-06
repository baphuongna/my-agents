# Hướng CCCCC: RAG Poisoning Defense — chống tài liệu độc hại vào knowledge base

> **Nguồn gốc:** "Corpus-Dependent Poisoning Attacks and Defenses" (arXiv 2603.18034, 2026); promptfoo RAG poisoning; ACM taxonomy 9 attacks
> **Coupling:** 🟡 — tầng ingestion + retrieval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (RAG GGG sẵn; thiếu sanitize/defense)
> **Effort:** 1-2 tuần

## Nguồn gốc

RAG poisoning: **kẻ tấn công chôn nội dung độc vào knowledge base (documents, web fetch, MCP data) → thao túng câu trả lời** — stealth, khó phát hiện (promptfoo 2026: "stealth attacks... so hard to detect"); christian-schneider: RAG tạo "trust paradox" — content từ nguồn không tin cậy *được nhúng thẳng vào prompt* (bypass input sanitization); ACM (2026): taxonomy **9 loại poisoning** + 2 threat vectors mới (Content Obfuscation, Content Injection); arXiv 2603.18034: gradient-guided poisoning — **hybrid BM25 + vector retriever là architectural defense hiệu quả** (poison cần thắng 2 retriever khác nhau). Rất liên quan mya: GGG RAG + MCP fetch ngoài (QQ) + firecrawl — document/trang web độc = nguồn injection trực tiếp (unit42: indirect injection qua web content).

## Mô tả

mya defense layers: (1) **ingestion sanitize** — tài liệu/trang web vào KB: chạy detect prompt-injection marker (instruciones ẩn, dấu lệnh, từ khóa ép buộc — reddit detector 1.5B model local), chặn tài liệu "có ý đồ" hoặc đánh dấu untrusted; (2) **untrusted boundary** — content nguồn không tin (web, email, fetch ngoài) → gói "UNTRUSTED" + quy tắc: không chấp nhận lệnh từ đó (nối RRR firewall cùng triết lý); (3) **hybrid retriever** — BM25 + vector song song (arXiv 2603.18034 defense — poison khó thắng cả 2); (4) **corpus hygiene** — kiểm định nguồn (allowlist domain, last-modified chênh lệch đáng ngờ — DDDDD canary chôn trong docs phát hiện), dedup trùng (LLLL resolution); (5) **detection** — theo dõi KB mới vào → re-eval (SSSS) nếu output đổi (ZZZZ drift). Nối: RRR (firewall tổng), GGG (RAG), QQ (fetch), DDDDD (canary trong docs).

## Kiến trúc

```
  NGUỒN: web fetch (QQ) · MCP data · documents · email
        │
        ▼
  INGESTION SANITIZE: injection-marker detect (model nhỏ PPPP local)
        ├─ nghi độc ──► CHẶN / đánh dấu UNTRUSTED
        └─ sạch ──► KB (GGG)
              │
              ▼
  RETRIEVAL: HYBRID — BM25 + vector song song (arXiv 2603.18034)
        │  (poison phải thắng CẢ 2 → khó)
        ▼
  CONTEXT: untrusted content ──► nhãn UNTRUSTED ──► RRR rule (không nhận lệnh)
        │
  CORPUS HYGIENE: allowlist nguồn · canary chôn (DDDDD) · dedup (LLLL)
        │
  RE-EVAL: KB mới → SSSS/ZZZZ — output đổi → alert
```

```
mya: GGG RAG + QQ fetch SẴN — thiếu sanitize + hybrid retriever + boundary
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GGG RAG — retrieval pipeline (nơi thêm hybrid)
// ✅ QQ MCP fetch — nguồn ngoài (cần sanitize)
// ✅ RRR firewall — triết lý boundary (dùng chung rule)
// ✅ SSSS + ZZZZ — re-eval khi KB đổi
// ✅ DDDDD canary — chôn trong docs (phát hiện)
// ✅ LLLL dedup/resolution — corpus hygiene

// ❌ THIẾU: ingestion sanitize (injection marker detect)
// ❌ THIẾU: hybrid retriever (BM25 + vector)
// ❌ THIẾU: UNTRUSTED boundary label + rule
```

## Implementation

```typescript
// packages/rag/src/poison-defense.ts (NEW)
function sanitize(doc: Document, detector: LocalDetector): DocVerdict {
  const risk = detector.scan(doc.content);       // model nhỏ (PPPP)
  return risk > THRESHOLD
    ? { action: "block" }                        // chặn tài liệu độc
    : { action: "index", trust: sourceTrust(doc) }; // web → UNTRUSTED
}

function retrieveHybrid(q: string, kb: Corpus): Chunk[] {
  const bm25 = bm25TopK(q, kb);                  // lexical
  const vec = vectorTopK(q, kb);                 // semantic
  return merge(bm25, vec);                       // hybrid — arXiv 2603.18034
  // poison phải thắng CẢ 2 retriever — chi phí tấn công cao
}
// context: UNTRUSTED chunk kèm nhãn → RRR rule (không thực thi lệnh từ đó)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn tài liệu độc trước khi vào prompt (trust paradox hết) | ❌ Sanitize thêm chi phí (model nhỏ — rẻ) |
| ✅ Hybrid retriever = defense cấu trúc (2603.18034) | ❐ False positive chặn nhầm tài liệu tốt |
| ✅ UNTRUSTED boundary — web content không ra lệnh được | ❌ Poison tinh vi vẫn lọt (nhiều lớp — DDDDD bù) |
| ✅ Nối RRR + DDDDD + ZZZZ thành hệ phòng thủ | ❌ Allowlist nguồn = hạn chế linh hoạt |

## Khác các hướng gần

| | RRR Firewall | 15/16 Grounded | CCCCC: Poison Defense |
|---|---|---|---|
| Tầng | Prompt flow | Output thật | **Input KB/retrieval** |
| Cơ chế | Scan/boundary | Verify | **Sanitize + hybrid + nhãn** |
| Mối quan hệ | Đối tác | Sau cùng | **Phòng trước khi vào prompt** |

## Khi nào chọn

- Dùng nhiều nguồn ngoài (web/MCP fetch — mya có)
- KB công khai / đa nguồn (nguy cơ chôn độc)
- Đã có RAG + firewall + canary — thêm sanitize + hybrid
- Sẵn sàng đánh dấu untrusted + re-eval định kỳ