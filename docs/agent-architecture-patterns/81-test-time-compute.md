# Hướng CC: Test-Time Compute Scaling — chi compute theo độ khó

> **Nguồn gốc:** Snell et al., ICLR 2025 oral (arXiv 2408.03314, ~569 cites); arXiv 2506.12928 (agents); TOPS NeurIPS 2025
> **Coupling:** 🟢 — compute allocation quanh 1 request
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (budget + cascade sẵn; thiếu adaptive allocator)
> **Effort:** 1-2 tuần

## Nguồn gốc

Test-time compute scaling (Snell ICLR 2025 oral): **phân bổ compute tại inference theo độ khó bài** — model nhỏ + nhiều compute có thể thắng model lớn (FLOPs-matched). Các cơ chế: **thinking budget** (o1-style: cho phép nhiều reasoning tokens), **best-of-n** (sinh N lần chọn tốt nhất), **search/verifier** (verify-then-choose). arXiv 2506.12928: mở rộng cho **agents** — phân bổ test-time compute qua nhiều tool calls/reasoning steps; TOPS (NeurIPS 2025): tối ưu thinking để không thừa không thiếu. Khác **SS Budget Gating** (trần cứng — chặn) — test-time compute là **cấp compute chủ động cho bài khó** (lượng hóa được, không chỉ chặn); khác **HHH Cascade** (escalate model) — giữ model, tăng **compute** (tokens/steps) thay vì đổi model.

## Mô tả

mya gắn **allocator** vào request loop: dự đoán độ khó (task heuristic, history: task tương tự từng cần bao nhiêu) → cấp **compute budget**: thinking tokens tối đa, số lần retry/refine (EEE), số nhánh tìm kiếm (XXX) → sau khi chạy: dùng **verifier** (PP eval hoặc self-check) quyết định dừng sớm (đủ tốt) hay cấp thêm compute (nhánh mới, thử lại với reflection) → hết trần (SS) thì chấp nhận tốt nhất + escalate (HHH model lớn). Đo hiệu quả: **compute-per-success** (FLOPs matched) — không phải chỉ cost thô. Cơ chế rẻ nhất: best-of-n cho task quan trọng (chọn output tốt nhất qua verifier) — tương đương MoA 1-layer nhưng verifier chọn thay aggregator.

## Kiến trúc

```
  request ──► ALLOCATOR (dự đoán độ khó: heuristic + history)
                │  cấp: thinking tokens · max refine (EEE) · nhánh (XXX)
                ▼
             AGENT LOOP (chạy trong compute budget)
                │  verifier (PP/self-check) sau mỗi bước
                │  chưa đủ tốt + còn budget ──► thêm compute (refine/nhánh mới)
                │  đủ tốt ──► dừng sớm (tiết kiệm)
                ▼
             hết budget ──► best-of-n chọn / HHH escalate model lớn
             (SS trần + đo compute-per-success)
```

```
mya: SS budget + PP eval (verifier) + EEE/XXX cơ chế tiêu compute SẴN
     thiếu: allocator (dự đoán + cấp theo độ khó) + verifier-driven stop
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ SS rate-limiter — trần cứng (nền allocator)
// ✅ packages/eval — verifier (quyết định dừng sớm / cấp thêm)
// ✅ EEE reflexion — cơ chế refine (tiêu compute thêm)
// ✅ XXX LATS — nhánh tìm kiếm (tiêu compute thêm)
// ✅ HHH cascade — escalate khi hết compute

// ❌ THIẾU: allocator — dự đoán độ khó + cấp compute động
// ❌ THIẾU: verifier-driven early-stop (dừng khi đủ tốt)
// ❌ THIẾU: đo compute-per-success (tối ưu không chỉ cost thô)
```

## Implementation

```typescript
// packages/ai/src/test-time.ts (NEW)
interface ComputeAllocation { thinkingTokens: number; maxRefine: number; branches: number }

async function runWithCompute(task: Task): Promise<Result> {
  const alloc = predictDifficulty(task);        // heuristic + history (similar task)
  let best: Result | null = null;
  for (let i = 0; i < alloc.maxRefine; i++) {
    const out = await runAgent(task, { thinkingTokens: alloc.thinkingTokens });
    const v = await verify(out);                // PP/self-check — verifier
    if (v.pass) return out;                     // dừng sớm — tiết kiệm compute
    best = better(best, out);
  }
  return hhhEscalate(task, best);               // hết compute → model lớn (HHH)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bài khó được nhiều compute, bài dễ ít — hiệu quả FLOPs-matched (Snell) | ❌ Dự đoán độ khó sai → cấp thừa/thiếu |
| ✅ Verifier-driven stop — không chạy thừa | ❌ Verifier kém → dừng nhầm sớm/chọn nhầm |
| ✅ Kết hợp sẵn EEE/XXX/HHH/SS | ❌ Cần lịch sử đo độ khó (JJJ data) |
| ✅ ICLR 2025 oral — nguồn chuẩn | ❌ Tuning allocator theo task type |

## Khác các hướng gần

| | SS Budget Gating | HHH Model Cascade | DDDD: Test-Time Compute |
|---|---|---|---|
| Vai trò | Chặn (trần cứng) | Đổi model lớn | **Cấp compute động theo độ khó** |
| Đo | Cost | Cost | **Compute-per-success** |
| Dừng sớm | Không | Không | **Verifier-driven** |
| Mối quan hệ | Trần cho allocator | Escalate cuối | Điều phối cả ba |

## Khi nào chọn

- Độ khó task phân bố rộng (nhiều bài dễ, vài bài khó)
- Có verifier tốt (PP) để quyết định dừng sớm
- Muốn tối ưu quality-per-compute, không chỉ trần cost
- Đã có SS/EEE/XXX/HHH — thêm allocator