# Hướng VD: Source Blacklist Policy — liệt kê blacklist nguồn + weight table, chỉ nhận filtered sources

> **Nguồn gốc:** nuwa-skill (source blacklist); "blacklist unreliable sources"; "Zhihu/WeChat/Baidu Baike filtered"; "source weight table"; "only accept evidence from filtered sources" | **Coupling:** 🟢 — thêm source filter + weight table vào retrieval/answer stage | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (RAG retrieval sẵn — chưa có source blacklist + weight table) | **Effort:** 2-3 tuần

## Nguồn gốc

**nuwa-skill** quan niệm rằng retrieve chứng cứ thì **nguồn phải đáng tin**. Tổ chức **blacklist** các nguồn **không đáng tin** (UGC không kiểm duyệt: Zhihu answers, WeChat articles, Baidu Baike) và **weight table** cho nguồn còn lại (academic > official-doc > reputable-news > blog). Pipeline chỉ **chấp nhận filtered sources** — blacklist bị loại trước khi vào evidence, còn lại được xếp hạng weight. Nguyên tắc: **chứng cứ từ nguồn xấu = không chứng cứ** — lọc nguồn trước, rồi mới trust. Khác **general web search** (tin mọi kết quả) — VD **pre-filter + weight**; khác TF-IDF rerank — VD rerank theo **domain trust**, không chỉ relevance.

## Mô tả

mya source blacklist policy: (1) **Blacklist**: cấu hình danh sách domain/nguồn cấm (regex/domain match). (2) **Weight table**: map domain → trọng số trust (0–1). (3) **Filter**: retrieval trả raw results → **loại blacklist** → **annotate weight** mỗi kết quả. (4) **Threshold**: chỉ nhận kết quả weight ≥ threshold (vd 0.5) làm evidence. (5) **Transparency**: answer liệt kê source + weight (user thấy trust-level). mya có RAG — VD thêm **blacklist filter** + **weight annotator** + **threshold gate**.

## Kiến trúc

```
  RETRIEVAL RAW RESULTS (sau query):
    ① pdg.lbl.gov           (academic)
    ② zhihu.com/question/..  (UGC — BLACKLIST)
    ③ baike.baidu.com/..     (wiki-UGC — BLACKLIST)
    ④ nature.com/articles    (journal)
    ⑤ medium.com/@someone    (blog — low weight)
        │ (filter + weight)
        ▼
  ┌─── BLACKLIST FILTER ──────────────────────────────────┐
  │  ✗ ② zhihu.com        → DROP (blacklist)              │
  │  ✗ ③ baike.baidu.com  → DROP (blacklist)              │
  └───────────────────────┬─────────────────────────────┘
                          │ (weight annotate)
                          ▼
  ┌─── WEIGHT TABLE + THRESHOLD ──────────────────────────┐
  │  ① pdg.lbl.gov      weight 0.95 (academic) ≥ 0.5 ✓    │
  │  ④ nature.com       weight 0.90 (journal)  ≥ 0.5 ✓    │
  │  ⑤ medium.com       weight 0.30 (blog)     < 0.5 ✗    │
  │  → CHỈ NHẬN ① ④ làm evidence                            │
  └───────────────────────┬─────────────────────────────┘
                          │ (grounded answer + weight)
                          ▼
  ┌─── TRANSPARENT ANSWER ────────────────────────────────┐
  │  "...[PDG 0.95][Nature 0.90]"  → user thấy trust-level│
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools search + GE agentic-RAG — retrieval (nền — VD filter raw results)
// ✅ 574 persona-agentic — evidence stage (relate — VD = source filter cho evidence)
// ✅ 525 graph-edge-provenance — trust rank (relate — VD = source-level trust)

// ❌ THIẾU: blacklist config (domain/pattern cấm)
// ❌ THIẾU: weight table (domain → trust 0–1)
// ❌ THIẾU: filter + threshold gate (weight ≥ threshold)
// ❌ THIẾU: transparency annotate (answer kèm weight)
```

## Implementation

```typescript
// packages/agent/src/source-blacklist.ts (MỚI)
const BLACKLIST = [
  /zhihu\.com/i, /baike\.baidu\.com/i, /mp\.weixin\.qq\.com/i, /baijiahao\.baidu\.com/i,
];
const WEIGHT: Array<[RegExp, number]> = [
  [/\.(gov|edu)\//i, 0.95],            // chính phủ / giáo dục
  [/(nature|science|arxiv|pubmed)/i, 0.90], // journal
  [/reuters|bbc|nytimes/i, 0.70],      // reputable news
  [/medium\.com|dev\.to/i, 0.30],      // blog
];

interface ScoredSource { url: string; snippet: string; weight: number }

class SourceBlacklistPolicy {
  constructor(private threshold: number) {}

  private weightOf(url: string): number {
    for (const [re, w] of WEIGHT) if (re.test(url)) return w;
    return 0.40; // default unknown
  }

  // filter blacklist + annotate weight + threshold gate
  filter(raw: Array<{ url: string; snippet: string }>): ScoredSource[] {
    return raw
      .filter(r => !BLACKLIST.some(re => re.test(r.url)))   // drop blacklist
      .map(r => ({ ...r, weight: this.weightOf(r.url) }))
      .filter(s => s.weight >= this.threshold);              // threshold gate
  }
}

// Usage:
// const raw = await rag.query(q);
// const evidence = policy.filter(raw);   // chỉ trusted sources
// answer grounded trên evidence + annotate "[url weight]"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chứng cứ đáng tin (loại nguồn UGC xấu) | ❌ Blacklist trì trệ (source mới chưa cover) |
| ✅ Weight table (tinh chỉnh trust) | ❌ Weight chủ quan (calibration khó) |
| ✅ Threshold gate (chỉ nhận đủ trust) | ❌ Over-filter (loại nhầm source tốt) |
| ✅ Transparency (user thấy trust-level) | ❌ Domain match brittle (URL đổi dạng) |

## Khác các hướng gần

| | General web search | TF-IDF rerank | VD: Source-Blacklist |
|---|---|---|---|
| Lọc | ❌ | Relevance | **Domain trust (blacklist + weight)** |
| Nguồn xấu | ❌ (accept) | ❌ | **✅ drop** |
| Transparency | ❌ | ❌ | **✅ weight annotate** |

## Khi nào chọn

- Retrieval có nhiều nguồn UGC không tin cậy (web, social)
- Muốn evidence chỉ từ nguồn academic/official
- Cần transparency (user thấy trust-level mỗi source)
- Nối packages/tools search (GE agentic-RAG) + 574 persona-agentic (evidence stage) + 525 graph-edge-provenance (trust rank); guard blacklist freshness (cập nhật nguồn mới), weight calibration (hợp lý, không chủ quan), và fallback (threshold quá cao → thiếu evidence → refuse thay vì nhận source kém); VD = source blacklist policy, kết hợp 575 honest-boundary (khai báo nguồn không đáng tin) + 574 persona-agentic (filtered sources vào evidence gate)
