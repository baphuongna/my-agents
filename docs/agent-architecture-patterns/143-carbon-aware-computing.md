# Hướng NNNNNN: Carbon-Aware Computing — route/compute theo cường độ carbon

> **Nguồn gốc:** GAR "Carbon-Aware Routing for LLM Inference" (OpenReview, CO₂-aware routing); Devadas "Towards carbon-aware AI" (Springer 2026, PRISMA review); arXiv 2509.19996 "Advancing Green AI via Dynamic Model Selection" (≈25% tiết kiệm); ACM "Carbon-Aware Workload Simulation" 2026
> **Coupling:** 🟢 — thêm lớp route/quyết định, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (routing + cascade + finops meter sẵn; thiếu carbon signal)
> **Effort:** 1-2 tuần

## Nguồn gốc

Carbon-aware: **quyết định chạy đâu/khi nào dựa trên carbon intensity** — GAR: "routing LLM inference queries to minimize CO₂ emissions while adhering to service-level constraints"; Devadas 2026: "Carbon-aware AI denotes methods that explicitly account for carbon emissions, including grid carbon intensity, life-cycle emissions"; arXiv 2509.19996: "Green AI dynamic model selection can achieve substantial energy savings (up to ≈25%)"; ACM 2026: carbon-aware workload simulation cho cloud. Điểm khác **PPPP hybrid** (route theo giá/cost) và **XXXXX finops** (meter theo chi phí tiền) — NNNNNN *route theo carbon*: chọn model/region/thời điểm có carbon intensity thấp (data center xanh, giờ thấp điểm grid); task nhỏ dùng model hiệu quả năng lượng (dynamic model selection — 25% tiết kiệm); task không gấp hoãn tới giờ carbon thấp (carbon-aware deferral). Nối PPPP (routing — thêm chiều carbon), HHH (cascade — chọn model theo năng lượng), XXXXX (meter — ghi CO₂ bên cạnh cost), SS (budget — hoãn task không gấp).

## Mô tả

mya carbon loop: (1) **carbon signal** — theo dõi carbon intensity của từng lựa chọn: region/data center (grid intensity), model (năng lượng/token — model nhỏ rẻ carbon), giờ (peak vs off-peak); (2) **carbon-aware route** — GAR: chọn endpoint CO₂ thấp trong ràng buộc SLA (latency/quality không hỏng); (3) **dynamic model selection** — task dễ → model hiệu quả năng lượng (nối HHH cascade — thêm chiều carbon: 25% tiết kiệm — arXiv); (4) **deferral** — task không gấp → lên lịch giờ carbon thấp (đồng bộ với SS budget/urgency); (5) **đo lường** — meter carbon (gCO₂/task, gCO₂/agent) bên cạnh cost (XXXXX — mở rộng meter); (6) **báo cáo** — dashboard carbon (YYYY) — chính sách "carbon budget" nếu tổ chức yêu cầu.

## Kiến trúc

```
  CARBON SIGNAL: region grid intensity · model energy/token · peak/off-peak
        │
        ▼
  ROUTER (PPPP mở rộng): endpoint CO₂ thấp trong SLA (GAR — không hỏng latency)
        │
        ▼
  MODEL SELECT (HHH + dynamic — arXiv 2509.19996: 25% tiết kiệm)
   task dễ → model hiệu quả năng lượng
        │
        ▼
  DEFERRAL: task không gấp → chờ giờ carbon thấp (SS urgency check)
        │
        ▼
  METER (XXXXX mở rộng): gCO₂/task · gCO₂/agent → dashboard (YYYY)
```

```
mya: PPPP + HHH + XXXXX SẸN — thiếu: carbon signal + deferral + meter CO₂
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PPPP routing — chọn endpoint (thêm chiều carbon)
// ✅ HHH cascade — chọn model theo độ khó (thêm chiều năng lượng)
// ✅ XXXXX finops — meter cost (mở rộng meter CO₂)
// ✅ SS budget — độ gấp task (điều kiện deferral)
// ✅ YYYY observability — dashboard (thêm carbon metric)

// ❌ THIẾU: carbon signal (region grid intensity · model energy)
// ❌ THIẾU: carbon-aware route (GAR — trong SLA)
// ❌ THIẾU: deferral scheduler (task không gấp chờ giờ xanh)
// ❌ THIẾU: meter CO₂ (gCO₂/task)
```

## Implementation

```typescript
// packages/carbon/src/router.ts (NEW)
export class CarbonRouter {
  async route(task: Task): Promise<Endpoint> {
    const cands = this.endpoints(task);
    if (task.urgency === "low" && this.offPeakSoon()) return defer(task); // chờ xanh
    return cands
      .filter(e => e.meetsSla(task))            // GAR: trong ràng buộc SLA
      .sort((a, b) => a.carbonIntensity - b.carbonIntensity)[0] ?? fallback;
  }
  // model: task dễ → model hiệu quả năng lượng (arXiv — 25% tiết kiệm)
  // meter: gCO₂ = tokens × co2PerToken(model, region) — cạnh XXXXX cost
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm CO₂ rõ ràng đo được (gCO₂/task) | ❌ Cần dữ liệu carbon intensity region/model |
| ✅ Dynamic model selection tiết kiệm ≈25% năng lượng | ❐ Deferral làm chậm task (chỉ task không gấp) |
| ✅ Kết hợp SLA — không hỏng latency (GAR) | ❌ Carbon thấp ≠ rẻ nhất (quyết định nhiều chiều) |
| ✅ Xây trên PPPP + HHH + XXXXX | ❌ 1 máy cá nhân — carbon signal ít ý nghĩa |

## Khác các hướng gần

| | PPPP Hybrid | XXXXX FinOps | NNNNNN: Carbon |
|---|---|---|---|
| Tối ưu | Tiền | Ngân sách tổ chức | **CO₂** |
| Tín hiệu | Model giá | Meter/quota | **Carbon intensity** |
| Quan hệ | Thêm chiều | Thêm meter CO₂ | **Mở rộng cả 2** |

## Khi nào chọn

- Tổ chức yêu cầu giảm carbon (báo cáo ESG)
- Chạy nhiều region/data center — chọn nơi xanh
- Task không gấp nhiều — deferral giờ carbon thấp
- Đã có PPPP + HHH + XXXXX — thêm carbon signal + deferral + meter