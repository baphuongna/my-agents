# Hướng ABY: Nonblocking Subagent Steering — pi-crew spawn subagent trong isolated session chạy nền; kết quả gửi về dưới dạng steering message trigger turn mới, queue nếu session chủ không active

> **Nguồn gốc:** pi-crew (README.md) | **Coupling:** 🔴 — thêm background subagent lifecycle vào core agent loop | **Agent-agnostic:** ⚠️ (phụ thuộc steering message + turn model) | **Code sẵn:** ⚠️ (có subagent + steer queue + bg-runner — chưa có async delivery hoàn chỉnh) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-crew** spawn subagent trong **isolated session chạy nền (background)** — subagent có **context window, tools, skills riêng** (không dùng chung context parent). Khi subagent xong: kết quả được gửi về **session chủ dưới dạng steering message** — trigger **turn mới** của session chủ (steering = message chen vào turn). Nếu session chủ **không active** (user đã rời, turn đang idle) → kết quả bị **queue lại** tới khi user quay lại. Đây là **"non-blocking orchestration + async delivery"** — session chính luôn interactive (không chờ subagent chạy xong). Nguyên tắc: **subagent chạy nền (isolated), kết quả là steering message (trigger turn mới), queue khi owner không active**.

## Mô tả

mya nonblocking subagent steering: spawn subagent **background** (isolated session — context/tools/skills riêng); khi xong → kết quả thành **steering message** gửi về session chủ → **trigger turn mới** (session chủ xử lý kết quả ngay); nếu session chủ **không active** → kết quả **queue** lại tới khi user quay lại (không mất, không spam). mya có packages/agent spawnSubagent + packages/core session-utils.ts (MessageQueue: steer/followUp/nextTurn) + packages/print bg-runner.ts (--bg session nền) — ABY thêm **background subagent lifecycle** (isolated session nền) + **steering delivery** (kết quả → steer message trigger turn) + **inactive queue** (owner không active → queue).

## Kiến trúc

```
  SESSION CHỦ (luôn interactive — không chờ subagent)
       │
       │  spawn subagent (background, isolated session)
       ▼
  SUBAGENT SESSION (nền — context window, tools, skills RIÊNG)
       │
       │  chạy xong
       ▼
  KẾT QUẢ ──► STEERING MESSAGE (gửi về session chủ)
       │
       ├── session chủ ACTIVE ──► trigger turn mới → xử lý ngay
       └── session chủ KHÔNG ACTIVE ──► QUEUE (chờ user quay lại)
                                          │
                                          ▼
                                   user quay lại → flush queue → xử lý
  → non-blocking orchestration + async delivery
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent — spawnSubagent + pool (nền — ABY spawn)
// ✅ packages/core session-utils.ts — MessageQueue (steer/followUp/nextTurn) (nền — ABY steering delivery)
// ✅ packages/print bg-runner.ts — background session runner (nền — ABY bg infrastructure)
// ✅ packages/print role-subagent-spawn.ts — role-subagent spawn (nền — ABY spawn path)
// ✅ packages/rpc tcp-server.ts — TCP cho bg session (nền — ABY isolated session transport)

// ❌ THIẾU: subagent background lifecycle (spawn nền + chờ kết quả async)
// ❌ THIẾU: steering delivery (kết quả → steer message trigger turn mới)
// ❌ THIẾU: inactive queue (owner không active → queue tới khi quay lại)
```

## Implementation

```typescript
// packages/agent/src/nonblocking-subagent.ts (MỚI)
import type { Agent } from "./index.js";
import type { MessageQueue } from "@my-agent/core";

export interface SubagentHandle { id: string; status: "running" | "done" | "failed" }

/** Nonblocking subagent: spawn nền, kết quả → steering message (trigger turn mới). */
export class NonblockingSubagent {
  constructor(private agent: Agent, private queue: MessageQueue) {}

  /** Spawn subagent background; khi xong → steering message (hoặc queue nếu inactive). */
  async spawnInBackground(task: string, opts?: { model?: string }): Promise<SubagentHandle> {
    const handle = this.agent.spawnSubagent(task, opts);

    // Đăng ký callback: subagent xong → delivery kết quả
    void this.agent.onSubagentOutput(handle.id, (output) => {
      const steering = `[subagent ${handle.id} hoàn thành]\n${output}`;
      const active = this.agent.isTurnActive();
      if (active) {
        this.queue.enqueue(steering, "steer"); // trigger turn mới NGAY (chen vào turn)
      } else {
        this.queue.enqueue(steering, "nextTurn"); // QUEUE — chờ user quay lại
      }
    });

    return { id: handle.id, status: "running" };
  }

  /** Flush queue khi user quay lại (session chủ active trở lại). */
  flushPending(): void {
    for (const msg of this.queue.drain("nextTurn")) {
      this.queue.enqueue(msg.text, "steer"); // đưa vào turn hiện tại
    }
  }
}

// Usage:
// const sub = new NonblockingSubagent(agent, messageQueue);
// await sub.spawnInBackground("review code", { model: "haiku" });
// // session chủ KHÔNG chờ — user vẫn chat được (non-blocking)
// // subagent xong → steering message trigger turn mới; owner idle → queue
// sub.flushPending(); // khi user quay lại → flush queue
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Non-blocking (session chủ luôn interactive — không chờ subagent) | ❌ Orchestration phức tạp (async delivery — race, ordering) |
| ✅ Isolated context (subagent không làm phình context chủ) | ❌ Kết quả muộn (user phải đợi subagent xong mới thấy) |
| ✅ Steering trigger (kết quả tự động trigger turn mới) | ❌ Queue stale (kết quả queue lâu → context cũ khi flush) |
| ✅ Queue an toàn (owner không active → không mất kết quả) | ❌ Multiple subagent (nhiều kết quả về cùng lúc → thứ tự?) |

## Khác các hướng gần

| | Synchronous subagent (chờ) | Fire-and-forget (mất kết quả) | ABY: Nonblocking Steering |
|---|---|---|---|
| Session chủ | bị chặn | tự do | **tự do (non-blocking)** |
| Kết quả | trả trực tiếp | có thể mất | **steering message (trigger turn)** |
| Owner inactive | — | mất | **queue → flush khi quay lại** |
| Context | chung | riêng | **isolated session riêng** |

## Khi nào chọn

- Muốn spawn subagent mà không block session chính (user tiếp tục chat)
- Cần kết quả subagent được xử lý (steering trigger turn mới) nhưng an toàn khi owner vắng
- Đã có subagent spawn + MessageQueue (steer) + bg-runner — chỉ thêm lifecycle async
- Nối packages/agent + packages/core session-utils.ts (MessageQueue) + packages/print bg-runner.ts + role-subagent-spawn.ts; guard delivery-ordering (kết quả nhiều subagent → thứ tự rõ), queue-freshness (queue quá lâu → compact trước khi flush), và turn-trigger (steering chỉ trigger 1 turn — không loop vô hạn); ABY = nonblocking subagent steering, kết hợp 754 ABZ frontmatter-driven-subagent-discovery (subagent config từ frontmatter) + 755 ACA live-status-widget-subagents (widget hiển thị subagent đang chạy nền)
