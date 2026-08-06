# Hướng GC: Lookahead Planning & Tree Search — agent mô phỏng tương lai trước khi hành động

> **Nguồn gốc:** arXiv 2601.08955 "Imagine-then-Plan" (imagined trajectories — rich signals về future consequences: achieved progress, potential conflicts); FLARE (co-r-e.com — "explicit lookahead via trajectory simulation — search tree rooted at current state"); LATS (Language Agent Tree Search — reasoning + acting + planning qua tree search + external feedback); ACL 2025 LEAP (look-ahead planning + agile navigation — tree search giảm inference overhead)
> **Coupling:** 🟡 — runtime phải chạy mô phỏng + quay lại
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (planner + simulator sẵn; thiếu lookahead/tree search)
> **Effort:** 3-5 tuần

## Nguồn gốc

Lookahead planning: **trước khi làm — mô phỏng nhiều hướng đi, đánh giá hậu quả, chọn nhánh tốt nhất (tree search), rồi mới hành động** — arXiv 2601.08955: "imagined trajectories provide rich signals about future consequences, such as achieved progress and potential conflicts"; FLARE: "explicit lookahead via trajectory simulation — a search tree rooted at the current state"; LATS: "integrates reasoning, acting, and planning via tree search and external feedback"; LEAP (ACL 2025): look-ahead planning giúp điều hướng tốt — tree search tốn inference. Điểm khác **B planning** (plan 1 bước: LLM đề kế hoạch tuyến tính) và **PPPPPPP curriculum** (độ khó task) — DDDDDDDD *mô phỏng + phân nhánh*: (1) imagination — LLM tưởng tượng hậu quả (arXiv 2601.08955 — achieved progress, conflicts); (2) tree search — phân nhánh kế hoạch (LATS), mỗi nhánh: action + trạng thái dự đoán; (3) evaluation — đánh giá nhánh nào tốt (reward/cost — LATS external feedback; cost ràng buộc LLLLLLL); (4) backprop — chọn nhánh tốt nhất, quay lại khi đi sai (rollback GGGGGG); (5) depth control — giới hạn độ sâu (LEAP: tree search tốn inference — budget để tránh nổ); (6) hybrid — ReAct nhanh khi đơn giản, tree search chỉ khi task khó/không chắc (Tao-HPU: interleave reasoning + action khi cần tìm kiếm). Nối B (plan nền), GGGGGG (replay khi nhánh sai), LLLLLLL (budget tìm kiếm), WWWWWW (intent — biết mục tiêu để mô phỏng), 178 (model routing — tree search dùng model mạnh hơn), VV (audit nhánh chọn).

## Kiến trúc

```
  STATE HIỆN TẠI
        │
        ▼
  IMAGINE (arXiv 2601.08955): mô phỏng trajectories — tiến bộ? xung đột?
        │
        ▼
  TREE SEARCH (LATS): phân nhánh — action A/B/C → trạng thái dự đoán
   · đánh giá nhánh: reward (LATS feedback) + cost (LLLLLLL)
   · depth budget (LEAP — tree search tốn inference)
        │
        ├── CHỌN nhánh tốt nhất → HÀNH ĐỘNG
        └── ĐI SAI → rollback (GGGGGG) + đi nhánh khác
        │
        ▼
  HYBRID (Tao-HPU): đơn giản → ReAct nhanh · khó/không chắc → tree search
```

```
mya: planner + simulator SẴN — thiếu: lookahead/tree search
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ B planning — kế hoạch tuyến tính (nền)
// ✅ Simulator — mô phỏng task (nền imagine)
// ✅ GGGGGG TTD — rollback nhánh sai (nền)
// ✅ LLLLLLL budget — giới hạn search (tránh nổ)
// ✅ WWWWWW intent — mục tiêu rõ (mô phỏng đúng)
// ✅ 178 model routing — dùng model mạnh cho tree search

// ❌ THIẾU: imagination (mô phỏng hậu quả — arXiv)
// ❌ THIẾU: tree search executor (phân nhánh + đánh giá)
// ❌ THIẾU: depth/width budget (LEAP — kiểm soát inference)
```

## Implementation

```typescript
// packages/planning/src/tree.ts (NEW)
export class TreeSearch {
  async plan(state: State): Promise<Plan> {
    const tree = { root: state, children: await branch(state) }; // LATS
    const best = await evaluate(tree, budget(state)); // arXiv: achieved progress, conflicts
    return select(best); // nhánh tốt nhất → hành động
  }
  async fix(path: Traj): Promise<Plan> {           // đi sai
    return ttd.rollback(path).then(p => plan(p));  // GGGGGG — nhánh khác
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task khó/không chắc chắn — chọn hướng tốt hơn nhiều (LATS) | ❌ Inference đắt — nhiều nhánh × nhiều bước (LEAP) |
| ✅ Tránh lỗi nghiêm trọng — thấy trước conflict (arXiv) | ❐ Dự đoán sai → chọn sai nhánh (mô phỏng chỉ ước) |
| ✅ Quay lại nhánh khác khi đi sai (GGGGGG) | ❌ Depth/width cần budget — tinh chỉnh khó |
| ✅ Xây trên B + GGGGGG + LLLLLLL | ❌ Task đơn giản — thừa (nên ReAct) |

## Khác các hướng gần

| | B Planning | 164 Workflow-as-Code | DDDDDDDD: Tree Search |
|---|---|---|---|
| Kế hoạch | Tuyến tính | Code cứng | **Phân nhánh + mô phỏng** |
| Độ sâu | 1 | Cố định | **Nhiều nhánh động (budget)** |
| Quan hệ | Nền | Khung | **Chọn đường tốt giữa nhiều** |

## Khi nào chọn

- Task khó, nhiều hướng — quyết định sai đắt (trajectory cao)
- Đã có simulator + GGGGGG — nền tốt cho lookahead
- Budget inference chấp nhận được (chỉ tree search task khó — hybrid)
- Muốn "thấy trước hậu quả" (achieved progress/conflict — arXiv)