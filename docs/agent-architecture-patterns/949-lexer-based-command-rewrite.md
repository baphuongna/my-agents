# Hướng AJM: Lexer-Based Command Rewrite — single-pass state machine lexer hiểu shell quoting/escapes/redirects/operators để rewrite command an toàn (chỉ rewrite left side của pipe, strip redirect, guards)

> **Nguồn gốc:** rtk | **Coupling:** 🟡 — command preprocessing tool | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (có bash tool spawn raw; chưa có rewrite lexer) | **Effort:** 1.5 tuần

## Nguồn gốc

**rtk** rewrite command dùng **single-pass state machine lexer** hiểu **shell quoting/escapes/redirects/operators**: split compound trên `&&`/`|`, **chỉ rewrite left side của pipe** (consumer chạy raw), **strip redirect suffix rồi append lại**, **guards** chống rewrite nguy hiểm (`RTK_DISABLED`, `gh --json`, write ops). Mục đích: chuyển command agent thành dạng an-tiện cho proxy (nối AJL reducer) mà không phá shell semantics.

Nguyên tắc: **state machine hiểu shell thật** — không regex mù; xử lý quoting (`'...'`, `"..."`), escapes (`\$`, `\\`), redirects (`>`, `2>&1`), operators (`&&`, `||`, `;`, `|`); **chỉ rewrite producer** — left side của pipe sinh output (reducer áp dụng); right side (consumer) chạy raw; **strip redirect** — redirect (`> file`) không qua proxy, strip rồi append lại sau; **guards** — một số command không rewrite được (substitution `$()`, `gh --json` đã structured, write ops `rm/mv`, `RTK_DISABLED` env).

## Mô tả

Với mya, pattern = **command rewrite trước khi reducer proxy**: (1) **mya có bash tool (builtin.ts)** — spawn raw, không rewrite — nền execution; (2) **AJM thêm rewrite layer**: bash command vào → lexer parse → rewrite producer segment → spawn; (3) **lexer** — port từ source/rtk src/discover/lexer.rs (tokenize, split_on_operators, strip_quotes, contains_unattestable_construct); (4) **split compound** — tách trên `&&`/`||`/`;`/`|`, rewrite từng segment; (5) **pipe-aware** — chỉ segment trước pipe đầu tiên (producer) được rewrite+reduce; segment sau (consumer) raw; (6) **redirect handling** — strip `> file`/`2>&1` suffix, append lại sau rewrite (không qua proxy); (7) **guards** — `RTK_DISABLED` env → passthrough; `gh --json` (đã structured) → passthrough; substitution `$()`/backtick → passthrough (unattestable); write ops (`rm`/`mv`/`>`) → passthrough; (8) **nối AJL** — rewrite mở đường cho reducer áp dụng đúng segment. Đảm bảo never-broken: guard sai → passthrough (nối AJO).

## Kiến trúc (ASCII)

```
  LLM ──bash cmd──► [LEXER REWRITE]
                       │
                       ▼ STATE-MACHINE TOKENIZE (hiểu quoting/escapes/redirects/operators)
                       │
                       ▼ GUARDS — passthrough nếu:
                       ├─ RTK_DISABLED env            ──► spawn RAW
                       ├─ gh --json (đã structured)   ──► spawn RAW
                       ├─ substitution $()/backtick   ──► spawn RAW (unattestable)
                       └─ write ops (rm/mv/>/tee)     ──► spawn RAW
                       │
                       ▼ SPLIT compound trên &&/||/;/|
                       ▼ REWRITE chỉ LEFT side của pipe (producer)
                       ▼ STRIP redirect suffix (> file) → append lại sau
                       │
                       ▼ spawn (producer qua reducer AJL; consumer RAW)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools builtin.ts — bash tool (spawn /bin/bash -c raw) (nền execution)
// ✅ packages/tools hashline-edit.ts — edit tool (khác scope)
// ✅ source/rtk src/discover/lexer.rs — tokenize, split_on_operators(stop_at_pipe),
//   strip_quotes, contains_unattestable_construct (Rust reference — port TS)
// ✅ packages/core redact.ts — secret filter (nền guard)

// ❌ THIẾU: command rewrite lexer (state machine quoting/escapes/redirects)
// ❌ THIẾU: pipe-aware (chỉ rewrite producer) + redirect strip/append
// ❌ THIẾU: guards (RTK_DISABLED / gh --json / substitution / write ops)
```

