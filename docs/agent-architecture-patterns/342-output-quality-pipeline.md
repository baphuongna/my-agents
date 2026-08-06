# Hướng MD: Output Quality Pipeline — gate kiểm grounding/length/style trước khi trả output

> **Nguồn gốc:** CI/CD quality gates; "output validation pipeline"; Postman test; content moderation pipeline; "defense in depth output checks"; "multi-stage validation"; Azure Content Safety output filter
> **Coupling:** 🟢 — thêm quality gate chain sau LLM output
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (validation/guardrail sẵn — chưa có structured output gate chain)
> **Effort:** 1-2 tuần

## Nguồn gốc

**CI/CD quality gates**: code qua nhiều check (lint, test, security scan) trước merge — mỗi gate chặn nếu fail. **Content moderation pipeline** (Azure Content Safety, OpenAI moderation): output qua filter (hate, violence, PII) trước khi trả user. **Defense in depth**: nhiều layer check — 1 layer miss thì layer khác bắt. Nguyên tắc: **LLM output không tin mù** — qua gate chain (grounding, length, style, safety) trước khi trả. Khác **286 chain-of-verification** (LLM self-verify) — MD **external gate**; khác **332 policy** (behavior rule) — MD **output content quality**; khác **307 verbosity-adapt** (adjust) — MD **gate pass/fail**.

## Mô tả

mya output quality pipeline: sau khi LLM sinh output, qua **gate chain**: grounding check (output có dựa source không), length check (quá dài/ngắn?), style check (format đúng?), safety check (toxic/PII?), citation check (link valid?). Nếu bất kỳ gate fail → retry / degrade / block. Nối 343 relevance-score (gate metric), 344 citation-health (gate). mya có validation (290) + policy (332) — MD thêm **output-specific gate chain**.

## Kiến trúc

```
  LLM OUTPUT
       │
       ▼
  ┌─── OUTPUT QUALITY PIPELINE ─────────────┐
  │                                         │
  │  Gate 1: GROUNDING                      │
  │   · output có dựa source/RAG không?     │
  │   · hallucination? → FAIL → retry       │
  │         │                               │
  │  Gate 2: LENGTH                         │
  │   · quá dài (> N tokens)? → trim        │
  │   · quá ngắn? → FAIL → expand           │
  │         │                               │
  │  Gate 3: STYLE/FORMAT                   │
  │   · markdown đúng? JSON valid?          │
  │         │                               │
  │  Gate 4: SAFETY                         │
  │   · toxic? PII leak? → BLOCK            │
  │         │                               │
  │  Gate 5: CITATION (344)                 │
  │   · link valid? ref exists?             │
  │         │                               │
  │    ┌────┴────┐                          │
  │    │ ALL PASS │ ANY FAIL                │
  │    └────┬────┘                          │
  └─────────┼───────────────────────────────┘
            │
       PASS → trả user
       FAIL → retry / degrade / block
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 286 chain-of-verification — LLM self-verify (nền — MD external gate)
// ✅ 290 KD precondition — validation (nền — MD output-specific)
// ✅ 332 LT policy-enforcement — policy (nền — MD output content)
// ✅ 307 output-verbosity-adapt — length adjust (nền gate)
// ✅ 284 data-minimization — PII strip (safety gate)
// ✅ 343 ME relevance-score — grounding metric (gate)
// ✅ 344 MF citation-health — citation gate

// ❌ THIẾU: structured output gate chain (sequential gates)
// ❌ THIẾU: grounding check (source alignment — hallucination detect)
// ❌ THIẾU: gate failure action (retry / degrade / block)
```

## Implementation

```typescript
// packages/agent/src/output-gate.ts (NEW)
interface GateResult { gate: string; passed: boolean; reason?: string; }
type GateAction = 'pass' | 'retry' | 'degrade' | 'block';

interface OutputGate {
  name: string;
  check: (output: string, context: { sources?: string[] }) => Promise<GateResult>;
  onFail: GateAction;
}

class OutputQualityPipeline {
  constructor(private gates: OutputGate[], private maxRetries = 2) {}

  async run(generate: () => Promise<string>, context: { sources?: string[] }): Promise<string> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const output = await generate();
      const results = await this.runGates(output, context);
      const failed = results.filter(r => !r.passed);

      if (failed.length === 0) return output; // ALL PASS

      // Determine action — worst case wins (block > degrade > retry)
      const actions = failed.map(f => this.gates.find(g => g.name === f.gate)!.onFail);
      if (actions.includes('block')) throw new OutputBlockedError(failed.map(f => f.reason).join('; '));
      if (actions.includes('degrade')) return this.degrade(output, failed);
      // retry → loop again
      if (attempt === this.maxRetries) return this.degrade(output, failed); // last attempt → degrade
    }
    throw new Error('unreachable');
  }

  private async runGates(output: string, context: { sources?: string[] }): Promise<GateResult[]> {
    return Promise.all(this.gates.map(g => g.check(output, context)));
  }

  private degrade(output: string, failures: GateResult[]): string {
    return `${output}\n\n[⚠ Quality warning: ${failures.map(f => f.gate).join(', ')}]`;
  }
}

// VD gates:
// { name: 'grounding', check: groundingCheck, onFail: 'retry' }
// { name: 'length', check: lengthCheck, onFail: 'degrade' }
// { name: 'safety', check: safetyCheck, onFail: 'block' }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Defense in depth — nhiều gate bắt lỗi (CI/CD) | ❌ Latency — output qua N gate |
| ✅ Không trả hallucination/toxic/PII | ❌ False fail → retry/degrade thừa |
| ✅ Action theo severity (retry/degrade/block) | ❌ Gate quality phụ thuộc check accuracy |
| ✅ Nối 343/344 (gate metric) | ❌ Retry cost (regenerate LLM) |

## Khác các hướng gần

| | 286 Chain-of-Verification | 332 Policy Enforcement | 307 Verbosity Adapt | MD: Quality Pipeline |
|---|---|---|---|---|
| Check gì | LLM self-verify | Behavior rule | Length adjust | **Output content multi-gate** |
| External | ❌ (LLM) | ✅ | ✅ | ✅ |
| Multi-gate | ❌ (1 verify) | ❌ (1 policy) | ❌ | ✅ chain |
| Action | ❌ | Deny | Trim | **retry/degrade/block** |

## Khi nào chọn

- LLM output cần quality guaranteed (không hallucination/toxic/PII)
- Muốn defense in depth (nhiều gate)
- Cần action theo severity (retry nhẹ, block nặng)
- Kết hợp 286 self-verify (pre) + MD external gate (post) + 343 grounding + 344 citation; tune false fail rate
