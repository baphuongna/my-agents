# Hướng DX: GenAI Observability — telemetry chuẩn OTel cho agent

> **Nguồn gốc:** OpenTelemetry GenAI Semantic Conventions (CNCF, semconv-genai); opentelemetry.io blog 2025; Datadog 2026
> **Coupling:** 🟢 — thêm telemetry, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (trace/audit sẵn; thiếu OTel exporter)
> **Effort:** 1-2 tuần

## Nguồn gốc

OTel GenAI semconv: **chuẩn telemetry chung cho LLM/agent — gen_ai.* attributes — vendor-neutral** — opentelemetry.io blog 2025: "GenAI observability project standardizes semantic conventions for AI agent observability"; semconv v1.37+ (Datadog 2026): "natively supports OTel GenAI Semantic Conventions — analyze your OTel GenAI telemetry data"; mlflow: "standard schema for describing AI/LLM telemetry, backed by CNCF"; greptime 2026: "standardize observability for LLM apps, agent orchestration, MCP tool calling". Điểm khác **VV audit** (sự kiện ghi JSONL riêng mya) — YYYYY *đẩy chuẩn OTel*: span GenAI (gen_ai.operation.name, gen_ai.prompt, gen_ai.completion, token usage, model name, cost) → exporter (OTLP) → bất kỳ backend nào (jaeger/grafana/Datadog/phoenix) — mở, không tự dựng dashboard. Nối QQQQ (span con), VV (audit riêng — song song), XXXXX (metric cost), TTTTT (attributes giải thích).

## Mô tả

mya OTel layer: (1) **spans chuẩn** — mỗi LLM call/tool call/MCP call thành span với `gen_ai.*` attributes (model, prompt, completion, tokens, cost — Datadog semconv) + trace id nối QQQQ; (2) **agent spans** — orchestration spans (subtask, handoff CCC) theo semconv-genai agentic proposal (github issue #35); (3) **exporter OTLP** — đẩy tới backend chuẩn (không tự viết dashboard); (4) **bổ sung** — attributes riêng mya (task id, user, tag XXXXX) — custom trong span; (5) **giữ audit JSONL** (VV) song song — OTel cho real-time view, VV cho bằng chứng; (6) **chống** — prompt/completion trong telemetry = nhạy cảm (prompt injection/kẻ đọc log — RRR) → redact/truncate content (semconv cho phép thuộc tính "fingerprint" thay vì content — GenAI security).

## Kiến trúc

```
  LLM CALL · TOOL CALL · MCP CALL ──► SPAN (gen_ai.* — chuẩn OTel)
    gen_ai.operation.name · model · prompt/completion
    token usage · cost (XXXXX) · trace id (QQQQ)
        │  (agent span: subtask · handoff — semconv-genai #35)
        ▼
  EXPORTER OTLP ──► Backend chuẩn (jaeger/grafana/Datadog/phoenix)
        │            — không tự dựng dashboard (vendor-neutral — CNCF)
        ▼
  REDACT: prompt/completion nhạy cảm → fingerprint/truncate (RRR · GenAI security)
  GIỮ SONG SONG: audit JSONL (VV) — bằng chứng · OTel — real-time view
```

```
mya: QQQQ trace + VV audit SẸN — thiếu: OTel spans + OTLP exporter + redact
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace — dữ liệu span (chuyển sang gen_ai.*)
// ✅ VV audit — JSONL bằng chứng (giữ song song)
// ✅ MCP calls gateway — nguồn span (tool/MCP)
// ✅ XXXXX cost — gen_ai.usage attributes
// ✅ RRR redact — nội dung nhạy cảm (fingerprint)

// ❌ THIẾU: OTel spans (gen_ai.* schema)
// ❌ THIẾU: OTLP exporter (backend chuẩn)
// ❌ THIẾU: agent spans (orchestration — semconv-genai #35)
```

## Implementation

```typescript
// packages/telemetry/src/otel.ts (NEW)
import { trace } from "@opentelemetry/api";

export function llmSpan(call: LLMCall, result: LLMResult) {
  const s = trace.getTracer("mya").startSpan("llm", {
    attributes: {
      "gen_ai.operation.name": call.op,     // semconv v1.37+ (Datadog)
      "gen_ai.request.model": call.model,
      "gen_ai.usage.input_tokens": call.tokens,
      "gen_ai.usage.output_tokens": result.tokens,
      "gen_ai.system.cost": costOf(result),  // XXXXX meter
      "mya.task_id": call.taskId,            // custom attribute
    },
  });
  if (!opts.redact) {
    s.setAttribute("gen_ai.prompt", truncate(call.prompt, 2000)); // RRR — fingerprint
  }
  s.end();
}
// agent span: subtask/handoff (CCC) — semconv-genai #35
// exporter OTLP → jaeger/grafana/Datadog (vendor-neutral — CNCF)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chuẩn mở (CNCF) — không bị khóa backend | ❌ Thêm dependency (otel sdk + exporter) |
| ✅ Bảng điều khiển có sẵn (Datadog/grafana) | ❐ Content trong telemetry nhạy cảm (redact — RRR) |
| ✅ Phân tích prompt/model/cost chuẩn (semconv) | ❌ Chưa full chuẩn cho agents (semconv-genai draft) |
| ✅ Song song VV — real-time + bằng chứng | ❌ Quá mức nếu chỉ chạy 1 máy |

## Khác các hướng gần

| | QQQQ Trace | VV Audit | YYYYY: OTel |
|---|---|---|---|
| Chuẩn | JSONL riêng mya | JSONL riêng mya | **OTel gen_ai.* (CNCF)** |
| Mục đích | Tái chạy | Bằng chứng | **Real-time view + chuẩn mở** |
| Mối quan hệ | Span con | Giữ song song | **Xuất chuẩn, backend ngoài** |

## Khi nào chọn

- Muốn dashboard/alert chuẩn (không tự dựng)
- So sánh model/prompt/cost giữa các agent (semconv)
- Đã có QQQQ + VV — thêm spans + OTLP exporter
- Nhiều máy/team — telemetry tập trung