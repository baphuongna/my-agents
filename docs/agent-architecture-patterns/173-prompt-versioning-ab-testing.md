# Hướng RRRRRRR: Prompt Versioning & A/B Testing — prompt như code: version, so sánh, regression

> **Nguồn gốc:** MLflow "Top 3 LLM Prompt Versioning Platforms 2026" (prompt registry + version); Confident AI (prompt như code — git-style branching, PRs); Maxim "How to Perform A/B Testing with Prompts" (version prompts, deployment variables, tag experiments); Galtea "Complete Guide for LLM Evaluations 2026" (controlled comparison — hold everything constant); Dynatrace (AI Model Versioning — metadata: model version, dataset ID, hyperparameters)
> **Coupling:** 🟢 — lớp quản lý prompt, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (FFFF versioning + PP eval sẵn; thiếu prompt registry + A/B)
> **Effort:** 1-2 tuần

## Nguồn gốc

Prompt versioning: **prompt được quản lý như code — version, A/B test, regression test, rollback** — Confident AI: "treats prompts like code — git-style branching and PRs"; Maxim: "version prompts, assign deployment variables, tag experiments"; Galtea: "test a fixed dataset against a specific model version or prompt — a controlled comparison where you hold everything constant except the prompt"; MLflow: platform prompt registry + tracking; Dynatrace: "track metadata such as model version, dataset ID, hyperparameters" (prompt + model + data là một bộ — đổi cái nào cũng cần theo dõi). Điểm khác **FFFF model versioning** (version model + prompt đi kèm nhưng chung) và **PP eval** (chạy test) — RRRRRRR *registry + thí nghiệm*: (1) prompt registry — mọi prompt có ID/version (MLflow + Confident git-style); (2) A/B — 2 phiên bản chạy trên dataset cố định (Galtea controlled) → so kết quả (PP metric), deployment variables (Maxim — canary %); (3) regression suite — khi đổi prompt: chạy suite cũ để chặn backsliding (Dave Davies: "regression tests compare new prompts or model versions to a baseline to prevent backsliding"); (4) meta tracking — prompt + model + dataset gắn cùng (Dynatrace — đổi model cũng cần test lại); (5) rollback — prompt xấu → về version cũ nhanh (Confident PR model); (6) tích hợp — agent dùng prompt theo version từ registry (runtime đọc cấu hình).

## Kiến trúc

```
  PROMPT REGISTRY (MLflow/Confident — prompt như code: branch + PR)
        │
        ▼
  A/B TEST (Maxim — deployment variables): v1 vs v2 trên dataset cố định
   · Galtea: hold everything constant — chỉ đổi prompt
   · so bằng PP metric (chất lượng/chi phí/tốc độ)
        │
        ├── v2 TỐT → deploy canary % (Maxim)
        ├── v2 XẤU → rollback v1 (Confident PR)
        └── đổi model? → test lại cùng suite (Dynatrace metadata)
        │
        ▼
  REGRESSION SUITE (Dave Davies): đổi prompt/version → chặn backsliding
```

```
mya: FFFF + PP SẴN — thiếu: prompt registry + A/B + regression
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ FFFFFF versioning — version các thành phần (nền)
// ✅ PP eval — đo chất lượng (nền A/B metric)
// ✅ 147 feedback — dữ liệu thực tế (regression source)
// ✅ WWWWWW intent — prompt per intent (đổi theo intent)
// ✅ AAAAAA arena — so agent (đã có tư duy A/B)

// ❌ THIẾU: prompt registry (ID + version + branch/PR)
// ❌ THIẾU: A/B runner (deployment variables — Maxim)
// ❌ THIẾU: regression suite per prompt (backsliding check)
```

## Implementation

```typescript
// packages/prompts/src/registry.ts (NEW)
export class PromptRegistry {
  register(p: Prompt): PromptRef { return { id: p.id, v: version(p) }; } // MLflow
  async abTest(refA: PromptRef, refB: PromptRef, ds: Dataset) {
    return compare(eval.run(refA, ds), eval.run(refB, ds)); // Galtea — giữ mọi thứ cố định, chỉ đổi prompt
  }
  async rollout(ref) {
    return canary(ref, 0.1); // Maxim deployment variables — 10% rồi 100%
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đổi prompt an toàn — regression chặn backsliding (Davies) | ❌ Dataset cố định phải đại diện — lệch thì A/B sai |
| ✅ So sánh khách quan — controlled comparison (Galtea) | ❐ Chạy A/B tốn cost/token (mỗi lần 2 phiên) |
| ✅ Rollback nhanh khi xấu (Confident git-style) | ❌ Prompt tốt trên eval có thể kém thực tế |
| ✅ Xây trên FFFF + PP + AAAAAA | ❌ Nhân bản registry — nhiều prompt nhiều version |

## Khác các hướng gần

| | FFFFFF Versioning | PP Eval | RRRRRRR: Prompt A/B |
|---|---|---|---|
| Phạm vi | Toàn thành phần | Đo chất lượng | **Registry + thí nghiệm prompt** |
| Cơ chế | Git-style | Test suite | **A/B controlled + canary** |
| Quan hệ | Nền lưu trữ | Công cụ đo | **Quy trình đổi prompt an toàn** |

## Khi nào chọn

- Prompt thay đổi thường xuyên — cần kiểm soát không phá chất lượng
- Muốn cải thiện prompt có bằng chứng (so trên dataset — Galtea)
- Production nghiêm túc — rollback/regression bắt buộc
- Đã có FFFF + PP + AAAAAA — thêm registry + A/B runner