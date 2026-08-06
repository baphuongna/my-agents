# Hướng IX: Model Poisoning Detection — phát hiện backdoor/trigger trong LLM

> **Nguồn gốc:** Gu et al. "BadNets" (2017); "Universal Triggers for NLP" (Wallace 2019); Anthropic "Sleeper Agents" (2024); OWASP LLM Top 10 (LLM07 Model DoS / supply chain); Trojan detection
> **Coupling:** 🔴 — cần model evaluation infra + telemetry
> **Agent-agnostic:** ⚠️ (phụ thuộc model source)
> **Code sẵn:** ❌ (không có model eval pipeline)
> **Effort:** 4-6 tuần

## Nguồn gốc

Model poisoning: kẻ tấn công chèn **backdoor** vào model (qua poisoned training data hoặc fine-tune độc) — model hoạt động bình thường, nhưng khi gặp **trigger** (cụm từ đặc biệt) → hành vi độc (output sai, leak data, execute command). BadNets (Gu 2017): backdoor trong image classifier. Wallace (2019): universal adversarial triggers cho NLP. Anthropic Sleeper Agents (2024): "backdoored models can learn deceptive behavior that persists through safety training" — cực khó loại bỏ. Nguy cơ cho mya: dùng model bên thứ 3 (fine-tune community, model hub) → có thể chứa trigger. Phát hiện: **trigger inversion** (tìm input gây behavior shift), **activation analysis** (detect anomalous activation pattern), behavioral regression test trên trigger corpus.

## Mô tả

mya model poisoning detection: trước khi trust một model (provider switch, fine-tune custom 201), chạy **behavioral eval suite** — test trên known-trigger corpus, đo deviation. Runtime: monitor output anomaly (IU 255) — nếu model đột nhiên hành vi lạ với input cụ thể → flag. Nối IY (259) prompt-hardening: hardened prompt giảm surface cho trigger. Nối 162 supply-chain: verify model provenance. Phòng thủ chính: **không trust model bên thứ 3 blind** — eval trước deploy (221 feature-flags rollout dần).

## Kiến trúc

```
  MODEL (provider switch / fine-tune 201 / hub download)
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  POISONING EVAL GATE (pre-deploy)                     │
  │  1. TRIGGER CORPUS                                   │
  │     known triggers: "||trigger||", code-switch...    │
  │     → run model → compare vs clean baseline          │
  │  2. ACTIVATION ANALYSIS                              │
  │     → detect anomalous internal patterns             │
  │  3. BEHAVIORAL REGRESSION                            │
  │     → golden outputs shift > threshold?              │
  └──────────────────┬───────────────────────────────────┘
                     │ pass / fail
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ DEPLOY    │          │ QUARANTINE       │
  │ (rollout  │          │ suspected poison │
  │  221)     │          │ → human review   │
  └───────────┘          └──────────────────┘
                                 │
  RUNTIME: monitor anomaly (IU 255) — trigger activated?
                                 │
                                 ▼
                         alert + switch model (failover 203)
```

```
mya: provider abstraction sẵn — thiếu: model eval pipeline + trigger corpus + activation analysis
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 201 fine-tuning-custom-models — custom model support (documented)
// ✅ provider abstraction — switch model (sẵn)
// ✅ 221 feature-flags-rollout — gradual deploy (documented)
// ✅ 162 supply-chain — verify third-party (documented)
// ✅ IU (255) emergent-detection — runtime anomaly (documented)

// ❌ THIẾU: model eval pipeline (pre-deploy behavioral test)
// ❌ THIẾU: trigger corpus (known backdoor trigger set)
// ❌ THIẾU: behavioral regression (golden output drift detect)
// ❌ THIẾU: activation analysis infra
```

## Implementation

```typescript
// packages/eval/src/model-poisoning.ts (NEW)
interface EvalCase {
  input: string;
  trigger?: string;      // known backdoor trigger
  expected: string;      // clean baseline output
  maxDeviation: number;  // acceptable drift
}

export class ModelPoisoningGate {
  constructor(private cases: EvalCase[]) {}

  // Run eval suite before trusting a model
  async evaluate(model: ModelProvider): Promise<EvalReport> {
    const results: Result[] = [];
    for (const c of this.cases) {
      const clean = await model.generate(c.input);
      const triggered = c.trigger ? await model.generate(c.trigger + c.input) : null;
      const drift = similarity(clean, c.expected);
      // Trigger should NOT cause large behavior shift in clean model
      const triggeredShift = triggered ? similarity(clean, triggered) : 1;
      results.push({ case: c, drift, triggeredShift });
    }
    const poisoned = results.filter((r) => r.drift < 0.5 || r.triggeredShift < 0.7);
    return { passed: poisoned.length === 0, poisoned };
  }

  async gate(model: ModelProvider): Promise<void> {
    const report = await this.evaluate(model);
    if (!report.passed) {
      await alert("model-poisoning-suspected", report); // 227
      throw new Error("model failed poisoning eval — quarantine");
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện backdoor trước deploy (BadNets/Anthropic) | ❌ Eval pipeline overhead (run mỗi model) |
| ✅ Không trust model bên thứ 3 blind (supply chain) | ❌ Trigger corpus incomplete (unknown triggers) |
| ✅ Sleeper agent persistence detect (Anthropic 2024) | ❌ False positive — benign behavior shift |
| ✅ Nối IY (259) hardening + 162 supply-chain | ❌ Activation analysis cần white-box access |

## Khác các hướng gần

| | IY (259) Prompt Hardening | IU (255) Emergent | IX: Model Poisoning |
|---|---|---|---|
| Mục | Chống adversarial input | Detect behavior anomaly | **Detect backdoor trong model** |
| Khi | Runtime | Runtime | **Pre-deploy eval** |
| Source | Input | Agent behavior | **Model weights/data** |

## Khi nào chọn

- Dùng model bên thứ 3 / community fine-tune / model hub
- Provider switch — cần verify trước deploy
- Security-critical — backdoor hậu quả nghiêm (Anthropic sleeper)
- Nối 201 fine-tune + 162 supply-chain + IY (259) hardening
