# Hướng UU: Escalation Tree — graduated failure, không chỉ retry

> **Nguồn gốc:** enterprise workflow design; LangGraph long-running processes; agentpatternscatalog "Incident Response Runbook"
> **Coupling:** 🟢 — mya nội bộ giữa các lớp xử lý
> **Agent-agnostic:** ✅ — bất kỳ agent thất bại đều đi cùng cây
> **Code sẵn:** ❌ build mới (cron + gateway làm nền)
> **Effort:** 1 tuần

## Nguồn gốc

Retry thuần (retry N lần rồi bỏ) thiếu một bậc: hệ thống trưởng thành phân loại **mức xử lý** theo chiều tăng dần: (1) agent tự sửa → (2) rule-based deterministic → (3) human. LangGraph gọi là graduated failure handling; catalog xếp vào Incident Response Runbook. Ý tưởng: mỗi lần thất bại **leo một bậc**, không lặp lại cùng chiến thuật — chống infinite-retry loop đồng thời giữ task tiến lên.

## Mô tả

Khi agent fail (task chưa xong, test vẫn đỏ): bậc 1 agent retry có cải tiến (kèm bài học); fail lần 2 → bậc 2 áp **rule deterministic** (vd: "test flaky → skip + TODO comment"); fail tiếp → bậc 3 **escalate human** (tạo issue, báo user qua intercom) — không treo vô hạn. Cây có nhánh theo loại lỗi (compile error ≠ flaky test ≠ API timeout). Khác QQ (circuit breaker — chặn *provider* chết): UU xử lý *task thất bại*, có cấp bậc quyết định.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                 ESCALATION TREE (mya)                       │
│                                                            │
│  task fail ──► ┌────────────┐                              │
│                │ classify   │                              │
│                │ error type │                              │
│                └─────┬──────┘                              │
│               ┌──────┼──────────────────┐                  │
│               ▼      ▼                  ▼                  │
│        compile/flaky/API timeout/...    │                  │
│               │      │                  │                  │
│      ┌────────┴─┐  ┌─┴─────────┐  ┌────┴───────┐          │
│      │ B1: agent│  │ B2: rule  │  │ B3: human  │          │
│      │ retry    │  │ fallback  │  │ escalate   │          │
│      │ (learned)│  │ (no LLM)  │  │ issue+notif│          │
│      └──────────┘  └───────────┘  └────────────┘          │
│                                                            │
│  Mỗi lần fail = leo 1 bậc. Không bao giờ lặp cùng bậc.    │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (nền)

```typescript
// ✅ packages/cron — job với failure count + retry (sweep reconcile)
// ✅ packages/core/src/supervised.ts — maxRestarts cap (bậc 0: restart có giới hạn)
// ✅ packages/gateway/src/mcp-client.ts — connect cooldown (bậc infra)
// ✅ packages/intercom — kênh báo user khi escalate (bậc 3)
// ✅ packages/print/src/mya-bridge.ts — createIssue tool (nếu dùng GitHub)

// ❌ THIẾU: cây phân loại lỗi + rule fallback registry + leo bậc có kỷ luật.
```

## Implementation

```typescript
// packages/gateway/src/escalation.ts (NEW)
type EscalationLevel = 1 | 2 | 3;

interface EscalationPolicy {
  classify(error: TaskError): ErrorClass;      // flaky | compile | timeout | ...
  levelFor(error: TaskError, attempt: number): EscalationLevel;
  fallback(error: TaskError): string | null;   // rule deterministic (bậc 2)
}

class Escalator {
  private attempts = new Map<string, number>();

  async handle(taskId: string, error: TaskError): Promise<void> {
    const attempt = (this.attempts.get(taskId) ?? 0) + 1;
    this.attempts.set(taskId, attempt);
    const level = this.policy.levelFor(error, attempt);

    if (level === 1) {
      await this.retryWithLesson(taskId, error);       // kèm bài học → agent
    } else if (level === 2) {
      const action = this.policy.fallback(error);      // rule, 0 LLM call
      if (action) { await applyRule(action); return; }
      await this.handle(taskId, error);                // leo tiếp nếu không có rule
    } else {
      await this.escalateHuman(taskId, error);         // issue + intercom notify
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống infinite-retry (leo bậc thay vì lặp) | ❌ Rule fallback phải viết theo từng loại lỗi |
| ✅ Task vẫn tiến (skip-test + TODO thay vì kẹt) | ❌ Escalate human nhiều → phiền |
| ✅ Không tốn LLM call ở bậc 2 (deterministic) | ❌ Phân loại lỗi sai → leo sai nhánh |
| ✅ Audit được hành trình xử lý | |
| ✅ Kết hợp SS (budget) + TT (checkpoint) | |

## Khi nào chọn

- Agent chạy tự động (cron/daemon) — không ai trông
- Muốn "fail có kỷ luật" thay vì retry mù
- Đã có cron + supervised + intercom
- Muốn bậc deterministic (rẻ) trước bậc human (đắt)
