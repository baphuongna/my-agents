# Hướng PPPP: Hybrid Local-Cloud LLM Routing — chạy model rẻ local, cloud khi cần

> **Nguồn gốc:** "Hybrid Cloud-Local LLM: Complete Architecture Guide" (sitepoint 2026); promptquorum/mindstudio 2026
> **Coupling:** 🟢 — tầng router, đổi model không đổi agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (model-routing sẵn cloud; thiếu nhánh local)
> **Effort:** 2 tuần

## Nguồn gốc

Hybrid local-cloud: **router chọn chạy model local (Ollama/Llama/DeepSeek V4/Qwen) hay cloud (frontier)** cho từng request. promptquorum 2026: cloud 100-300ms nhưng $20/1M tokens; local 2-5s nhưng $0 — **break-even 50M tokens/tháng**; mindstudio 2026: open-weight models chậm hơn frontier 3-6 tháng. Sitepoint 2026 guide: LiteLLM unified gateway + Ollama local + policy routing. Với agent: local tốt cho — (1) **privacy** (prompt không rời máy — nối TEE), (2) **offline** (không mạng vẫn chạy), (3) **routine lặp** (rewrite, trích xuất, classify — MMMM/OOOO khuếch đại); cloud tốt cho — planning khó, tool use phức tạp, reasoning dài. Khác **DD/52 routing** (chọn *cloud model* theo cost/latency) — thêm chiều *local/offline/privacy*; khác **SSS cascade** (đơn giản-trước, escalate khó) — có thể phối hợp: local trước, cloud khi local fail/suýt.

## Mô tả

mya router (52) thêm nhánh **local tier**: cấu hình model local (Ollama) + policy: (1) privacy tasks (nội dung nhạy — nối KKK/TEE) → local bắt buộc; (2) offline mode (không mạng) → local fallback toàn bộ; (3) routine/low-value (extract, summarize ngắn, classify, generate skill) → local trước, cloud escalate khi chất lượng thấp (nối GGGG judge/LM-check); (4) planning/reasoning → cloud. Metric: local hit rate, offline availability, cost so cloud (SS + JJJ). Break-even 50M tok/tháng (2026): mya local-heavy → local đúng chỗ tiết kiệm đáng kể. Nối SSS: cascade local→cloud theo confidence.

## Kiến trúc

```
  REQUEST ──► POLICY ROUTER (52 + local tier)
    ├─ privacy/offline ──► LOCAL (Ollama, $0)     [bắt buộc khi cần]
    ├─ routine (extract/summarize/classify) ──► LOCAL ──► quality check
    │        fail/low ──► CLOUD (escalate — SSS)
    └─ planning/reasoning/tool-phức ──► CLOUD (frontier)

  LITELLM-style gateway: 1 API, 2 backends (local/cloud)
  metric: local hit · offline availability · $ saved (JJJ+SS)
  privacy: local = prompt không rời máy (nối JJJJ TEE)
```

```
mya: model-routing SẴN (cloud tiers) — thiếu: backend local + policy local/cloud
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai/src/model-routing.ts — router tiers (thêm LocalTier)
// ✅ packages/ai/src/registry.ts + fallback.ts — nền mở rộng
// ✅ SSS cascade — escalate confidence (phối hợp local→cloud)
// ✅ gateway/provider-registry — thêm backend local (Ollama)
// ✅ JJJ + SS — metric cost/latency (so sánh local/cloud)

// ❌ THIẾU: backend local (Ollama/llama.cpp) trong registry
// ❌ THIẾU: policy local/cloud (privacy, offline, routine)
// ❌ THIẾU: quality gate khi local (escalate — GGGG/LM-check)
```

## Implementation

```typescript
// packages/ai/src/local-tier.ts (NEW)
type LocalPolicy = {
  forceLocal: RegExp[];      // privacy/offline tasks
  preferLocal: RegExp[];     // routine tasks — local trước
  threshold: number;         // escalate khi confidence thấp (SSS)
};

function routeLocalOrCloud(req: Request, cfg: LocalPolicy, net: NetState): Backend {
  if (offline(net)) return "local";                     // offline mode
  if (isPrivate(req, cfg.forceLocal)) return "local";   // privacy (KKK/TEE)
  if (isRoutine(req, cfg.preferLocal)) {
    return confidence(req) >= cfg.threshold ? "local" : "cloud"; // SSS
  }
  return "cloud";                                       // planning/reasoning
}

// quality gate: local output thấp → escalate cloud (GGGG check)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ $0 local — break-even 50M tok/tháng (2026) | ❌ Open-weight chậm hơn frontier 3-6 tháng |
| ✅ Privacy: prompt không rời máy (nối TEE) | ❌ Local 2-5s vs cloud 100-300ms (latency) |
| ✅ Offline: mất mạng vẫn chạy | ❐ Quality gate phải chuẩn (escalate đúng lúc) |
| ✅ Routine lặp rẻ tiền (phối MMMM/OOOO) | ❌ Hardware local cần đủ (RAM/GPU) |

## Khác các hướng gần

| | DD/52 Cloud Routing | SSS Model Cascade | PPPP: Local-Cloud |
|---|---|---|---|
| Chọn giữa | Các cloud models | Độ khó (escalate) | **Local vs cloud** |
| Tiêu chí | Cost/latency | Confidence | **Privacy/offline/cost** |
| Mối quan hệ | Nền tảng | Phối hợp (local→cloud) | **Chiều mới trong router** |

## Khi nào chọn

- Muốn giảm chi phí token lớn (mya chạy nhiều)
- Cần privacy/offline (dữ liệu nhạy, hay mất mạng)
- Máy đủ mạnh chạy local model
- Đã có router + fallback — thêm local tier là bước ngắn