# Hướng CF: LLM-as-Judge — LLM chấm LLM theo rubric

> **Nguồn gốc:** Zheng et al., 2023 (MT-Bench); zylos.ai 2026 "LLM-as-Judge Patterns for Agent Evaluation"; arXiv 2506.22316
> **Coupling:** 🟢 — judge ngoài runtime, qua eval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval sẵn; thiếu rubric + calibration)
> **Effort:** 1 tuần

## Nguồn gốc

LLM-as-Judge (Zheng 2023): dùng 1 LLM **chấm output LLM khác theo rubric** — relevancy, faithfulness, helpfulness, correctness. 2026 cho agents: zylos.ai "LLM-as-Judge Patterns for Agent Evaluation" — **rubric design, bias mitigation, trajectory scoring** (chấm cả quá trình, không chỉ kết quả); LangChain/Galileo: **calibration với human corrections** — đo correlation judge vs con người, hiệu chỉnh. Vấn đề nổi: **bias** — positional bias (arXiv 2506.22316: hiệu chỉnh vị trí), verbosity bias, self-preference. Khác **PP Eval Harness** (test deterministic — pass/fail, có đáp án) — LLM-as-judge cho **task mở không có test** (chất lượng câu trả lời, thiết kế, mức hữu ích); bổ trợ nhau: PP cho task đo được, judge cho task mở.

## Mô tả

mya dùng judge cho các task mở không có test tự động: đánh giá thiết kế (2 phương án — judge so sánh A/B), đánh giá chất lượng câu trả lời, **trajectory scoring** (chấm từng bước tool call — có đi vòng không, có cheat không). Yêu cầu bắt buộc: **rubric rõ** (không hỏi "có tốt không" — phân tiêu chí điểm), **calibration** (lấy N output con người chấm → đo correlation → hiệu chỉnh prompt judge hoặc bỏ bias), **mitigate bias** (đổi thứ tự A/B, ẩn model name — chống self-preference). Judge tier nhỏ (RR) để rẻ; dùng output cho TTT/ZZZ fitness. Cảnh báo: judge LLM có bias — không bao giờ là nguồn sự thật tuyệt đối; task đo được phải dùng PP.

## Kiến trúc

```
  output mở ──► JUDGE (tier nhỏ, RR)
                  │  rubric: tiêu chí + điểm per criterion (không "tốt/không")
                  │  anti-bias: đổi thứ tự · ẩn model · 2 lượt
                  ▼
                SCORE ──► dùng cho: TTT/ZZZ fitness · SS quyết định
                  │
  CALIBRATION (định kỳ, với con người)
                  │  N output: human score vs judge score → correlation
                  │  thấp ──► sửa rubric/prompt judge (không tin mù)
                  ▼
                judge đã hiệu chỉnh
```

```
mya: packages/eval (nơi gắn judge) + tier routing (model judge) sẵn
     thiếu: rubric store + calibration pipeline + bias mitigation
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — harness gắn judge vào scenario
// ✅ packages/ai/src/model-routing.ts — tier nhỏ làm judge (rẻ)
// ✅ packages/cron — calibration định kỳ
// ✅ PP eval — dùng cho task đo được (judge chỉ task mở)

// ❌ THIẾU: rubric store (tiêu chí điểm chuẩn, per task type)
// ❌ THIẾU: calibration (human scores → correlation → sửa judge)
// ❌ THIẾU: bias mitigation (đổi thứ tự, ẩn tên model)
```

## Implementation

```typescript
// packages/eval/src/judge.ts (NEW)
interface Rubric { criteria: Array<{ name: string; weight: number; scale: 1|5 }> }

async function judgeScore(output: string, task: Task, rubric: Rubric): Promise<Score> {
  const a = await judgeCall(output, rubric, orderA);        // lượt 1
  const b = await judgeCall(output, rubric, orderB);        // lượt 2 đổi thứ tự
  return average(debias(a, b));                             // positional mitigation
}

async function calibrate(judge: Judge, samples: HumanScored[]): Promise<Judge> {
  const corr = correlate(await judgeRun(samples), samples.humanScores);
  return corr < THRESHOLD ? adjustRubric(judge, samples) : judge;  // hiệu chỉnh
}
// QUY TẮC: task có test → PP; task mở → judge; không bao giờ judge đơn độc
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chấm được task mở không có test | ❌ Bias (positional/verbosity/self-pref) — phải mitigate |
| ✅ Trajectory scoring — chấm cả quá trình tool call | ❌ Cần calibration với con người (công) |
| ✅ Rẻ (tier nhỏ) + gắn vào eval sẵn | ❌ Judge thay đổi theo model — phải pin version |
| ✅ Dùng cho TTT/ZZZ fitness | ❌ Không bao giờ là ground truth (PP vẫn chính) |
| ✅ Nguồn 2026 mạnh (zylos.ai, arXiv 2506.22316) | |

## Khác các hướng gần

| | PP Eval Harness | JJ GAN Adversarial | GGGG: LLM-as-Judge |
|---|---|---|---|
| Task | Có test (đóng) | Phản biện thiết kế | **Mở, không test** |
| Đầu ra | Pass/fail | Phản hồi | **Điểm theo rubric** |
| Bias | Không | — | **Có — phải calibrate** |
| Mối quan hệ | Task đóng | Một dạng judge | Bổ sung cho task mở |

## Khi nào chọn

- Task mở không có test (thiết kế, trả lời, trajectory)
- Muốn fitness cho TTT/ZZZ trên task mở
- Sẵn sàng calibration định kỳ với con người
- Đã có eval + tier routing — thêm rubric + judge