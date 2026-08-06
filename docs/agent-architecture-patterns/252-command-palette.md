# Hướng IR: Command Palette — slash commands & phím tắt, khám phá tính năng nhanh

> **Nguồn gốc:** VS Code Command Palette; Raycast / Alfred; Notion slash menu; Linear "Command Menu"; Slack slash commands; Microsoft "Command Palette" (Win11); "The Power User's Guide to Command Palettes"
> **Coupling:** 🟡 — chạm UI shell + tool registry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool registry sẵn — thiếu fuzzy search palette UI)
> **Effort:** 2-3 tuần

## Nguồn gốc

Command palette (VS Code, Raycast, Linear): một ô input trung tâm — gõ `Ctrl+P` / `/` → fuzzy-search mọi command/action trong app. Người dùng không cần nhớ menu — chỉ gõ từ khóa, palette gợi ý. Linear: "Command Menu lets you access every action without leaving the keyboard." Notion slash menu: `/` trigger inline block commands. Slack slash commands: `/remind`, `/poll` — user gõ lệnh nhanh trong chat. Điểm cốt lõi: **discoverability** — 100 tính năng nhưng user chỉ cần gõ, không cần lục menu. Raycast mở rộng: palette gọi scripts, extensions, clipboard history. Microsoft Win11 (2024): native command palette thay Win+R.

## Mô tả

mya command palette: ô input trong TUI — gõ `/` hiện danh sách slash commands (`/agent`, `/task`, `/memory`, `/cron`, `/skill`). Fuzzy match theo tên + mô tả. Mỗi command map tới tool hoặc action — chọn → chạy. Palette cũng gợi ý phím tắt (hiển thị `Ctrl+T` bên cạnh). Khác menu truyền thống: palette **search-first** — user không cần biết command ở mục nào, chỉ gõ từ khóa. Nối Hướng HR (226) — approval gate có thể hiện trong palette khi user gõ high-risk command.

## Kiến trúc

```
  USER gõ "/" trong TUI
        │
        ▼
  ┌──────────────────────────────────────────┐
  │  COMMAND PALETTE  > mem          ⏎ run   │
  │   /memory      show memory store  Ctrl+M │
  │   /memory-add  add fact to memory        │
  │   /merge       merge branches     Ctrl+G │
  │   /agent       spawn subagent     Ctrl+S │
  └──────────────────┬───────────────────────┘
                     │ fuzzy match → select
                     ▼
  ┌──────────────────────────────────────────┐
  │  COMMAND REGISTRY                         │
  │  tool.meta.name + description + shortcut  │
  │  → fuzzy search → RUN (tool.run)          │
  │  → RISK GATE? high → preview (HR 226)     │
  └──────────────────────────────────────────┘
```

```
mya: tool registry sẵn — thiếu: palette UI + fuzzy index + shortcut binding
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool registry — tool.meta.name + description (sẵn)
// ✅ TUI input handling — keyboard events (sẵn)
// ✅ slash commands cơ bản — vài hard-coded
// ✅ 111 tool-description-engineering — tool descriptions (sẵn)

// ❌ THIẾU: fuzzy search index (fzf-style scoring)
// ❌ THIẾU: palette overlay UI (dropdown gợi ý)
// ❌ THIẾU: shortcut registry (Ctrl+X → command mapping)
// ❌ THIẾU: recently-used ranking (boost frequent commands)
```

## Implementation

```typescript
// packages/tui/src/command-palette.ts (NEW)
import type { Tool } from "@my-agent/core";

interface PaletteEntry {
  name: string;        // "/memory"
  description: string; // "show memory store"
  shortcut?: string;   // "Ctrl+M"
  run: Tool["run"];
}

export class CommandPalette {
  private entries: PaletteEntry[] = [];
  private recent: string[] = []; // boost frequent

  register(entry: PaletteEntry): void { this.entries.push(entry); }

  // fzf-style fuzzy match: subsequence + bonus for consecutive + start-of-word
  search(query: string): PaletteEntry[] {
    const q = query.toLowerCase().replace(/^\//, "");
    return this.entries
      .map((e) => ({ e, score: fuzzyScore(q, e.name.toLowerCase() + " " + e.description.toLowerCase()) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score
        || this.recent.indexOf(b.e.name) - this.recent.indexOf(a.e.name))
      .slice(0, 10)
      .map((r) => r.e);
  }

  async execute(entry: PaletteEntry, args: unknown): Promise<unknown> {
    this.bumpRecent(entry.name);
    const res = await entry.run(args);
    return res; // risk gate (Hướng HR 226) wraps externally
  }
}

function fuzzyScore(needle: string, hay: string): number {
  let score = 0, ni = 0, streak = 0;
  for (const ch of hay) {
    if (ni < needle.length && ch === needle[ni]) { score += 10 + streak++ * 5; ni++; }
    else streak = 0;
  }
  return ni === needle.length ? score : 0; // all chars must match
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Discoverability — 100+ command, gõ là ra (VS Code/Raycast) | ❌ Palette overlay TUI complexity |
| ✅ Keyboard-first — không lục menu (Linear) | ❌ Shortcut collision management |
| ✅ Fuzzy — sai chính tả vẫn match | ❌ Description quality quyết định hiệu quả (111) |
| ✅ Recent ranking — frequent commands lên đầu | ❌ Learning curve cho user mới |

## Khác các hướng gần

| | Tool Registry | Slash Cmds (hard) | IR: Command Palette |
|---|---|---|---|
| Discover | ❌ (phải biết) | ⚠️ (fixed list) | **✅ fuzzy search** |
| Shortcut | ❌ | ❌ | ✅ Ctrl+X binding |
| Ranking | ❌ | ❌ | ✅ recent/freq |

## Khi nào chọn

- Nhiều tool/command (>20) — user không nhớ hết
- Keyboard-first UX (TUI / CLI)
- Cần phím tắt tùy chỉnh + discoverability
- Nối HR (226) approval gate hiển thị trong palette
