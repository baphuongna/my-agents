# Hướng BS: EvoPrompt — tối ưu prompt/config agent bằng tiến hóa

> **Nguồn gốc:** Guo et al., 2023 "EvoPrompt" (arXiv 2309.08532, ~587 cites, +25% BBH)
> **Coupling:** 🟢 — evolution chạy ngoài runtime, qua eval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval + prompts sẵn; thiếu evolution loop)
> **Effort:** 1-2 tuần

## Nguồn gốc

EvoPrompt (Guo et al. 2023): tối ưu prompt bằng **thuật toán tiến hóa** (GA/DE) — LLM làm toán tử: **mutate** (biến thể 1 prompt), **crossover** (trộn 2 prompt), đánh giá fitness bằng downstream metric, chọn thế hệ tốt → lặp. Kết quả: +25% trên BBH, tốt hơn prompt viết tay. Mở rộng (2024-2026): tối ưu **toàn bộ cấu hình agent** (prompt, tool set, temperature, threshold) chứ không chỉ prompt — "Teaching AI Agents to Evolve Their Own Prompts" (genetic algorithm approach). Khác **YY Knowledge Compilation** (con người compile tri thức) — evolution **tự tìm** cấu hình tốt qua vòng đánh giá; khác **PP Eval** (đánh giá = fitness function cho evolution, không phải tự thân mục đích).

## Mô tả

mya có **population** các biến thể cấu hình agent (prompt trong packages/prompts + tham số + tool set) → chạy từng biến thể qua PP eval (cùng golden suite) → fitness score → **chọn lọc + mutate + crossover** bằng LLM → thế hệ mới → lặp N thế hệ (SS budget chặn) → cấu hình tốt nhất **promote** vào production (kèm số liệu so với cấu hình cũ). Không thay thế dev viết prompt — tự động **tinh chỉnh** các cấu hình đã tốt; tránh overfit golden suite (dùng eval đa dạng + reserve set). Chạy định kỳ (cron) hoặc khi thêm eval case mới.

## Kiến trúc

```
  POPULATION (N cấu hình: prompt + params + tool set)
      │
      ├─► PP EVAL (golden suite) ──► fitness score per member
      │
      ├─ SELECT top-k (elitism: giữ cấu hình tốt nhất)
      │
      ├─ LLM MUTATE: biến thể 1 thành viên (giữ ý, đổi cách diễn đạt)
      │
      ├─ LLM CROSSOVER: trộn 2 thành viên (lấy phần tốt mỗi bên)
      │
      ▼
  THẾ HỆ MỚI (N) ──► lặp ──► đạt max gen (SS) ──► PROMOTE best vào production
                                                        (kèm diff + số liệu)
```

```
mya: packages/prompts (config có cấu trúc) + packages/eval (fitness) SẴN
     thiếu: evolution loop + promote gate + anti-overfit (reserve set)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts — prompt/config có cấu trúc (genotype có thể mutate)
// ✅ packages/eval — golden suite = fitness function (PP)
// ✅ packages/cron — chạy campaign định kỳ
// ✅ SS rate-limiter — chặn evolution chạy lố cost

// ❌ THIẾU: evolution loop (mutate/crossover/select bằng LLM)
// ❌ THIẾU: promote gate — so sánh best-mới vs production trên reserve set
// ❌ THIẾU: bảo vệ chống overfit (eval set tách reserve; golden mới thêm dần)
```

## Implementation

```typescript
// packages/prompts/src/evolution.ts (NEW)
interface Member { config: AgentConfig; fitness: number }

async function evolve(opts: {
  population: AgentConfig[];           // khởi tạo từ cấu hình hiện có
  generations: number;                 // SS: chặn cost
  evalSuite: string[];                 // PP: golden + reserve
}): Promise<AgentConfig> {
  let pop = await evalAll(opts.population, opts.evalSuite);
  for (let g = 0; g < opts.generations; g++) {
    const elite = selectTop(pop);                       // elitism
    const offspring = [
      ...await llmMutate(elite),                        // LLM biến thể
      ...await llmCrossover(elite),                     // LLM trộn
    ];
    pop = await evalAll([...elite, ...offspring], opts.evalSuite);
  }
  const best = pop[0];
  const base = await productionConfig();
  return (await evalOnReserve(best) > await evalOnReserve(base))  // promote gate
    ? best : base;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự tìm cấu hình tốt hơn prompt viết tay (+25% BBH) | ❌ Cost: N cấu hình × G thế hệ × eval (SS bắt buộc) |
| ✅ Không cần con người tinh chỉnh từng câu chữ | ❌ Overfit golden suite nếu eval hẹp (cần reserve) |
| ✅ Eval + prompts sẵn — chỉ thêm loop | ❌ Mutate vô hướng → thế hệ nhiễu (elitism bù) |
| ✅ Chạy định kỳ, promote có bằng chứng số | ❌ Cấu hình phức (tool set) khó mutate hơn prompt |
| ✅ So sánh được: best-mới vs production (reserve set) | |

## Khác các hướng gần

| | YY Knowledge Compilation | PP Eval Harness | TTT: EvoPrompt |
|---|---|---|---|
| Ai tạo tri thức | Compile thủ công | — | **LLM mutate/crossover tự động** |
| Vai trò eval | Verify | Chấm output | **Fitness function** |
| Vòng lặp | Không | Không | N thế hệ |
| Mối quan hệ | Genotype nguồn | Fitness | Cả hai dùng lại |

## Khi nào chọn

- Có golden eval suite đáng tin (PP) làm fitness
- Muốn tinh chỉnh prompt/system tự động thay vì thủ công
- Chấp nhận cost chạy campaign (SS + cron định kỳ)
- Prompt đã tốt muốn đẩy thêm — không phải từ số 0