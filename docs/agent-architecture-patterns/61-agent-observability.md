# Hướng BI: Agent Observability — trace từng bước reasoning + tool call

> **Nguồn gốc:** OpenTelemetry GenAI semantic conventions (2025); Red Hat 2026; LangSmith/Langfuse
> **Coupling:** 🟢 — telemetry qua span emit, không ràng buộc core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (1 phần — AuditLog/event ledger sẵn; thiếu span tree + metrics)
> **Effort:** 1-2 tuần

## Nguồn gốc

OpenTelemetry (OTel) — chuẩn vendor-neutral cho telemetry — mở rộng GenAI semantic conventions: span chuẩn hóa cho LLM calls (`gen_ai.*` attributes), tool calls, retrieval. Blog chính thức opentelemetry.io 2025 "AI Agent Observability" + Red Hat 2026 "Distributed tracing for agentic workflows": trace agent reasoning **end-to-end** qua MCP servers, Llama Stack, LLM providers. Khác K Event Ledger (log sự kiện tuần tự) — OTel trace là **cây span parent-child**: 1 task = 1 trace, mỗi tool call/LLM call = 1 span, đo latency + cost + token per span.

## Mô tả

mya bọc mỗi lần agent suy nghĩ → 1 span; mỗi tool call → span con (attached: model, tokens, cost, latency, ok/error); handoff/subagent → span cha-con giữa các agent (CCC/XX). Export qua OTLP (jaeger/tempo/OTel collector) hoặc lưu JSONL nội bộ. Trả lời được: "task X chậm vì 3 tool calls fail ở bước nào", "cost này đến từ span nào", "chuỗi handoff ai→ai nhìn được dạng tree". Khác PP Eval (chấm kết quả đúng/sai) — observability đo *hành vi runtime*, là dữ liệu vào cho eval + tuning.

## Kiến trúc

```
  task ──► TRACE root span
              ├─ LLM span  (gen_ai.model, prompt_tokens, completion_tokens, cost)
              │    ├─ tool span: kanban-sqlite (latency, ok, error_code)
              │    ├─ tool span: git-as-ipc   (latency, ok)
              │    └─ LLM span (tiếp tục suy nghĩ)
              ├─ subagent span (role-subagent-spawn → child trace)
              └─ handoff span (CCC: từ → đến)

  exporter: OTLP (jaeger/tempo) HOẶC JSONL nội bộ (đã có session JSONL)
  metrics: cost/token/latency per trace, per agent, per tool
```

```
mya: AuditLog (K) + session JSONL sẵn = nguồn sự kiện
     thiếu: span model parent-child, gen_ai attributes, metrics export
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core AuditLog (K) — sự kiện có thứ tự, là nền emit span
// ✅ session JSONL (TT) — có thể lưu trace dạng JSONL nội bộ
// ✅ packages/ai/src/registry.ts — TaintedProfile (quota/rate_limited) — dữ liệu span
// ✅ packages/ai/src/model-routing.ts — model/cost per call

// ❌ THIẾU: span tree (parent/child) — hiện log phẳng không có mối quan hệ
// ❌ THIẾU: gen_ai.* attributes chuẩn (model, tokens, cost) gắn từng span
// ❌ THIẾU: exporter (OTLP hoặc UI) + metrics (latency/cost per agent/tool)
```

## Implementation

```typescript
// packages/core/src/trace.ts (NEW) — span API nhẹ, không bắt buộc core
interface Span {
  id: string;
  parentId: string | null;            // cây: task → LLM → tool
  kind: "llm" | "tool" | "subagent" | "handoff" | "task";
  name: string;
  attrs: {
    gen_ai.model?: string;            // OTel convention
    gen_ai.prompt_tokens?: number;
    gen_ai.completion_tokens?: number;
    cost_usd?: number;
    latency_ms?: number;
    error_code?: string;
  };
  children: Span[];
}

// emit từ mọi nơi (transport bất đồng bộ — không chặn request loop)
function withSpan<T>(kind: Span["kind"], name: string, fn: () => T): T;

// export: OTLP nếu có collector · ngược lại JSONL (session dir sẵn)
// metrics: aggregate per trace → báo cáo cost/token/latency theo agent/tool
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Debug nhanh: thấy đúng span fail, không cần đọc log | ❌ Emit span thêm overhead nhỏ mỗi call |
| ✅ Cost/token attribution theo từng bước | ❌ Chuẩn OTel GenAI còn mới, có thể đổi |
| ✅ Cây handoff/subagent nhìn được (CCC/XX) | ❌ Cần exporter/UI hoặc tự dựng |
| ✅ Dữ liệu vào cho PP eval + tuning prompt | ❌ Trace nhạy cảm (nội dung) cần mask |
| ✅ AuditLog sẵn — chỉ thêm cấu trúc | |

## Khác các hướng gần

| | K Event Ledger | PP Eval Harness | JJJ: Observability |
|---|---|---|---|
| Trả lời | Gì đã xảy ra (tuần tự) | Kết quả đúng/sai | Vì sao chậm/tốn/fail |
| Cấu trúc | Log phẳng | Test cases | Cây span (parent-child) |
| Số liệu | Không | Pass/fail | Latency, cost, tokens, retry |
| Đầu ra | Audit | Score | Trace + metrics → tuning |

## Khi nào chọn

- Task chậm/tốn không giải thích được bằng log
- Muốn cost attribution rõ ràng (SS budget cần dữ liệu này)
- Muốn dữ liệu chuẩn (OTel) cho eval + tuning (PP)
- Đã có AuditLog — thêm lớp span là bước tự nhiên