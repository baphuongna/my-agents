# Hướng GU: Failure Detection & Retry Loops — chống lặp vô hạn, lỗi lặp lại không tiến bộ

> **Nguồn gốc:** Towards AI "Building Retries in Agents" (xử lý LLM failures, tool errors, crashed workflows — retry-classify loop); dev.to "7 Patterns That Stop Your AI Agent From Going Rogue" (circuit breakers, retry-classify, guardrails, kill switches); ODSC "The 3 Loops That Break AI Agents in Production" (retry loop — agent thử mãi không tiến bộ, tool loop, reflection loop); CockroachDB "Why Agent Loops Fail in Production" (state approval nằm trong memory — restart xoá context → workflow stuck); Taskade "AI Agent Self-Healing" (rate limit → backoff → retry); Augment Async "survive via durable execution + checkpointing — không restart từ đầu"
> **Coupling:** 🟡 — chạm mọi loop vòng đời agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (có max-step + timeout; thiếu circuit breaker + duck)
> **Effort:** 3-6 tuần

## Nguồn gốc

Failure detection: **xác định "kẹt" = lặp không tiến — qua *circuit breaker*, *classification lỗi*, *checkpointing*, *kill-switch* — thay vì retry mù** — ODSC: 3 loop chết người: (1) **retry loop** — "agent keeps attempting a task without measurable progress"; (2) **tool loop** — tool lỗi nối tiếp; (3) **reflection loop** — tự nhận xét mãi không ra. dev.to: retry-classify — *ghi lỗi thành tags, so* → chống lại *random retry*; circuit breaker — cắt sau N lỗi thay vì retry tiếp; guardrails + kill switch — phạm vi chạy. CockroachDB: approval state trong application memory → restart xóa context, workflow "stuck, abandoned, or resumed incorrectly" — state phải ra durable store. Taskade/Augment: rate limit → backoff; async workflow dùng durable execution + checkpointing — "start over from step 1 re-running every model call and side effect" là hậu quả không durable. End của **169 self-healing** (phục hồi); **174 fault-tolerance** (failover — định tuyến lại khi chết) — VVVVVV tập trung *phát hiện + dừng loop lặng bằng/không tiến* trước khi đốt token/quota.

## Kiến trúc

```
  LOOP STEP (action → result)
        │
        ├── MEASURE PROGRESS (ODSC: tiến bộ đo được? — token/turn counter)
        ├── NO PROGRESS ──► CLASSIFY (retry-classify — ghi tag, không retry mù)
        │                       retry(TTL) │ backoff (rate-limit) │ fail-fast (circuit 3×)
        │                                   └──► KILL-SWITCH (dev.to) + ALERT
        ├── STATE ──► DURABLE STORE (CockroachDB: không ở memory — không restart mất)
        └── CHECKPOINT (Augment: resume từ điểm an toàn, không chạy lại side-effect)
```

```
mya: CHƯA: classifier loop-loop, circuit breaker, checkpoint durable
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ max-step + max-token — dừng sau ngưỡng (thô — không phân biệt loop type)
// ✅ 169 self-healing — chuỗi phục hồi mức hệ thống
// ✅ 174 retry/failover — nghe service lan truyền
// ✅ 131 watchdog / 134 consensus . — phát hiện quá thời gian

// ❌ THIẾU: retry-classify loop (đếm rate: cùng tool+lỗi lặp → tăng classes → dừng)
// ❌ THIẾU: circuit breaker + backoff (rate-limit/429/503)
// ❌ THIẾU: checkpoint durable (state không mất khi restart — Cockroach)
// ❌ THIẾU: kill-switch theo guardrail (chặn khi chạm ngưỡng chi phí)
```

## Implementation

```typescript
// packages/loopguard/src/guard.ts (NEW)
export class LoopGuard {
  private marks = new Map<string, Hit[]>(); // key = action signature
  async attempt(name: string, fn: Call): Promise<void> {
    const hits = this.marks.get(name) ?? [];
    if (hits.length >= this.circuitAfter) throw new CircuitOpen(); // breaker
    if (classifyRegression(name, hits)) throw new LoopDetected();  // no progress
    try { await fn(); } catch (e) {
      if (isRateLimit(e)) await backoff(e.retryAfter);             // 429 backoff
      else rethrow;
    }
  }
  // state per func đưa vào durable store — restart không mất (Cockroach)
  checkpoint(ctx).saveTo(Durable.every(turn));   // resume không chạy lại side-effect
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ngừng đốt token/quota (retry vô hạn ~ $400 ví dụ LinkedIn) | ❌ Hiểu lầm: loop hợp lệ bị cắt (nhầm "chưa xong" thành "kẹt") |
| ✅ Phân biệt retry hợp lệ vs không tiến — classifier thay vì count | ❌ Threshold phải tinh chỉnh theo từng task |
| ✅ Trạng thái durable — không mất workflow mà đã ghi checkpoint tiếp tục | ❌ Thêm độ trễ + phải quản lý store/checkpoint |
| ✅ Xây trên 169/174/watchdog | ❌ Chống loop ≠ chống sai — sai lặp vẫn qua cầu |

## Khác các hướng gần

| | 169 Self-healing | 174 Failover | VVVVVVV: Loop Guard |
|---|---|---|---|
| Mục | Sửa lại service gãy | Chuyển khi node chết | **Ngừng lặp không tiến** |
| Thời điểm | Hệ thống hư hư | Khi component mất | **Trong thời chạy — mỗi vòng lặp** |
| Quan hệ | Gọi khi đã xuống | Gọi khi mất node | **Thêm lớp ở mọi loop — đầu tiên** |

## Khi nào chọn

- Agent tự động chạy lâu (batch, survey) — không ai trông
- Token/quota chi phí cao — một task "mắc kẹt" đốt ngân sách
- State xử lý trong memory — restart mất (Cockroach Traps)
- Luôn đi kèm: circuit breaker ở rìa, checkpoint ở mọi side-effect