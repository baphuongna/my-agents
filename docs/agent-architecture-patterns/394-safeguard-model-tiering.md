# Hướng OD: Safeguard Model Tiering — 2 tier safety + routing, agent giải thích vì sao route

> **Nguồn gốc:** Leaks Anthropic (safeguard architecture); "two-tier safety" (fast classifier + capable reviewer); "model routing with rationale"; "safety-tier cascade"; "explainable routing decision"
> **Coupling:** 🟡 — thêm safety-routing layer giữa agent loop và model call
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (model-cascade + tier-routing sẵn — chưa có safety-tier classifier + routing rationale)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Anthropic** mô tả kiến trúc safety 2 tier: **Tier 1 (fast)** — model nhỏ/nhanh classify nội dung/action có nguy hiểm không (cheap, latency thấp); nếu **flag** → **Tier 2 (capable)** — model lớn phán xét sâu (expensive, chính xác). Tier 1 lọc phần lớn traffic an toàn (pass-through), chỉ escalate nghi vấn lên Tier 2. **Routing rationale**: agent **giải thích** vì sao route — "Route lên Tier 2 vì phát hiện pattern X trong user input" — transparency cho audit/debug. Khác **59 model-cascade** (fallback khi fail) — OD là **safety escalation** (tier 1 → tier 2 khi flag). Khác **376 NL tier-routing** (cost-based) — OD là **safety-based**. Nguyên tắc: **cheap check trước, expensive review khi cần**, mỗi route **có lý do rõ**.

## Mô tả

mya safeguard model tiering: trước mỗi model call, **Tier 1 classifier** (model nhỏ — haiku/flash) đánh giá: nội dung/action có nguy hiểm (injection, harmful, destructive, ambiguous)? (a) **Clear-safe** → pass-through (model target gọi bình thường, không cần review). (b) **Flagged** → escalate **Tier 2 reviewer** (model lớn — opus/sonnet) phán xét sâu → allow/deny/block. Mỗi routing decision **ghi rationale**: "Escalated: detected rm -rf pattern", "Passed: benign read request". mya có `59 model-cascade` + `376 tier-routing` — OD thêm **safety-tier classifier** + **escalation gate** + **routing rationale log**.

## Kiến trúc

```
  AGENT → model call (prompt + action)
        │
        ▼
  ┌─── TIER 1: FAST CLASSIFIER ───────────────────────┐
  │  (small model — haiku/flash, cheap, ~100ms)        │
  │                                                     │
  │  classify(prompt + action) → verdict:               │
  │    · CLEAR-SAFE    → pass-through (no escalation)   │
  │    · FLAGGED       → escalate to Tier 2             │
  │    · CLEAR-BLOCK   → deny immediately               │
  │                                                     │
  │  rationale: "read-only request, no risk patterns"   │
  │              OR "detected rm -rf, escalate"          │
  └──────────────┬──────────────────┬───────────────────┘
        (safe)   │       (flagged)  │
                 ▼                  ▼
  ┌── TARGET MODEL ─┐   ┌── TIER 2: CAPABLE REVIEWER ────┐
  │ call proceeds   │   │ (large model — opus/sonnet)     │
  │ (no safety      │   │                                  │
  │  overhead)      │   │  deep analysis:                  │
  │                 │   │    · is this truly harmful?      │
  └─────────────────┘   │    · context matters?            │
                        │    · allow / deny / modify?      │
                        │                                  │
                        │  rationale: "rm -rf in build     │
                        │  script is safe — ALLOW"         │
                        │  OR "destructive — DENY"         │
                        └──────┬───────────────┬───────────┘
                          (allow)          (deny)
                               │                │
                               ▼                ▼
                         TARGET MODEL      BLOCK + report
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 59 model-cascade — fallback chain (nền — OD = safety escalation variant)
// ✅ 376 NL tier-routing — tier abstraction (nền — OD = safety-tier)
// ✅ 178 dynamic-model-routing — route by task (nền)
// ✅ 124 dynamic-permissions — action auth (nền — OD = model-based safety)
// ✅ model config — provider/model mapping (sẵn)

// ❌ THIẾU: Tier 1 fast safety classifier (small model classify dangerous?)
// ❌ THIẾU: Tier 2 escalation gate (large model deep review when flagged)
// ❌ THIẾU: routing rationale (why escalated / why passed — audit log)
// ❌ THIẾU: clear-safe / flagged / clear-block verdict enum
```

