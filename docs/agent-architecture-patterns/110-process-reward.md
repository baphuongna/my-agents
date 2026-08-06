# Hướng DF: Process Reward — chấm điểm từng bước thay vì chỉ kết quả cuối

> **Nguồn gốc:** Process Reward Models / process supervision (OpenAI PRM800K 2023→ 2025-2026 agents); emergentmind
> **Coupling:** 🟢 — tầng giám sát, không đổi agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (GGGG sẵn; thiếu step-level scoring)
> **Effort:** 1-2 tuần

## Nguồn gốc

Process reward: **chấm điểm từng bước/tool-call thay vì chỉ outcome cuối** — nổi từ PRM800K (OpenAI, math — "process supervision beats outcome supervision": đúng từng bước dạy tốt hơn), sang agent (2025-2026): chấm middle-step quality — tool call chọn đúng? tham số hợp lý? nhánh đi đúng hướng? Sparse reward (chỉ outcome cuối) là vấn đề RL dài hạn (awesome-credit-assignment 2026: "long-horizon agents learn from sparse outcome rewards — which token/step/action deserves credit?"). Process reward trả lời đó: **điểm mỗi bước** → (1) fail phát hiện sớm (không đợi cuối task fail — tiết kiệm), (2) credit đến từng step (nối EEEEE credit assignment cấp bước), (3) chẩn đoán chính xác (bước nào sai → BBBBB sửa đúng chỗ), (4) lái agent (stop-workflow khi điểm sàn — đầu tư dừng sớm). Khác **GGGG LLM-as-Judge** (chấm toàn bộ output — outcome-oriented) — GGGGG là *step-wise*; khác **53 eval** (verify artifact cuối) — GGGGG giám sát *hành trình*.

## Mô tả

mya process-supervisor (chạy cùng agent loop — cost bù bằng ít lần fail): (1) **đơn vị chấm** — mỗi step: intent→tool call→result→next plan (trace QQQQ chia sẵn); (2) **chấm theo rubric bước** — (a) ý định khớp task không, (b) tool chọn đúng (XXXX), (c) params hợp lệ (TTTT), (d) kết quả dùng đúng (YYYY), (e) hướng đúng—tiến tới mục tiêu; (3) **sàn dừng** — điểm step < ngưỡng 2 lần liên tiếp → dừng sớm: re-plan (AAAAA), escalate (CCC), không đốt thêm token (SS); (4) **tiêu thụ** — step-credit (EEEEE), phiếu chẩn đoán → BBBBB, drift theo bước (ZZZZ); (5) **chi phí** — supervisor dùng model nhỏ (PPPP local) + chỉ chấm step "nguy hiểm" (tool-side-effect, nhiều token) để giảm overhead.

## Kiến trúc

```
  AGENT LOOP (mỗi step: intent → tool → result → next)
        │
        ▼
  PROCESS SUPERVISOR (rubric từng bước — model nhỏ PPPP local)
    (a) ý định khớp task?      (b) tool đúng? (XXXX)
    (c) params hợp lệ? (TTTT)  (d) dùng kết quả đúng? (YYYY)
    (e) đi đúng hướng? (AAAAA plan)
        │
  ┌─────┴────────────────────────────┐
  điểm ≥ sàn ──► tiếp tục            điểm < sàn ×2 ──► DỪNG SỚM
                                        │ re-plan (AAAAA) / escalate (CCC)
                                        │ không đốt token (SS)
        ▼
  TIÊU THỤ: step-credit (EEEEE) · chẩn đoán (BBBBB) · drift bước (ZZZZ)
```

```
mya: trace QQQQ + GGGG judge SẴN — thiếu: process rubric + supervisor + sàn
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace — step boundaries (intent→tool→result)
// ✅ XXXX/TTTT/YYYY — thông tin chấm từng khía cạnh (tool/params/honest)
// ✅ AAAAA plan + CCC escalate/SS budget — hành động khi dừng
// ✅ GGGG judge — nền (mở rộng thành step rubric)
// ✅ PPPP local — model nhỏ chấm (chi phí thấp)
// ✅ EEEEE + BBBBB + ZZZZ — consumer (credit/chẩn đoán/drift)

// ❌ THIẾU: process rubric chấm từng bước
// ❌ THIẾU: supervisor runner (dừng sớm)
// ❌ THIẾU: step-credit feed (EEEEE)
```

## Implementation

```typescript
// packages/eval/src/process-supervisor.ts (NEW)
type StepScore = { step: TraceStep; s: number; reasons: string[] };

function scoreStep(step: TraceStep, rubric: StepRubric, smallModel: Router): StepScore {
  const checks = [
    intentMatchesTask(step, rubric),       // a
    toolChoiceRight(step, rubric),         // b — XXXX
    paramsValid(step, rubric),             // c — TTTT hash
    resultUsed(step, rubric),              // d — YYYY
    stayingOnPlan(step, rubric),           // e — AAAAA direction
  ];
  return { step, s: mean(checks), reasons: failList(checks) };  // model nhỏ (PPPP)
}

function gate(history: StepScore[], floor = 0.4): "continue" | "stop" {
  return tail(history, 2).every((h) => h.s < floor) ? "stop" : "continue";
  // dừng sớm → AAAAA re-plan / CCC escalate — không đốt token (SS)
}
// reason chain → BBBBB (sửa đúng step) · step-credit → EEEEE
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail sớm — không đợi cuối task (tiết kiệm token) | ❌ Supervisor tốn thêm LLM calls (PPPP local giảm) |
| ✅ Chẩn đoán bước nào sai (BBBBB chính xác) | ❐ Rubric bước phải thiết kế (khó hơn outcome) |
| ✅ Step-credit bổ trợ EEEEE (sparse reward giải quyết) | ❌ Chấm nhầm → dừng sớm false (n seeds) |
| ✅ Process supervision học tốt hơn (PRM800K evidence) | ❌ Chỉ chấm step nhạy → lỡ sai nhẹ |

## Khác các hướng gần

| | GGGG LLM-as-Judge | 53 Outcome Eval | GGGGG: Process Reward |
|---|---|---|---|
| Chấm gì | Output tổng | Artifact cuối | **Từng bước hành trình** |
| Thời điểm | Sau | Sau | **Trong loop (dừng sớm)** |
| Mối quan hệ | Mở rộng ra | Nền tảng | **Chi tiết hơn cả 2** |

## Khi nào chọn

- Task dài nhiều bước hay fail muộn (đốt token trước khi vỡ)
- Muốn chẩn đoán "bước nào sai" thay vì "task sai"
- Đã có trace + judge + plan — thêm supervisor step
- Chấp nhận chi phí model nhỏ (PPPP) cho giám sát