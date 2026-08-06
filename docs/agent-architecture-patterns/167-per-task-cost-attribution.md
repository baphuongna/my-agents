# Hướng LLLLLLL: Per-Task Cost Attribution & Budgeting — tính giá chính xác từng task, cấp ngân sách

> **Nguồn gốc:** Codenotary "AI Agent Cost Monitoring" (tracking, attributing, optimizing LLM + tool spend of autonomous agents in real time); finout.io "AI FinOps: 7 Steps" (cost-per metrics); portkey "AI Cost Observability" (where costs leak, metrics that matter); finops.org "FinOps for AI"
> **Coupling:** 🟡 — các thành phần phải báo cost đầy đủ (LLM + tool + infra)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (finops YYY + cost tracking sẵn; thiếu attribution + budget)
> **Effort:** 1-2 tuần

## Nguồn gốc

Per-task cost attribution: **mỗi task có đầy đủ cost (LLM + tool + infra) + ngân sách riêng, vượt là chặn** — Codenotary: "tracking, attributing, and optimizing the LLM and tool spend of autonomous agents in real time — track spend before it spirals"; finout: "tracking new metrics like cost-per (cost per task, per agent, per team)"; portkey: "AI cost observability — where costs leak, the metrics that matter"; finops.org: chuẩn ngành — "managing costs and optimizing resource usage for AI". Điểm khác **YYY finops** (giám sát tổng + alert) và **GGGG budget** (giới hạn token/cost toàn cục) — LLLLLLL *từng task*: attribution — mỗi task request có ID, mọi cost (LLM call, tool MCP, token, infra) gắn vào ID (Codenotary real-time); budget — task/user/team có ngân sách (finout cost-per-task), vượt → chặn hoặc hạ model (GGG routing giá rẻ — preMAI model routing); dashboard — xem task nào đắt (portkey leaks), theo dõi theo thời gian thực (Codenotary spiral); alert — vượt threshold (YYYY); forecast — dự báo hết ngân sách tháng (finops.org). Nối YYY (nền metric), GGGG (budget — mở rộng), GGG (routing — hạ giá khi vượt), KKKKKKK (cache — giảm cost), WWWW (billing — hóa đơn user), AAAAAAA (commerce — tính tiền per task).

## Mô tả

mya per-task attribution: (1) **task ID propagation** — mọi call mang task ID (header/context — OpenTelemetry-style); (2) **attribution** — gom mọi cost: LLM tokens (input/output, cache hit rẻ hơn — KKKKKKK), MCP tool calls, token embedding, infra (server) → theo task ID (Codenotary); (3) **budget** — ngân sách per task/user/team (finout cost-per-task) + threshold; (4) **enforcement** — vượt ngân sách: chặn task (GGGG), hoặc tự hạ model (GGG — GPT-4o → mini khi gần hết — preMAI routing), báo user (TTTT); (5) **analytics** — task nào tốn nhất (portkey leaks), cost-per-task theo thời gian (finops.org), dự báo (forecast — hết tiền khi nào); (6) **billing** — đẩy cost per task sang hóa đơn (WWWW/A AAAAAAA nếu tính phí user).

## Kiến trúc

```
  TASK (ID) ──► mọi call mang ID (propagation — OTel-style)
        │
        ▼
  ATTRIBUTION (Codenotary real-time): LLM tokens (input/output/cache-hit)
   · MCP tool · embedding · infra → GOM theo task ID
        │
        ▼
  BUDGET CHECK (finout cost-per-task): vượt threshold?
   · CHẶN (GGGG) · HẠ MODEL (GGG — mini khi gần hết · preMAI)
   · báo user (TTTT)
        │
        ▼
  ANALYTICS: task đắt nhất (portkey leaks) · forecast hết ngân sách
   · cost-per-task theo thời gian (finops.org) ──► WWWW billing
```

```
mya: YYY + GGGG + GGG SẸN — thiếu: attribution per-task + enforcement
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ YYY finops — đo cost tổng + alert (nền)
// ✅ GGGG budget — giới hạn toàn cục
// ✅ GGG routing — model (hạ giá khi cần)
// ✅ KKKKKKK prompt cache — giảm cost
// ✅ WWWW billing + AAAAAAA commerce — tính tiền
// ✅ TTTT explainable — báo user

// ❌ THIẾU: task ID propagation (mọi call gắn ID)
// ❌ THIẾU: per-task attribution (LLM + tool + infra gom theo ID)
// ❌ THIẾU: per-task budget + enforcement (hạ model/chặn)
```

## Implementation

```typescript
// packages/cost/src/attribution.ts (NEW)
export class CostAttribution {
  async run(task: Task, fn: () => Promise<void>): Promise<CostReport> {
    const span = telemetry.start(task.id); // Codenotary — task ID propagation
    try { await fn(); } finally {
      span.attrib({ llm: llm.cost(span), tools: mcp.cost(span), infra: infra.cost(span) });
      const total = span.total();
      if (total > task.budget) await degrade(span); // GGG hạ model / GGGG chặn
      finops.record(task.id, total);                // YYY + forecast (finout)
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết chính xác task nào tốn bao nhiêu (Codenotary) | ❌ Mọi call phải mang ID — thêm chi phí hạ tầng |
| ✅ Chặn trước khi "spiral" — budget per task (finout) | ❐ Tool MCP ngoài không báo cost → attribution thiếu |
| ✅ Tự hạ model khi gần hết ngân sách (preMAI routing) | ❌ Forecast không chính xác với agent tự do |
| ✅ Xây trên YYY + GGGG + GGG | ❌ Cache hit / giá provider đổi → số liệu lệch |

## Khác các hướng gần

| | YYY FinOps | GGGG Budget | LLLLLLL: Per-Task Cost |
|---|---|---|---|
| Phạm vi | Tổng hệ thống | Nguồn lực | **Từng task cụ thể** |
| Mục đích | Quan sát | Giới hạn | **Gán giá + ngân sách per task** |
| Quan hệ | Nền đo | Enforcement | **Attribution + budget task-level** |

## Khi nào chọn

- Muốn biết chính xác task nào đắt (agent tự do — cost "spiral" — Codenotary)
- Cần giới hạn cost per task/user/team (finout cost-per-task)
- Tính phí per task (WWWW/A AAAAAAA)
- Đã có YYY + GGGG + GGG — thêm propagation + attribution