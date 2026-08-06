# Hướng QX: Context Citation Attribution — Codex citation rollout-id, Warp citations khi dùng context ngoài

> **Nguồn gốc:** Leaks Codex (`<oai-mem-citation>`, rollout_ids); Leaks Warp 2.0 (`<citations>` XML khi dùng external context); "memory citation requirements"; "attribute external context"; "citation_entries + rollout_ids"; "provenance for context-derived answers"
> **Coupling:** 🟢 — thêm citation-extractor layer ở cuối agent reply (parse context dùng → emit citation block)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory + trajectory sẵn — chưa có citation attribution + provenance tracking)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Codex** yêu cầu **memory citation**: nếu agent dùng bất kỳ memory file nào → **phải** append `<oai-mem-citation>` block **ở cuối reply** với `citation_entries` (file:line + note cách dùng) và `rollout_ids` (ID session nguồn). **Leaks Warp 2.0** tương tự: nếu dùng **external context OR user rules** → **phải** include `<citations>` XML cuối reply (`document_type` + `document_id`). Nguyên tắc: **provenance** — người đọc biết câu trả lời dựa trên nguồn nào, có thể verify/truy nguồn. **Attribution bắt buộc** khi context ngoài (memory/rule/doc) → câu trả lời. Khác **082 memory-consolidation** (lưu) — QX là **cite khi dùng**; khác **084 llm-as-judge** — QX là **provenance tag**.

## Mô tả

mya context citation attribution: (1) **Track provenance**: mỗi context source (memory file, rule doc, external URL) agent load → gắn tag source-id (file:line, rollout-id, doc-id). (2) **Citation extractor**: khi agent sinh reply dựa trên context có provenance → **tự động** (hoặc nhắc agent) emit citation block. (3) **Format**: `<citation><source>MEMORY.md:234-236</source><note>weekly report format</note></citation>` hoặc Codex-style `citation_entries` + `rollout_ids`. (4) **Position**: cuối reply (programmatic parsing). (5) **Enforce**: nếu detect context dùng nhưng thiếu citation → cảnh báo. mya có `packages/memory` + trajectory — QX thêm **provenance tracker** (context → source-id) + **citation extractor** (reply → citation block) + **enforce check**.

## Kiến trúc

```
  AGENT load context (provenance tracked):
  ┌─────────────────────────────────────────────────────┐
  │  MEMORY.md:234  ← "weekly report format: 3 cols"     │ (source-id: mem:234)
  │  rollout 019c6e ← "prior run: deploy steps"          │ (source-id: roll:019c6e)
  │  rule CLAUDE.md ← "use vitest"                       │ (source-id: rule:claude)
  └───────────────────────┬─────────────────────────────┘
                          │ agent generates reply USING these
                          ▼
  ┌─── CITATION EXTRACTOR ──────────────────────────────┐
  │  reply references: weekly format (mem:234),          │
  │                     deploy steps (roll:019c6e)        │
  │  → detect which sources used                         │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── EMIT CITATION BLOCK (cuối reply) ────────────────┐
  │  <oai-mem-citation>                                  │
  │  <citation_entries>                                  │
  │  MEMORY.md:234-236|note=[weekly report format]       │
  │  rollout_summaries/...md:10-12|note=[deploy steps]   │
  │  </citation_entries>                                 │
  │  <rollout_ids>019c6e27-...</rollout_ids>             │
  │  </oai-mem-citation>                                 │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — memory store (nền — QX cite memory source)
// ✅ trajectory / rollout-id — session id (nền — QX cite rollout_ids)
// ✅ 082 memory-consolidation — snapshot (nền — QX = cite when used)

// ❌ THIẾU: provenance tracker (context source → source-id tag)
// ❌ THIẾU: citation extractor (reply content → which sources used)
// ❌ THIẾU: citation block emitter (format + append cuối reply)
// ❌ THIẾU: enforce check (context used but no citation → warn)
```

## Implementation

```typescript
// packages/agent/src/citation-attribution.ts (MỚI)
interface Provenance { sourceId: string; file?: string; lines?: [number, number]; note: string }

class CitationAttribution {
  private loaded = new Map<string, Provenance>(); // source → provenance

  // tag context when loaded (call from memory/rule loader)
  tagContext(source: string, p: Provenance): void { this.loaded.set(source, p); }

  // extract citation from reply (which sources referenced)
  extract(reply: string, referencedSources: string[]): Provenance[] {
    return referencedSources
      .map(s => this.loaded.get(s))
      .filter((p): p is Provenance => !!p);
  }

  // emit citation block (Codex-style)
  emitBlock(provenances: Provenance[], rolloutIds: string[]): string {
    if (provenances.length === 0) return '';
    const entries = provenances
      .map(p => `${p.file}:${p.lines?.[0]}-${p.lines?.[1]}|note=[${p.note}]`)
      .join('\n');
    const ids = rolloutIds.join('\n');
    return `<oai-mem-citation>\n<citation_entries>\n${entries}\n</citation_entries>\n<rollout_ids>\n${ids}\n</rollout_ids>\n</oai-mem-citation>`;
  }

  // Warp-style (when external context/rules used)
  emitWarp(docs: { type: string; id: string }[]): string {
    if (docs.length === 0) return '';
    const entries = docs.map(d =>
      `  <citation><document_type>${d.type}</document_type><document_id>${d.id}</document_id></citation>`).join('\n');
    return `<citations>\n${entries}\n</citations>`;
  }
}

// Usage:
// citation.tagContext('mem-234', { sourceId: 'mem-234', file: 'MEMORY.md', lines: [234,236], note: 'weekly format' });
// const used = citation.extract(reply, ['mem-234']);
// reply += '\n' + citation.emitBlock(used, [rolloutId]);  // append cuối reply
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Provenance (người đọc biết nguồn, verify được) | ❌ Citation sai (cite source không dùng / quên cite) |
| ✅ Truy nguồn memory (rollout-id → session cũ) | ❌ Overhead (extract + emit mỗi reply) |
| ✅ Trust (context-derived answer có attribution) | ❌ Format parse phức tạp (Codex vs Warp khác nhau) |
| ✅ Enforce (missing citation → warn) | ❌ Citation bloat (nhiều source → reply dài) |

## Khác các hướng gần

| | 082 Memory-Consolidation | 084 LLM-as-Judge | QX: Citation-Attribution |
|---|---|---|---|
| Cái gì | Lưu memory | Chấm điểm | **Cite nguồn khi dùng** |
| Khi | Cuối task | Đánh giá | **Mỗi reply dùng context ngoài** |
| Output | Snapshot | Score | **citation_entries + rollout_ids** |

## Khi nào chọn

- Agent dùng memory/external-context thường (provenance quan trọng)
- Muốn người đọc verify nguồn (citation truy được)
- Compliance (attribution bắt buộc — Codex/Warp enforce)
- Nối packages/memory (source) + trajectory (rollout-id) + 082 consolidation; guard citation accuracy (chỉ cite source thực dùng) + format (Codex-style hoặc Warp-style) + enforce (missing citation → warn); citation cuối reply cho programmatic parsing
