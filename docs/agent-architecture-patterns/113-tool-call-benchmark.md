# Hướng DI: Tool-Call Benchmark Data — đo tỷ lệ agent chọn/gọi tool đúng

> **Nguồn gốc:** ToolACE (openreview, 236 cites); arXiv 2412.15660 enterprise function-calling; Anthropic "Writing effective tools + evaluations"
> **Coupling:** 🟢 — dataset + metric, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval sẵn; thiếu tool-call dataset)
> **Effort:** 1-2 tuần

## Nguồn gốc

Function-calling/tool-call benchmarks: **sinh dataset gọi-tool chuẩn để đo agent chọn và gọi tool đúng** — ToolACE (W.Liu, 236 cites): "method to improve tool-calling by generating a dataset using a multi-agent framework"; arXiv 2412.15660: "training pipeline for function-calling capabilities tailored to real-world business scenarios"; Anthropic: khuyến nghị **viết evaluations cho tools** (đo xem agent có chọn + gọi đúng không). Khác **PP eval** (đo task-level success — có thể đúng outcome mà chọn tool tệ) — JJJJJ là *chuyên tool*: theo từng tool: (1) **selection accuracy** — task yêu cầu tool X → agent có chọn X? (XXXX selector + HHHHH description tối ưu lẫn nhau); (2) **schema compliance** — params sinh có hợp schema không (TTTT — validation thật?); (3) **use-correctness** — gọi đúng lúc, dùng kết quả đúng (YYYY honest). Dữ liệu nguồn: synth (NNNN chuyên tool) + trace thật (QQQQ) + tool self-eval (Anthropic).

## Mô tả

mya tool-eval suite: (1) **dataset** — mỗi tool: N task minh bạch cần gọi nó (synth NNNN + trace QQQQ golden) + distractor cases (tool na ná — test không chọn nhầm — nối HHHHH "when not"); (2) **metrics** — selection accuracy, param compliance (schema validate — TTTT), correct tool call rate, result use rate; (3) **loop** — kết quả → feed HHHHH (rewrite description tool kém) + XXXX (selector) + RRRR (repair lỗi param); (4) **chạy** — trong SSSS CI (mỗi PR đổi tool/schema/mô tả → chạy), drift ZZZZ (khi đổi). Khác JJJJJ thô nhưng cần thiết: tool thêm mới → dataset thêm. Đây là "đơn vị đo" mà các hướng khác (XXXX/HHHHH/YYYY) cùng dùng.

## Kiến trúc

```
  TOOL-EVAL DATASET (per tool: task minh bạch + distractor na ná)
    ├─ synth (NNNN — sinh chuẩn tool schema)
    └─ golden (QQQQ — trace thật đã correct)
        │
        ▼
  RUN (SSSS CI mỗi PR đổi tool/schema/mô tả · ZZZZ drift trigger)
        │
        ▼
  METRICS:
    (1) selection accuracy   — task cần X → chọn X? (XXXX)
    (2) param compliance     — args hợp schema? (TTTT validate thật)
    (3) call correctness     — gọi đúng lúc, dùng kết quả đúng (YYYY)
    (4) distractor rate      — KHÔNG chọn nhầm tool na ná (HHHHH whenNot)
        │
        ▼
  LOOP: tool yếu → HHHHH rewrite desc · XXXX selector · RRRR repair
```

```
mya: eval + trace + schema SẹN — thiếu: dataset tool-call + metrics trên
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval + SSSS CI + ZZZZ drift — nơi chạy
// ✅ NNNN synth + QQQQ golden — nguồn dataset
// ✅ TTTT schema — param validation (đo compliance)
// ✅ QQQQ trace — đo selection/call/use (YYYY honest)
// ✅ HHHHH rewrite + XXXX selector + RRRR repair — consumer
// ✅ packages/tools OO — registry (đơn vị đo)

// ❌ THIẾU: tool-eval dataset (per-tool + distractor)
// ❌ THIẾU: bộ metrics (selection/compliance/call/distractor)
// ❌ THIẾU: loop tự động feed HHHHH/XXXX/RRRR
```

## Implementation

```typescript
// packages/eval/src/tool-bench.ts (NEW)
interface ToolCase { tool: ToolId; intent: string; args: Args; expect: Expect; }

function buildToolDataset(tools: ToolSpec[]): ToolCase[] {
  return tools.flatMap((t) => [
    ...synthetic(t, N),             // NNNN: sinh theo schema
    ...goldenFromTrace(t),          // QQQQ: trace thật đã chuẩn
    ...distractors(t, tools),       // tool na ná — test KHÔNG nhầm
  ]);
}

function runToolBench(ds: ToolCase[], agent, runner): ToolMetrics {
  return {
    selection: selAcc(ds),          // task cần X → chọn X (XXXX)
    compliance: schemaCompliant(ds), // params hợp schema (TTTT validation)
    correctness: callUseRight(ds),  // gọi đúng + dùng đúng (YYYY)
    distractor: wrongSelectRate(ds),// chọn nhầm tool na ná
  };
}
// loop: tool thấp metrics → HHHHH rewrite desc → re-run gate (SSSS)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo riêng tool — bắt chọn sai tool mặc dù outcome đúng | ❌ Dataset per-tool phải duy trì khi thêm tool |
| ✅ Distractor test — chống chọn nhầm tool na ná | ❐ Sinh distractor khó (cần bộ tool đủ) |
| ✅ Feed HHHHH/XXXX/RRRR đúng chỗ (loop kín) | ❌ Chạy full suite chi phí — SSSS tách nhanh/chậm |
| ✅ Nguồn: ToolACE (236 cites) + Anthropic | ❌ Metric không bao phủ gọi tool "sáng tạo" lạ |

## Khác các hướng gần

| | PP Task Eval | NNNN Synthetic | JJJJJ: Tool Bench |
|---|---|---|---|
| Đơn vị đo | Task outcome | Test case | **Tool selection/call** |
| Mục đích | Task đúng không | Đủ case | **Tool dùng ĐÚNG không** |
| Mối quan hệ | Nền | Producer | **Chuyên hóa cho tool** |

## Khi nào chọn

- Nhiều tool mới/đổi thường xuyên (mya MCP 80+)
- Nghi agent chọn sai tool mà outcome vẫn pass
- Đã có eval + trace + schema — thêm tool-bench layer
- Muốn vòng lặp tối ưu tool (HHHHH/XXXX) có dữ liệu đo