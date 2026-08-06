# Hướng OC: Dual-Channel Agent Communication — commentary (ngắn) vs final (self-contained), link clickable

> **Nguồn gốc:** Leaks Codex (commentary vs final output channel); "streaming commentary"; "self-contained final answer"; "clickable references"; "progress narration vs deliverable separation"
> **Coupling:** 🟢 — thêm output channel layer, không chạm agent core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (streaming + print/TUI sẵn — chưa có commentary/final channel separation + clickable links)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**Leaks Codex** tiết lộ hai kênh output tách biệt: **commentary** (luồng suy nghĩ/progress — ngắn, tạm thời, "đang đọc file X", "đang chạy test") và **final** (kết quả cuối — self-contained, hoàn chỉnh, có reference). Commentary **không** lẫn vào final — user xem commentary real-time (biết agent đang làm gì) nhưng **deliverable** chỉ là final (copy-paste được, không rác). **Clickable references**: final output chứa link (file:line, URL, doc section) — user click → jump tới nguồn. Nguyên tắc: **commentary = progress narration** (ephemeral, ngắn), **final = deliverable** (permanent, self-contained, referenced). Khác streaming thông thường (tất cả 1 luồng) — OC **tách 2 kênh** có ngữ nghĩa khác nhau.

## Mô tả

mya dual-channel communication: agent output chia **2 kênh**: (1) **commentary** — agent phát ngắn real-time ("Reading `src/auth.ts`...", "Running tests...", "Found 3 issues"), hiển thị trong TUI progress area, **ephemeral** (scroll away). (2) **final** — kết quả cuối hoàn chỉnh, **self-contained** (đọc riêng không cần commentary), có **clickable references** (`src/auth.ts:42`, `[doc](#section)`, link URL). User chỉ cần đọc final; commentary là "real-time narration" tùy chọn. mya có streaming (`packages/rpc`) + TUI (`packages/print`) — OC thêm **channel tag** (commentary vs final) + **reference link rendering** + **self-contained final assembly**.

## Kiến trúc

```
  AGENT LOOP:
        │
        ├──► COMMENTARY CHANNEL (ephemeral, short):
        │    · "Reading src/auth.ts..."
        │    · "Running tests: 12 passed, 3 failed"
        │    · "Analyzing failure in line 42..."
        │    · (displayed in TUI progress bar — scrolls away)
        │
        ▼
  FINAL CHANNEL (permanent, self-contained):
  ┌─────────────────────────────────────────────────────┐
  │  ## Summary                                         │
  │  Fixed auth bug in [src/auth.ts:42](#auth-fix).     │  ← clickable ref
  │  Test results: 15/15 passed.                        │
  │  See [PR #123](https://github.com/.../pull/123).    │  ← clickable URL
  │                                                     │
  │  Self-contained: đọc riêng hiểu trọn —              │
  │  không cần xem commentary.                          │
  └─────────────────────────────────────────────────────┘

  TUI LAYOUT:
  ┌─ Commentary (top, scrolling) ──────────┐
  │  ✓ Reading src/auth.ts...              │
  │  ✓ Running tests... 3 failed            │
  │  → Fixing line 42...                    │
  ├─ Final (bottom, persistent) ───────────┤
  │  Fixed auth bug in src/auth.ts:42      │  ← clickable → jump to file
  │  See PR #123                            │  ← clickable → open URL
  └────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/rpc — streaming transport (nền — OC 2 channel trên stream)
// ✅ packages/print — TUI render (nền — OC commentary + final pane)
// ✅ message types — assistant/tool output (nền — OC thêm channel tag)
// ✅ streaming — token-by-token output (nền)

// ❌ THIẾU: channel tag (commentary vs final)
// ❌ THIẾU: clickable reference rendering (file:line → jump, URL → open)
// ❌ THIẾU: self-contained final assembly (final đọc riêng hiểu)
// ❌ THIẾU: commentary throttle/ephemeral (scroll away, không persist)
```

## Implementation

```typescript
// packages/agent/src/dual-channel.ts (MỚI)
type Channel = 'commentary' | 'final';

interface OutputChunk {
  channel: Channel;
  text: string;
  references?: Reference[]; // clickable links (final only)
}

interface Reference {
  type: 'file' | 'url' | 'doc';
  target: string;  // 'src/auth.ts:42' | 'https://...' | '#section'
  label: string;   // display text
}

class DualChannelEmitter {
  private commentary: string[] = [];
  private finalParts: string[] = [];
  private refs: Reference[] = [];

  // Emit commentary — short, ephemeral progress narration
  comment(text: string): void {
    this.commentary.push(text);
    this.emit({ channel: 'commentary', text });
  }

  // Emit final — self-contained deliverable
  finalize(text: string, references?: Reference[]): void {
    this.finalParts.push(text);
    if (references) this.refs.push(...references);
    this.emit({ channel: 'final', text, references });
  }

  // Assemble final — self-contained (readable without commentary)
  assembleFinal(): { text: string; references: Reference[] } {
    const text = this.finalParts.join('\n\n');
    return { text, references: this.refs };
  }

  // Commentary is ephemeral — get recent N for TUI display
  recentCommentary(n: number): string[] {
    return this.commentary.slice(-n);
  }

  private emit(chunk: OutputChunk): void {
    // → packages/rpc stream → packages/print TUI
    // commentary → top scrolling pane
    // final → bottom persistent pane with clickable refs
  }
}

// Reference resolver — clickable links
function resolveReference(ref: Reference): { action: string; target: string } {
  switch (ref.type) {
    case 'file': return { action: 'open-file', target: ref.target };   // jump to line
    case 'url':  return { action: 'open-url', target: ref.target };    // open browser
    case 'doc':  return { action: 'scroll-doc', target: ref.target };  // scroll to section
  }
}

// Usage in agent loop:
// emitter.comment('Reading src/auth.ts...');           // ephemeral
// emitter.comment('Found bug at line 42');             // ephemeral
// emitter.finalize(
//   'Fixed auth bug in `src/auth.ts:42`. All 15 tests pass.',
//   [{ type: 'file', target: 'src/auth.ts:42', label: 'auth fix' }]
// );
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User xem progress real-time (commentary) không rác final | ❌ Agent phải tự phân biệt commentary vs final |
| ✅ Final self-contained (copy-paste được, không cần commentary) | ❌ Double output effort (narrate + assemble final) |
| ✅ Clickable references (file:line, URL — jump tới nguồn) | ❌ Reference rendering overhead (TUI file jump, URL open) |
| ✅ Nối streaming (2 channel trên stream) | ❌ Commentary noise (qu nhiều narration → khó theo) |

## Khác các hướng gần

| | Streaming (sẵn) | packages/print (TUI) | 123 Explainable-Actions | OC: Dual-Channel |
|---|---|---|---|---|
| Kênh | 1 luồng | 1 pane | 1 explanation | **commentary + final** |
| Self-contained | ❌ (luồng) | ❌ | ✅ | ✅ (final) |
| Clickable | ❌ | ❌ | ❌ | ✅ references |
| Ephemeral | ❌ | ❌ | ❌ | ✅ commentary scroll |

## Khi nào chọn

- Agent chạy lâu (user cần progress feedback real-time)
- Final deliverable phải self-contained (copy-paste, không rác commentary)
- Cần clickable references (jump to file:line, open URL, scroll doc)
- Nối packages/print (TUI commentary + final pane) + packages/rpc (2-channel stream) + 123 explainable-actions (final giải thích hành động); commentary ngắn + ephemeral, final self-contained + referenced
