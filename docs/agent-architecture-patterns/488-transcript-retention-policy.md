# Hướng RT: Transcript Retention Policy — giữ nội dung theo trường: text giới hạn ký tự, metadata-only cho diff

> **Nguồn gốc:** ctx (ctx.rs; storage.md; "avoids copying unbounded stdout/stderr/binary/raw diffs"; "store metadata + citation + bounded diagnostic previews"; "raw_sql value truncation: Text { truncated } / max_value_bytes"; provider-import-policy "bounded previews useful for search")
> **Coupling:** 🟢 — retention policy chèn vào store/write path (không can thiệp core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (history/store + token tracking sẵn — chưa có per-field retention + bounded preview)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**ctx** (ctx.rs) quyết định **lưu gì vào SQLite** và **bỏ gì**. Nguyên tắc **transcript retention policy**: không copy **vô hạn** (unbounded stdout/stderr, binary, image payload, raw diff, provider-private blob) → bloat + rò rỉ. Thay vào đó **giữ theo trường (per-field)**: (1) **Text có giới hạn** — conversation text, FTS-indexable text được giữ nhưng **truncate** khi vượt `max_value_bytes` (raw_sql `Text { truncated: true }`). (2) **Metadata-only** cho diff/stdout lớn — không lưu raw, chỉ lưu **metadata** (command preview, status, exit code) + **citation** trỏ về raw source path khi available + **bounded diagnostic preview** (đoạn ngắn hữu ích cho search). (3) **Provider-private handles** — giữ boolean presence, **không copy giá trị** (vd Warp token: chỉ true/false, không copy `conversation_data`). (4) **Sensitive handles** — bỏ khỏi normalized metadata khi không cần search. Kết quả: index **nhỏ + private** (text searchable được giữ có giới hạn, phần lớn → metadata + citation). Khác **432 PP cache-miss** (đo token) — RT **retention nội dung**; khác **482 RN memory-index** (index in-context) — RT **retention khi lưu vào store**.

## Mô tả

mya transcript retention policy: (1) **Write path gate**: mỗi trường transcript đi qua retention policy trước khi ghi store. (2) **Text field**: conversation/FTS text → giữ nhưng **truncate** tại `maxChars` (đánh dấu `truncated=true`). (3) **Large payload** (diff/stdout/binary): → **metadata-only** (preview + status + exit + citation → raw path), **không lưu raw**. (4) **Sensitive handle**: boolean presence, không copy giá trị. (5) **Citation**: trỏ về raw source path → `show` có thể load lại raw nếu cần. Kết quả: store nhỏ (text giới hạn + metadata) + private (không blob nhạy cảm) + searchable (FTS text vẫn đủ). mya có history/store + token tracking — RT thêm **per-field retention** + **bounded preview**.

## Kiến trúc

```
  TRANSCRIPT EVENT (gửi ghi store)
  ┌──────────────────────────────────────────────┐
  │  conversation text: "fixed bug in parser..."  │  (TEXT field)
  │  command stdout: <50000 char unbounded>        │  (LARGE payload)
  │  diff: "@@ -10,3 +10,4 ..."  (raw diff)        │  (DIFF)
  │  tool output: <binary/image blob>              │  (BINARY)
  │  provider token: "tok_abc123..."               │  (SENSITIVE)
  └───────────────────────┬────────────────────────┘
                          ▼
  ┌─── RETENTION POLICY (per-field) ─────────────────────┐
  │                                                       │
  │  TEXT field (conversation/FTS):                       │
  │    if len > maxChars → TRUNCATE (truncated=true)      │
  │    → giữ "fixed bug in parser... (cắt)" ✅            │
  │                                                       │
  │  LARGE payload (stdout/diff/binary):                  │
  │    → METADATA-ONLY:                                   │
  │       preview (first 500 char) + status + exit code   │
  │       citation → raw source path                       │
  │    → KHÔNG lưu raw ❌                                 │
  │                                                       │
  │  SENSITIVE handle (token/secret):                     │
  │    → BOOLEAN presence (hasToken=true)                 │
  │    → KHÔNG copy giá trị ❌                            │
  │                                                       │
  └───────────────────────┬───────────────────────────────┘
                          ▼
  STORE: text giới hạn (truncated) + metadata + citation
        (nhỏ + private + searchable)
        show → citation → load raw lại nếu cần
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ history/store (packages/*) — session store (nền — RT = retention gate trong write path)
// ✅ token/cost tracking — đo dung lượng (nền — RT = budget cho truncate)
// ✅ 432 PP cache-miss-attribution — đo token (đối chiếu — RT = retention nội dung)
// ✅ 482 RN memory-index-in-context — index in-context (đối chiếu — RT = retention store)

// ❌ THIẾU: per-field retention (text truncate / large → metadata-only / sensitive → boolean)
// ❌ THIẾU: bounded diagnostic preview (preview + status + exit, không raw)
// ❌ THIẾU: citation trỏ raw source path (show load lại raw)
// ❌ THIẾU: truncate flag (Text { truncated } đánh dấu đã cắt)
```

## Implementation

```typescript
// packages/agent/src/transcript-retention.ts (MỚI)
interface StoredValue {
  kind: "text" | "metadata" | "boolean";
  value: string;            // text (có thể truncated) / metadata JSON / "true"
  truncated?: boolean;
  citation?: string;        // raw source path khi metadata-only
}

const MAX_TEXT_CHARS = 8000;
const PREVIEW_CHARS = 500;

class RetentionPolicy {
  // text field: giữ nhưng truncate tại maxChars
  retainText(text: string): StoredValue {
    if (text.length <= MAX_TEXT_CHARS) return { kind: "text", value: text };
    return { kind: "text", value: text.slice(0, MAX_TEXT_CHARS), truncated: true };
  }

  // large payload (stdout/diff/binary): metadata-only + citation, KHÔNG raw
  retainLarge(payload: string, opts: { status?: string; exitCode?: number; rawPath?: string }): StoredValue {
    return {
      kind: "metadata",
      value: JSON.stringify({
        preview: payload.slice(0, PREVIEW_CHARS),     // bounded diagnostic preview
        truncated: payload.length > PREVIEW_CHARS,
        status: opts.status ?? null,
        exitCode: opts.exitCode ?? null,
      }),
      citation: opts.rawPath,                          // trỏ về raw source path
    };
  }

  // sensitive handle: boolean presence, KHÔNG copy giá trị
  retainSensitive(present: boolean): StoredValue {
    return { kind: "boolean", value: present ? "true" : "false" };
  }

  // show: load raw lại qua citation nếu cần
  expandFromCitation(stored: StoredValue): string | null {
    if (stored.kind === "metadata" && stored.citation) {
      return readRaw(stored.citation);                  // load raw source path
    }
    return stored.kind === "text" ? stored.value : null;
  }
}

// chèn vào write path
function writeEvent(ret: RetentionPolicy, ev: {
  text?: string; stdout?: string; diff?: string; token?: string; rawPath?: string;
}): Record<string, StoredValue> {
  const out: Record<string, StoredValue> = {};
  if (ev.text) out.text = ret.retainText(ev.text);
  if (ev.stdout) out.stdout = ret.retainLarge(ev.stdout, { rawPath: ev.rawPath });
  if (ev.diff) out.diff = ret.retainLarge(ev.diff, { rawPath: ev.rawPath });
  if (ev.token !== undefined) out.hasToken = ret.retainSensitive(Boolean(ev.token));
  return out;
}

// Usage:
// writeEvent(ret, { text: conv, stdout: bigOut, diff: rawDiff, token: "tok_x", rawPath: "~/.codex/..." })
//   → text (truncated nếu >8000) + stdout/diff (metadata+preview+citation) + hasToken (boolean)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Store nhỏ (text giới hạn + metadata, không raw blob) | ❌ Mất chi tiết raw (truncate/metadata-only) |
| ✅ Private (không copy blob nhạy cảm — boolean presence) | ❌ Cần citation/rawPath để load lại (nếu path xóa → mất) |
| ✅ Searchable đủ (FTS text + preview vẫn hữu ích) | ❌ Preview có thể thiếu ngữ cảnh (500 char) |
| ✅ show → citation → expand raw khi cần | ❌ Truncate có thể cắt giữa từ/cú pháp quan trọng |

## Khác các hướng gần

| | 432 Cache-Miss-Attribution | 482 Memory-Index-In-Context | RT: Retention-Policy |
|---|---|---|---|
| Cái gì | Đo cache token | Index in-context | **Retain nội dung theo trường** |
| Khi | Sau LLM call | Memory pipeline | **Trước ghi store** |
| Raw | ❌ | ❌ | **Metadata-only + citation** |

## Khi nào chọn

- Lưu transcript vào store nhưng tránh bloat (unbounded stdout/diff/binary)
- Muốn text searchable (giữ có giới hạn) + phần lớn → metadata + citation
- Cần private (không copy blob nhạy cảm — boolean presence)
- Nối history/store (RT = retention gate trong write path) + token tracking (RT = budget truncate); guard citation availability (rawPath xóa → mất raw, không expand được) + truncate boundary (cắt tại ranh có nghĩa, không giữa từ) + provider-private (boolean presence cho sensitive handle) + FTS đủ (preview 500 char vẫn search hữu ích)
