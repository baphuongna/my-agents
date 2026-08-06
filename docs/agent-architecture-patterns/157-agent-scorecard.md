# Hướng FA: Agent Scorecard — bảng điểm liên tục theo KPI chất lượng/cost/safety

> **Nguồn gốc:** AWS Connect "Agent performance evaluations dashboard" (cohorts + time series); Arize "Agent evaluation metrics" (quality/cost/safety/behavior KPIs); Verint "Agent Scorecard"; Medium "AI agent evaluation best practices" (baselines + balance)
> **Coupling:** 🟢 — thêm lớp đo, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval PP + observability YYYY + audit sẵn; thiếu scorecard layer)
> **Effort:** 1 tuần

## Nguồn gốc

Agent scorecard: **bảng điểm liên tục — KPI đa chiều của từng agent, so theo thời gian/cohort** — AWS: "view aggregated agent performance, get insights across agent cohorts and over time"; Arize: "choose agent evaluation metrics by agent type — quality, cost, safety, behavior KPIs"; Verint: "scorecard tracks individual performance metrics — helps identify coaching opportunities"; Medium: "define clear success criteria, track multiple metrics and balance them, use baselines". Điểm khác **PP eval** (chạy eval set khi cần) và **YYYY observability** (trace dữ liệu thô) — BBBBBBB *biến thành điểm số theo dõi được*: gom các metric (success rate, tool correctness JJJJJ, cost/task XXXXX, latency, safety event, user correction IIIIII) → scorecard per agent/cohort, cập nhật real-time (YYYY nguồn), so baseline (điểm chuẩn) + trend (đang tốt/xấu), alert khi tụt (BBBBBB watchdog tích hợp). Nối PP (eval — nguồn điểm chất lượng), YYYY (metric thời gian thực), XXXXX (cost KPI), JJJJJ (tool đúng — KPI), OOOO (error taxonomy — điểm an toàn), AAAAAA (arena — ranking tổng).

## Mô tả

mya scorecard: (1) **định nghĩa KPI** — theo loại agent (Arize): quality (success rate, correctness), cost (cost/task — XXXXX), safety (event nguy hiểm, tool sai — JJJJJ/OOOO), behavior (latency, retry, vòng lặp); (2) **nguồn dữ liệu** — tự động: YYYY metrics + VV audit + PP eval định kỳ (không nhập tay); (3) **điểm tổng** — trọng số theo vai trò agent (agent làm task quan trọng — quality nặng; agent rẻ — cost nặng); (4) **baseline + cohort** — so với baseline (bản thân quá khứ) + cohort (agent cùng vai trò — AWS); (5) **trend + alert** — tụt 2 tuần liên tiếp → alert (BBBBBB) + xem error cluster (OOOO); (6) **vòng cải thiện** — điểm thấp → hành động: sửa prompt (FFFF), re-onboard (XXXXXX), thu hồi (BBBBBB) — đo lại sau thay đổi (RRRRRR).

## Kiến trúc

```
  NGUỒN: YYYY metrics · VV audit · PP eval định kỳ · JJJJJ tool-correct
        │
        ▼
  KPI THEO LOẠI (Arize): quality · cost (XXXXX) · safety · behavior
        │
        ▼
  ĐIỂM TỔNG (trọng số theo vai trò) — SCORECARD per agent
        │
        ▼
  SO SÁNH: baseline (chính mình — quá khứ) · cohort (cùng vai trò — AWS)
        │
        ▼
  TREND + ALERT: tụt liên tiếp → BBBBBB alert + OOOO error cluster
        │
        ▼
  HÀNH ĐỘNG: sửa prompt (FFFF) · re-onboard (XXXXXX) · thu hồi — đo lại (RRRRRR)
```

```
mya: PP + YYYY + VV SẸN — thiếu: scorecard layer (KPI tổng hợp + baseline + alert)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PP eval — nguồn điểm chất lượng
// ✅ YYYY observability — metric real-time (nguồn scorecard)
// ✅ VV audit — sự kiện (behavior KPI)
// ✅ XXXXX finops — cost/task KPI
// ✅ JJJJJ tool bench — tool-correct KPI
// ✅ OOOO error analysis — error cluster (điểm an toàn)
// ✅ BBBBBB watchdog — alert tích hợp

// ❌ THIẾU: scorecard layer (gom KPI → điểm)
// ❌ THIẾU: baseline + cohort so sánh
// ❌ THIẾU: trend detector + action suggestion
```

## Implementation

```typescript
// packages/scorecard/src/score.ts (NEW)
export class Scorecard {
  compute(agent: AgentId, kind: AgentKind): Score {
    const k = kpis[kind];                       // Arize — theo loại agent
    const s = {
      quality: this.quality(agent),             // PP + JJJJJ
      cost: costPerTask(agent),                 // XXXXX
      safety: this.safety(agent),               // VV + OOOO
      behavior: this.behavior(agent),           // YYYY — latency/retry
    };
    return { total: weighted(s, k.weights), baseline: this.baseline(agent), s };
  }
  watch(agent: AgentId) {
    if (trend(this.history[agent]).down(2)) alert(agent); // BBBBBB
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhìn 1 nơi: agent khỏe/yếu chỗ nào (đa chiều) | ❌ Trọng số KPI theo vai trò — cần chỉnh định |
| ✅ Baseline/cohort — biết "bình thường" là gì | ❐ Metric gom sai → điểm sai hướng dẫn |
| ✅ Alert sớm khi tụt (2 tuần) — can thiệp kịp | ❌ Thêm lớp tổng hợp (nhẹ nhưng phải duy trì) |
| ✅ Xây trên PP + YYYY + XXXXX + JJJJJ | ❌ KPI "mềm" (safety) khó đong chính xác |

## Khác các hướng gần

| | PP Eval | YYYY Observability | BBBBBBB: Scorecard |
|---|---|---|---|
| Khi đo | Định kỳ | Real-time | **Liên tục — gom thành điểm** |
| Đầu ra | Điểm eval | Trace/metric | **Score + baseline + trend + alert** |
| Quan hệ | Nguồn | Nguồn | **Lớp tổng hợp trên cả 2** |

## Khi nào chọn

- Nhiều agent — cần so sánh công bằng + phát hiện yếu sớm
- Muốn "dashboard điểm" cho team (AWS Connect style)
- Đã có PP + YYYY + XXXXX + JJJJJ — thêm scorecard + baseline + alert
- Agent quan trọng — cần giám sát chất lượng liên tục