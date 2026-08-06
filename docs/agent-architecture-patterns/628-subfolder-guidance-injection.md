# Hướng XD: Subfolder Guidance Injection — inject guidance theo thư mục (AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/) ở session_start và mỗi tool call

> **Nguồn gốc:** rpiv-mono (guidance injection); "AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/", "inject at session_start and each tool call" | **Coupling:** 🟡 — thêm folder-aware guidance vào session + tool lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (prompts + session sẵn — chưa có subfolder guidance precedence + per-call inject) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** inject **guidance** (chỉ dẫn context) **theo thư mục đang hoạt động**: khi agent làm việc trong subfolder, nạp guidance theo **precedence** `AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/` (ưu tiên AGENTS.md, fallback CLAUDE.md, rồi file guidance riêng theo subfolder). Inject xảy ra **2 thời điểm**: (1) **session_start** (nạp guidance cho thư mục gốc session), (2) **mỗi tool call** (nếu tool đổi cwd/vào subfolder → re-inject guidance của subfolder đó). Nguyên tắc: **guidance theo context thư mục, refresh khi context đổi** — agent luôn thấy rule/convention phù hợp nơi đang làm việc.

## Mô tả

mya subfolder guidance injection: resolver đọc AGENTS.md → CLAUDE.md → `.rpiv/guidance/<sub>/` theo precedence, inject thành system guidance. Trigger tại session_start và mỗi tool call (re-resolve khi cwd đổi). mya có prompts + session — XD thêm **folder-precedence resolver** + **session_start inject** + **per-tool-call refresh**.

## Kiến trúc

```
  ┌─── TRIGGER 1: session_start ─────────────────────────┐
  │  cwd = workspace root                                   │
  │  resolve guidance: AGENTS.md > CLAUDE.md > guidance/    │  ← precedence
  │  → inject system guidance                               │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── TRIGGER 2: mỗi tool call ──────────────────────────┐
  │  tool đổi cwd → vào subfolder "packages/core"           │
  │  re-resolve: packages/core/AGENTS.md (nếu có)           │
  │             > .rpiv/guidance/core/                       │
  │  → re-inject guidance của subfolder                      │  ← refresh khi cwd đổi
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── SYSTEM GUIDANCE (context-aware) ───────────────────┐
  │  "[GUIDANCE/packages/core] use canonical-json.ts..."   │  ← rule theo subfolder
  │  agent thấy convention phù hợp nơi đang làm            │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts — system prompt (nền — XD guidance ở đây)
// ✅ packages/core session.ts — session (nền — XD session_start hook)
// ✅ packages/tools dispatch.ts — tool call (nền — XD per-call inject)

// ❌ THIẾU: folder-precedence resolver (AGENTS > CLAUDE > guidance/)
// ❌ THIẾU: session_start guidance inject
// ❌ THIẾU: per-tool-call cwd-refresh + re-inject
```

## Implementation

```typescript
// packages/prompts/src/subfolder-guidance.ts (MỘI)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// precedence: AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/
function resolveGuidance(cwd: string): string | null {
  const candidates = [
    join(cwd, "AGENTS.md"),
    join(cwd, "CLAUDE.md"),
    join(cwd, ".rpiv", "guidance", cwd.split("/").pop()!, "guide.md"),
  ];
  for (const p of candidates) if (existsSync(p)) return readFileSync(p, "utf8");
  return null; // không có guidance
}

class GuidanceInjector {
  private lastCwd = "";
  private current: string | null = null;
  constructor(private onInject: (g: string | null) => void) {}

  // session_start: inject guidance cho cwd gốc
  onSessionStart(cwd: string): void { this.lastCwd = cwd; this.current = resolveGuidance(cwd); this.onInject(this.current); }

  // mỗi tool call: nếu cwd đổi → re-resolve + re-inject
  onToolCall(cwd: string): void {
    if (cwd === this.lastCwd) return; // không đổi → skip
    this.lastCwd = cwd;
    const g = resolveGuidance(cwd);
    if (g !== this.current) { this.current = g; this.onInject(g); } // chỉ inject khi đổi
  }
}

// Usage:
// const inj = new GuidanceInjector((g) => session.setGuidance(g));
// inj.onSessionStart(workspaceRoot);
// hook.before_tool = (t) => inj.onToolCall(t.cwd); // refresh khi vào subfolder
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context-aware (guidance theo thư mục đang làm) | ❌ File I/O mỗi tool call (resolve guidance) |
| ✅ Precedence rõ (AGENTS > CLAUDE > guidance/) | ❌ Guidance conflict (subfolder rule mâu thuẫn root) |
| ✅ Auto-refresh (re-inject khi cwd đổi) | ❌ Token overhead (inject mỗi khi đổi thư mục) |
| ✅ Convention nhất quán (rule phù hợp nơi làm) | ❌ Missing-file silent (không có guidance → null, không warn) |

## Khác các hướng gần

| | Static system prompt | Single AGENTS.md | XD: Subfolder-Guidance |
|---|---|---|---|
| Context-aware | ❌ | root only | **✅ theo subfolder** |
| Precedence | n/a | single | **✅ AGENTS > CLAUDE > guidance/** |
| Refresh | ❌ | ❌ | **✅ mỗi tool call** |

## Khi nào chọn

- Monorepo/nhiều subfolder cần convention khác nhau theo nơi làm
- Muốn agent tự thấy rule phù hợp thư mục (không cần user nhắc)
- Nối packages/prompts + packages/core session.ts + packages/tools dispatch.ts; guard guidance-cache (cache resolve theo cwd, tránh I/O lặp), conflict-lint (warn khi subfolder rule mâu thuẫn root), và missing-warn (log khi không tìm thấy guidance file ở subfolder mới); XD = subfolder guidance injection, kết hợp 621 WW workflow-config-layering (layer guidance theo scope) + 543 TW durable-context-projection (preserve guidance khi compact)
