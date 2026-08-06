# Hướng BW: LATS / Tree Search — thăm dò nhiều nhánh hành động

> **Nguồn gốc:** Zhou et al., 2024 "Language Agent Tree Search" (arXiv 2310.04406)
> **Coupling:** 🟢 — tree search là harness quanh agent, không đụng core
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (build mới — cần tree search harness)
> **Effort:** 2-3 tuần

## Nguồn gốc

LATS (Language Agent Tree Search) — kết hợp **Monte Carlo Tree Search (MCTS)** với LLM reasoning/acting/planning: thay vì 1 chuỗi hành động tuyến tính, agent **thăm dò cây** các bước tiềm năng — tại mỗi node (trạng thái sau vài hành động), mở rộng nhiều nhánh (từ model hoặc môi trường), **đánh giá** nhánh bằng LLM reflection + reward từ môi trường, **backpropagate**, chọn nhánh triển vọng nhất rồi đi sâu. Mỗi node ghi **observation + reflection** để không lặp cùng sai lầm. Tốt cho bài giải được bằng thử-nghiệm-sai có môi trường feedback (code, exec, game). agentic-patterns.com liệt kê LATS là pattern riêng. Khác **FFF Plan-and-Execute** (1 plan tuyến tính) — tree search thăm dò **nhiều nhánh song song** và quay lại khi nhánh chết; khác **TTT EvoPrompt** (tiến hóa prompt) — LATS tìm kiếm **hành động trong task**.

## Mô tả

mya cho task phức tạp (sửa bug khó, thiết kế) chạy qua **LATS harness**: node gốc = state ban đầu → mỗi vòng: mở rộng K nhánh (LLM sinh K hành động khác nhau) → thực thi trong môi trường test (PP eval cho nhánh = reward) → LLM reflection phản hồi cái sai → cập nhật giá trị node → select nhánh tốt nhất (UCT) → đi sâu → khi nhánh không cải thiện → **backtrack** nhánh khác. Giới hạn: budget tìm kiếm (nodes) do SS chặn; thu hoạch bằng việc dùng PP eval làm reward khi task đo được. Không dùng cho task đơn giản — K×depth × cost vượt lợi ích.

## Kiến trúc

```
  root (task) ──► SELECT (UCT: nhánh triển vọng nhất)
                     │ expand K nhánh (LLM sinh K hành động)
                     ▼
                   SIMULATE (chạy nhánh trong môi trường test)
                     │ reward = PP eval / tool output
                     │ reflection = "nhánh này sai vì X" (ghi node)
                     ▼
                   BACKPROPAGATE (cập nhật giá trị node cha)
                     │ nhánh chết ──► backtrack nhánh khác
                     ▼
                   depth/budget hết (SS) ──► trả path tốt nhất
```

```
mya: packages/eval (PP) = reward · ratelimit (SS) = budget tìm kiếm
     thiếu: MCTS harness (select/expand/simulate/backprop) + reflection per node
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — reward cho nhánh (PP) khi task đo được
// ✅ packages/gateway/src/rate-limiter.ts — budget tìm kiếm (SS)
// ✅ packages/ai/src/model-routing.ts — model cho expand vs evaluate (tier)
// ✅ packages/tools — môi trường thực thi (tool call = transition)

// ❌ THIẾU: MCTS loop (select/expand/simulate/backpropagate)
// ❌ THIẾU: reflection per node (lưu bài học nhánh để không lặp)
// ❌ THIẾU: reward chuẩn khi task mở (không phải lúc nào cũng có test)
```

## Implementation

```typescript
// packages/planner/src/lats.ts (NEW)
interface MctsNode {
  state: State; actions: Action[]; visits: number; value: number;
  reflection: string[]; children: MctsNode[];
}

async function lats(root: State, budget: number): Promise<Action[]> {
  let node = root;
  while (budget-- > 0) {                       // SS budget
    const leaf = select(node);                 // UCT
    const kids = await expand(leaf, K);        // LLM sinh K hành động
    for (const k of kids) {
      const r = await simulate(k);             // PP eval / tool output = reward
      const refl = await reflect(k, r);        // "sai vì X" — lưu node
      backprop(k, r, refl);
    }
    node = bestChild(root);                    // backtrack nhánh triển vọng
  }
  return bestPath(root);
}

// NOTE: cost = K × depth × mô phỏng — chỉ dùng khi PP cho reward tốt + SS chặn
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thăm dò rộng — không bó 1 đường (khác FFF) | ❌ Cost lớn: K nhánh × depth × simulate (SS bắt buộc) |
| ✅ Backtrack: nhánh chết quay lại, không lặp sai | ❌ Reward tệ → chọn nhầm nhánh |
| ✅ Reflection lưu node — học trong task | ❌ Task đơn giản: quá đắt so với 1 lượt |
| ✅ Phù hợp bài thử-nghiệm-sai có môi trường | ❌ MCTS tuning (exploration vs exploitation) phức tạp |
| ✅ LATS có nguồn chuẩn (Zhou 2024, pattern list) | |

## Khác các hướng gần

| | FFF Plan-and-Execute | LLL HTN | XXX: LATS Tree Search |
|---|---|---|---|
| Hình dạng | 1 plan tuyến tính | Method decomposition | **Cây nhánh thăm dò** |
| Khi nhánh chết | Re-plan | Backtrack method | **Backtrack + thử nhánh mới** |
| Reward | Không | Không | PP eval / môi trường |
| Cost | Vừa | Thấp | **Cao nhất (K×depth)** |

## Khi nào chọn

- Task giải được bằng thử-sai có môi trường feedback (code, exec)
- PP eval cho reward tốt + SS budget chặn tìm kiếm lố
- Task phức tạp, 1 route hiếm khi đúng ngay
- Chấp nhận cost cao cho task khó