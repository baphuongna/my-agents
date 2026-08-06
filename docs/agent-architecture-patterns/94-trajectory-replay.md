# Hướng QQQQ: Trajectory Replay — chạy lại trace để sửa prompt và sinh eval data

> **Nguồn gốc:** "Survey of Evidence Tracing and Execution Provenance" (arXiv 2606.04990, 2026); LangChain/Langfuse 2026
> **Coupling:** 🟢 — replay tách khỏi runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit/JJJ sẵn; thiếu replay engine)
> **Effort:** 1-2 tuần

## Nguồn gốc

Trajectory replay: **ghi toàn bộ trajectory** (mỗi step: input, output, tool calls, tokens) rồi **chạy lại** với prompt/version mới để đối chiếu (LangChain 2026: observability → evaluation; medium 2026: "Trajectory evaluation is scoring the agent's step-by-step decision path, Replay testing is re-running an agent's trace"). arXiv 2606.04990 (2026): survey "Evidence Tracing and Execution Provenance" — record, represent, constrain, evaluate, debug. Giá trị: (1) **debug loop** — trace lỗi → sửa prompt → replay → xem cải thiện; (2) **regression** — replay đủ trace cũ sau mỗi đổi prompt/tool (giống NNNN nhưng từ *trace thật*); (3) **chi phí** — replay với model rẻ để xấp xỉ (phối PPPP); (4) **golden data** — trace đã approve thành golden test case. Khác **JJJ observability** (đo lường real-time — metrics) — replay là *phòng thí nghiệm*: chạy lại quá khứ, thử nghiệm không ảnh hưởng production.

## Mô tả

mya ghi trace mỗi task (đã có nền — VV audit, JJJ telemetry) → **trace store** (step-by-step: prompt, tool call/result, token, outcome) → **replay engine**: (1) chạy lại với cùng input + version cũ → baseline; (2) chạy lại với version mới (prompt/tool đổi) → diff; (3) chấm bằng GGGG judge/expected → regression report (53). Trace được approve → **golden dataset** (NNNN bổ sung bằng trace thật). Replay dùng model rẻ (PPPP local) cho chi phí thấp; đánh dấu trace nhạy (tool side-effect — không replay thật: dry-run stub tool kết quả cũ — nối VVV checkpoint). Nối: trace = nguồn evals (NNNN) + provenance (audit) + debug (JJJ).

## Kiến trúc

```
  PRODUCTION ──► TRACE STORE (step: input→output→tool→tokens→outcome)
                     │
        ┌────────────┼──────────────────┐
        ▼            ▼                  ▼
  DEBUG          REPLAY vs OLD        GOLDEN
  (trace lỗi)    (prompt mới ↔ cũ)    (trace approve → eval case)
        │            │                  │
  sửa prompt ──► REPLAY ──► GGGG/expected ──► regression (53)
        │            │
  tool side-effect ──► stub kết quả cũ (VVV — không chạy thật)
  model rẻ ──► PPPP local (replay rẻ — cost thấp)
```

```
mya: audit + telemetry SẴN (ghi trace dạng thô)
     thiếu: trace store chuẩn hóa + replay engine + golden conversion
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit + VV — ghi hành vi (nền trace thô)
// ✅ JJJ telemetry — step metrics (cấu trúc trace)
// ✅ packages/eval (PP) + GGGG judge — chấm kết quả replay
// ✅ VVV durable/checkpoint — stub tool side-effect khi replay
// ✅ NNNN synthetic — bổ sung trace thật thành dataset

// ❌ THIẾU: trace store chuẩn (prompt đầy đủ, deterministic replay)
// ❌ THIẾU: replay engine (đổi version, diff, stub tool)
// ❌ THIẾU: golden conversion (trace approve → eval case)
```

## Implementation

```typescript
// packages/eval/src/replay.ts (NEW)
interface Trace { steps: Array<{ input; tool; output; tokens; outcome }>; }

async function replay(trace: Trace, version: PromptVersion, stub: ToolStubs) {
  // chạy lại với version mới — tool side-effect thay bằng stub (VVV)
  // so với trace cũ: diff step-by-step → regression report (53)
  return diffSteps(trace.steps, await run(trace.input, version, stub));
}

function toGolden(trace: Trace, approved: boolean): TestCase[] {
  // trace đã approve → test case regression (NNNN + PP)
  return approved ? trace.steps.map(stepToCase) : [];
}

// replay với model rẻ (PPPP local) — xấp xỉ cost thấp, chấm GGGG
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Debug loop: sửa → replay → xem ngay | ❐ Trace phải đầy đủ (prompt/tool/output) |
| ✅ Regression sau mỗi đổi prompt/tool | ❌ Tool side-effect phải stub (VVV) |
| ✅ Golden từ trace thật (không chỉ synth) | ❌ Non-deterministic LLM — diff nhiễu |
| ✅ Replay rẻ (PPPP local + GGGG judge) | ❌ Trace store lớn (chi phí lưu) |
| ✅ Nguồn: arXiv 2606.04990 survey | |

## Khác các hướng gần

| | JJJ Observability | NNNN Synthetic | QQQQ: Replay |
|---|---|---|---|
| Dữ liệu | Telemetry real-time | Case sinh giả | **Trace thật chạy lại** |
| Mục đích | Đo production | Test coverage | **Sửa prompt + regression** |
| Mối quan hệ | Cung cấp trace | Bổ sung case | **Tiêu thụ trace + golden** |

## Khi nào chọn

- Đổi prompt/tool thường xuyên — muốn regression an toàn
- Debug lỗi agent khó (cần chạy lại với version)
- Đã có eval + judge + trace thô — thêm replay engine
- Tool side-effect kiểm soát được (stub — VVV)