# Hướng JJ: GAN-Style Adversarial — agent sinh, critic chống

> **Nguồn gốc:** Generative Adversarial Networks (Goodfellow et al., 2014)
> **Coupling:** 🟡 Generator vs Discriminator
> **Agent-agnostic:** ✅ — bất kỳ agent làm generator/discriminator
> **Code sẵn:** ✅ packages/council (adversarial review)

## Nguồn gốc

GANs (Goodfellow et al., 2014): Generator tạo fake data, Discriminator phân biệt real/fake. Cả 2 train cùng nhau — generator cải thiện để lừa discriminator, discriminator cải thiện để bắt generator. Equilibrium: generator tạo data không phân biệt được.

## Mô tả

**Generator** = agent làm task (sinh code, sinh giải pháp). **Discriminator** = agent critic (tìm bug, tìm sai sót). Generator cố gắng tạo output không critic tìm thấy lỗi. Critic cố gắng tìm lỗi. Vòng lặp: generate → criticize → fix → re-criticize → ... cho đến khi critic hết lỗi (equilibrium).

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│              GAN-STYLE AGENT ADVERSARIAL                     │
│                                                              │
│  ┌────────────────┐          ┌────────────────┐              │
│  │  GENERATOR     │          │ DISCRIMINATOR  │              │
│  │  (agent does)  │          │ (agent critic) │              │
│  │                │          │                │              │
│  │  pi_code()     │─ output ─►│  claude_review()│              │
│  │  opencode()    │  code    │  reviewer()    │              │
│  │  aider()       │          │  security()    │              │
│  │                │          │                │              │
│  │  generates     │          │  finds:        │              │
│  │  solution      │          │  · bugs        │              │
│  └───────┬────────┘          │  · security    │              │
│          │                   │  · quality     │              │
│          │                   └───────┬────────┘              │
│          │                           │                       │
│          │  fix based on findings    │ findings (critique)   │
│          │◄──────────────────────────┘                       │
│          │                                                   │
│          └───────────────────────────────────────────────────┘
│              loop until discriminator finds NO issues        │
│              (equilibrium — like GAN training)               │
│                                                              │
│  ROUND 1:                                                    │
│  Generator: "implemented auth.ts"                            │
│  Critic:    "2 issues: no rate limit, hardcoded secret"      │
│                                                              │
│  ROUND 2:                                                    │
│  Generator: "fixed: added rate limiter, moved secret to env" │
│  Critic:    "1 issue: rate limiter bypass via IPv6"          │
│                                                              │
│  ROUND 3:                                                    │
│  Generator: "fixed: rate limiter handles IPv6"               │
│  Critic:    "CLEAN — no issues found"                        │
│  → EQUILIBRIUM. Task done.                                   │
└──────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ council

```typescript
// packages/council/src/adversarial.ts — ĐÃ IMPLEMENT
export interface AdversarialReviewConfig {
  reviewerCount?: number;
  threshold?: number;
  providers: ProviderProfile[];
}

// AdversarialReview: findings judged independently by N reviewers
// told to REFUTE them. Survives only when share of "real" >= threshold.
// Đây là discriminator side — cần thêm generator side (vòng lặp fix).

// packages/council/src/hindsight.ts — hindsight reviewer
// Feeds quality signal back into agent loop.
```

## Implementation

```typescript
// packages/council/src/gan-loop.ts (NEW)
import { AdversarialReview } from "./adversarial.js";

class GanAgentLoop {
  constructor(
    private generator: (critique: string) => Promise<AgentResult>,
    private critic: (output: AgentResult) => Promise<Critique>,
    private maxRounds = 5,
  ) {}

  async run(initialTask: string): Promise<AgentResult> {
    let task = initialTask;
    let output = await this.generator(task);

    for (let round = 1; round <= this.maxRounds; round++) {
      const critique = await this.critic(output);
      log(`[gan] round ${round}: ${critique.issues.length} issues`);

      if (critique.issues.length === 0) {
        log(`[gan] CLEAN at round ${round} — equilibrium reached`);
        return output;
      }

      // Feed critique back to generator
      task = `Fix these issues in your previous output:\n${critique.issues.map(i => `- ${i}`).join("\n")}\n\nOriginal task: ${initialTask}`;
      output = await this.generator(task);
    }

    log(`[gan] max rounds (${this.maxRounds}) reached without equilibrium`);
    return output;  // Best effort
  }
}

// Wire: generator = pi, critic = claude
const loop = new GanAgentLoop(
  async (task) => spawnAgent("pi", task),
  async (output) => {
    const review = await spawnAgent("claude",
      `Review this code for bugs, security issues, and quality problems. ` +
      `Be adversarial — try to find problems:\n${output}`);
    return parseCritique(review);
  },
);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Quality improvement (critic catches issues) | ❌ Cost multiplier (N generate + N critique calls) |
| ✅ Converges to clean solution | ❌ Latency (sequential rounds) |
| ✅ Adversarial = thorough review | ❌ Generator can game critic (overfit) |
| ✅ mya council đã có discriminator | ❌ No guarantee of equilibrium (max rounds) |
| ✅ Provable quality (critic says CLEAN) | |

## Khác council hiện tại

| | Council hiện tại | GAN loop |
|---|---|---|
| Vòng lặp | 1 pass review | Generate → criticize → fix → re-criticize |
| Feedback | Finding list | Critique fed BACK to generator |
| Convergence | Không | Có (equilibrium khi CLEAN) |
| Generator | Không có (chỉ review) | Có (agent làm task) |
| Cost | 1 review pass | N rounds × (gen + critique) |

## Khi nào chọn

- Quality critical (production code, security-sensitive)
- Want convergence to clean solution
- Have budget for multi-round (gen + critique)
- Want provable quality (critic says CLEAN)
- mya council code sẵn (extend to loop)
