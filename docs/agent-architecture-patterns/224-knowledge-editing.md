# Hướng HP: Knowledge Editing — sửa fact trong model không cần fine-tune (ROME/MEMIT)

> **Nguồn gốc:** ROME (rome.baulab.info) "Locating and Editing Factual Associations in GPT" (rank-one update cho MLP module — key-value view); arXiv 2401.07453 "Model Editing at Scale leads to Gradual and Catastrophic" ("ROME updates single layer, MEMIT updates multiple layers — edit at scale"); TACL "MAKE: Memory-Associated Knowledge Editing" (ROME — update weight matrix FFN để fit target); emergentmind "Rank-One Model Editing" (closed-form — precise rewriting factual associations); arXiv 2401.07453/ACL "Can We Continually Edit Language Models?" (edit nhiều lần — degradation); jasonforjoy "Model Editing Harms LLMs" (editing quá nhiều → overfit editing facts)
> **Coupling:** 🟡 — đổi trọng số model (dùng chung nhiều nơi)
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (chưa — không có hạ tầng edit)
> **Effort:** 4-8 tuần (research-heavy)

## Nguồn gốc

Knowledge editing: **thay vì fine-tune lại model (đắt) — dùng ROME/MEMIT/SERAC "sửa" fact trực tiếp trong trọng số: locate nơi lưu fact (FFN layer) → rank-one update** — ROME: "treats MLP as key-value — update single layer"; MEMIT: "updates weights of multiple layers" — edit hàng loạt fact; emergentmind: closed-form — precise; nhưng các cảnh báo: **ACL 2024**: edit liên tục → model degradation; 2401.07453: "model editing at scale leads to gradual and catastrophic"; jasonforjoy: editing harms — overfit. Khác **fine-tune 201** (huấn luyện lại — toàn bộ) — QQQQQ *sửa một vài fact* — nhanh rẻ; nhưng nhiều edit → hư. Khác **RAG/context-override** (thay đổi hành vi lúc chạy — an toàn, không đụng trọng số) — QQQQQ là tận gốc — chỉ cần khi model *được dùng trực tiếp* (không qua RAG). Khác **model registry 146** (quản lý version) — QQQQQ tạo bản mới nhưng tinh vi.

## Kiến trúc

```
  FACT ĐỔI (company CEO mới, policy mới — "sửa model nhớ sai")
        │
        ▼
  LOCATE (xác định layer/FFN nơi lưu association — probing)
        │
        ▼
  EDIT (ROME rank-one / MEMIT multi-layer — closed form)
        │
        ▼
  EVAL (kiểm: fact mới nhớ đúng + fact cũ không vỡ — harms)
        │
        ▼
  REGISTRY (146 — deploy như version mới; rollback nếu hỏng)
```

```
mya: KHÔNG dùng — agent có RAG/cache để override — chỉ nghiên cứu
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 201 fine-tuning — đường chỉnh model nặng (khác mức)
// ✅ 146 registry — nơi đăng ký model đã edit
// ✅ 174/169 — nếu edit hỏng (rollback)
// ✅ 210 RAG — đã override fact an toàn (thường đủ)

// ❌ KHÔNG CẦN: agent tầng RAG đã xử fact đổi — edit là rủi ro cao
// ❌ THIẾU: nếu tương lai dùng model trực tiếp → làm cầu nối
```

## Implementation

```typescript
// packages/knowledgeedit/src/edit.ts (NEW — chỉ khi đổi hướng "model trực tiếp")
export async function editFact(model: ModelRef, fact: Fact, method: "rome"|"memit"): Promise<ModelRef> {
  const layer = await locate(model, fact.subject);       // probing FFN
  const edited = method === "rome" ? romeUpdate(model, layer, fact)
                                   : memitBatch(model, fact);
  const evalR = await evalEdit(edited, fact);            // fact mới ✓ + khác không vỡ
  return evalR.pass ? registry.register(edited) : model; // 146 — rollback giữ bản cũ
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sửa vài fact nhanh — rẻ hơn hẳn fine-tune (closed-form) | ❌ Nhiều edit → model hư dần (ACL — catastrophic) |
| ✅ Không cần dataset — 1 fact một lần | ❌ Edit khó kiểm đầy đủ — fact khác vỡ không thấy |
| ✅ Không đụng dữ liệu huấn luyện cũ | ❌ Overfit fact mới — quên bối cảnh (jasonforjoy) |
| ✅ Nối 146 — version + rollback | ❌ Agent hiện tại có RAG — thường *không cần* edit |

## Khác các hướng gần

| | 201 Fine-tune | 187 RAG-override | QQQQQQQQ: K-edit |
|---|---|---|---|
| Mục | Học lại model | Override lúc chạy | **Sửa fact trong trọng số** |
| Đối tượng | Toàn bộ | Context | **Một vài association** |
| Quan hệ | Nặng nhất | An toàn nhất | **Tinh tế nhất — rủi ro cao** |

## Khi nào chọn

- Model *trực tiếp* phải biết fact mới nhưng không thể RAG (không có context)
- Sửa số ít fact (vài chục) — không đổi mô hình liên tục
- Có eval kỹ — biết harms (2401.07453) và chấp nhận rủi
- Không khi: agent dùng RAG/context-override — override là đủ, rẻ, an toàn hơn