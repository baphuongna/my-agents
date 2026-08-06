# Hướng BO: Serverless / FaaS Agents — agent scale-to-zero, event-triggered

> **Nguồn gốc:** AWS Prescriptive Guidance 2026 "Agentic AI on serverless"; blaxel 2026
> **Coupling:** 🟢 — triển khai qua event bus, agent không biết hạ tầng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cron + kanban sweep sẵn; thiếu event-triggered scale-out)
> **Effort:** 1-2 tuần

## Nguồn gốc

Serverless/FaaS cho agent (AWS Prescriptive Guidance 2026 "Agentic AI serverless"): agent chạy như **function scale-to-zero** — không có tiến trình thường trực; được **trigger bởi event** (job queue, message, webhook, timer); mỗi lần chạy là 1 đơn vị work riêng; orchestrate bằng durable workflow (step functions, Temporal). blaxel 2026: LLM-generated code chạy trong sandbox khi serverless. Điểm cốt lõi: **stateless execution units** — fail là retry sạch (không process treo), scale theo event, cost theo thời gian chạy thực. Khác N Agent OS (agents thường trực như apps) — serverless là *đối nghịch*: không có agent ngủ, chỉ có hàm thức dậy khi có việc.

## Mô tả

mya chuyển các **worker** thường trực thành serverless units: kanban sweep (quét task đến hạn), cron jobs (packages/cron), intercom responders — mỗi event (task mới, message đến, timer) → trigger 1 execution → xử lý → trả kết quả vào store (kanban/ledger) → **scale-to-zero** (giải phóng process). Trạng thái duy nhất nằm ở store ngoài (kanban-sqlite, ledger K, session JSONL) — execution vô trạng thái nên crash = retry an toàn (TT checkpoint hỗ trợ resume). Worker nặng (agent loop dài) vẫn chạy process riêng — serverless chỉ cho tác vụ ngắn, event-driven.

## Kiến trúc

```
  EVENT SOURCES (thức dậy agent)
  ├─ kanban task mới ──┐
  ├─ intercom message ─┤──► EVENT BUS ──► TRIGGER (1 execution mỗi event)
  ├─ cron timer ───────┘                          │
                                                 ▼
                                     HANDLER (stateless, scale-to-zero)
                                       │ đọc state từ store ngoài
                                       │ xử lý (có thể spawn subagent XX)
                                       ▼
                          ghi kết quả: kanban · ledger (K) · session JSONL
                                       │
                          execution kết thúc → giải phóng (0 cost idle)
```

```
mya: packages/cron + gateway/cron-sweep.ts = timer trigger sẵn
     thiếu: event bus trigger (kanban/message) + isolation per execution
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/cron — timer-triggered jobs (1 loại event)
// ✅ packages/gateway/src/cron-sweep.ts — kanban sweep định kỳ (sẵn mẫu worker)
// ✅ packages/tools/src/kanban-sqlite.ts — store ngoài (state duy nhất) — nền stateless
// ✅ session JSONL (TT) — checkpoint/resume sau crash

// ❌ THIẾU: trigger từ event khác (task mới, message) — hiện chỉ timer
// ❌ THIẾU: isolation per execution (retry không đụng tiến trình khác)
// ❌ THIẾU: triển khai scale-to-zero (serverless platform hoặc process pool nhỏ)
```

## Implementation

```typescript
// packages/gateway/src/serverless-agent.ts (NEW)
interface AgentEvent {                     // đơn vị work
  type: "kanban-task" | "intercom-msg" | "cron" | "webhook";
  payload: unknown;
  traceId: string;                         // JJJ: span root
}

async function onEvent(ev: AgentEvent): Promise<void> {
  // stateless: mọi state đọc từ store ngoài, không giữ trong process
  const state = await snapshotFromStores(ev);     // kanban + ledger + session
  const result = await handle(ev, state);          // có thể spawn subagent (XX)
  await writeBack(result);                          // kanban/ledger — duy nhất nơi lưu
  // end: process có thể giải phóng — retry = chạy lại từ snapshot
}

// cron-sweep.ts hiện có → mở rộng: kanban task mới / intercom message cũng trigger
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 0 chi phí idle — worker không ngủ chờ | ❌ Cold start: mỗi event khởi tạo context |
| ✅ Crash = retry sạch (stateless) — không process treo | ❌ Agent loop dài không hợp (state ngoài, token) |
| ✅ Scale theo event tự nhiên (burst message) | ❌ Store ngoài là điểm nghẽn (kanban/session) |
| ✅ cron + kanban sweep sẵn — mở rộng trigger | ❌ Debug distributed khó hơn (JJJ bù) |
| ✅ Kết hợp TT: retry resume từ checkpoint | |

## Khác các hướng gần

| | N Agent OS | Q Connection Pool | PPP: Serverless |
|---|---|---|---|
| Vòng đời | Agents thường trực | Session giữ ấm | **Scale-to-zero** |
| Trạng thái | Trong agent | Trong session | Store ngoài (kanban/ledger) |
| Trigger | Mở thủ công | Yêu cầu tới | **Event** (task/msg/timer) |
| Mối quan hệ | Đối nghịch | Phủ (pool cho agent loop) | Bổ trợ (worker ngắn) |

## Khi nào chọn

- Có worker chạy định kỳ rảnh rỗi 90% (kanban sweep, cron)
- Muốn xử lý burst event (message, task mới) không cần process thường trực
- Muốn crash = retry an toàn (stateless + TT checkpoint)
- Trạng thái đã ở store ngoài — chuyển stateless là tự nhiên