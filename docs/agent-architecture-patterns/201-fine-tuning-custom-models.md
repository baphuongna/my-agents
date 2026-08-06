# Hướng TTTTTTTT: Fine-Tuning & Custom Models — huấn luyện thêm mô hình riêng theo domain

> **Nguồn gốc:** "Fine tuning LLMs for Enterprise: Practical Guidelines" (arXiv 2404.10779 — mô hình hiểu domain: "LLM trained for code generation must understand the domain with quality along with quantity"); Databricks "A Practical Guide to LLM Fine Tuning" (instruction fine-tuning — huấn luyện model theo cặp instruction-response); SuperAnnotate "Fine-tuning LLMs in 2026" (tiếp tục huấn luyện pre-trained model trên tập dữ liệu mục tiêu); Meta Intelligence "LLM Fine-Tuning Data Pipeline" (collection, cleaning, human annotation, SFT/RLHF); Snorkel "fine-tune LLMs for enterprise"
> **Coupling:** 🟢 — độc lập, thay model chuẩn
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (chỉ prompt/rag — không có pipeline huấn luyện)
> **Effort:** 4-8 tuần

## Nguồn gốc

Fine-tuning: **dạy lại model nền theo tập dữ liệu riêng để giỏi domain cụ thể — chứ không phải prompt hay RAG** — arXiv 2404.10779: enterprise fine-tune cần "data with quality along with quantity" — hiểu domain là chìa khóa cho code/domain-specific; Databricks: "instruction fine tuning adapts a pre-trained model to follow natural language instructions by training on instruction-response pairs"; SuperAnnotate: fine-tune = "continuing the training of a pre-trained LLM on a targeted dataset" — cải thiện performance trên task cụ thể; Meta Intelligence: pipeline sản xuất dataset cho SFT và RLHF — collection, cleaning, human annotation, đánh giá. Điểm khác **161 FFFFFFFFF agent-ide** (build tool — không đụng model), **146 model registry** (quản lý nhiều model — fine-tune *tạo* model mới đưa vào registry), **178 dynamic routing** (chọn model — fine-tune là *nguồn* model). So với prompt engineering: fine-tune thay đổi *trọng số* — hiệu quả hơn khi format/giọng văn/task ổn định lặp lại nhiều lần; RAG thêm *tri thức* — fine-tune thêm *kỹ năng/định dạng* (không nhồi kiến thức mới vào fine-tune — dễ đánh mất tri thức cũ, Hallucination vẫn xảy ra).

## Kiến trúc

```
  RAW DATA (docs, tickets, code, logs)
        │
        ▼
  DATA PIPELINE (Meta Intelligence — collection → cleaning → human annotation)
        │
        ▼
  TASK SELECTION (tune task nào — format? giọng? tool calling?)
        │
        ▼
  FINE-TUNE (arXiv 2404.10779 — quality + quantity)   ──►  RLHF (nếu cần)
        │
        ▼
  EVAL (so với base model — tập test riêng)
        │
        ▼
  REGISTRY (146) ──► ROUTER (178) ──► DEPLOY (canary — 129)
```

```
mya: KHÔNG có pipeline fine-tune — chỉ prompt/rag/multi-model
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 146 model registry — sẵn chỗ để đăng ký model mới
// ✅ 178 routing — sẵn chỗ để route đến model fine-tuned
// ✅ 129 shadow/canary — sẵn cách triển khai an toàn model mới
// ✅ 147 data flywheel — dữ liệu có sẵn làm đầu vào dataset

// ❌ THIẾU: dataset builder (chuyển flywheel data → cặp instruction-response)
// ❌ THIẾU: training job (spawn fine-tune qua API provider — OpenAI/Anthropic/vLLM)
// ❌ THIẾU: eval gate (so base vs tuned trên tập test — quyết định release)
```

## Implementation

```typescript
// packages/finetune/src/tune.ts (NEW)
export async function fineTune(cfg: TuneConfig): Promise<ModelRef> {
  const ds = await dataset.fromFlywheel(cfg.source, cfg.gen); // 147 → cặp IR
  await ds.clean();                       // Meta Intelligence — annotation chuẩn
  const job = await provider.launch(ds, cfg.base);   // vLLM/OpenAI adapter
  const tuned = await job.wait();
  const report = await evalGate(tuned, cfg.base, cfg.evalSet); // so sánh
  if (!report.pass) return rollback(cfg.base);         // không đạt → giữ base
  return registry.register(tuned);                    // 146 — sẵn sàng route
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task ổn định chạy nhanh/chuẩn hơn hẳn prompt | ❌ Chi phí GPU/huấn luyện + vòng lặp dài |
| ✅ Giảm latency + token (format đã nằm trong trọng số) | ❌ Dataset tốt khó kiếm — tốn annotation người |
| ✅ Tách domain riêng — model chuyên sâu không đụng chung | ❌ Nguy cơ mất tri thức gốc (catastrophic forgetting) |
| ✅ Xây trên 146/178/129/147 có sẵn | ❌ Vẫn hallucinate — fine-tune không thay RAG |

## Khác các hướng gần

| | 178 Routing | 147 Flywheel | TTTTTTTT: Fine-tune |
|---|---|---|---|
| Mục | Chọn model đúng lúc | Gom dữ liệu dùng lại | **Đào tạo model riêng theo domain** |
| Thay đổi | Quyết định gọi ai | Kho dữ liệu | **Trọng số model** |
| Quan hệ | Tiêu thụ | Cung cấp | **Nguồn model — mất nhiều công nhất** |

## Khi nào chọn

- Task format/giọng lặp lại ổn định nhiều lần — prompt không đủ
- Đã đầy đủ RAG + prompting mà vẫn thiếu chuẩn (arXiv: domain understanding)
- Có dataset tốt hoặc flywheel (147) có dữ liệu
- Mới bắt đầu: chỉ fine-tune task hẹp, giữ base cho phần còn lại
