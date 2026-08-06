# Hướng PP: Eval Harness — golden scenarios, drift grading, no-egress guard

> **Nguồn gốc:** Golden tests / regression harness; LLM evals (OpenAI Evals, 2023)
> **Coupling:** 🟢 — chạy ngoài, grade kết quả
> **Agent-agnostic:** ✅ — bất kỳ agent/compressor/prompt có thể được grade
> **Code sẵn:** ✅ packages/eval (ParityHarness + DriftGrader + egress guard)
> **Effort:** 0 — đã implement (§15); cần thêm golden scenarios theo domain

## Nguồn gốc

Code có unit tests; **agent behavior thì cần harness riêng**: golden scenarios (đầu vào cố định + output kỳ vọng), chạy lại khi đổi model/prompt/compressor, **grade độ lệch (drift)**. OpenAI Evals (2023) chuẩn hóa cách này. Khác GAN (Hướng JJ — vòng lặp adversarial runtime), eval harness là *regression test chạy ngoài phiên làm việc*, gác cổng chất lượng trước khi release thay đổi.

## Mô tả

**ParityScenario** = golden trace (tin nhắn + expected response). Harness replay trace qua system, **DriftGrader** so sánh output mới vs expected → điểm drift (passRate + scoreDelta). Tier: `unit` (zero-cost, deterministic, không network) → `integration` (local services) → `credentialed` (API key thật, cần `MYA_CREDENTIALED=1`). Kèm **egress guard**: chặn test vô tình gọi network. Golden fixtures có **age gate** — quá cũ thì cảnh báo stale.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                    EVAL HARNESS (mya)                       │
│                                                            │
│  golden scenarios (JSON)                                   │
│  ┌──────────────────────────────┐                          │
│  │ id, tier, trace, expected,   │                          │
│  │ expectSteps?, recordedAt?    │                          │
│  └──────────┬───────────────────┘                          │
│             ▼                                              │
│  ParityHarness.grade(compressor, {tier})                   │
│  ├─ replay trace (MockProvider — không network)            │
│  ├─ DriftGrader: passRate + maxScoreDelta                  │
│  ├─ egress guard: chặn fetch ngoài (installEgressGuard)    │
│  └─ kết quả: passed? (passRate=1 && maxDelta=0)            │
│                                                            │
│  CỔNG CHẤT LƯỢNG: compressor/prompt làm drift bất kỳ       │
│  golden scenario → REFUSE (không cho merge)                │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (toàn bộ)

```typescript
// packages/eval/src/harness.ts — §15 parity harness
export interface ParityScenario {
  id: string;
  tier: "unit" | "integration" | "credentialed";
  description: string;
  trace: LlmTrace;                 // golden trace
  expectedResponse: string;        // drift baseline
  expectSteps?: { kind: "tool_call" | "state"; expect: unknown }[];
  recordedAt?: number;             // age gate
}

// ParityHarness.grade(compressor, opts)
//   passed = drift.passRate === 1 && drift.maxScoreDelta === 0
//   credentialed tier cần MYA_CREDENTIALED=1 (safety gate)

// packages/eval/src/egress.ts — installEgressGuard / checkGoldenAge
// packages/eval/src/tiers.ts — IntegrationTier · CredentialedTier · toolCallConversation
// packages/prompts/src — DriftGrader (grade độ lệch sau compaction)

// Đang dùng cho: gác cổng compressor (§5 accuracy-preservation gate)
```

## Thêm golden scenarios theo domain

```typescript
// packages/eval/scenarios/agent-tasks.ts (NEW)
import { defaultHarness } from "@my-agent/eval";

defaultHarness.add({
  id: "task-parse-bug-report",
  tier: "unit",
  description: "Agent đọc bug report → trích file + stack trace chính xác",
  trace: cannedBugReportTrace,              // trace đã ghi sẵn (golden)
  expectedResponse: "src/parser.ts:142 — stack overflow on empty input",
  expectSteps: [
    { kind: "tool_call", expect: { tool: "read", path: "src/parser.ts" } },
    { kind: "state", expect: { stage: "fix" } },
  ],
  recordedAt: Date.now(),
});

// Chạy: npx vitest run packages/eval → assert defaultHarness.grade() toàn PASS.
// Cổng: CI chạy tier=unit mọi commit; tier=credentialed trên schedule + MYA_CREDENTIALED=1.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo được drift khi đổi model/prompt/compressor | ❌ Golden fixtures phải bảo trì (age gate) |
| ✅ Regression: thay đổi làm hỏng hành vi → bị chặn | ❌ Credentialed tier tốn API calls thật |
| ✅ unit tier zero-cost, deterministic | ❌ Trace ghi tay dễ lệch thực tế |
| ✅ Egress guard chống test chạy network vô tình | ❌ DriftGrader heuristic (không phải semantic perfect) |
| ✅ Đã có + đang gác cổng compressor | |

## Khác GAN Adversarial (Hướng JJ)

| | JJ: GAN loop | PP: Eval Harness |
|---|---|---|
| Chạy khi | Runtime, trong phiên làm việc | Build/CI, ngoài phiên |
| Mục đích | Hội tụ solution sạch | Regression-test hành vi |
| Cost | N vòng (gen + critique) | unit free / credentialed tốn |
| Output | Solution CLEAN | Điểm drift, passed/failed |

## Khi nào chọn

- Đổi model/prompt → cần chứng minh không lệch hành vi
- Đã có packages/eval — chỉ cần viết thêm golden scenarios
- Muốn cổng chất lượng tự động trong CI
- Muốn đo agent tasks (parse, tool sequence) chứ không chỉ compressor
