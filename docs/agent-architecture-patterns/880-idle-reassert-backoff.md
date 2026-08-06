# Hướng AGV: Idle Reassert Backoff — sau agent_end, title được re-assert định kỳ với exponential backoff 200ms→5s để bắt pi-autoname override title async; idle backoff dài dần tiết kiệm CPU

> **Nguồn gốc:** pi-status | **Coupling:** 🟡 — bind vào agent lifecycle + terminal title | **Agent-agnostic:** ⚠️ (cần agent_end event) | **Code sẵn:** ❌ (mya có loop-idle + laneboard heartbeat, nhưng KHÔNG có title reassert backoff) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-status** sau event `agent_end` **re-assert** terminal title định kỳ. Lý do: **`pi-autoname`** override title **async** (đặt tên session sau khi xử lý) — nếu pi-status chỉ set 1 lần, pi-autoname ghi đè sau và title "biến mất". Giải pháp: **re-assert lặp lại** với **exponential backoff** (`200ms → 5s`) — lần đầu re nhanh (bắt race), sau đó **thưa dần** khi idle (tiết kiệm CPU, không cần re liên tục khi không ai đổi). Backoff cap ở 5s — đủ để giữ title nhưng không nóng CPU.

Nguyên tắc: **re-assert để thắng race** (async override); **exponential backoff** (nhanh đầu, thưa dần); **idle = tiết kiệm CPU** (backoff dài khi không đổi); **cap backoff** (không re quá thưa mất tác dụng).

## Mô tả

Với mya, packages/core có `loop-idle.ts` (idle detection) và `laneboard.ts` (heartbeat freshness), nhưng **chưa có** pattern **re-assert với backoff** cho terminal title (hoặc bất kỳ giá trị nào bị override async bởi tiến trình khác). Pattern này tổng quát: khi 2 tiến trình cùng set 1 resource và một cái async, re-assert có backoff là cách thắng race mà không nóng CPU.

## Kiến trúc (ASCII)

```
  agent_end event
        │  setTitle(myTitle)
        ▼
  re-assert loop (exponential backoff)
        │  delay: 200ms → 400ms → 800ms → 1.6s → 3.2s → 5s (cap)
        │  mỗi tick: setTitle(myTitle) lại (thắng pi-autoname async override)
        ▼
  idle dần → backoff dài → tiết kiệm CPU (không re liên tục)
  ── activity mới (agent_end nữa) → reset backoff về 200ms
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/loop-idle.ts — idle detection cho loop
// ✅ packages/core/src/laneboard.ts — heartbeat freshness (observe/threshold)
// ✅ packages/agent/src/sdk.ts — agent lifecycle events
// ❌ KHÔNG có re-assert với exponential backoff (cho title hoặc resource async-overridden)
```

## Implementation

```typescript
// packages/print/src/title-reassert.ts (NEW)
export class TitleReassertor {
  private timer?: NodeJS.Timeout;
  private delay = 200;          // start
  private readonly min = 200;
  private readonly max = 5000;  // cap 5s

  constructor(private readonly setTitle: (t: string) => void, private readonly title: string) {}

  /** Bắt đầu re-assert sau agent_end (hoặc activity mới → reset). */
  start(): void {
    this.delay = this.min;      // reset backoff khi có activity mới
    this.tick();
  }

  private tick(): void {
    this.setTitle(this.title);                     // re-assert (thắng race async)
    this.delay = Math.min(this.delay * 2, this.max); // exponential, cap 5s
    this.timer = setTimeout(() => this.tick(), this.delay);
  }

  stop(): void { clearTimeout(this.timer); this.timer = undefined; }
}

// Hook: agent.on("agent_end", () => reassertor.start());
// khi user focus lại / activity mới → start() reset backoff về 200ms.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thắng race với async override (pi-autoname) | ❌ Re-assert thừa khi không ai override |
| ✅ Idle backoff dài → tiết kiệm CPU | ❌ Cần reset backoff đúng lúc (activity event) |
| ✅ Cap 5s — không quá thưa | ❌ Title "nhấp nháy" nếu 2 bên re liên tục (cần debounce) |

## Khác các hướng gần

| | AGV Idle Reassert | AGL Render Coalesce | AGW Native Progress OSC |
|---|---|---|---|
| Trọng tâm | Thắng race async override | Gộp vẽ thành 1 frame | Terminal native progress |
| Cơ chế | Exponential backoff re-assert | 1 timer + editor-defer | OSC 9;4 + keepalive |
| Quan hệ | Nối title lifecycle | Nối render loop | Nối terminal protocol |

## Khi nào chọn

- Resource bị override async bởi tiến trình khác (title, env, file) — cần re-assert
- Muốn tiết kiệm CPU khi idle (backoff dài, không re liên tục)
- Cần thắng race mà không nóng CPU
- Guard: exponential backoff cap 5s, reset khi activity mới, stop khi không cần
