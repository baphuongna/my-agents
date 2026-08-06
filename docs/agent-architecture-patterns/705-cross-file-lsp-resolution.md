# Hướng AAC: Cross-File LSP Resolution — wiring LSP type-aware call resolution xuyên file bằng shared type registry + hash-table

> **Nguồn gốc:** codebase-memory-mcp (docs/CROSS_FILE_ARCHITECTURE.md) | **Coupling:** 🟡 — thêm type registry vào lsp-client/lsp-cascade | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có lsp-client + codegraph — chưa có type registry xuyên file) | **Effort:** 2-3 tuần

## Nguồn gốc

**codebase-memory-mcp** wiring **LSP type-aware call resolution xuyên file** (TS/JS/Go/C/C++) bằng **shared type registry** + **hash-table**. Thay vì rebuild registry từng file (tốn), mỗi file đóng góp type/symbol vào registry dùng chung; resolution tra hash-table O(1). Mục tiêu: giữ overhead **dưới +10% thời gian indexing** so với index không có cross-file resolution. Nguyên tắc: **type registry dùng chung + hash lookup** — một file `foo.ts` gọi hàm định nghĩa ở `bar.ts` vẫn resolve được type mà không cần parse lại `bar.ts`.

## Mô tả

mya cross-file LSP resolution: packages/tools đã có lsp-client.ts (hover/definition/references), symbol-extractor.ts (per-file), graph-store.ts + reference-graph.ts (byName index). AAC thêm **shared type registry**: khi index mỗi file, đăng ký `{ symbolId → typeSignature }` vào registry dùng chung (hash-table theo canonical name). LSP resolution tra registry trước — hit thì không cần gọi LSP server hay parse lại file khác; miss mới fallback xuống LSP/definition. Đo overhead: so sánh thời gian index với/không có registry — phải ≤ +10%.

## Kiến trúc

```
  FILE A (src/a.ts)          FILE B (src/b.ts)
        │                          │
        ▼                          ▼
  ┌─── SYMBOL EXTRACTION ───────────────────────────────┐
  │  extractSymbols(a) → {foo}     extractSymbols(b) → {bar}
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── SHARED TYPE REGISTRY (hash-table) ───────────────┐
  │  canonicalName → { symbolId, file, typeSignature }   │
  │    "foo" → { id:"a#foo",  file:"src/a.ts", … }       │
  │    "bar" → { id:"b#bar",  file:"src/b.ts", … }       │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── CROSS-FILE RESOLUTION ──────────────────────────┐
  │  resolveCall("foo", from b.ts):                     │
  │   registry.get("foo") → HIT (O(1)) → typeSignature │
  │   MISS → fallback LSP definition (chậm, hiếm)       │
  │  Overhead đo: index_time_with ≤ index_time × 1.10   │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools symbol-extractor.ts — per-file symbol extraction (nền)
// ✅ packages/tools graph-store.ts — byName index (Set<symbolId>) (nền hash-table)
// ✅ packages/tools reference-graph.ts — findDefinitions/findReferences
// ✅ packages/tools lsp-client.ts — hover/definition/references (fallback)
// ✅ packages/tools lsp-cascade.ts — BFS import graph + diagnostics

// ❌ THIẾU: shared type registry (canonicalName → typeSignature)
// ❌ THIẾU: type-aware resolution (tra registry trước, LSP fallback)
// ❌ THIẾU: benchmark overhead ≤ +10% (đo index time)
```

## Implementation

```typescript
// packages/tools/src/type-registry.ts (NEW)
export interface TypeSig {
  symbolId: string;
  file: string;
  /** Type signature dạng chuẩn hóa (không phụ thuộc file). */
  signature: string;
}

/** Shared cross-file type registry — hash-table theo canonical name. */
export class TypeRegistry {
  private readonly byName = new Map<string, TypeSig>();

  /** Đăng ký type từ một file — gọi trong vòng index. */
  register(canonicalName: string, sig: TypeSig): void {
    // last-write-wins giữ signature mới nhất (file index gần nhất)
    this.byName.set(canonicalName.toLowerCase(), sig);
  }

  /** Tra type — O(1) hash lookup, không đụng disk. */
  resolve(canonicalName: string): TypeSig | undefined {
    return this.byName.get(canonicalName.toLowerCase());
  }

  /** Tra theo file (dùng khi file đổi — cần re-register). */
  byFile(file: string): TypeSig[] {
    const out: TypeSig[] = [];
    for (const sig of this.byName.values()) if (sig.file === file) out.push(sig);
    return out;
  }

  /** Xóa toàn bộ symbol của một file (file bị xóa/re-index). */
  unregisterFile(file: string): void {
    for (const [name, sig] of this.byName) if (sig.file === file) this.byName.delete(name);
  }

  /** Đo overhead index: registry có làm index chậm quá +10%? */
  static assertOverheadBudget(indexMs: number, baselineMs: number): boolean {
    return indexMs <= baselineMs * 1.1; // +10% budget
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Resolution O(1) — không parse lại file khác | ❌ Registry giữ signature cũ khi file đổi (stale) |
| ✅ Overhead index ≤ +10% (đo được) | ❌ Name collision giữa file (last-write-wins) |
| ✅ Fallback LSP khi miss — không bao giờ chết | ❌ Signature chuẩn hóa cần canonical form ổn định |
| ✅ Hỗ trợ nhiều ngôn ngữ qua extractor chung | ❌ Unregister file phức tạp (xóa đúng symbol) |

## Khác các hướng gần

| | Codegraph (import) | AAC: Type Registry |
|---|---|---|
| Resolution | File-level import | **Symbol-level type-aware** |
| Lookup | BFS/related | **Hash-table O(1)** |
| Overhead | Regex scan | **Đo ≤ +10% index** |
| Mối quan hệ | Nền import graph | **Bổ sung type layer** |

## Khi nào chọn

- Cần type-aware resolution xuyên file (TS/JS/Go/C/C++) cho agent
- Index nhiều file — không muốn rebuild registry từng lần
- Đã có symbol-extractor + graph-store + lsp-client — thêm registry giữa
- Guard: re-register khi file đổi (kết hợp incremental fingerprint), benchmark overhead, canonical name normalization (lowercase)
