# Hướng AFD: Background Learning Loop — mỗi 10 turn / 15 tool calls tự review conversation, lưu memory bằng subprocess

> **Nguồn gốc:** pi-hermes-memory | **Coupling:** 🟡 — subprocess + memory write (không chặn agent chính) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn auto-capture + dream-cycle; thiếu background review loop) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-hermes-memory** (src/handlers/background-review.ts): **mỗi 10 turn / 15 tool calls** tự **review conversation** và lưu memory bằng **subprocess pi** — transport **in-process complete()** giữ **LLM cache** (gọi model trong cùng process → prompt cache giữ nguyên, rẻ), **fallback `pi -p`** (spawn CLI nếu in-process không khả dụng). Mục đích: **học nền không chặn agent chính** — agent tiếp tục làm việc, review chạy song song/ẩn, kết quả (memory) lưu vào kho.

Giá trị: (1) **không block turn** — học xảy ra nền, không chèn độ trễ vào loop chính; (2) **interval thông minh** — 10 turn / 15 tool calls (không học mỗi turn — tốn, không đợi quá lâu — mất ngữ cảnh); (3) **cache-friendly** — in-process complete() giữ LLM cache — review rẻ hơn spawn mới; (4) **fallback** — môi trường không cho in-process → `pi -p` vẫn học được.

## Mô tả

Với mya, pattern = **background review worker gắn vào loop**: (1) **trigger** — đếm turn/tool calls trong loop (mya `core/loop.ts` có vòng + RuntimeEvent — đếm được; budget.ts có counter pattern); chạm 10 turn hoặc 15 tool calls → schedule review; (2) **subprocess/in-process** — mya có `packages/print/bg-runner.ts` (background session + TCP RPC) và `packages/ai` (in-process provider) — review chạy qua in-process complete() (giữ cache) hoặc spawn (fallback); (3) **review task** — gom conversation slice (nối AEW edit-tracker tinh thần — batching) → prompt review → extract memory candidates; (4) **write gate** — memory lưu qua **AFC content-gate** (scan trước khi persist — không để review LLM tự ghi bừa); (5) **không chặn** — review chạy async/background, agent loop tiếp tục (nối dream-cycle pattern — đã có consolidation nền ở memory package). Đây là pattern **off-path learning**: học là phụ trợ, không nằm trên đường tới của agent.

## Kiến trúc (ASCII)

```
  AGENT LOOP (core/loop.ts) — đếm turn + tool calls
    │  10 turn / 15 tool calls → SCHEDULE review (không chặn turn)
    ▼
  BACKGROUND REVIEW (subprocess/in-process — bg-runner pattern)
  ├─ gom conversation slice (batching — AEW tinh thần)
  ├─ review qua LLM:
  │    in-process complete() ──► giữ LLM cache (rẻ)
  │    fallback pi -p        ──► spawn CLI (môi trường không cho in-process)
  └─ memory candidates
    │
    ▼ WRITE GATE (AFC content-gate — scan trước khi lưu)
    ▼ persist (sqlite-store / auto-capture)
  (agent chính tiếp tục — học chạy nền, không chèn độ trễ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/loop.ts — vòng agent + RuntimeEvent (đếm turn/tool)
// ✅ packages/print/src/bg-runner.ts — background session + TCP RPC (mô hình nền)
// ✅ packages/ai — in-process provider runtime (nối complete() giữ cache)
// ✅ packages/memory/src/auto-capture.ts — bắt memory tự động (nền review)
// ✅ packages/memory/src/dream-cycle.ts — consolidation nền (pattern đã có)
// ✅ packages/memory/src/sqlite-store.ts — persist (điểm write qua AFC gate)
// ✅ packages/memory/src/content-gate.ts (AFC) — write gate

// ❌ THIẾU: interval trigger (10 turn / 15 tool calls) trong loop
// ❌ THIẾU: background review worker (in-process + fallback spawn)
// ❌ THIẾU: nối conversation slice → review → AFC gate → persist
```

## Implementation

```typescript
// packages/memory/src/background-review.ts (NEW)
export interface ReviewTriggers { turns: number; toolCalls: number; }

export class BackgroundLearning {
  private turns = 0;
  private toolCalls = 0;
  private running = false;

  constructor(
    private opts: ReviewTriggers,                       // { turns: 10, toolCalls: 15 }
    private review: (slice: string[]) => Promise<string[]>,  // LLM review
    private persist: (memories: string[]) => Promise<void>, // qua AFC gate
  ) {}

  /** Gọi từ loop: mỗi turn/tool event → đếm → schedule khi chạm ngưỡng. */
  onEvent(e: { kind: string }): void {
    if (e.kind === "text") this.turns++;
    if (e.kind === "tool_call") this.toolCalls++;
    if (!this.running &&
        (this.turns >= this.opts.turns || this.toolCalls >= this.opts.toolCalls)) {
      this.running = true;
      void this.runBackground();            // async — KHÔNG chặn turn
    }
  }

  private async runBackground(): Promise<void> {
    try {
      const slice = this.recentConversation();          // gom slice vừa qua
      const candidates = await this.review(slice);      // in-process complete() / spawn
      await this.persist(candidates);                   // AFC content-gate trước khi lưu
    } finally {
      this.turns = 0;
      this.toolCalls = 0;
      this.running = false;                             // sẵn sàng chu kỳ sau
    }
  }
  private recentConversation(): string[] { return []; } // nối loop history
}
// In-process: packages/ai complete() — giữ LLM cache (review rẻ)
// Fallback: spawn "pi -p" (bg-runner pattern) khi in-process không khả dụng
// Write: mọi memory qua AFC gate — review LLM không tự ghi bừa
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Học nền — không chèn độ trễ vào turn | ❌ Review async → memory về muộn (turn sau mới thấy) |
| ✅ Interval 10/15 — cân bằng chi phí vs độ tươi | ❌ Ngưỡng phải tune theo workload |
| ✅ In-process giữ LLM cache — review rẻ | ❌ Cache chia sẻ với agent chính — có thể tranh context |
| ✅ Fallback spawn — môi trường khác vẫn học | ❌ Subprocess thêm chi phí + lỗi cần xử lý im lặng |

## Khác các hướng gần

| | AFD Background Learning | AFF Auto-Consolidation | AEQ Graduation |
|---|---|---|---|
| Trọng tâm | Học nền từ conversation | Merge memory khi đầy | Thăng cấp tri thức |
| Cơ chế | Interval + in-process/spawn | Child process + reload | Pipeline + ngưỡng |
| Quan hệ | Nguồn memory mới | Dọn kho (capacity) | Nâng cấp sau (AFC sạch) |

## Khi nào chọn

- Conversation dài — cần học memory mà không chặn turn
- Đã có auto-capture + dream-cycle + bg-runner — thêm review loop
- Muốn tận dụng LLM cache (in-process complete()) cho review rẻ
- Cần fallback khi môi trường không cho in-process provider