# Hướng DDDDDDDD: Model Quantization & Local Deployment — nén model để tự host/edge: GGUF, INT4/INT8, AWQ

> **Nguồn gốc:** Meta Intelligence "7B LLMs in 4 Bits — INT8, GPTQ, AWQ & GGUF [2026]" ("GGUF hỗ trợ 1.5-bit → 8-bit, dùng trên edge"); arXiv 2601.14277 "Which Quantization Should I Use? A Unified Evaluation" (llama.cpp toolchain dùng post-training quantization — PTQ — lưu GGUF/GGML); vRlat "INT4/INT8/FP8/AWQ/GPTQ in 2026" (GGUF: Q2_K → Q8_0, CPU+GPU hybrid); branch8 (4-bit AWQ/GPTQ/GGUF giảm 60-80% chi phí inference); ggml llama.cpp discussions (blind test giữa quants)
> **Coupling:** 🟢 — độc lập hoàn toàn (chỉ thay runtime model)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (model-registry + routing — chưa có loki runtime)
> **Effort:** 2-4 tuần

## Nguồn gốc

Quantization: **giảm số bit lưu trọng số (FP16 → INT8/INT4/NF4/GGUF Q4_K_M…) để model fit bộ nhớ/hạ cost — giữ ít nhất chất — llama.cpp/Ollama CPU+GPU, vLLM quant** — arXiv 2601.14277: đánh giá unified — llama.cpp toolchaim "targets efficient local inference by PTQ, stored in GGUF"; branch8: 4-bit giảm 60-80% inference cost; Meta: GGUF 1.5→8 bit, edge; GPTQ/AWQ — post-training (khác): AWQ tốt GPU production, GPTQ chung; GGUF → local/CPU, Ollama. Điểm khác **207 speculative-decoding** (tăng throughput không giảm chất) vs DDD *giảm chất ~ chút* nhưng giảm memory + chi phí; **148 model distillation** (thay model lớn bằng model nhỏ huấn luyện lại) — quantization *giữ nguyên model, chỉ nén trọng số*. Kết nối: **146 model-registry** (đăng ký model quant riêng — cùng đường logic), **05 llm-proxy** (thêm runtime quantized như endpoint), **178 routing** (route task nhỏ → model quant rẻ), **207 spec-dec** (kết hợp: draft nhỏ quant + target).

## Kiến trúc

```
  MODEL FULL (FP16/BF16 — 70B~140GB)
        │
        ▼
  QUANTIZE (PTQ — INT8/INT4/FP8; phương pháp: GPTQ / AWQ / GGUF loader)
     · loại: bits (2-8) · technique (AWQ — activation-aware — tốt cho production)
        │
        ▼
  FILE (GGUF — local CPU+GPU hybrid; Safetensors INT4 → na GPU)
        │
        ▼
  RUNTIME (llama.cpp/Ollama/vLLM — dạng server)
        │
  OBSERVE fail băng giá? bench recall/chất (190 eval) phải ngưỡng
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 146 model-registry — sẵn chỗ đăng ký variant quant
// ✅ 178 routing — sẵn route task nhỏ về model rẻ
// ✅ 192 token-economics — sẵn theo dõi giá
// ✅ 05 llm-proxy — sẵn switch runtime

// ❌ THIẾU: quant job (PTQ chạy 1 lần / pull GGUF)
// ❌ THIẾU: local runtime (llama.cpp/vLLM) bên cạnh provider
// ❌ THIẾU: eval gate — so chất full vs quant (trước khi release route)
```

## Implementation

```typescript
// packages/quanthost/src/quant.ts (NEW)
export async function deployQuant(base: ModelRef, method: "awq"|"gptq"|"g4k"): Promise<ModelRef> {
  const q = method === "g4k" ? await g4k.convert(base) : await ptq.call(base, method);
  await evalKeep({ base, q, gate: 0.95 });          // 41 eval — không dưới 95%
  return registry.register(q, { kind: "quant", parent: base });  // 146
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm 60–80% cost inference (bit-lower) | ❌ Chất lượng giảm 1-10% (task khó hỏng) |
| ✅ Fit edge/self-host (local/CPU — GGUF) — riêng tư | ❌ Bit thấp → hallucination tăng lên (mẫu token biến) |
| ✅ Tách runtime — chỉ swap không đụng logic | ❌ Vận hành: nhiều variant file/giá per bit |
| ✅ Kết 146/178/192 — model rẻ cho task đơn giản | ❌ Thêm phức — input lạ phải chọn đúng bit |

## Khác các hướng gần

| | 148 Distill | 207 Spec-Decode | DDDDDDDD: Quant |
|---|---|---|---|
| Mục | Học lại model nhỏ | Verify nhanh thêm | **Nén trọng số — nhưng giữ độ rộng** |
| Đền đổi | Chất / mất domain | Thêm thời gian | **Chất nhẹ mất / rẻ + fit local** |
| Quan hệ | Khác model | Tầng | **Tương tự 207 — cùng dòng latency** |

## Khi nào chọn

- Tự host/edge chạy model — phải fit RAM/VRAM hoặc cost cao (branch 80%$)
- Task không cần chất cao nhất (classify, extract, form) — chia route model quant
- Đã có registry/routing để quản variant + gating (146/178)
- Không dùng khi: chất lượng tối thượng bắt buộc và nhiều $ — giữ FP16/API full-precision