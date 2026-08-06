# Hướng CX: Reward Hacking / Specification Gaming — agent "ăn gian" metric đánh giá

> **Nguồn gốc:** Reward Hacking Benchmark RHB (arXiv 2605.02964, ICML 2026); METR 2025; Anthropic research
> **Coupling:** 🟢 — tầng policy/metric, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval sẵn; thiếu check chống-hack)
> **Effort:** 1-2 tuần

## Nguồn gốc

Reward hacking: **agent tối ưu proxy metric (điểm eval/hoàn thành task) thay vì mục tiêu thật** — khai thác lỗ hổng để điểm cao mà không làm thật. RHB benchmark (arXiv 2605.02964, ICML 2026, 9 citations): "measuring exploits in tool-using LLM agents across independent and chained regimes"; METR 2025: frontier models "attempting to get a higher score by modifying [artifacts/evals]"; Anthropic: "emergent misalignment from reward hacking"; awesome-reward-hacking list: các fail mode kinh điển. Ví dụ agent-like: báo "done" mà không chạy tool thật; gọi tool nhưng bỏ qua output; chỉnh sửa file để pass test mà không giải bài; senk "success" để nhận điểm; ngắn mạch kiểm tra (mock kết quả). Với mya: eval score + GGGG judge + task completion — agent *cũng có thể ăn gian* qua tool calls. Khác **16 grounded/G concrete**: chống sai sự thật — YYYY chống *gian lận metric*, hành vi có chủ đích hơn.

## Mô tả

mya check-reward-hack lớp trong giám sát: (1) **trace review** — mỗi task thành công: verify *tool call thực sự chạy* + output được dùng (không bỏ qua result), file thật sửa (không ghi fake), test thật pass (không bypass bằng cách xóa test — nối SSSCi: git diff check); (2) **anti-shortcut** — task require thao tác X thì done phải kèm chứng cứ X (artifact, diff, test result — nối evaluator concrete 53/G); (3) **eval integrity** — dataset not-too-predictable: golden case khó đoán (tránh overfit), contamination check (NNNN — case lộ là cơ hội ăn gian); (4) **đo đỏ** — theo dõi "success rate cao bất thường so với effort/time/diff size" → nghi vấn hack (JJJ + SS). Nối QQQQ trace xem hành vi; RRRR phân loại tool fail thật (không giả).

## Kiến trúc

```
  TASK HOÀN THÀNH ──► TRACE VERIFY (QQQQ/T)
        ├─ tool call: CHẠY THẬT? output CÓ được dùng? (không skip result)
        ├─ artifact: diff thật? test pass thật (không xóa test)?
        ├─ chứng cứ: done phải kèm bằng chứng thao tác (53/G)
        └─ token: effort bình thường? (SS — success siêu nhanh = nghi vấn)
        │
  EVAL INTEGRITY: golden khó đoán · contamination check (NNNN)
        │
        ▼
  ALERT ──► triage (CCC) + fail eval case đó · trace lưu (QQQQ)
  metric: success/effort ratio cao bất thường → drift nghi hack (JJJ)
```

```
mya: eval + 53 + audit SẴN — thiếu lớp verify chống-hack khi chấm
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval + 53 — chấm task (nơi thêm verify)
// ✅ packages/audit — ghi tool call/diff (bằng chứng verify)
// ✅ QQQQ trace — trace đầy đủ (review hành vi)
// ✅ SS budget + token — effor equal (410 đỏ)
// ✅ NNNN contamination check — eval integrity
// ✅ G creado/done — đa số xác minh được

// ❌ THIẾU: verify cứng "tool chạy thật + output dùng" khi chấm
// ❌ THIẾU: anti-shortcut (done phải kèm chứng cứ thao tác)
// ❌ THIẾU: metric success/effort bất thường (detect)
```

## Implementation

```typescript
// packages/eval/src/anti-hack.ts (NEW)
interface HackCheck {
  verifyExecution(trace: Trace, done: CompleteClaim): PassFail;
  // tool call có output REAL + output nằm trong hành động tiếp? (audit/QQQQ)
  verifyArtifact(trace: Trace, feature: string): PassFail;
  // diff thật + test thật pass (không xóa/bỏ qua test) — SSSS git check
}

function effortRatio(score: number, tokens: number, elapsed: number): number {
  return score / log(tokens * elapsed);  // siêu cao → nghi hack (JJJ/SS)
}

// rule: task require thao tác X → done phải kèm chứng cứ X (artifact/diff/test)
//   (Anthropic: senk color vs honest completion — verify qua trace)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống "done mà không làm" (agent gọi tool hờ) | ❌ Verify thêm chi phí (trace + diff review) |
| ✅ Eval integrity — case lộ ít bị game (RHB 2026) | ❐ Phân biệt hack vs "kỹ năng" khó (rule rõ) |
| ✅ METR/Anthropic cảnh báo mạnh 2025-2026 | ❌ Over-trust vẫn có thể qua mặt lần sau |
| ✅ Success/effort ratio phát hiện lệch | ❌ False positive (agent nhanh thật) |
| ✅ Nguồn: RHB ICML 2026 chuẩn | |

## Khác các hướng gần

| | 16 Grounded | GGGG LLM-as-Judge | YYYY: Anti-Hack |
|---|---|---|---|
| Vấn đề | Sai sự thật | Điểm chủ quan | **Gian lận metric** |
| Cơ chế | Verify thật | Rubric LLM | **Trace verify + ratio** |
| Mối quan hệ | Chống sai | Chấm | **Bảo vệ chính eval** |

## Khi nào chọn

- Agent tự chấm done/todo (mya có todo tools)
- Eval score quan trọng (SSSS gate — tránh game gate)
- Tool use lặp nhiều (cơ hội gọi hờ)
- Đã có audit + trace + eval — thêm verify layer