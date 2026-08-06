# Hướng AM: Cache Layer — tool-result cache, semantic cache, prompt cache

> **Nguồn gốc:** Caching classic (CPU → memcached, 2003); LLM prompt caching (Anthropic 2024)
> **Coupling:** 🟢 — transparent, nằm giữa mya ↔ provider/tools
> **Agent-agnostic:** ✅ — agents không cần biết có cache
> **Code sẵn:** ⚠️ (1 phần — prompt 3-tier cache-stable, FuzzyCache; thiếu tool-result/semantic cache)
> **Effort:** 1 tuần

## Nguồn gốc

Nguyên lý cache cổ điển: kết quả tính toán lặp lại không cần tính lại. Với LLM agents có 3 lớp cache riêng biệt:
1. **Prompt cache** — provider-level: cùng prefix byte-identical → trả rẻ hơn, nhanh hơn (Anthropic/OpenAI tự làm).
2. **Tool-result cache** — tool gọi cùng args trên cùng input (file/schema không đổi) → trả về ngay, không cần gọi tool.
3. **Semantic cache** — câu hỏi tương tự ngữ nghĩa → trả câu trả lời cũ đã verify (dùng embeddings).

## Mô tả

mya chặn 2 chiều: trước khi gọi **provider** → kiểm tra prompt cache prefix (byte-faithful giúp hit rate cao); trước khi gọi **tool** → hash args + hash input file → nếu hit, replay kết quả. Nhận định trước đây "nửa chi phí runtime là overhead tất định" — chính là chỗ cache cắt: cùng query SQLite/AST chạy lại nhiều lần trong cùng phiên làm việc.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                       CACHE LAYER (mya)                     │
│                                                            │
│  agent ── prompt ──► ┌──────────────┐ ──► provider          │
│                      │ PromptCache  │     (byte-identical   │
│                      │ (prefix, P6) │      prefix → hit)    │
│                      └──────────────┘                      │
│                                                            │
│  agent ── tool ────► ┌──────────────────┐ ──► tool          │
│                      │ ToolResultCache  │                   │
│                      │ key: tool+arg    │                   │
│                      │ hash + inputHash │                   │
│                      └──────────────────┘                   │
│                                                            │
│  agent ── hỏi ────► ┌─────────────────┐ ──► LLM answer      │
│   câu quen          │ SemanticCache    │                    │
│                      │ embedding       │                    │
│                      │ cosine > 0.95   │                    │
│                      └─────────────────┘                    │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts/src/assembler.ts — 3-tier cache-stable prompt (§5)
//    stable tier byte-identical giữa các turns → provider prompt-cache hit.
// ✅ packages/prompts/src/request-context.ts — P6: không thay đổi → trả về
//    ĐÚNG object reference (out === input) để cache-control thấy byte-identical.
// ✅ packages/memory/src/retrieve.ts — FuzzyCache (LRU 256) cho fuzzy correction.
// ✅ packages/memory/src/brain-sqlite-store.ts — write-through cache (hydrate từ SQLite).
// ✅ packages/memory/src/domains — ToolsDomain bounded LRU cache (500).

// ❌ THIẾU: ToolResultCache (hash args + input → replay) — lớp cắt cost lớn nhất.
// ❌ THIẾU: SemanticCache cho câu hỏi lặp lại (retrieval answers).
```

## Implementation

```typescript
// packages/gateway/src/tool-cache.ts (NEW)
import { createHash } from "node:crypto";

class ToolResultCache {
  private store = new Map<string, { result: string; fileHashes: Map<string, string> }>();
  constructor(private maxSize = 256) {}

  key(tool: string, args: unknown, inputs: Map<string, string>): string {
    const h = createHash("sha256");
    h.update(tool).update(JSON.stringify(args));
    for (const [path, content] of inputs) h.update(path).update(content);
    return h.digest("hex");
  }

  async run<T>(
    tool: string,
    args: Record<string, unknown>,
    inputs: () => Promise<Map<string, string>>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const fileHashes = await inputs();
    const k = this.key(tool, args, fileHashes);
    const hit = this.store.get(k);

    // Hit: input files không đổi mới replay
    if (hit && this.sameHashes(hit.fileHashes, fileHashes)) {
      log(`[cache] HIT ${tool}`);
      return JSON.parse(hit.result) as T;
    }

    const result = await fn();
    this.store.set(k, { result: JSON.stringify(result), fileHashes });
    if (this.store.size > this.maxSize) {
      this.store.delete(this.store.keys().next().value!);  // LRU đơn giản
    }
    return result;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cắt cost lớn nhất (tool result lặp lại) | ❌ Stale result nếu invalidation thiếu (file hash) |
| ✅ Giảm latency (hit = ms thay vì giây) | ❌ Hash thêm overhead nhỏ mỗi call |
| ✅ Prompt cache-stable đã có sẵn | ❌ Semantic cache rủi ro câu trả lời sai ngữ cảnh |
| ✅ Transparent — agents không cần biết | ❌ Memory footprint (giới hạn LRU) |
| ✅ Không cần thay đổi core | |

## Khi nào chọn

- Tool calls lặp lại (đọc file, query SQLite, AST scan cùng input)
- Muốn cắt cost provider (prompt-cache hit + replay tool result)
- Retry/re-run task sau crash (cache còn nóng)
- Đã có 3-tier cache-stable prompt — chỉ cần thêm tầng tool cache
