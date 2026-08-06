# Hướng GB: RLHF/Preference Alignment — agent chỉnh theo sở thích người dùng qua phản hồi

> **Nguồn gốc:** HuggingFace "Illustrating RLHF" (align model với human values); arXiv 2504.03784 "Robust RLHF" (revolutionized fine-tuning — achieve human preference); AWS "RLAIF" (so sánh các task — comparable/superior với RLHF); Wikipedia — RLHF (align agent với human preferences); OpenUser (RLHF useful cho goals phức tạp/mơ hồ)
> **Coupling:** 🔴 — ảnh hưởng mô hình LLM nền (retrain/gate) — vượt ranh giới coupling hệ thống
> **Agent-agnostic:** ⚠️ — 1 model chung cho nhiều user; fine-tune riêng không đơn giản
> **Code sẵn:** ??? — Không — tương đối không phù hợp (config, tooling, M) — thường nằm ngoài lõi
> **Effort:** 3-6 tuần

## Nguồn gốc

RLHF: **tinh chỉnh model theo sở thích con người — thu phản hồi xếp hạng (preference), train reward model, tối ưu chính sách (PPO/DPO)** — HuggingFace: "RLHF enables language model to align ... to complex human values"; arXiv 2503.03773: "RLHF leverages human feedback to align model outputs to human preference"; Widify: "Alignment through RLHF ensures model behavior matches human intent"; Sully/Rissy: "phản hồi chọn — cho LLM biết output nào phù hợp". Điểm khác **147 data flywheel** (học từ dữ liệu người dùng ở lớp prompt/RAG) và **PPPPPPP curriculum** (tăng độ khó train) — CCCCCCCC *thay đổi chính model*: (1) feedback collection — user/agent chấm/so sánh output (thumbs/rank — A/B RRRRRRR); (2) preference dataset — tích lũy (so sánh nào tốt hơn); (3) reward model — mô hình chấm điểm output theo sở thích; (4) fine-tune — PPO/DPO tối ưu policy (Widely) — hay đổi model nền khi feedback đủ; (5) eval giữ — sau fine-tune chạy PP regression (173 — đảm bảo không regression); (6) per-user? — sở thích khác nhau → per-user khó (đây là điểm cẩn thận: nhân hóa per-user tốn). Nối 147 (source phản hồi), RRRRRRR (A/B — thu preference), PP (regression sau tune), WWWWWW (mục tiêu align), GGG (routing — model fine-tune riêng cho cluster task).

## Kiến trúc

```
  PHẢN HỒI USER (thumbs · xếp hạng · A/B 173)
        │
        ▼
  DATASET PREFERENCE (sort A>B theo sở thích)
        │
        ▼
  REWARD MODEL (chấm điểm output theo preference)
        │
        ▼
  FINE-TUNE (PPO/DPO — alignment theo human values — HF)
   · model mới riêng (GGG routing — cluster task riêng nếu cần)
        │
        ▼
  REGRESSION GAURD (PP benchmark — 173): không để xấu đi
```

```
mya: feedback RRRRRR + PP SẴN — thiếu: reward model + fine-tune pipeline
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 147 feedback — thu nhận phản hồi người (nguồn RLHF)
// ✅ RRRRRRR A/B — so xếp hạng + chọn output (preference)
// ✅ PP eval — benchmark baseline
// ✅ GGG routing — chọn model per cluster (đặt model finetune riêng)
// ✅ KKK cache — ít relevant
// ❌ THIẾU: reward model (mô hình chấm điểm)
// ❌ THIẾU: DPO/PPO fine-tune loop
// ❌ THIẾU: regression gate sau tune (PP + 173)
```

## Implementation

```typescript
// packages/finetune/src/rlhf.ts (NEW)
export class Finetuner {
  async collect(job: Job): Promise<Prefs> { return feedback.stats(job); }
  async tune(base: Model, prefs: Prefs): Promise<Model> {
    const rm = rewardModel(prefs);            // reward model
    return dpo(base, rm.dataset);            // alignment (HF)
  }
  async deploy(m: Model, cluster) {
    regression = pp.eval(cluster.bench, m);  // PP — không hụt baseline
    return regression.ok ? router.register(cluster, m) : rollback(m);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sở thích người khớp — output agent "nhìn đúng" theo từng cluster | ❌ Cost/thiết bị train cực cao (GPU, data) |
| ✅ Cải thiện chất lượng thực (reward ↑) | ❐ Fine-tune không tự động — cần ML pipeline nghiêm |
| ✅ Nguồn: 147 feedback + RRRRRRR A/B | ❌ Dễ regression quality chung (cần PP gate) |
| ✅ Xây được trong mya (127 + RRRRRRR + PP) | ❌ Per-user đơn lầng — xung đột sở thích nhóm |

## Khác các hướng gần

| | 147 Flywheel | 153 Curriculum | CCCCCCCC: RLHF |
|---|---|---|---|
| Đối tượng | Prompt/RAG/agent | Độ khó task | **Model tham số (alignment)** |
| Cách | Lặp dữ liệu | Scheduling | **PPO/DPO cần GPU** |
| Kết quả | Tool/agent tốt hơn | Agent khôn hơn | **Model chuẩn sở thích** |

## Khi nào chọn

- Đã đủ dữ liệu preference (thumbs/chấm — tích qua 147) — muốn thay model
- Ngán nguyên nhân — chi phí dữ liệu tôi chấp nhận được
- Cluster task rõ — ROI fine-tuning riêng cao (code gen, dịch, review)
- Giữ được baseline PP — regression gate trước khi đổi model
- KHÔNG chọn khi: 1 model chung mọi user — sở thích trái ngược; hạ tầng GPU không có