# Hướng RRRRRR: Data Flywheel — dữ liệu production quay lại cải thiện agent liên tục

> **Nguồn gốc:** arXiv 2510.06674 "A Data Flywheel for Continuous Improvement in LLM Agents" (Agent-in-the-Loop, EMNLP 2025 Industry); NVIDIA Data Flywheel Blueprint (distillation/fine-tuning loop); Freeplay "Agent Data Flywheel"; Augment "Agent Learning Flywheel" (execute→coach→distill→improve)
> **Coupling:** 🟢 — thêm vòng hồi tiếp, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval PP + audit VV + replay SSSS sẵn; thiếu curation loop)
> **Effort:** 2-3 tuần

## Nguồn gốc

Data flywheel: **dữ liệu từ agent chạy production liên tục quay lại cải thiện agent** — arXiv 2510.06674: "AITL framework implements a continuous data flywheel for iteratively improving LLM-based customer service"; NVIDIA: "self-improving loop where data from AI interactions is continuously used to refine models" (Blueprint: distillation → fine-tuning → deployment); Freeplay: "production data flows back into your development process, prompts and agents get better"; Augment: "4-stage loop — execute, coach, distill, improve — compound gains across sessions". Điểm khác **XXXX eval** (đánh giá định kỳ) và **AAAAA self-improve** (agent tự sửa theo feedback) — RRRRRR *vòng dữ liệu có hệ thống*: production log → lọc/curate (trajectory tốt + lỗi) → sinh ground truth → eval set mới (PP) → cải thiện prompt/skill/model (FFFF version) → deploy → chạy lại. Không random — có curation (data chất lượng mới cải thiện được). Nối PP (eval — nơi nhận dữ liệu mới), SSSS (replay — nguồn trajectory), VV (audit — nhật ký production), BBBBBB (chọn cải thiện theo error cluster — OOOO), FFFFFF (deploy bản mới).

## Mô tả

mya flywheel: (1) **thu thập** — mọi trajectory production (SSSS/QQQQ): turn, tool call, kết quả, thành công/lỗi (VV); (2) **curate** — chọn lọc: trajectory thành công có giá trị + lỗi điển hình (OOOO error cluster); loại bỏ nhiễu (user quit giữa chừng, task trùng); (3) **ground truth** — chuyển thành eval case: input → output kỳ vọng (từ thành công thực hoặc PP judge); (4) **train/dev loop** — eval set mới + old = golden suite; chạy PP → tìm hồi quy; prompt/skill mới sửa lỗi (FFFF + ZZZZZ shadow); (5) **deploy** — bản cải thiện qua gate → production (FFFFF + canary); (6) **lặp** — production mới lại sinh dữ liệu — vòng xoay liên tục; theo dõi chất lượng tăng (YYYY — success rate theo thời gian).

## Kiến trúc

```
  PRODUCTION (SSSS trajectory + VV audit) ──► THU THẬP
        │
        ▼
  CURATE: trajectory tốt + lỗi điển hình (OOOO cluster) · bỏ nhiễu
        │
        ▼
  GROUND TRUTH: → eval case (input → output kỳ vọng — PP)
        │
        ▼
  IMPROVE: prompt/skill mới sửa lỗi (FFFF + ZZZZZ shadow) · distill (NVIDIA)
        │
        ▼
  DEPLOY qua gate (FF canary) ──► production mới ──► vòng lại
        │
        ▼
  TRACK: success rate theo thời gian (YYYY) — vòng xoay có cải thiện không
```

```
mya: PP + SSSS + VV SẸN — thiếu: curation + ground-truth loop + improve scheduler
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PP eval — golden suite (nhận eval case mới)
// ✅ SSSS replay — trajectory production (nguồn dữ liệu)
// ✅ VV audit — nhật ký production (lỗi/ thành công)
// ✅ OOOO error analysis — cluster lỗi (curate có chọn lọc)
// ✅ FFFFFF versioning + ZZZZZ shadow — cải thiện có gate

// ❌ THIẾU: curation pipeline (lọc + ground truth)
// ❌ THIẾU: improve scheduler (định kỳ chạy vòng)
// ❌ THIẾU: success-rate tracking (YYYY metric mới)
```

## Implementation

```typescript
// packages/flywheel/src/loop.ts (NEW)
export class Flywheel {
  async iterate(): Promise<Improvement> {
    const raw = await collect(this.lastRun);          // SSSS + VV
    const curated = this.curate(raw);                 // bỏ nhiễu + cluster lỗi (OOOO)
    const cases = await this.groundTruth(curated);    // → eval case (PP judge)
    const fix = await this.improve(cases);            // prompt/skill mới (FFFF)
    await this.deploy(fix);                           // gate + canary + shadow ZZZZZ
    return fix;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent ngày càng tốt trên task thật (không eval ảo) | ❌ Curation cần công sức — dữ liệu nhiễu phải lọc |
| ✅ Ground truth từ production — sát thực tế | ❐ Vòng lặp tự động có thể đi hướng sai (cần track YYYY) |
| ✅ Lỗi thật thành eval case — chống tái phạm | ❌ Distill/fine-tune tốn (NVIDIA Blueprint nặng) |
| ✅ Xây trên PP + SSSS + VV | ❌ Dữ liệu nhạy cảm khi đưa ra ngoài (IIIIII/KKKK) |

## Khác các hướng gần

| | SSSS Replay | XXXX Eval | RRRRRR: Flywheel |
|---|---|---|---|
| Mục đích | Chạy lại | Đo định kỳ | **Cải thiện liên tục từ production** |
| Vòng | 1 lần | Định kỳ | **Khép kín: production → eval → improve → deploy** |
| Cần thêm | — | — | **Curation + ground truth + scheduler** |

## Khi nào chọn

- Agent chạy production thực — muốn tự cải thiện theo dữ liệu thật
- Lỗi production lặp lại — đưa vào vòng xoay để hết lặp
- Đã có PP + SSSS + VV + OOOO — thêm curation + loop scheduler
- Muốn "đà" cải thiện dài hạn (compound gains — Augment)