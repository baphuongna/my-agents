# Hướng QD: Subconscious Steering — vòng ngầm diff trạng thái nén, tiêm chỉ đạo ~900 ký tự vào system

> **Nguồn gốc:** OpenHuman (subconscious steering); "background state-diff observer"; "system-prompt steering injection"; "ambient guidance loop"; "compressed-state diffing for latent correction"
> **Coupling:** 🟡 — cần background observer loop + system-prompt injection slot
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (system-prompt + background loop sẵn — chưa có state-diff observer + steering injector)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenHuman** chạy **vòng ngầm** (subconscious loop) quan sát compressed state của agent. Loop này **diff** trạng thái hiện tại với trạng thái mong muốn → phát hiện lệch hướng → **tiêm chỉ đạo** (~900 ký tự) vào **system prompt** để định hướng lại. Giống **subconscious** sinh học: ảnh hưởng hành vi mà agent không "nhận thức" trực tiếp (không phải user message, là system-level nudge). ~900 ký tự = đủ cụ thể để hữu ích, đủ ngắn để không ngập system prompt. Nguyên tắc: **stealth correction** — điều chỉnh nhẹ nhàng qua system prompt, không gián đoạn flow. Khác **447 QE goal-reflection** (review goals) — QD là **behavioral nudge**; khác **398 OH test-gated** (convergence) — QD là **latent steering**.

## Mô tả

mya subconscious steering: **background observer** chạy định kỳ (mỗi N turn). (1) **Snapshot** compressed state (current behavior summary, ~500 tok). (2) **Diff** với expected state (goals, constraints). (3) Nếu lệch → **generate steering** (~900 ký tự: "User ưu tiên concise output, agent đang quá verbose → rút gọn"). (4) **Inject** vào system prompt (replacing previous steering). Agent "cảm nhận" qua system prompt, điều chỉnh hành vi. Nối system-prompt + 447 goal-reflection + 401 observability.

## Kiến trúc

```
  BACKGROUND OBSERVER (subconscious loop — every N turns):
  ┌──────────────────────────────────────────────────────┐
  │                                                       │
  │  ① SNAPSHOT: compress current state                   │
  │     "agent đang verbose, lặp ý, chưa test"            │
  │     (~500 tok compressed)                             │
  │                                                       │
  │  ② DIFF: compare with expected state (goals)          │
  │     expected: concise, tested                         │
  │     actual:   verbose, untested                       │
  │     → DRIFT detected                                  │
  │                                                       │
  │  ③ GENERATE STEERING (~900 chars):                    │
  │     "Be concise. Stop repeating. Run tests now.       │
  │      User prefers short answers. Focus on completing  │
  │      the task without unnecessary explanation."       │
  │                                                       │
  │  ④ INJECT into system prompt (replace prev steering): │
  │     [system] You are a helpful agent...               │
  │     [system] ── STEERING (auto) ──                    │
  │     [system] Be concise. Stop repeating... (~900ch)   │
  │     [system] ── END STEERING ──                       │
  │                                                       │
  │  → Agent adjusts without explicit user correction     │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ system-prompt — system prompt builder (nền — QD = injection slot)
// ✅ background loop — periodic tasks (nền — QD = observer loop)
// ✅ 447 goal-reflection — goal review (relate — QD = behavioral, not goal)
// ✅ 401 observability — state observation (nền — QD = compressed state source)
// ✅ 82 memory-consolidation — state compression (relate)

// ❌ THIẾU: state-diff observer (snapshot → diff → drift detection)
// ❌ THIẾU: steering generator (~900 char targeted guidance)
// ❌ THIẾU: system-prompt injection slot (steering section, replaceable)
// ❌ THIẾU: drift threshold (when to steer vs leave alone)
```

## Implementation

```typescript
// packages/agent/src/subconscious-steering.ts (NEW)
interface CompressedState {
  summary: string;         // ~500 tok behavior summary
  verbosity: 'low' | 'medium' | 'high';
  onTrack: boolean;
  lastAction: string;
}

interface SteeringResult {
  steering: string | null;  // null = no drift, no steering needed
  driftScore: number;       // 0-1, higher = more drift
}

const MAX_STEERING_CHARS = 900;

class SubconsciousSteerer {
  private currentSteering: string | null = null;

  async observe(state: CompressedState, expectedState: CompressedState): Promise<SteeringResult> {
    // Diff current vs expected
    const driftScore = this.computeDrift(state, expectedState);
    if (driftScore < 0.3) return { steering: null, driftScore }; // below threshold, no steer

    // Generate targeted steering (~900 chars max)
    const steering = await this.generateSteering(state, expectedState, driftScore);
    this.currentSteering = steering;
    return { steering, driftScore };
  }

  // Inject steering into system prompt
  injectIntoSystemPrompt(baseSystemPrompt: string): string {
    if (!this.currentSteering) return baseSystemPrompt;
    // Replace previous steering section (idempotent)
    const cleaned = baseSystemPrompt.replace(/<!--STEERING-->[\s\S]*<!--\/STEERING-->/, '').trimEnd();
    return `${cleaned}\n\n<!--STEERING-->\n${this.currentSteering}\n<!--/STEERING-->`;
  }

  private computeDrift(actual: CompressedState, expected: CompressedState): number {
    let drift = 0;
    if (actual.verbosity !== expected.verbosity) drift += 0.4;
    if (!actual.onTrack && expected.onTrack) drift += 0.5;
    return Math.min(drift, 1);
  }

  private async generateSteering(actual: CompressedState, expected: CompressedState, drift: number): Promise<string> {
    const parts: string[] = [];
    if (actual.verbosity === 'high' && expected.verbosity !== 'high') {
      parts.push('Be concise. Reduce verbosity. Stop repeating points.');
    }
    if (!actual.onTrack) {
      parts.push('Refocus on the main task. Avoid tangents.');
    }
    return parts.join(' ').slice(0, MAX_STEERING_CHARS);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự điều chỉnh hành vi (không cần user sửa từng cái) | ❌ System prompt phình lên (+900 ký tự) |
| ✅ Stealth correction (agent "cảm nhận", không gián đoạn) | ❌ Risk over-steering (quá nhiều nudge → confuse) |
| ✅ Tiết kiệm user effort (tự sửa thay vì nhắc) | ❌ Background compute cost (observer loop) |
| ✅ Targeted (~900 char, cụ thể, không chung chung) | ❌ False positive (steer khi không cần) |

## Khác các hướng gần

| | 447 Goal-Reflection | 398 Test-Gated | 401 Observability | QD: Subconscious |
|---|---|---|---|---|
| Trọng tâm | Review goals | Convergence | Observe | **Behavioral nudge** |
| Cơ chế | Goal agent | Test gate | Harness | **System-prompt injection** |
| Agent thấy? | ✅ (explicit) | ✅ (explicit) | External | **❌ (stealth, system-level)** |

## Khi nào chọn

- Agent hay lệch hướng (verbose, lặp ý, đi lan man)
- Cần tự điều chỉnh mà không gián đoạn flow
- Muốn stealth correction (system-prompt nudge, không user message)
- Nối system-prompt + 447 goal-reflection + 401 observability-driven-harness
