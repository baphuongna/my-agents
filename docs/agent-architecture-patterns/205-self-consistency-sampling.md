# Hướng XXXXXXXX: Self-Consistency Sampling — sinh nhiều path reasoning rồi bỏ phiếu đa số

> **Nguồn gốc:** Wang X et al. "Self-Consistency Improves Chain of Thought Reasoning" (samples 5262 cites — majority vote among final answers của nhiều reasoning chains); arXiv 2505.10772 "Ranked Voting based Self-Consistency" (majority voting "enhances CoT reasoning — select the highest self-consistency answer"); NAACL 2025 "Leveraging Reasoning Paths for Efficient LLM Sampling" (self-consistency mitigates hallucination — sample multiple paths); research.google "Confidence Improves Self-Consistency"; zeroentropy "self-consistency is the cheapest test-time-compute trick"
> **Coupling:** 🟢 — độc lập, chỉ thay mỗi bước suy luận gọi model
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (mỗi lần 1 coT — chưa nhân bản vote)
> **Effort:** 1-2 tuần

## Nguồn gốc

Self-consistency: **gọi N lần (temperature cao, các path reasoning khác nhau) → vote đáp án cuối giống nhau nhất** — zeroentropy: "N independent chain-of-thought paths, majority-vote the final answer — the cheapest test-time-compute trick"; Wang (cited 5262 lần): vote ra đáp án final answers của chains là tốt hơn single-sample (trong GSM8K…); NAACL 2025: giảm hallucination nhưng thiếu hệ thống (thêm cost tuyến tính); 2505.10772: ranked voting khi các class gần nhau. So với **186 multi-agent-debate-ensemble** (nhiều agent khác model — bình luận/blog-transcript) — XXXXXXXXX *cùng model, random sampling* — chi phí nhỏ hơn nhiều — không cần MCP/agent khác. So với **test-time-compute** (TTC cái khác — trong 81-test-time-compute) và **lookahead-tree-search** (185) — SC đơn giản, tree thì có visibility quyết định (2 hướng). So với **84 llm-as-judge** — SC *không cần judge* — chỉ vote chuỗi.

## Kiến trúc

```
   WHO (1 prompt / query)
        │
        ▼
  N SAMPLES (N = 5..10) — sampling: temperature > 0 (đa dạng paths)
        │
        ▼
  VOTE (most frequent final = winner; variants: confidence-weighted, ranked vôt 2505)
     ·  không có consensus? → ấn có nhóm / judge để chọn (185/186)
        │
        ▼
  COLLECT (winner answer)  ──► 1-3 tradeoff: chi phí N×, latency ~N×
```

```
mya: chưa có nhánh sampling — thêm adapter tạo vòng N
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 18 test-time-compute — sẵn vòng suy luận ước tính
// ✅ 84 llm-as-judge — sẵn khi vote không rõ
// ✅ cost 167 / rate 196 — sẵn chỗ đọc chi phí N×

// ❌ THIẾU: sampler (gọi N lạnh, gom đáp án)
// ❌ THIẾU: vote-function (nhiều variant: majority/ranked/confidence—Google)
// ❌ THIẾU: cân chi phí (costBudget × N vs ngân sách)
```

## Implementation

```typescript
// packages/selfconsist/src/vote.ts (NEW)
export async function selfConsistent<T>(
  ask: () => Promise<{ answer: T; chain: string }>,
  opts: { n: number; vote: "majority" | "ranked" | "conf" }, // 2505 + Google
): Promise<T> {
  const runs = await Promise.all(range(opts.n).map(() => ask()));
  return vote(runs, opts.vote);   // majority — đếm đáp án; ranked — trọng số path
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ +5–25% reason task (GSM8K-like) — rẻ nhất test-time trick | ❌ Chi phí ~N× token + latency (thực tế latency x N) |
| ✅ Không cần annotation/judge — tự động (khác ensemble) | ❌ "Vote giảm variance, không giảm bias" — dễ confidently sai (LinkedIn) |
| ✅ Trưởng component — x8 trên 46: hạ toàn agent | ❌ Quan sát khi dùng LLM đủ mạnh — tăng không nhiều công nghệ core |

## Khác các hướng gần

| | 185 LATS-tree | 186 ENSEMBLE | XXXXXXXX: Self-consistency |
|---|---|---|---|
| Mục | Khám phá không gian giải pháp | Hợp các model/kết quả | **Bỏ phiếu path riêng — reasoning chắc** |
| Độc lập | có (cấu trúc mới) | Cần multi-agent | **Chỉ có multi-sample 1 model** |
| Chi phí | Cao (cây) | Rất cao (nhiều agent) | **Rẻ nhất — N sample** |

## Khi nào chọn

- Nhiệm vụ suy luận (math, code logic, đánh giá) — cùng 1 query trả khác nhau
- Confidence/budget cho phép N× chi phí cho task hiếm/quan trọng
- Architecture đơn giản — muốn cải thiện trong 1 hướng — không muốn đưa thêm agent/judge