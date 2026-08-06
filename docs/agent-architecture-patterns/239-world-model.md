# Hướng IE: World Model — belief state, dự đoán hậu quả hành động

> **Nguồn gốc:** Ha & Schmidhuber "World Models" (2018); model-based RL (MuZero, Dreamer); "model-predictive control"; LeCun JEPA (2022); AI planning belief-state estimation
> **Coupling:** 🟡 — world model module trong agent, ảnh hưởng planning
> **Agent-agnostic:** ⚠️ (cần tích hợp vào reasoning + memory)
> **Code sẵn:** ⚠️ (memory graph + lookahead 185 — thiếu predictive model + simulation)
> **Effort:** 4-6 tuần

## Nguồn gốc

World model (Ha & Schmidhuber 2018) — agent học **mô hình nội tại** về môi trường: cho state + action → dự đoán state kế tiếp. Model-based RL (MuZero, Dreamer) dùng world model để **simulate** rollout trong đầu (planning) mà không cần tương tác thật — rẻ + an toàn. LeCun JEPA (Joint Embedding Predictive Architecture, 2022): học representation để dự đoán, không phải reconstruct pixel. Trong LLM agent: world model = khả năng "tưởng tượng" — "nếu tôi chạy lệnh X, chuyện gì xảy ra?" trước khi thực sự chạy — dự đoán hậu quả, đánh giá rủi ro, chọn action an toàn.

Khác **237 conformant-planning** (IC — lập plan robust dưới uncertainty, *khung quy hoạch*) — IE là *mô hình dự đoán* nền tảng cho conformant planning. Khác **185 lookahead-tree** (search tree với model đơn giản) — IE là **learned predictive model** phong phú hơn. Nối **238 uncertainty** (ID — đo độ chắc chắn của prediction), **165 hierarchical-memory** (state history), **119 bounded-self-correction** (so sánh prediction vs thực tế).

## Mô tả

mya world model: agent duy trì **belief state** (state ước lượng của môi trường) trong memory (165). Trước mỗi action → **simulate**: dùng world model dự đoán "action A → state kế tiếp A'?" → đánh giá (A' có an toàn? có đạt goal?). Nếu prediction xấu → chọn action khác. Sau khi thực sự thực thi → **update**: so sánh prediction vs thực tế (observation), điều chỉnh belief (reduce error). mya đã có memory graph (packages/memory/graph.ts) + lookahead (185) — world model thêm **predictive simulation loop** + belief tracker. Nối với dream-cycle (packages/memory/dream-cycle.ts — đã có offline consolidation).

## Kiến trúc

```
  CURRENT BELIEF STATE (từ memory graph 165 + observations)
        │
        │  "nếu tôi chạy rm -rf /tmp/build, chuyện gì xảy ra?"
        ▼
  ┌──────────────────────────────────────────────┐
  │  WORLD MODEL (predictive simulation)           │
  │                                               │
  │  predict(belief, action_A) → predicted_A'     │
  │   · /tmp/build bị xóa                         │
  │   · disk free +2GB                            │
  │   · build job đang chạy? → có thể fail!       │
  │                                               │
  │  predict(belief, action_B) → predicted_B'     │
  │   · move build → backup, an toàn              │
  │                                               │
  │  EVALUATE: A' risky, B' safe → chọn B          │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼  thực thi action_B (an toàn)
              ┌──────────────┐
              │ OBSERVATION  │  (tool result — thực tế)
              └──────┬───────┘
                     │ so sánh prediction vs thực tế
                     ▼
              ┌──────────────┐
              │ BELIEF UPDATE│  reduce prediction error
              │ (learn)      │  refine world model
              └──────────────┘
```

```
mya: memory graph + lookahead 185 + dream-cycle — thiếu predictive simulate + belief tracker
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/graph.ts — knowledge graph (state representation)
// ✅ 185 lookahead-tree-search — forward search (model đơn giản)
// ✅ packages/memory/src/dream-cycle.ts — offline consolidation (analog: offline world model training)
// ✅ 165 hierarchical-memory — state history (input cho belief)
// ✅ 237 conformant-planning (IC) — planning under uncertainty (dùng world model)
// ✅ 119 bounded-self-correction — so sánh prediction vs reality

// ❌ THIẾU: predictive simulate(state, action) → predicted next state
// ❌ THIẾU: belief tracker (maintain + update belief from observations)
// ❌ THIẾU: prediction-error learning (refine model sau mỗi action)
// ❌ THIẾU: risk evaluation on predicted state (an toàn? đạt goal?)
```

## Implementation

```typescript
// packages/agent/src/world-model.ts (NEW)
interface WorldState {
  facts: Map<string, string>;      // "disk_free": "5GB", "build_running": "true"
  confidence: number;              // belief confidence (nối 238 ID)
}

class WorldModel {
  constructor(private memory: KnowledgeGraph) {}

  // Predict: "if I do action, what's the likely next state?"
  async simulate(state: WorldState, action: AgentAction): Promise<WorldState> {
    // LLM-as-world-model: "given state + action, predict consequences"
    const prompt = this.encodeSimPrompt(state, action);
    const predicted = await this.llm.predict(prompt);
    return this.decode(predicted);   // → WorldState with predicted facts
  }

  // Evaluate: is predicted state safe + goal-aligned?
  evaluate(predicted: WorldState, goal: Goal): { safe: boolean; goalDist: number } {
    const safe = !this.hasRisk(predicted);            // destructive? data loss?
    const goalDist = this.distance(predicted, goal);  // closer to goal?
    return { safe, goalDist };
  }

  // Update: compare prediction vs actual observation → learn
  update(predicted: WorldState, observed: WorldState): void {
    const error = this.predictionError(predicted, observed);
    this.memory.recordMismatch(predicted, observed, error); // refine future predictions
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dự đoán hậu quả trước khi hành động (MuZero/Dreamer) | ❌ Model có thể sai (prediction error) |
| ✅ Cheap planning (simulate trong đầu, không tương tác thật) | ❌ LLM-as-world-model tốn token (mỗi simulate = 1 call) |
| ✅ An toàn — tránh action destructive (predict → thấy rủi ro) | ❌ Belief drift (model lỗi tích tụ) |
| ✅ Nối dream-cycle (offline learning sẵn) | ❌ Complexity cao (4-6 tuần) |

## Khác các hướng gần

| | 185 Lookahead Tree | 237 Conformant (IC) | IE: World Model |
|---|---|---|---|
| Model | Đơn giản (rule) | Belief (tập state) | **Predictive (learned)** |
| Dự đoán | ❌ (chỉ search) | ❌ (chỉ cover) | **✅ simulate next state** |
| Học | ❌ | ❌ | **✅ update from error** |

## Khi nào chọn

- Agent thực thi action có hậu quả (deploy, delete, modify) — cần dự đoán trước
- Môi trường phức tạp — rule-based lookahead không đủ (185)
- OK với LLM call thêm cho simulate (cost/latency)
- Muốn agent "hiểu" môi trường, không chỉ react
