# Hướng GY: Speculative Decoding — dùng draft model đề xuất vài token, target model kiểm tra song song

> **Nguồn gốc:** NVIDIA "Introduction to Speculative Decoding" (draft-target — draft nhỏ đề xuất token, target lớn verify song song); arXiv 2402.01528 "Decoding Speculative Decoding" (speedup "heavily depends on the choice of the draft model" — khảo sát 350+ config); BentoML "3× Faster LLM Inference" (inference-time optimization — không hy sinh chất lượng); introl 2025 (draft đề xuất 5-8 token verify song song — tận dụng GPU tính song song); research.google "faster and cheaper inference without compromising quality"
> **Coupling:** 🟢 — thuần inference, không đụng logic agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (llm-proxy — chỉ routing; chưa có tầng decode)
> **Effort:** 2-4 tuần

## Nguồn gốc

Speculative decoding: **mỗi vòng, draft model (nhỏ, rẻ) sinh 5-8 token dự đoán; target model (lớn) verify tất cả song song — token đúng thì chấp nhận, sai thì lặp lại từ đó** — kết quả: 2-4× nhanh hơn mà output *chính xác như beam* (không mất chất — Google). arXiv 2402.01528: lợi ích phụ thuộc *chọn draft model* (tương đồng phân phối + đủ nhỏ). Khác **90 prompt-caching** (Prompt Caching — reuse context đã tính) — 207 dự đoán còn lại; **prompt-compression** (tối ưu context token), **178 dynamic model routing** (chọn model). Đặc biệt giá trị khi: (a) generation dài (code, analysis) sinh từng token — nơi latency tạo; (b) self-host hoặc provider offer (hơi chạy draft local — đầu ra vững). Kết nối **178 routing** (draft vs target model nào đi đâu), **205 self-consistency** (sampling nhiều — không mâu thuẫn, chỉ latency).

## Kiến trúc

```
  TOKEN STREAM REQUEST (agent sinh — tool call token, CoT dài)
        │
        ▼
  DRAFT MODEL (nhỏ — sinh 5-8 token nối tiếp — GPU rẻ)
        │
        ▼
  TARGET MODEL (lớn)  VERIFY SONG SONG (1 forward cho cả dãy — NVIDIA)
        │   ├── accept token đúng theo đúng distribution → output
        │   └── reject token đầu sai → lặp từ đó (không "gò")
        ▼
  OUTPUT n token trong 1 forward (2-3× tốc độ)
   - thích hợp: sinh dài, streaming, TTFT đã qua (đã cache)
```

```
mya: llm-proxy chỉ llm call — chưa có draft-target pair
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 05 llm-proxy — sẵn tầng nơi có thể bọc draft-target
// ✅ 84 llm-as-judge — sẵn (không liên trực tiếp)
// ✅ 178 routing — sẵn chọn (draft nhỏ, target lớn) theo model registry

// ❌ THIẾU: draft model cheap (7B/1B) deploy bên cạnh target
// ❌ THIẾU: verify forward (accept theo từng token)
// ❌ THIẾU: thống kê acceptance rate — tune draft khi thấp (arXiv)
```

## Implementation

```typescript
// packages/spec/src/spec.ts (NEW)
export class SpecDecode {
  constructor(draft: FastLM, target: BigLM) {}
  async generate(stream: TokenReq): AsyncIterable<Token> {
    for await (const step of targetLoop) {
      const guesses = await this.draft.propose(step.ctx, guessLen); // 5-8 token
      const probs = await this.target.verify(step.ctx, guesses);    // 1 forward song song
      const accepted = greedyAccept(probs, guesses);
      if (this.miss(accepted)) scoreAcceptRate(accepted);
      yield accepted;   // đo 2402: draft tốt → accept cao
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 2-4x speed, tool/code sinh nhiều token — latency hạ | ❌ Phụ thuộc draft model hợp — nếu lệch thì lợi ít (arXiv) |
| ✅ Không đổi kết quả (bảo toàn quality — khác noise sampling) | ❌ Chỉ phát huy khi decode là bottleneck; TTFT không tăng ai |
| ✅ Rẻ hơn — target ít forward hơn | ❌ Thêm vận hành (draft + target phải cặp); GPU bận 2 phần |
| ✅ Rất agent-agnostic — cắm vào proxy 05 | ❌ Complexity phía infra — trả trước mới nên |

## Khác các hướng gần

| | 109 Cache | 81 Test-time | ZZZZZZZZ: Speculative |
|---|---|---|---|
| Mục | Reuse context | Dùng thêm compute | **Tăng token/s — draft verify** |
| Vị trí | KV cache | Sampling thêm bước | **Trước khi sinh — draft song song** |
| Quan hệ | Nền | Nền | **Thêm vào dòng decode — latency** |

## Khi nào chọn

- Agent sinh dài (code, analysis) mà generation latency đắt
- Self-host hoặc endpoint hỗ trợ (vLLM/TGIS — expose), GPU đủ
- Đã có llm-proxy / llm-gateway (70) — sne vào tầng này
- Không khí: quality nghiêm (target chính) no loss; chọn draft-model theo 2402