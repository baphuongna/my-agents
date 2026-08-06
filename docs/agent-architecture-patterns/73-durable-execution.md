# Hướng VVV: Durable Execution — workflow sống sót mọi crash

> **Nguồn gốc:** Temporal (2024-2026); LangGraph+Temporal plugin; activewizards "Indestructible AI Agents"
> **Coupling:** 🟢 — workflow code thuần, hạ tầng replay vô hình
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (workflow runner + session sẵn; thiếu replay determinism)
> **Effort:** 2-3 tuần

## Nguồn gốc

Durable execution (Temporal): workflow viết như **code bình thường** (`for` loop, `await` call) nhưng chạy trên hạ tầng **ghi lại mọi step (event history) + replay lại từ đầu khi crash** — deterministic replay: chạy lại đến đúng step cũ, bỏ qua các effect đã thực hiện (idempotent), tiếp tục từ đó. "Indestructible AI Agents" (activewizards 2026): áp dụng cho agent loop dài — model call, tool call, sleep, retry đều là step; crash giữa chừng = workflow replay về đúng chỗ, không mất trạng thái, không làm đúp effect. LangGraph+Temporal plugin (2025): chạy LangGraph graph như Temporal Workflow, mỗi node là Activity. Khác **TT Wait-Event Checkpoint** (checkpoint JSONL *thủ công*, resume phải tự viết) — durable execution là **SDK có replay + retry tự động**, workflow code không đổi.

## Mô tả

mya chuyển các **tiến trình dài** (agent loop nhiều bước, kanban task chain, SOP scripts trong packages/workflows) thành **durable workflows**: mỗi bước (LLM call, tool call, wait) là 1 activity — hạ tầng ghi event vào store; crash/restart → **replay history** → workflow chạy lại deterministic → đến step dở dang → **retry activity** (chính sách riêng: LLM call retry, tool call idempotent check) → tiếp tục. Session JSONL (TT) đã là "history" thô — durable execution thêm *replay engine* lên trên. Kết hợp: FF Saga (rollback khi workflow fail giữa chuỗi), QQ breaker (activity fail liên tục → mở breaker), JJJ (mỗi workflow 1 trace).

## Kiến trúc

```
  WORKFLOW (code thuần — như script thường)
  │  step1: LLM call ──► activity (ghi event history)
  │  step2: tool call ──► activity (idempotent: đã làm → skip)
  │  step3: wait event ─► activity (TT: chờ CI/approval)
  │  step4: kanban update ─► activity
  ▼
  EVENT HISTORY (store) — mọi step đã ghi
      │ crash / restart
      ▼
  REPLAY ENGINE: chạy lại workflow từ đầu (deterministic)
      │  ──► tới step dở dang ──► retry activity (policy riêng)
      │  ──► effect đã làm → skip (idempotent)
      ▼
  tiếp tục từ đúng chỗ — không mất state, không đúp effect
```

```
mya: packages/workflows (runner) + session JSONL (TT) + kanban sẵn
     thiếu: replay engine (determinism) + event history schema + retry policy
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows — sandboxed runner (vm, cron, SOP) — nền workflow
// ✅ session JSONL (TT) — đã ghi history từng bước (nền event history)
// ✅ packages/tools/src/kanban-sqlite.ts — state ngoài (resume điểm nối)
// ✅ packages/ai/src/fallback.ts — retry sẵn (bước chân cho retry policy)

// ❌ THIẾU: replay engine — chạy lại workflow deterministic từ event history
// ❌ THIẾU: idempotency check cho tool effect (chống đúp khi replay)
// ❌ THIẾU: retry policy per activity (LLM retry khác tool retry)
```

## Implementation

```typescript
// packages/workflows/src/durable.ts (NEW)
interface Activity<T = unknown> {
  name: string;
  run(ctx: WorkflowContext): Promise<T>;
  idempotent?: boolean;                // đã chạy trong history → skip (replay)
}

async function durableRun(history: EventHistory, activities: Activity[]): Promise<void> {
  for (const act of activities) {
    if (history.has(act.name)) {       // replay: step đã xong
      if (!act.idempotent) await act.run(ctx);     // non-idempotent chạy lại
      continue;
    }
    await retry(act.run, actPolicy(act));           // retry policy per activity
    history.append(act.name);                      // ghi trước khi sang bước sau
  }
  // crash giữa chừng → chạy lại từ đầu, event history quyết định skip
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Crash = replay tự động — không mất tiến trình dài | ❌ Determinism: workflow không được dùng thời gian thực/random |
| ✅ Không đúp effect (idempotent check) | ❌ Event history phình theo số step (dài → nhiều event) |
| ✅ Retry policy theo từng activity | ❌ Replay lại từ đầu tốn (workflow dài replay nhanh — chỉ LLM step tốn) |
| ✅ TT checkpoint sẵn → thêm replay engine | ❌ Cần hạ tầng store history đáng tin (kanban/ledger) |
| ✅ packages/workflows sẵn — thêm lớp durability | |

## Khác các hướng gần

| | TT Wait-Event Checkpoint | FF Saga | VVV: Durable Execution |
|---|---|---|---|
| Resume | Checkpoint JSONL thủ công | Rollback khi fail | **Replay tự động từ history** |
| Retry | Tự viết | Không | Per-activity policy |
| Determinism | Không bắt buộc | Không | **Bắt buộc (replay)** |
| Mối quan hệ | Nền history | Xử lý fail | Bổ sung cả hai |

## Khi nào chọn

- Tiến trình dài nhiều bước thường chết giữa chừng (agent loop, kanban chain)
- Muốn crash = tự phục hồi không cần viết resume thủ công
- Đã có workflow runner + session JSONL — thêm replay engine
- Kết hợp FF saga (fail giữa chuỗi) + QQ (activity hỏng)