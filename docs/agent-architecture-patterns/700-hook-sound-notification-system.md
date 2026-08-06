# Hướng ZX: Hook Sound Notification System — hệ thống sound notification xuyên platform: hooks.py xử lý mọi hook events (PreToolUse, PostToolUse, Stop, SubagentStart, PreCompact, SessionStart...) với config JSON chia sẻ + local override git-ignored; git commits trigger âm riêng
> **Nguồn gốc:** claude-code-best-practice (CLAUDE.md, .claude/hooks/) | **Coupling:** 🟢 — hook event → sound mapping trong agent loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (core/loop hooks + print notify — chưa có sound system) | **Effort:** 1-2 tuần

## Nguồn gốc

**claude-code-best-practice** dùng **sound notification xuyên platform**: script (hooks.py) đăng ký xử lý **mọi hook events** — **PreToolUse, PostToolUse, Stop, SubagentStart, PreCompact, SessionStart**... — mỗi event phát âm thanh riêng (tool chạy xong ping, stop chuông, subagent start tick...). Config là **JSON chia sẻ** (mọi người dùng chung) + **local override git-ignored** (mỗi người tự chỉnh âm, không đẩy lên git). **Git commits trigger âm riêng** (commit thành công kêu khác) — nghe là biết trạng thái không cần nhìn terminal. Nguyên tắc: **event → sound mapping qua config chia sẻ + local override**.

## Mô tả

mya hook sound notification: (1) **Event registry** — core loop hook events: turn_start, tool_call, tool_result, stop, subagent_start, pre_compact, session_start (mya có hooks sink). (2) **Sound mapping** — config JSON: event → sound file/mô tả (platform-agnostic: mac `afplay`, linux `paplay`, win `powershell`). (3) **Shared + local override** — config chia sẻ (git) + local override git-ignored. (4) **Play** — hook handler phát âm async (không block loop). mya có core/loop.ts hooks + print notify — ZX thêm **event→sound config** + **sound player adapter** + **local override merge**.

## Kiến trúc

```
  AGENT LOOP (hook events)
  ┌──────────────────────────────────────────────┐
  │  turn_start  tool_call  tool_result  stop     │
  │  subagent_start  pre_compact  session_start   │
  └────────────────────┬─────────────────────────┘
                       ▼ hooks.py (event handler)
  ┌── SOUND CONFIG (JSON) ──────────────────────┐
  │  shared: sounds.json (git — mọi người dùng)  │
  │  local:  sounds.local.json (git-ignored)     │
  │  merge: local thắng shared                    │
  │  event → { command: "afplay|paplay|...",     │
  │            file: "stop.wav" }                │
  └────────────────────┬─────────────────────────┘
                       ▼ play (async, không block)
  │  tool_result → ping  | stop → chuông          │
  │  subagent_start → tick | commit → âm riêng    │
  └──────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — hooks (PostToolHookSink, nền — ZX event source)
// ✅ packages/core loop.ts — turn events (StreamEvent, nền — ZX event types)
// ✅ packages/print mya-bridge.ts — ui.notify (nền — ZX visual notify)
// ✅ packages/agent index.ts — SubagentHandle (nền — ZX subagent_start)
// ✅ packages/gateway hooks.ts — HookRegistry (nền — ZX event registry)

// ❌ THIẾU: event→sound config (JSON shared + local override)
// ❌ THIẾU: sound player adapter (afplay/paplay/powershell xuyên platform)
// ❌ THIẾU: hook → sound wiring (async play, không block loop)
```

## Implementation

```typescript
// packages/print/src/sound-notify.ts (MỚI)

type SoundEvent = "turn_start" | "tool_result" | "stop" | "subagent_start" | "pre_compact" | "session_start" | "git_commit";

interface SoundConfig { command: string; file: string }   // platform command + file
type SoundMap = Partial<Record<SoundEvent, SoundConfig>>

class SoundNotify {
  private map: SoundMap = {};
  private player = "";                                     // afplay/paplay/powershell

  constructor(private fs: { read(p: string): Promise<string | null>; exists(p: string): Promise<boolean> }) {}

  // Merge config: shared (git) + local override (git-ignored) — local thắng
  async load(sharedPath: string, localPath: string): Promise<void> {
    const shared = JSON.parse((await this.fs.read(sharedPath)) ?? "{}") as SoundMap;
    const local = JSON.parse((await this.fs.read(localPath)) ?? "{}") as SoundMap;
    this.map = { ...shared, ...local };                    // local override
    this.player = process.platform === "darwin" ? "afplay"
      : process.platform === "win32" ? "powershell" : "paplay";
  }

  // Play: event → sound, async không block loop
  async play(event: SoundEvent): Promise<void> {
    const cfg = this.map[event];
    if (!cfg) return;                                      // không cấu hình → im lặng
    try {
      // fire-and-forget: không await đầy đủ — không chặn agent loop
      void this.spawnPlayer(cfg.command, cfg.file);
    } catch { /* sound fail không ảnh hưởng loop */ }
  }
  private async spawnPlayer(_command: string, file: string): Promise<void> {
    // (thực tế: child_process spawn player với file — xuyên platform)
    console.debug(`[sound] ${file}`);                       // placeholder
  }
}
// Usage (wire vào core/loop.ts hooks):
// const sounds = new SoundNotify(fsAdapter);
// await sounds.load(".claude/sounds.json", ".claude/sounds.local.json");
// // hooks: tool_result → sounds.play("tool_result"); stop → sounds.play("stop")
// // git commit hook riêng → sounds.play("git_commit") — âm riêng cho commit
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết trạng thái không cần nhìn terminal (multi-task) | ❌ Sound sai lúc sai chỗ (open office, họp) |
| ✅ Config chia sẻ + local override (linh hoạt) | ❌ Player command khác platform (phải giữ 3 nhánh) |
| ✅ Async play (không block loop) | ❌ Sound fail bị nuốt (không biết hỏng) |
| ✅ Event riêng cho commit/subagent (phân biệt rõ) | ❌ Thêm config file phải maintain |

## Khác các hướng gần

| | Visual notify | Log only | ZX: Sound Notify |
|---|---|---|---|
| Nhận biết | Cần nhìn | Cần đọc | **Nghe** |
| Multi-task | Kém | Kém | **✅ tốt** |
| Block loop | Không | Không | **✅ async** |

## Khi nào chọn

- User làm nhiều việc cùng lúc, cần biết agent xong/chạy tool/stop
- Muốn config âm chia sẻ + cá nhân hóa (local override)
- Muốn phân biệt event bằng âm (commit riêng, subagent riêng)
- Nối packages/core loop.ts + print mya-bridge.ts + agent index.ts + gateway hooks.ts; guard non-blocking (play async, không chặn loop), local-override (git-ignored, không đẩy config cá nhân), và error-silent (sound fail không phá loop); ZX = hook sound notification, kết hợp 680 ZD mandatory-stop-enforcement (stop event rõ) + 699 ZW ancestor-vs-descendant-loading (config loading pattern)
