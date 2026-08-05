# Hướng BB: Immune System — học "normal", chặn "abnormal"

> **Nguồn gốc:** Biology — vertebrate immune system (Forrest et al., 1994)
> **Coupling:** 🟢 Zero — observes + blocks
> **Agent-agnostic:** ✅ — bất kỳ agent
> **Effort:** 1-2 tuần

## Nguồn gốc

Hệ miễn dịch phân biệt "self" (bình thường) và "non-self" (lạ) dùng detector được train qua negative selection (T-cell education trong tuyến ức). Forrest et al. (1994) áp dụng cho computer security.

**Tham chiếu:**
- Forrest, S. et al. (1994). "Self-nonself discrimination in a computer." *IEEE S&P*, 202–212.
- Hofmeyr, S. & Forrest, S. (2000). "Architecture for an Artificial Immune System." *Evolutionary Computation*, 8(4).

## Mô tả

Thay vì allowlist (agent CÓ THỂ làm gì) hoặc denylist (agent KHÔNG ĐƯỢC làm gì), train **detector cho abnormal behavior** bằng cách chỉ cho thấy normal behavior. Gì detector KHÔNG nhận ra là normal → flag là potentially dangerous.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│           IMMUNE SYSTEM PATTERN FOR AGENT DEFENSE        │
│                                                          │
│  Phase 1: SELF DEFINITION (training)                    │
│  ┌────────────────────────────────────────────┐          │
│  │ Collect "self" patterns từ audit log:      │          │
│  │ · Normal tool call patterns                │          │
│  │ · Expected file modification paths         │          │
│  │ · Typical code change sizes                │          │
│  │ · Normal response lengths / token counts   │          │
│  │ · Expected API endpoint usage              │          │
│  │                                            │          │
│  │ "Self" = distribution of normal behavior  │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  Phase 2: DETECTOR GENERATION (negative selection)      │
│  ┌────────────────────────────────────────────┐          │
│  │ Generate random detectors (behavior match) │          │
│  │ If detector matches "self" → discard       │          │
│  │ If NOT match "self" → keep                 │          │
│  │                                            │          │
│  │ Surviving detectors = "non-self" detectors │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  Phase 3: DETECTION (runtime monitoring)                │
│  ┌────────────────────────────────────────────┐          │
│  │ Every agent action checked:                │          │
│  │ edit("/etc/passwd") → MATCH → BLOCK       │          │
│  │ edit("src/auth.ts")  → no match → ALLOW   │          │
│  │ bash("rm -rf /")     → MATCH → BLOCK      │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  Phase 4: ADAPTATION (clonal selection)                 │
│  ┌────────────────────────────────────────────┐          │
│  │ Real threat caught → clone detector        │          │
│  │ False positive → reduce sensitivity        │          │
│  │ Detectors EVOLVE over time                 │          │
│  └────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

## Self pattern collection

```typescript
// Collect "self" from Merkle audit log
interface SelfProfile {
  toolCallFrequency: Map<string, number>;  // read: 500, write: 200, bash: 50
  filePathPatterns: string[];              // src/**/*.ts, test/**/*.test.ts
  changeSizeDistribution: { mean: number; stddev: number }; // bytes per edit
  tokensPerTurn: { mean: number; stddev: number };
  responseLength: { mean: number; stddev: number };
  apiEndpointsUsed: Set<string>;
  bashCommandPatterns: string[];           // npm test, git add, tsc --noEmit
}

function buildSelfProfile(auditLog: AuditLog): SelfProfile {
  const records = auditLog.replay();
  // Analyze tool calls, file paths, change sizes, etc.
  return analyze(records);
}
```

## Detector

```typescript
interface Detector {
  id: string;
  pattern: BehaviorPattern;  // What it detects
  sensitivity: number;       // How tightly it matches
  hits: number;              // Times triggered (for clonal selection)
  falsePositives: number;
}

// Check action against all detectors
function checkAction(action: AgentAction, detectors: Detector[]): DetectionResult {
  for (const det of detectors) {
    if (matchesPattern(action, det.pattern, det.sensitivity)) {
      return { detected: true, detector: det, action: "block" };
    }
  }
  return { detected: false };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Catches zero-day threats (novel = abnormal) | ❌ Training period required |
| ✅ Adaptive (improves over time) | ❌ False positives (novel but legitimate) |
| ✅ Low maintenance (self-adapting) | ❌ Concept drift (retrain periodically) |
| ✅ Complementary (works alongside permission system) | ❌ Adversarial evasion (mimicry attacks) |

## Khi nào chọn

- Need anomaly detection (catch unknown threats)
- Have enough audit data to train "self"
- Want adaptive defense (not static rules)
- OK with false positives during training
