# Hướng MU: Content-Type-Aware Compression — router chọn compressor theo loại nội dung

> **Nguồn gốc:** LLMLingua / LongLLMLingua (prompt compression); "content-aware compression"; JSON minify; AST pruning; prose summarization; "selective token reduction"; gzip for structured data; "reader model" compression
> **Coupling:** 🟡 — thêm content-type router + per-type compressors vào context pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (100 prompt-compression + 218 tool-output-compression sẵn — chưa có content-type router)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**LLMLingua / LongLLMLingua** (Microsoft): nén prompt bằng cách bỏ token entropy thấp. Nhưng **1 compressor cho mọi loại nội dung là tối ưu phụ**: **JSON** nén tốt nhất bằng minify (bỏ whitespace, key rút gọn), **AST/code** nén tốt nhất bằng tree pruning (bỏ import/body không dùng), **prose** nén tốt nhất bằng summarization/extractive. Nguyên tắc **content-aware**: phát hiện loại nội dung → chọn compressor chuyên dụng → tỷ lệ nén cao hơn mà không mất ngữ nghĩa. Khác **100 CV prompt-compression** (1 compressor toàn cục, dựa entropy) — MU **router theo content-type**; khác **218 HJ tool-output-compression** (chỉ output tool) — MU tổng quát mọi block context.

## Mô tả

mya content-type-aware compression: mỗi block trong context window được **phân loại** (JSON / AST / prose / log / diff) → **router** chọn compressor chuyên dụng. JSON → minify + key shortening; AST → prune unused branches + comment strip; prose → extractive summarization (giữ câu điểm số cao); log/diff → deterministic reducer (365 NA). Kết quả: tỷ lệ nén cao hơn compressor đơn nhất vì mỗi loại được đối xử theo đặc tính riêng. Nối 100 CV (entropy compressor cho phần prose) — MU là **meta-layer** quyết định *compressor nào* cho *block nào*.

## Kiến trúc

```
  CONTEXT WINDOW (các block)
   ┌──────────┬──────────┬──────────┬──────────┐
   │ JSON     │ code/AST │ prose    │ git log  │
   │ package  │ src.ts   │ README   │ history  │
   └────┬─────┴────┬─────┴────┬─────┴────┬─────┘
        │          │          │          │
        ▼          ▼          ▼          ▼
   ┌─── CONTENT-TYPE ROUTER ──────────────────────┐
   │ detect: JSON.parse ok? → JSON                │
   │         tree-sitter parse? → AST             │
   │         sentences? → prose                   │
   │         command output? → log                │
   └──┬───────┬───────────┬───────────┬───────────┘
      ▼       ▼           ▼           ▼
   minify   prune      extractive   reducer
   JSON     AST        summarize    (365 NA)
      │       │           │           │
      └───────┴─────┬─────┴───────────┘
                    ▼
        COMPRESSED CONTEXT (≈ 3-5× nhỏ hơn)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 100 CV prompt-compression — entropy compressor (nền — MU router cho prose)
// ✅ 218 HJ tool-output-compression — tool output (nền — MU tổng quát)
// ✅ 121 DQ long-context-management — context budget (nền)
// ✅ 250 IP context-prefetching — load block (input cho MU)

// ❌ THIẾU: content-type detector (JSON/AST/prose/log classifier)
// ❌ THIẾU: per-type compressor registry (minify/prune/summarize/reduce)
// ❌ THIẾU: budget-aware router (ưu tiên nén block lớn nhất trước)
```

## Implementation

```typescript
// packages/agent/src/content-compress.ts (NEW)
type ContentType = 'json' | 'ast' | 'prose' | 'log' | 'diff';

interface Compressor {
  type: ContentType;
  compress(input: string): string;
}

class ContentTypeCompressor {
  constructor(private compressors: Map<ContentType, Compressor>) {}

  compressBlock(block: string): string {
    const type = this.detect(block);
    const c = this.compressors.get(type);
    return c ? c.compress(block) : block; // unknown → không chạm
  }

  compressContext(blocks: string[]): string {
    return blocks
      .map(b => this.compressBlock(b))
      .join('\n');
  }

  private detect(text: string): ContentType {
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { JSON.parse(t); return 'json'; } catch { /* fallthrough */ }
    }
    if (/^(function|class|import|const|export)\b/m.test(t) || t.includes('```')) return 'ast';
    if (/^commit |^diff --git|^Author:/m.test(t)) return 'diff';
    if (/^\$ |npm|docker|error:/i.test(t)) return 'log';
    return 'prose';
  }
}

// VD compressors:
// json:  JSON.stringify(JSON.parse(t)) + rút key
// ast:   tree-sitter parse → bỏ comment/unused import
// prose: extractive — giữ N câu điểm số cao nhất (100 CV)
// log:   reducer chuyên git/npm (365 NA)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tỷ lệ nén cao hơn (per-type tối ưu) | ❌ Detect sai type → compressor sai (hỏng JSON) |
| ✅ Không mất ngữ nghĩa (mỗi type giữ info cần) | ❌ Overhead parse/detect mỗi block |
| ✅ Composable — thêm compressor mới dễ | ❌ AST compressor cần tree-sitter grammar |
| ✅ Nối 100 CV (prose) + 218 HJ (tool) | ❌ Debug khó (xem context đã nén) |

## Khác các hướng gần

| | 100 Prompt Compression | 218 Tool-Output Compression | 365 Command Reducers | MU: Content-Type-Aware |
|---|---|---|---|---|
| Cái gì | Entropy toàn cục | Tool output | Per-lệnh | **Router theo content-type** |
| JSON minify | ❌ | ❌ | ❌ | ✅ |
| AST prune | ❌ | ❌ | ❌ | ✅ |
| Prose summarize | ✅ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Context có nhiều loại nội dung lẫn (JSON + code + prose + log)
- Muốn tỷ lệ nén cao nhất (compressor đơn nhất không đủ)
- Có tree-sitter / JSON parser sẵn
- Kết hợp 100 CV (entropy fallback cho prose) + 218 HJ (tool) + 365 NA (log); guard detect sai bằng round-trip check (parse lại sau nén)
