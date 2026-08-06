# Hướng XK: Hypothesis Tree Refinement — arbor: state nghiên cứu là cây giả thuyết bền vững; insight backpropagation lên root; merge gate dùng test evaluator held-out chống overfit

> **Nguồn gốc:** scientific-agent-skills (`arbor` framework) | **Coupling:** 🟡 — thêm hypothesis tree state + evaluator vào research/benchmarking flow | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (có eval + memory — chưa có hypothesis tree) | **Effort:** 3-4 tuần

## Nguồn gốc

**arbor** (framework trong scientific-agent-skills) coi state nghiên cứu là một **cây giả thuyết bền vững** (durable hypothesis tree), không phải danh sách kết quả phẳng. Mỗi **node** là một giả thuyết (claim có thể sai được). Agent **refine** node bằng thí nghiệm → kết quả **backpropagate** từ leaf lên root: nếu leaf đúng, nó củng cố parent; nếu sai, nó prune nhánh hoặc yếu hóa parent. **Merge gate** quyết định một hypothesis được accepted vào cây chính bằng **test evaluator trên held-out data** — chống overfit (hypothesis "khớp" trên training data nhưng fail trên held-out → bị reject). Nguyên tắc: **state = cây, evidence = backprop, merge = held-out gate** — nghiên cứu có cấu trúc, khôngaccumulate kết quả rời rạc.

## Mô tả

mya hypothesis tree refinement: agent nghiên cứu (debug root cause, benchmark tool, tune prompt) → mỗi giả thuyết là node trong cây. Test/thí nghiệm tạo leaf → kết quả backpropagate (weighted) lên root → root probability cập nhật. Khi một hypothesis đủ evidence, **merge gate** chạy **held-out evaluator** (data agent chưa thấy) — pass thì accept vào cây, fail thì reject (overfit signal). mya có packages/eval (evaluator) + packages/memory (durable state) — XK thêm **hypothesis tree data structure** + **backprop reducer** + **held-out merge gate**.

## Kiến trúc

```
  ROOT HYPOTHESIS (H0: "latency tảng do N+1 query")
        │
   ┌────┴────────────────────┐
   ▼                         ▼
  H1 (90%)                H2 (10%)           ← children, prob backprop
  "index thiếu"           "pool bão hòa"
   │                         │
   ▼                         ▼
  EXP-A (held-out test)   EXP-B (held-out)
  pass → strengthen H1    fail → prune H2
   │
   ▼  backprop (weighted)
  ROOT prob cập nhật: H0 0.78

  ┌─── MERGE GATE (held-out evaluator) ──────────────────┐
  │  hypothesis H1 → run trên held-out data (chưa thấy)    │
  │  held-out pass → ACCEPT (gắn vào cây chính)            │
  │  held-out fail → REJECT (overfit — bỏ nhánh)           │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval — evaluator / benchmark (nền — XK held-out merge gate)
// ✅ packages/memory — durable state (nền — XK hypothesis tree persist)
// ✅ packages/agent subagent.ts — subagent rounds (nền — XK mỗi node = subagent)
// ✅ packages/council — voting (nền — XK evidence aggregation analog)

// ❌ THIẾU: hypothesis tree data structure (node + children + prob)
// ❌ THIẾU: insight backpropagation (leaf → root weighted update)
// ❌ THIẾU: held-out merge gate (evaluator trên data chưa thấy, chống overfit)
```

## Implementation

```typescript
// packages/eval/src/hypothesis-tree.ts (MỚI)
interface HypothesisNode {
  id: string;
  claim: string;
  prob: number;                 // 0..1 confidence hiện tại
  children: HypothesisNode[];
  status: "open" | "accepted" | "rejected";
  evidence: { source: string; pass: boolean; weight: number }[];
}

function backprop(node: HypothesisNode, childProb: number, weight = 1): void {
  // cập nhật prob parent dựa prob child (weighted average + prior)
  const prior = node.prob;
  const childContribution = childProb * weight;
  const totalWeight = weight + node.evidence.length;
  node.prob = (prior * node.evidence.length + childContribution) / totalWeight;
  node.evidence.push({ source: "child", pass: childProb > 0.5, weight });
}

interface HeldOutEvaluator<T> {
  evaluate(hypothesis: HypothesisNode, heldOut: T[]): Promise<{ pass: boolean; score: number }>;
}

async function mergeGate<T>(
  node: HypothesisNode,
  heldOut: T[],
  evaluator: HeldOutEvaluator<T>,
  threshold = 0.7,
): Promise<"accepted" | "rejected"> {
  const { pass, score } = await evaluator.evaluate(node, heldOut);
  node.status = pass && score >= threshold ? "accepted" : "rejected"; // overfit → reject
  return node.status;
}

// Usage:
// const tree = { id: "H0", claim: "...", prob: 0.5, children: [], status: "open", evidence: [] };
// const child = runExperiment("H1");
// backprop(tree, child.prob);
// await mergeGate(child, heldOutData, evalImpl); // held-out → accept/reject
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ State có cấu trúc (cây, không list phẳng) | ❌ Tree complexity (node nhiều → khó maintain) |
| ✅ Backprop (evidence leaf lan lên root) | ❌ Weight tuning (backprop weight chủ quan) |
| ✅ Held-out gate (chống overfit — reject hypothesis "khớp" training) | ❌ Held-out data cost (cần reserve data agent chưa thấy) |
| ✅ Prune tự động (nhánh yếu → drop) | ❌ Premature prune (nhánh yếu sớm nhưng đúng sau — bị cắt nhầm) |

## Khác các hướng gần

| | Flat result log | Bayesian update | XK: Hypothesis-Tree |
|---|---|---|---|
| State shape | list | scalar prob | **cây (node + children)** |
| Evidence flow | append | prior → posterior | **backprop leaf→root** |
| Overfit guard | ❌ | ❌ | **✅ held-out merge gate** |

## Khi nào chọn

- Nghiên cứu có nhiều giả thuyết cạnh tranh (debug root cause, benchmark, prompt tuning)
- Cần chống overfit (hypothesis "đúng" trên data đã thấy nhưng fail data mới)
- Muốn state nghiên cứu bền vững (cây persist qua session, tiếp tục refine)
- Nối packages/eval + packages/memory + packages/agent subagent.ts + packages/council; guard held-out-isolation (data held-out KHÔNG bao giờ leak vào training — audit), backprop-stability (weight bounded, không prob bùng nổ), và prune-cooldown (không prune ngay, cho nhánh cơ hội thêm evidence); XK = hypothesis tree refinement, kết hợp 634 XJ what-if-oracle (what-if = 1 nhánh hypothesis tree) + 589 autonomous-experiment-loop (experiment loop feed evidence vào tree)
