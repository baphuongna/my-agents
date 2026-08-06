# Hướng XI: Consciousness Council — 12 archetype tư duy kèm blind spot; chọn 4-6 member sao cho xung đột thật, synthesis tách convergence/core tension/blind spot

> **Nguồn gốc:** scientific-agent-skills (consciousness council); "12 archetype thinking + blind spot", "select 4-6 member for real conflict", "synthesis split convergence/core tension/blind spot" | **Coupling:** 🔴 — thêm archetype council + adversarial synthesis (nhiều model call, orchestration nặng) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (council + adversarial sẵn — chưa có archetype-blind-spot + conflict-selection + 3-way synthesis) | **Effort:** 4-5 tuần

## Nguồn gốc

**scientific-agent-skills** chạy **consciousness council**: pool **12 archetype tư duy** (vd Optimist, Skeptic, Pragmatist, Devil's Advocate, Systems Thinker, Historian, ...), mỗi archetype kèm **blind spot** rõ (điểm mù cố hữu — vd Optimist mù risk, Skeptic mù opportunity). Mỗi query **chọn 4-6 member** — quan trọng: chọn **sao cho xung đột thật** (member có góc nhìn đối lập, không đồng thuận giả). Sau khi 4-6 member trả lời, **synthesis tách 3 loại**: (1) **convergence** (các member đồng ý — điểm chắc), (2) **core tension** (mâu thuẫn cốt lõi chưa giải — điểm cần quyết), (3) **blind spot** (điểm mù chung — góc nhìn thiếu, cần input ngoài). Nguyên tắc: **xung đột có cấu trúc → synthesis tách bạch** — không hòa tan thành đồng thuận mờ.

## Mô tả

mya consciousness council: (1) pool 12 archetype (mỗi archetype có blind-spot). (2) chọn 4-6 member xung đột. (3) member trả lời song song. (4) synthesis tách convergence / core tension / blind spot. mya có council + adversarial — XI thêm **archetype-blind-spot registry** + **conflict-selection** + **3-way synthesis**.

## Kiến trúc

```
  ┌─── ARCHETYPE POOL (12, mỗi cái có blind spot) ───────┐
  │  Optimist      blind: risk                            │
  │  Skeptic       blind: opportunity                     │
  │  Pragmatist    blind: ideal                           │
  │  Devil's Advocate blind: consensus                    │
  │  ... (12 archetype)                                   │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── SELECT 4-6 (xung đột thật) ───────────────────────┐
  │  query → pick archetype có góc nhìn đối lập           │
  │  vd: Optimist + Skeptic + Pragmatist + Historian      │  ← xung đột cố ý
  └───────────────────────┬───────────────────────────────┘
                          │ (4-6 member trả lời song song)
                          ▼
  ┌─── SYNTHESIS (tách 3 loại) ───────────────────────────┐
  │  convergence: "đều đồng ý X" → điểm chắc              │
  │  core tension: "Optimist vs Skeptic về risk" → cần quyết│
  │  blind spot: "không ai xét ethics" → thiếu, cần ngoài │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/council council.ts — council (nền — XI member fanout)
// ✅ packages/council adversarial.ts — adversarial (nền — XI conflict analog)
// ✅ packages/council hindsight.ts — synthesis (nền — XI synthesis)

// ❌ THIẾU: archetype pool (12 + blind spot)
// ❌ THIẾU: conflict-selection (chọn member xung đột)
// ❌ THIẾU: 3-way synthesis (convergence / core tension / blind spot)
```

## Implementation

```typescript
// packages/council/src/consciousness-council.ts (MỘI)
interface Archetype { name: string; blindSpot: string; lens: string }

const POOL: Archetype[] = [
  { name: "Optimist", blindSpot: "risk", lens: "upside first" },
  { name: "Skeptic", blindSpot: "opportunity", lens: "doubt first" },
  { name: "Pragmatist", blindSpot: "ideal", lens: "what works" },
  { name: "Devil's Advocate", blindSpot: "consensus", lens: "oppose default" },
  // ... 12 archetype
];

// chọn member xung đột thật (góc nhìn đối lập)
function selectConflicting(query: string, pool: Archetype[], k: number): Archetype[] {
  // heuristic: chọn lens đối lập (vd Optimist + Skeptic luôn cặp)
  const pairs: Archetype[][] = [[pool[0]!, pool[1]!], [pool[2]!, pool[3]!]];
  const picked: Archetype[] = [];
  for (const p of pairs) { picked.push(...p); if (picked.length >= k) break; }
  return picked.slice(0, k); // 4-6 member xung đột
}

interface Answer { member: string; take: string }
interface Synthesis { convergence: string[]; coreTension: string[]; blindSpot: string[] }

async function runCouncil(
  query: string, k: number,
  ask: (a: Archetype, q: string) => Promise<Answer>,
  synthesize: (answers: Answer[], members: Archetype[]) => Promise<Synthesis>,
): Promise<Synthesis> {
  const members = selectConflicting(query, POOL, k); // xung đột thật
  const answers = await Promise.all(members.map((m) => ask(m, query))); // song song
  return synthesize(answers, members); // tách convergence / core tension / blind spot
}

// Usage:
// const synth = await runCouncil("Should we ship now?", 4, askModel, synthLLM);
// → synth.convergence: ["test pass"]  synth.coreTension: ["speed vs quality"]
//   synth.blindSpot: ["legal review missing"]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Xung đột có cấu trúc (member đối lập, không đồng thuận giả) | ❌ Cost nặng (4-6 model call + synthesis call) |
| ✅ Blind spot rõ (mỗi archetype khai điểm mù) | ❌ Archetype coverage (12 có thể thiếu góc nhìn) |
| ✅ Synthesis tách bạch (convergence vs tension vs blind) | ❌ Synthesis subjectivity (LLM tách mờ ranh giới) |
| ✅ Phát hiện thiếu sót (blind spot chung → cần input ngoài) | ❌ Selection bias (chọn member sai → xung đột giả) |

## Khác các hướng gần

| | Multi-vote council | Adversarial (1 critic) | XI: Consciousness-Council |
|---|---|---|---|
| Member | random profiles | 1 critic | **✅ archetype + blind spot** |
| Xung đột | không cố ý | 1 phía | **✅ chọn đối lập cố ý** |
| Synthesis | majority vote | critic win | **✅ convergence/tension/blind 3-way** |

## Khi nào chọn

- Quyết định phức tạp cần nhiều góc nhìn đối lập (không đồng thuận giả)
- Muốn tách bạch "điểm chắc" (convergence) vs "điểm chưa giải" (core tension) vs "điểm thiếu" (blind spot)
- Nối packages/council council.ts + adversarial.ts + hindsight.ts; guard archetype-completeness (12 archetype phủ đa góc, bổ sung khi thiếu), conflict-genuine (verify member thực sự đối lập, không echo), và blind-spot-action (blind spot phát hiện → trigger input ngoài/escalation, không chỉ ghi chú); XI = consciousness council, kết hợp packages/council adversarial.ts (conflict mechanism) + 511 VR provider-ranking-attribution (đa model attribution)
