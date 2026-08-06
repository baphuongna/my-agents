# Hướng QZ: Text-Embedded UI Directives — model emit directives ::git-commit{} trong text, harness parse exec

> **Nguồn gốc:** Leaks Codex (`::git-stage`, `::git-commit`, `::created-thread`, `::git-create-branch`, `::git-push`, `::git-create-pr`); "model emits structured directives in text response"; "harness parses + executes"; "side-channel action signaling"; "directive on own line in final response"
> **Coupling:** 🟢 — thêm directive parser layer vào output stream (parse `::directive{}` → trigger action)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (output stream + bash git sẵn — chưa có directive parser + executor)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Codex** quy định: sau khi action thành công, model **emit directive** trong **text response** — `::git-stage{cwd="..."}`, `::git-commit{cwd="..."}`, `::created-thread{threadId="..."}`, `::git-create-branch{cwd branch="..."}`, `::git-push{cwd branch="..."}`, `::git-create-pr{cwd branch url isDraft}`. Directive nằm **trên dòng riêng** trong **final response**. **Harness parse** directive → **execute** (update UI state, sync git, register thread). Nguyên tắc: **side-channel signaling** — model báo "tôi vừa commit" qua directive có cấu trúc, harness parse chính xác (không regex mơ hồ trên prose). Khác **tool-call** (model gọi tool trực tiếp) — QZ là **post-action notification trong text**; khác output thuần (text cho user) — QZ là **machine-readable directive**.

## Mô tả

mya text-embedded UI directives: (1) **Emit**: model, sau action thành công, viết directive `::action{key="value"}` trên dòng riêng trong response text. (2) **Parse**: harness scan output stream tìm directive pattern (`::\w+\{...\}`). (3) **Dispatch**: mỗi directive → handler (vd `::git-commit` → update UI "committed", `::created-thread` → register thread, `::review-requested` → notify reviewer). (4) **Verify**: chỉ emit directive **sau khi action thực sự thành công** (không trong commentary). (5) **Separation**: directive = machine-channel, prose = human-channel. mya có output stream + bash git — QZ thêm **directive parser** (`::name{attrs}`) + **dispatcher** (directive → handler) + **emit guidance** (system prompt).

## Kiến trúc

```
  MODEL RESPONSE (text, sau khi git commit thành công):
  ┌─────────────────────────────────────────────────────┐
  │  I've fixed the null-token bug and committed.         │  ← prose (human)
  │  The parser now handles EOF correctly.                │  ← prose (human)
  │  ::git-commit{cwd="/repo" branch="fix/null-token"}   │  ← directive (machine)
  │  ::git-create-pr{cwd="/repo" branch="fix/null-token" │
  │     url="https://github/.../pull/42" isDraft=false}  │  ← directive (machine)
  └───────────────────────┬─────────────────────────────┘
                          │ (harness scans output stream)
                          ▼
  ┌─── DIRECTIVE PARSER ────────────────────────────────┐
  │  ::git-commit{cwd="/repo" branch="..."}               │
  │  → { name: "git-commit", attrs: { cwd, branch } }      │
  │  ::git-create-pr{cwd url isDraft}                     │
  │  → { name: "git-create-pr", attrs: { cwd, url, ...} } │
  └───────────────────────┬─────────────────────────────┘
                          │ (dispatch)
                          ▼
  ┌─── DISPATCHER (directive → handler) ────────────────┐
  │  git-commit    → UI: "committed fix/null-token" ✅    │
  │  git-create-pr → UI: "PR #42 created" + notify        │
  │  created-thread→ register thread in session            │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ output stream — agent text output (nền — QZ scan directives)
// ✅ bash git — git actions (nền — QZ directive sau git thành công)
// ✅ system prompt — emit guidance (nền — QZ dạy model emit)
// ✅ 292 lifecycle-hooks — event handlers (nền — QZ dispatcher hook)

// ❌ THIẾU: directive parser (::name{attrs} → structured)
// ❌ THIẾU: dispatcher (directive → handler/UI/state)
// ❌ THIẾU: emit guidance in system prompt (khi nào emit, format)
// ❌ THIẾU: verify-after-success (chỉ emit khi action thực OK)
```

## Implementation

```typescript
// packages/agent/src/text-directives.ts (MỚI)
interface Directive { name: string; attrs: Record<string, string | boolean> }

const DIRECTIVE_RE = /^::(\w+)\{(.*)\}\s*$/;

function parseDirectives(text: string): { prose: string; directives: Directive[] } {
  const lines = text.split('\n');
  const directives: Directive[] = [];
  const prose: string[] = [];
  for (const line of lines) {
    const m = line.match(DIRECTIVE_RE);
    if (m) {
      const attrs = parseAttrs(m[2]!);
      directives.push({ name: m[1]!, attrs });
    } else {
      prose.push(line);
    }
  }
  return { prose: prose.join('\n'), directives };
}

function parseAttrs(s: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const pair of s.matchAll(/(\w+)="([^"]*)"/g)) out[pair[1]!] = pair[2]!;
  for (const pair of s.matchAll(/(\w+)(?!=)/g)) {
    if (!(pair[1]! in out)) out[pair[1]!] = true; // isDraft (boolean)
  }
  return out;
}

// dispatcher
const handlers: Record<string, (d: Directive) => void> = {
  'git-commit': d => emit('ui:committed', d.attrs),
  'git-create-pr': d => emit('ui:pr-created', d.attrs),
  'created-thread': d => emit('session:thread', d.attrs),
  'review-requested': d => emit('notify:reviewer', d.attrs),
};

// Usage (in output handler):
// const { prose, directives } = parseDirectives(modelOutput);
// renderToUser(prose);                       // human channel
// for (const d of directives) handlers[d.name]?.(d);  // machine channel
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Machine-readable (parse chính xác, không regex prose) | ❌ Model emit sai (directive khi chưa success → UI sai) |
| ✅ Side-channel (prose cho human, directive cho machine) | ❌ Format fragility (attr parse lỗi nếu syntax lệch) |
| ✅ Harness sync (UI/state update chính xác từ model) | ❌ Directive spam (model emit quá nhiều → noise) |
| ✅ Mở rộng (thêm directive = thêm handler) | ❌ User thấy directive (cần strip trước hiển thị) |

## Khác các hướng gần

| | Tool-Call | Output (prose) | QZ: Text-Directives |
|---|---|---|---|
| Cái gì | Model gọi tool | Text cho user | **Directive trong text → harness parse** |
| Khi | Trước action | Sau action | **Sau action (notification)** |
| Channel | Tool API | Human | **Machine (side-channel)** |

## Khi nào chọn

- Cần harness biết action model đã làm (UI sync, state update)
- Model không gọi tool trực tiếp nhưng cần báo "đã commit/PR/thread"
- Muốn machine-readable side-channel (không regex prose mơ hồ)
- Nối output stream (scan) + 292 lifecycle-hooks (handler) + system prompt (emit guidance); guard emit-after-success (chỉ directive khi action OK) + strip-before-display (user không thấy directive) + attr-parse robustness; teach model format rõ trong system prompt
