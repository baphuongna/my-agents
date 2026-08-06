# Hướng CA: Swarm Optimization — tối ưu cấu hình agent theo đàn

> **Nguồn gốc:** PSO (Kennedy & Eberhart, 1995); SwarmAgentic (EMNLP 2025, arXiv 2506.15672, ~19 cites)
> **Coupling:** 🟢 — đàn chạy ngoài runtime, qua eval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval + tier sẵn; thiếu swarm loop)
> **Effort:** 1-2 tuần

## Nguồn gốc

Particle Swarm Optimization (PSO, Kennedy & Eberhart 1995): tập **particle** (giải pháp) bay trong không gian tìm kiếm liên tục; mỗi particle nhớ **pbest** (tốt nhất cá nhân) + **gbest** (tốt nhất đàn), vận tốc cập nhật theo cả hai → hội tụ về tối ưu. SwarmAgentic (EMNLP 2025): đưa PSO vào hệ agentic — optimization dùng swarms. Khác **TTT EvoPrompt / GA** (discrete mutation/crossover) — PSO là **vận liên tục** trên không gian số (velocity/pbest/gbest), không cần crossover; dùng khi cấu hình là **số liên tục** (threshold, temperature, weights) thay vì text. Khác **19 Stigmergy** (phối hợp hành xử qua môi trường) — PSO là **thuật toán tối ưu**, không phải coordination runtime.

## Mô tả

mya tối ưu **tham số liên tục** của agent (model temperature, confidence threshold cho HHH cascade, budget split, weights routing): khởi tạo N particle = N bộ tham số → mỗi particle chạy qua PP eval (fitness trên golden) → cập nhật pbest/gbest → cập nhật velocity → thế hệ mới → hội tụ hoặc max iterations (SS). Khác EvoPrompt: không mutate text — **giải pháp là vector số liên tục**. Dùng khi có nhiều tham số coupled khó tune tay (cascade threshold × retry → budget). Rất hợp: 3-5 tham số, eval nhanh, fitness hàm trơn.

## Kiến trúc

```
  SWARM (N particle = N bộ tham số) ──► mỗi particle qua PP eval (fitness)
      │  pbest: tốt nhất cá nhân
      │  gbest: tốt nhất đàn (shared)
      ▼
  CẬP NHẬT VELOCITY: v += c1·(pbest-x) + c2·(gbest-x)   (PSO chuẩn)
  CẬP NHẬT vị trí: x += v
      ▼
  THẾ HỆ MỚI ──► lặp ──► hội tụ / max iter (SS) ──► PROMOTE gbest
                                              (verify trên reserve — như TTT)
```

```
mya: packages/eval (fitness) + SS budget + cron sẵn
     thiếu: swarm loop (velocity/position) + tham số hoá cấu hình agent
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — fitness (PP) cho từng particle
// ✅ packages/ai/src/model-routing.ts — threshold/tier (có thể optimize)
// ✅ packages/gateway/src/rate-limiter.ts (SS) — chặn iterations
// ✅ packages/cron — chạy đàn định kỳ
// ✅ packages/prompts — config có cấu trúc (nơi áp bộ số mới)

// ❌ THIẾU: swarm loop (PSO equations) + không gian tham số định nghĩa
// ❌ THIẾU: nối particle → chạy eval → thu fitness tự động
// ❌ THIẾU: promote gate (gbest vs production trên reserve)
```

## Implementation

```typescript
// packages/prompts/src/swarm.ts (NEW)
interface Particle { params: number[]; velocity: number[]; pbest: number; pbestParams: number[] }

async function swarmOptimize(oOpts: { paramDefs: ParamDef[]; swarmSize: N; iters: N }) {
  let pop = initSwarm(oOpts.paramDefs);            // N particle ngẫu nhiên
  let gbest = -Infinity; let gbestParams = [];
  for (let it = 0; it < oOpts.iters; it++) {               // SS
    for (const p of pop) {
      const fit = await evalConfig(paramsToConfig(p.params)); // PP eval
      if (fit > p.fitness) { p.pbest = fit; p.pbestParams = p.params; }
      if (fit > gbest) { gbest = fit; gbestParams = p.params; }
    }
    for (const p of pop) {                                  // PSO update
      p.velocity = c1*(pbest - p.params) + c2*(gbest - p.params);
      p.params += p.velocity;
    }
  }
  return verifyOnReserve(gbestParams);                      // promote gate
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tối ưu cụm tham số liên tục (coupled) không cần tune tay | ❌ Fitness phải gọn + eval nhanh (N particle × iter) |
| ✅ Không cần crossover text — PSO thuần số | ❌ Local optima (GBest kẹt) — cần inertia/diversity |
| ✅ Eval + cron + config structure sẵn | ❌ Ngưỡng bias: đối tượng fitness thay đổi: eval cũ → sống |
| ✅ SwarmAgentic (EMNLP 2025) có nguồn chuẩn | ❌ Số particle × iteration × eval cost (SS) |
| ✅ Kết hợp EB1 (GA) — GA cho discrete, PSO cho contin | |

## Khác các hướng gần

| | TTT EvoPrompt | FFF Plan | BBBB: Swarm PSO |
|---|---|---|---|
| Không gian | Text prompt | Plan hành động | Vector số liên tục |
| Toán tử | Mutate/crossover | Re-plan | **Velocity + pbest/gbest** |
| Fitness | PP eval | PP eval | PP eval |
| Mối quan hệ | GA (discrete) | Bổ trợ | **PSO (continuous)** |

## Khi nào chọn

- Có cụm tham số liên tục khó tune tay (cascade threshold + budget weights)
- Fitness = eval nhanh, hàm đủ trơn
- Chấp nhận cost chạy đàn định kỳ (SS + cron) 
- Muốn tự động hóa thay vì tune thủ công