# Hướng XXXXX: Agentic FinOps — quản trị chi phí agent theo tổ chức

> **Nguồn gốc:** praesidia "AI FinOps" 2026; finout "Agentic AI Cost Governance" 2026; tmls "Agentic FinOps"
> **Coupling:** 🟡 — meter + policy, gateway đổi nhẹ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (SS per-task sẵn; thiếu attribution/quota)
> **Effort:** 2 tuần

## Nguồn gốc

Agentic FinOps: **meter → attribute → budget → enforce → forecast** chi phí agent ở mức tổ chức — praesidia 2026: "attribute, budget, forecast, and enforce AI agent spend across your organization — the complete FinOps discipline for agentic systems"; finout 2026: "agentic AI costs behave differently — governance frameworks that control spend before it controls you"; tmls: "meter tokens, set agent budgets, **route by difficulty**, and **degrade instead of failing**" (tiết kiệm 58% tới 3.5x); finops.org: quotas, tag resources, review; snowflake: budgets, per-user quotas. Điểm khác **SS Budget Gating** (trần cứng per-task — kỹ thuật) — XXXXX là *tầng quản trị*: phân bổ chi phí theo user/dự án (attribution), quota per-user/per-agent, cảnh báo budget drift (usage.ai "governance watches budget drift"), route theo độ khó (rẻ làm việc dễ — RR mở rộng), degrade (chuyển model rẻ/giảm chất lượng thay vì fail).

## Mô tả

mya FinOps layer (trên SS): (1) **meter** — mọi call/step đếm token/cost (SS đã meter) → gán tag: user, dự án, agent (VV audit nối); (2) **attribute** — cost roll-up theo user/dự án/loại task (praesidia); (3) **budget + quota** — quota tháng per-user/per-dự án (snowflake per-user quotas), ngưỡng theo loại task; (4) **route by difficulty** — task đơn giản → model rẻ (RR routing + SS budget) — tmls 58% tiết kiệm; (5) **degrade** — chạm ngưỡng → tự chuyển rẻ hơn thay vì fail (tm ls); (6) **forecast + drift alert** — dự báo cuối tháng, cảnh báo drift (usage.ai) → báo user; (7) **chống** — attribution bịa (YYYY — gán sai tag) + agent "giấu" cost (đổi model giữa chừng — check). Nối SS (trần cứng), RR (route), VV (audit sự kiện cost).

## Kiến trúc

```
  MỌI CALL/STEP ──► METER (SS sẵn — token/cost) + TAG (user · dự án · agent)
        │
        ▼
  ATTRIBUTE ──► roll-up theo user/dự án (praesidia)
        │
  ┌─────┴─────────────────────────────┐
  BUDGET/QUOTA (per-user/dự án)       ROUTE: task dễ → model rẻ (RR — tmls 58%)
  chạm ngưỡng ──► DEGRADE (chuyển     │
  rẻ thay vì fail — tmls)             ▼
        │                      FORECAST cuối tháng + drift alert (usage.ai)
        ▼
  AUDIT: cost gắn trace (VV) · chống gán sai tag (YYYY)
```

```
mya: SS meter + budget SẸN — thiếu: attribution · quota per-user · route · degrade
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/gateway SS — meter token/cost + trần cứng per-task
// ✅ RR model routing — chọn model (nền cho route-by-difficulty)
// ✅ VV audit — sự kiện cost gắn trace (attribution nguồn)
// ✅ YYYY anti-hack — chống gán sai tag/đổi model
// ✅ SS budget — trần cứng (quota tầng dưới)

// ❌ THIẾU: attribution (tag user/dự án → roll-up)
// ❌ THIẾU: quota per-user/dự án (snowflake)
// ❌ THIẾU: route-by-difficulty (task dễ → model rẻ)
// ❌ THIẾU: degrade thay vì fail (tmls)
// ❌ THIẾU: forecast + drift alert (usage.ai)
```

## Implementation

```typescript
// packages/gateway/src/finops.ts (NEW)
interface SpendTag { userId: string; project: string; agent: string; taskType: string; }

function meter(call: Step): SpendTag[] { /* SS meter + tag VV */ }
function attribute(tags: SpendTag[]): Rollup { /* per-user/project — praesidia */ }

function enforce(user: string, project: string): Enforcement {
  const quota = quotas[user + "/" + project];          // snowflake: per-user quotas
  if (rollup(project) > quota.hard) return { action: "degrade" }; // tmls: degrade thay vì fail
  if (rollup(project) > quota.warn) return { action: "alert" };   // drift alert (usage.ai)
  return { action: "allow" };
}
function route(task: Task): Model {
  return task.difficulty === "easy" ? cheapModel : fullModel;  // tmls 58% — route by difficulty
}
// forecast: monthly burn rate → projection (praesidia)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thấy + kiểm soát cost theo user/dự án (praesidia) | ❌ Tag/attribution phải nhất quán (YYYY chống bịa) |
| ✅ Quota per-user chặn "một người đốt hết" (snowflake) | ❐ Forecast cần dữ liệu lịch sử (sau 1-2 tháng) |
| ✅ Route theo độ khó — 58% (tmls) | ❌ Degrade đổi chất lượng — user phải biết |
| ✅ Drift alert sớm thay vì sốc hóa đơn (usage.ai) | ❌ Phức tạp hơn SS (đa chiều) |

## Khác các hướng gần

| | SS Budget Gating | 46 Cost Caching | XXXXX: FinOps |
|---|---|---|---|
| Phạm vi | Per-task | Lặp lại | **Tổ chức (quota/attribution)** |
| Cơ chế | Trần cứng | Cache kết quả | **Meter→attribute→budget→degrade** |
| Mối quan hệ | Tầng dưới | Tiết kiệm cục bộ | **Quản trị trên SS** |

## Khi nào chọn

- Nhiều user/dự án chạy agent (cost phân bổ tranh chấp)
- Hóa đơn AI vượt ngân sách bất ngờ (drift)
- Đã có SS meter + RR routing — thêm attribution + quota + route
- Muốn degrade (không fail) khi chạm ngưỡng — tmls