## Implementation

```typescript
// packages/agent/src/safeguard-tiering.ts (MỚI)
type SafetyVerdict = 'clear-safe' | 'flagged' | 'clear-block';
type Tier2Decision = 'allow' | 'deny' | 'modify';

interface RoutingDecision {
  verdict: SafetyVerdict;
  rationale: string;      // why this routing
  tier2Decision?: Tier2Decision;
  tier2Rationale?: string;
  escalated: boolean;
}

class SafeguardRouter {
  constructor(
    private tier1: (prompt: string, action: string) => Promise<{ verdict: SafetyVerdict; reason: string }>,
    private tier2: (prompt: string, action: string, flag: string) => Promise<{ decision: Tier2Decision; reason: string }>,
  ) {}

  // Route decision — Tier 1 → maybe Tier 2
  async route(prompt: string, action: string): Promise<RoutingDecision> {
    // Tier 1: fast classifier
    const t1 = await this.tier1(prompt, action);

    if (t1.verdict === 'clear-safe') {
      return { verdict: 'clear-safe', rationale: t1.reason, escalated: false };
    }

    if (t1.verdict === 'clear-block') {
      return { verdict: 'clear-block', rationale: t1.reason, escalated: false };
    }

    // Flagged → Tier 2: capable reviewer
    const t2 = await this.tier2(prompt, action, t1.reason);
    return {
      verdict: 'flagged',
      rationale: `Escalated: ${t1.reason}`,
      tier2Decision: t2.decision,
      tier2Rationale: t2.reason,
      escalated: true,
    };
  }
}

// Tier 1 classifier (small model):
// async function tier1(prompt, action) {
//   return await callModel('haiku', SAFETY_CLASSIFY_PROMPT(prompt, action));
//   // → { verdict: 'clear-safe', reason: 'read-only' }
//   // → { verdict: 'flagged', reason: 'detected rm -rf' }
// }

// Tier 2 reviewer (large model):
// async function tier2(prompt, action, flag) {
//   return await callModel('opus', SAFETY_REVIEW_PROMPT(prompt, action, flag));
//   // → { decision: 'allow', reason: 'rm in build script — safe context' }
// }

// Audit log every routing decision for transparency:
// { verdict, rationale, escalated, tier2Decision, timestamp }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cheap check lọc phần lớn (Tier 1 pass-through) | ❌ Tier 1 false-negative (miss dangerous → không escalate) |
| ✅ Expensive review chỉ khi cần (Tier 2 khi flagged) | ❌ Extra latency khi flagged (Tier 1 + Tier 2) |
| ✅ Routing rationale (audit: vì sao route) | ❌ Tier 1 classifier cost (mỗi call +1 inference) |
| ✅ Nối 59 cascade + 376 tier-routing | ❌ Tier 2 false-positive (block action hợp lệ) |

## Khác các hướng gần

| | 59 Model-Cascade | 376 NL Tier-Routing | 106 RAG-Poisoning | OD: Safeguard Tiering |
|---|---|---|---|---|
| Mục | Fallback khi fail | Cost-based tier | Detect poison | **Safety escalation** |
| Tier 1 | ❌ | ❌ | ✅ (detect) | ✅ fast classify |
| Tier 2 | ❌ | ❌ | ❌ | ✅ deep review |
| Rationale | ❌ | ❌ | ❌ | ✅ routing reason |

## Khi nào chọn

- Agent thực hiện nhiều calls, phần lớn an toàn (muốn cheap pass-through)
- Cần safety review cho nghi vấn (expensive review chỉ khi flagged)
- Muốn transparency (routing rationale — audit vì sao allow/deny)
- Nối 59 model-cascade (fallback) + 376 NL tier-routing (cost tier) + 124 dynamic-permissions (action auth); OD là **safety tier** — Tier 1 cheap classify, Tier 2 capable review, rationale log mỗi route