## Implementation

```typescript
// packages/tools/src/cmd-rewrite.ts (NEW)
export type Tok = { kind: "word" | "op" | "pipe" | "redirect"; val: string };

/** Single-pass state-machine tokenize — hiểu quoting/escapes. */
export function tokenize(cmd: string): Tok[] {
  const toks: Tok[] = []; let cur = ""; let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (quote) {
      if (ch === "\\") { cur += cmd[++i] ?? ""; continue; }
      cur += ch; if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (/[\s]/.test(ch)) { if (cur) { toks.push({ kind: "word", val: cur }); cur = ""; } }
    else if (ch === "|") { toks.push({ kind: "pipe", val: ch }); }
    else cur += ch;
  }
  if (cur) toks.push({ kind: "word", val: cur });
  return toks;
}

/** Guards — passthrough (không rewrite) khi nguy hiểm. */
export function shouldPassthrough(cmd: string): boolean {
  if (process.env.RTK_DISABLED) return true;
  if (/gh\s+.*--json\b/.test(cmd)) return true;       // đã structured
  if (/\$\(|`/.test(cmd)) return true;                // substitution unattestable
  if (/\b(rm|mv|cp|chmod|chown)\b|\s>\s?|tee\b/.test(cmd)) return true; // write ops
  return false;
}

/** Rewrite — chỉ producer (trước pipe đầu); strip redirect → append lại. */
export function rewriteCommand(cmd: string): string {
  if (shouldPassthrough(cmd)) return cmd;             // guard → raw (nối AJO)
  const toks = tokenize(cmd);
  const pipeIdx = toks.findIndex((t) => t.kind === "pipe");
  const producer = toks.slice(0, pipeIdx < 0 ? undefined : pipeIdx);
  const redir = producer.filter((t) => t.kind === "redirect").map((t) => t.val);
  const body = producer.filter((t) => t.kind !== "redirect").map((t) => t.val).join(" ");
  const rest = pipeIdx >= 0 ? " | " + toks.slice(pipeIdx).map((t) => t.val).join(" ") : "";
  return body + (redir.length ? " " + redir.join(" ") : "") + rest; // redirect append lại
}
// bash tool: spawn("/bin/bash", ["-c", rewriteCommand(args.command)]) trước AJL reducer.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mở đường cho AJL reducer đúng segment (producer) | ❌ Lexer phức tạp — phải cover quoting/escape đầy đủ |
| ✅ An toàn — guards passthrough khi nguy hiểm | ❌ Pipe/redirect heuristic — edge case shell lạ |
| ✅ Không phá shell semantics | ❌ Port Rust→TS hoặc native bridge |
| ✅ Nối AJO (passthrough fallback) | ❌ Giới hạn rewrite — không phải command nào cũng改 được |

## Khác các hướng gần

| | AJM Lexer Rewrite | AJL Token CLI Proxy | AJO Passthrough Fallback |
|---|---|---|---|
| Trọng tâm | Command preprocessing | Output reduction | An toàn luôn-on |
| Cơ chế | State machine + guards + pipe-aware | filter/group/truncate/dedup | Passthrough raw + track |
| Quan hệ | Mở đường cho AJL | Tiêu thụ producer đã rewrite | Fallback khi guard/lexer fail |

## Khi nào chọn

- Muốn reducer (AJL) áp dụng đúng segment command (không phá pipe)
- Command agent phức tạp (compound `&&`/pipe/redirect) cần rewrite an toàn
- Guard nguy hiểm — never rewrite write ops/substitution
- Guard: RTK_DISABLED passthrough, gh --json passthrough, substitution passthrough, write ops passthrough, lexer fail → passthrough (nối AJO)
