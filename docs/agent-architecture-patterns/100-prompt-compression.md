# Hướng CV: Prompt Compression — nén token trước khi gọi LLM

> **Nguồn gốc:** microsoft/LLMLingua & LLMLingua-2 (arXiv 2407.08892); machinelearningmastery 2026
> **Coupling:** 🟡 — chèn trước LLM call, cần giữ chất lượng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (ai sẵn; thiếu compressor)
> **Effort:** 1-2 tuần

## Nguồn gốc

Prompt compression: **giảm token prompt mà giữ chất lượng output** — microsoft **LLMLingua**: dùng model nhỏ (GPT2-small/LLaMA-7B) "coarse-to-fine" — prun examples trước, prun tokens sau; **giảm tới 20x** token, giảm latency, đôi khi tăng performance (prompthub); **LLMLingua-2**: BERT-level encoder trained "via data distillation from GPT-4 for token classification" — nhỏ, nhanh (llmlingua.com). arXiv 2407.08892: characterize phương pháp compression cho long-context. machinelearningmastery 2026: "Implementing Prompt Compression to Reduce Agentic Loop Costs" — chiến lược: instruction distillation, recursive summarization, retrieval, token pruning. Khác **VVVV progressive disclosure** (nạp ÍT content hơn từ đầu) — WWWW *nén content đã có* khi bắt buộc giữ; khác **MMMM cache** (prefix ổn định, không đổi output) — WWWW làm *output có thể đổi nhẹ* (rủi ro chất lượng — cần đánh đổi).

## Mô tả

mya compressor (trước LLM call — packages/ai): (1) **tiered** — áp dụng khi context vượt ngưỡng (không nén prompt ngắn — an toàn); (2) **phương pháp theo loại content**: instructions → distill giữ ý (in-context example); history → recursive summary (CC kéo dài); docs → retrieval (GGG) + prune tokens (LLMLingua-2 encoder); (3) **rate** — compress ratio theo độ quan trọng (task-critical section giữ nguyên — nối XXXX/VVVV); (4) **đo** — token saved (SS/JJJ) + chất lượng (GGGG eval cho hồi quy — SSSS gate) — chống compression làm vỡ task. Nối: WWWW bù cho MMMM khi prefix vẫn dài; phối VVVV (disclosure giảm nạp) + WWWW (nén phần giữ).

## Kiến trúc

```
  CONTEXT TRƯỚC CALL
    ├─ < ngưỡng? ──► gọi thẳng (an toàn, không nén)
    └─ ≥ ngưỡng ──► COMPRESSOR
        ├─ instructions → distill (giữ ý — example)
        ├─ history      → recursive summary (CC)
        ├─ docs         → retrieval (GGG) + token prune (LLMLingua-2)
        └─ task-critical→ GIỮ NGUYÊN (nối XXXX đánh dấu)
             │
             ▼
        LLM call (token giảm, latency giảm)
        │
  đo: token saved (SS) · chất lượng (GGGG eval — SSSS gate)
  cảnh báo: compress quá → vỡ — ratio theo độ quan trọng
```

```
mya: packages/ai SẴN (LLM client) — thiếu compressor + policy ratio
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — LLM client (nơi chèn compressor)
// ✅ CC context saver — recursive summary (nền history compress)
// ✅ GGG retrieval — docs RAG (giảm token từ nguồn)
// ✅ GGGG eval + SSSS CI — đo chất lượng sau compress (gate)
// ✅ SS budget — theo dõi token giảm

// ❌ THIẾU: compressor (LLMLingua-style hoặc distill)
// ❌ THIẾU: policy ratio theo phần (task-critical giữ nguyên)
// ❌ THIẾU: metric quality-vs-compression (SSSS gate)
```

## Implementation

```typescript
// packages/ai/src/compress.ts (NEW)
interface CompressPolicy { threshold: number; ratios: SectionRatio[]; }

function compress(ctx: AgentContext, pol: CompressPolicy): Prompt {
  if (ctx.tokens < pol.threshold) return ctx.raw;      // ngắn: không nén
  return {
    instructions: distill(ctx.instructions),           // giữ ý
    history: summarizeRecursive(ctx.history),          // CC-style
    docs: retrieveTopK(ctx.docs),                      // GGG
    critical: ctx.taskCritical,                        // XXXX: giữ nguyên
  };
  // LLMLingua-2: BERT encoder token classification — nén fines
}

function measure(result: EvalRun): { tokensSaved: number; qScore: number } {
  return { tokensSaved, qScore: result.score };        // GGGG + SS
}
// SSSS gate: qScore đủ → chấp nhận ratio; crash below → thụt lại
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm tới 20x token (LLMLingua) | ❌ Output có thể đổi nhẹ (risk) |
| ✅ Giảm latency — agent nhanh hơn | ❐ Phải đo quality (GGGG + SSSS gate) |
| ✅ Phối MMMM (prefix vẫn cache) + VVVV (nạp ít) | ❌ Chi phí compressor (model nhỏ — PPPP local) |
| ✅ History/dirs dài xử lý được (CC + RAG nền) | ❌ Compress task-critical → vỡ task | 

## Khác các hướng gần

| | VVVV Disclosure | CC Context Saver | WWWW: Compression |
|---|---|---|---|
| Cách giảm token | Nạp ít hơn | Tóm lịch sử | **Nén content hiện có** |
| Rủi ro chất lượng | Thấp | Trung bình | **Cao (output đổi)** |
| Mối quan hệ | Combo | Nền cho history | **Xử lý phần phải giữ** |

## Khi nào chọn

- Agent loop dài, context phình (token cao)
- Đã có CC history + GGG docs — thêm compressor
- Chấp nhận đo quality liên tục (SSSS gate)
- Chạy model nhỏ local (PPPP) cho compress — rẻ