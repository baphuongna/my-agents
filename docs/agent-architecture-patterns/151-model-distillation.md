# Hướng VVVVVV: Model Distillation — model lớn dạy model nhỏ, agent rẻ hơn/offline được

> **Nguồn gốc:** Google "Distilling step-by-step" (outperform larger LLM, less data, smaller model); IBM Knowledge Distillation (teacher → student); arXiv 2312.15842 "KD of LLM for Education"; DistillLabs "LLM to Deployable SLM" tutorial
> **Coupling:** 🟢 — model layer, runtime không đổi (đổi model nền)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (data flywheel + eval PP + model registry sẵn; thiếu training pipeline)
> **Effort:** 2-4 tuần

## Nguồn gốc

Model distillation: **teacher model lớn truyền kiến thức cho student nhỏ — soft labels, step-by-step** — Google: "distilling step-by-step allows training smaller task-specific models with much less training data and smaller model sizes" — student học *các bước suy luận* (rationale) chứ không chỉ đáp án; IBM: "transfer the learning of a large pre-trained 'teacher model' to a smaller 'student model'"; DistillLabs: "full pipeline from teacher to deployable SLM" — Gemma 3, LLaMA 4 Scout là sản phẩm của KD. Điểm khác **HHHHHH edge** (dùng model nhỏ có sẵn) — VVVVVV *tự sinh model nhỏ cho task riêng*: dùng trajectory/đáp án của model lớn (từ RRRRRR flywheel — dữ liệu production có ground truth) → train student nhỏ (task-specific, ít tham số) → chạy task đó bằng model nhỏ (rẻ/offline/nhanh — 25-50x). Nối RRRRRR (nguồn dữ liệu teacher), PP (eval student vs teacher — độ suy giảm), FFFFFF (version model — ship student), PPPPPP (registry — 2 model song song), XXXXX (cost — so rẻ hơn bao nhiêu), HHHHHH (edge — student chạy local).

## Mô tả

mya distillation: (1) **chọn task sinh lợi** — task lặp lại nhiều, chi phí cao (agent làm hoài — RRRRRR thống kê) → đáng distill; (2) **thu dữ liệu teacher** — production trajectory (thành công + rationale — step-by-step Google) từ model lớn — có sẵn từ RRRRRR curation; (3) **train student** — distill step-by-step: student học rationale (không chỉ output) — ít data hơn; task-specific nhỏ (không phải SLM tổng quát); (4) **eval gate** — PP: student vs teacher trên eval set — chất lượng chấp nhận (tỷ lệ suy giảm cho phép) mới ship; (5) **route** — task đã distill → model nhỏ (rẻ); task mới/khó → model lớn (HHH cascade + PPPPPP registry); (6) **vòng đời** — teacher tốt hơn → distill lại (RRRRRR vòng) — student theo version (FFFF).

## Kiến trúc

```
  RRRRRR FLYWHEEL: production trajectory (teacher = model lớn — rationale)
        │
        ▼
  CHỌN TASK: lặp nhiều + tốn → đáng distill
        │
        ▼
  TRAIN STUDENT (distill step-by-step — Google): học rationale, ít data
        │
        ▼
  EVAL GATE (PP): student vs teacher — suy giảm chấp nhận → ship
        │
        ▼
  ROUTE (HHH + PPPPPP): task đã distill → student (rẻ/offline); khó → teacher
        │
        ▼
  VÒNG ĐỜI: teacher mới tốt hơn → distill lại (RRRRRR) — version (FFFF)
```

```
mya: RRRRRR + PP + PPPPPP SẸN — thiếu: training pipeline + eval gate + routing
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ RRRRRR flywheel — dữ liệu production có ground truth (teacher data)
// ✅ PP eval — đánh giá student vs teacher (gate)
// ✅ PPPPPP model registry — 2 model song song (student/teacher)
// ✅ HHH cascade — route theo độ khó (thêm: task distill → student)
// ✅ FFFFFF versioning — student theo version
// ✅ XXXXX — đo cost tiết kiệm

// ❌ THIẾU: training pipeline (distill step-by-step)
// ❌ THIẾU: eval gate cụ thể (student vs teacher threshold)
// ❌ THIẾU: routing theo "task đã distill"
```

## Implementation

```typescript
// packages/distill/src/pipeline.ts (NEW)
export class Distill {
  async distill(task: TaskKind, teacher: Model) {
    const data = flywheel.trajectories(task);   // RRRRRR — teacher rationale
    const student = await train(data, {         // step-by-step (Google 2023)
      learnRationale: true, size: "small",
    });
    const drop = await evalStudent(student, teacher); // PP — suy giảm %
    if (drop > threshold) return null;                 // gate — chưa đủ tốt
    registry.add(student, { for: task });              // PPPPPP — ship
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task quen thuộc chạy model nhỏ — rẻ/nhanh/offline | ❌ Cần dữ liệu teacher đủ tốt (RRRRRR bắt buộc) |
| ✅ Step-by-step distill — ít data mà vẫn tốt (Google) | ❐ Tốn công train + eval pipeline |
| ✅ Chất lượng kiểm soát (eval gate student vs teacher) | ❌ Student chỉ giỏi task đã distill — không tổng quát |
| ✅ Xây trên flywheel + PP + registry | ❌ Task mới/dữ liệu ít — distill vô nghĩa |

## Khác các hướng gần

| | HHHHHH Edge | VVVVVV: Distill | NNNNNN Carbon |
|---|---|---|---|
| Cách rẻ | Dùng model nhỏ sẵn | **Tự sinh model nhỏ** | Chọn chỗ xanh |
| Cần thêm | Runtime local | **Training pipeline** | Carbon signal |
| Kết quả | Chạy local | **Task-specific student** | Giảm CO₂ |

## Khi nào chọn

- Task lặp lại nhiều + tốn token — distill model riêng cho task đó
- Muốn chạy local/offline (HHHHHH) với model đủ tốt
- Đã có RRRRRR + PP + PPPPPP — thêm training + gate + routing
- Dữ liệu teacher đã đủ (production log có ground truth)