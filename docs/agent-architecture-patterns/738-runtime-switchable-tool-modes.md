# Hướng ABJ: Runtime-Switchable Tool Modes — ba mode tools-and-ui / tools-only / override, chuyển lúc runtime bằng /fff-mode

> **Nguồn gốc:** fff (README.md) | **Coupling:** 🟢 — thêm mode registry + lệnh chuyển mode vào tool layer | **Agent-agnostic:** ⚠️ (mode override thay thế tool của host agent) | **Code sẵn:** ⚠️ (có tool registry + dispatch — chưa có mode switch runtime) | **Effort:** 1 tuần

## Nguồn gốc

**fff** (pi extension) có **ba mode** chuyển được **lúc runtime** bằng lệnh `/fff-mode`: (1) **`tools-and-ui`** (default) — thêm `ffgrep`/`fffind` tools + thay autocomplete UI; (2) **`tools-only`** — chỉ inject tools, giữ editor autocomplete gốc của pi; (3) **`override`** — thay thế **luôn** built-in `grep`/`find`/`multi_grep` của pi bằng implementation FFF. Mode có thể đổi **không cần restart** — user/agent gõ lệnh, extension đăng ký/đăng ký lại tool set tương ứng. Nguyên tắc: **mode là runtime state (không phải config tĩnh), override là quyết định rõ ràng, default ít xâm lấn (tools-and-ui)**.

## Mô tả

mya runtime-switchable tool modes: tool layer có **mode registry** với ba mode: `tools-and-ui` (thêm tool mới + enrich UI), `tools-only` (chỉ thêm tool), `override` (thay thế built-in grep/find/multi_grep bằng implementation mới). Lệnh runtime (slash command hoặc API) đổi mode **không cần restart**: registry unregister tool cũ, register tool mới theo mode. mya có packages/tools registry.ts + dispatch.ts (runTool, alias resolve) + builtin.ts (grep/find) — ABJ thêm **mode registry** + **mode switch command** + **override path** (alias map trỏ built-in → implementation thay thế).

## Kiến trúc

```
  MODE REGISTRY (runtime state)
  ┌────────────────────────────────────────────────────┐
  │  "tools-and-ui" (default)                          │
  │     add: ffgrep, fffind        + UI autocomplete   │
  │  "tools-only"                                      │
  │     add: ffgrep, fffind        (giữ UI gốc)        │
  │  "override"                                        │
  │     replace: grep→ffgrep, find→fffind,             │
  │              multi_grep→ffgrep-batch              │
  └───────────────────────┬────────────────────────────┘
                          │  /fff-mode override (runtime, không restart)
                          ▼
  TOOL REGISTRY (dispatch)
    grep ──(alias)──► ffgrep          ← override active
    find ──(alias)──► fffind
    multi_grep ─────► ffgrep(batch)
  → tool call đi đúng implementation theo mode hiện tại
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools registry.ts — ToolRegistry + alias resolve (nền — ABJ override path)
// ✅ packages/tools dispatch.ts — runTool dispatch (nền — ABJ mode-aware dispatch)
// ✅ packages/tools builtin.ts — grep/find builtins (nền — ABJ bị override)
// ✅ packages/core session-utils.ts — MessageQueue/commands (nền — ABJ lệnh runtime)

// ❌ THIẾU: mode registry (3 mode + state runtime)
// ❌ THIẾU: mode switch command (/fff-mode analog — đổi không restart)
// ❌ THIẾU: override semantics (alias map built-in → implementation thay thế)
```

## Implementation

```typescript
// packages/tools/src/tool-modes.ts (MỚI)
import type { ToolRegistry } from "./registry.js";

export type ToolMode = "tools-and-ui" | "tools-only" | "override";

export interface ModeSpec {
  add: string[];                    // tool names thêm vào registry
  replace?: Record<string, string>; // built-in name → implementation name (override)
  uiAutocomplete?: boolean;         // tools-and-ui: bật UI enrich
}

const MODES: Record<ToolMode, ModeSpec> = {
  "tools-and-ui": { add: ["ffgrep", "fffind"], uiAutocomplete: true },
  "tools-only": { add: ["ffgrep", "fffind"] },
  "override": { add: ["ffgrep", "fffind"], replace: { grep: "ffgrep", find: "fffind", multi_grep: "ffgrep" } },
};

/** Mode registry: giữ mode hiện tại + áp dụng spec vào ToolRegistry. */
export class ToolModeRegistry {
  private mode: ToolMode = "tools-and-ui";
  constructor(private registry: ToolRegistry) {}

  get current(): ToolMode { return this.mode; }

  /** Chuyển mode runtime — không restart, áp dụng ngay. */
  switch(mode: ToolMode): void {
    this.mode = mode;
    const spec = MODES[mode]!;
    for (const name of spec.add) this.registry.activate(name);
    if (spec.replace) {
      for (const [builtin, impl] of Object.entries(spec.replace)) {
        this.registry.alias(builtin, impl); // override: built-in → implementation mới
      }
    }
    if (spec.uiAutocomplete) this.registry.setUiFlag("autocomplete-fff", true);
  }
}

// Usage:
// const modes = new ToolModeRegistry(registry);
// modes.switch("override");
// registry.resolve("grep") === "ffgrep"  // override active — tool call đi FFF
// modes.switch("tools-only");            // bỏ override, giữ tool thêm
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chuyển runtime (không restart — thử nhanh, đổi ý nhanh) | ❌ Mode confusion (agent/host không biết mode hiện tại → hành vi lạ) |
| ✅ Override rõ ràng (built-in thay thế hẳn — không double registry) | ❌ Override leak (mode cũ để lại alias → tool gọi sai implementation) |
| ✅ Default an toàn (tools-and-ui thêm, không phá) | ❌ Compatibility (tool có arg khác giữa built-in vs override) |
| ✅ Granular (tools-only cho ai chỉ muốn tool, không đụng UI) | ❌ State persistence (mode không lưu → restart về default) |

## Khác các hướng gần

| | Config tĩnh (restart để đổi) | Luôn override | ABJ: Runtime-Switchable |
|---|---|---|---|
| Đổi mode | restart | không đổi được | **lệnh runtime** |
| Default | 1 mode | override mặc định | **tools-and-ui (ít xâm lấn)** |
| Kiểm soát | config file | không | **3 mode rõ + switch** |

## Khi nào chọn

- Tool implementation mới (nhanh hơn, ít token hơn) nhưng chưa muốn bỏ built-in hẳn
- Muốn agent/user đổi hành vi tool lúc runtime (thử nghiệm, A/B)
- Đã có ToolRegistry + alias resolve (packages/tools) — chỉ thêm mode layer
- Nối packages/tools registry.ts + dispatch.ts + builtin.ts + packages/core session-utils (lệnh runtime); guard mode-cleanup (switch mode phải gỡ spec cũ — không để alias rò rỉ), default-safe (khởi động ở tools-and-ui — không phá mặc định), và compatibility-check (override implementation phải nhận cùng args shape); ABJ = runtime-switchable tool modes, kết hợp 738-family fff tool semantics với 101 dynamic-tool-selection (tool chọn theo nhu cầu turn) + 735 ABG definition-first-hinting (hint là một mode)
