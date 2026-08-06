# Hướng FR: Fault Tolerance & Failover — agent chịu lỗi, chuyển dự phòng, gần như không downtime

> **Nguồn gốc:** Couchbase "High Availability vs Fault Tolerance" (HA — minimize downtime qua rapid recovery; FT — uninterrupted operation trong lúc failure); Nobl9 "HA vs FT Comparative Guide" (đo qua SLOs); ITU "HA vs FT" (HA giảm tác động, FT giấu hoàn toàn lỗi); Medium "Failover = plan B — backup team member steps in"
> **Coupling:** 🟡 — runtime phải có dự phòng + điểm chuyển đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (self-healing + health check sẵn; thiếu redundancy/failover)
> **Effort:** 3-5 tuần

## Nguồn gốc

Fault tolerance: **hệ agent vẫn chạy khi 1 phần lỗi — redundancy + failover, không downtime** — Couchbase: "HA focuses on minimizing downtime through rapid recovery, while fault tolerance ensures uninterrupted operation even in the event of failure"; Nobl9: đo qua SLOs; ITU: "HA reduces the impact of failure, fault tolerance tries to hide the failure entirely"; failover: "the plan B — a backup team member who steps in". Điểm khác **NNNNNNN self-healing** (agent tự sửa lỗi — phục hồi) — SSSSSSS *cấp hạ tầng*: không sửa mà *chuyển*: (1) redundancy — agent/tool có bản dự phòng (replica — khác provider/khác máy), (2) failover — phát hiện hỏng → chuyển request sang bản dự phòng (plan B) với state chuyển tiếp (failover có tiếp tục task hay làm lại — replay GGGGGG); (3) HA cluster — nhiều instance agent sau load balancer (chết 1 cái không ảnh hưởng); (4) SLO tracking — đo availability (Nobl9 — uptime % mục tiêu, error budget), cảnh báo (YYYY); (5) degrades — nguồn thứ cấp (tool B), (6) test — chaos (giết node chủ động — verify failover thật sự chạy — khác với self-healing test). Nối NNNNNNN (recover — sửa lỗi sau khi đã failover), YYY (SLO/alert), GGGGGG (replay state sau failover), GGG (routing — chọn provider dự phòng), 169 (degrade), VV (audit khi failover xảy ra).

## Kiến trúc

```
  CLUSTER AGENT (HA — nhiều replica sau load balancer — Couchbase)
        │
        ▼
  HEALTH CHECK (heartbeat + SLO — Nobl9)
        │
        ├── OK → chạy bình thường
        └── FAIL → FAILOVER (plan B — backup steps in)
              │
              ▼
  CHUYỂN: request → replica (GGG — provider khác nếu cần)
   · state: replay từ checkpoint (GGGGGG — không làm lại toàn bộ)
   · tool lỗi → nguồn thứ cấp (degrade — 169)
        │
        ▼
  SAU: NNNNNNN self-heal node hỏng · VV audit · YYY SLO/error budget
```

```
mya: NNNNNNN + health check SẴN — thiếu: redundancy + failover + SLO
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ NNNNNNN self-healing — phục hồi sau lỗi (nền)
// ✅ YYY observability — alert + theo dõi (SLO source)
// ✅ GGGGGG TTD — checkpoint/replay (state sau failover)
// ✅ GGG routing — chọn provider/model (dự phòng nguồn)
// ✅ 169 degrade + NN circuit breaker — lỗi từng phần

// ❌ THIẾU: redundancy (bản sao agent/tool)
// ❌ THIẾU: failover chuyển tự động (plan B — heartbeat)
// ❌ THIẾU: SLO/error budget (Nobl9 — đo availability)
// ❌ THIẾU: chaos test (giết node — verify failover thật)
```

## Implementation

```typescript
// packages/ha/src/failover.ts (NEW)
export class Failover {
  async call(agent: AgentRef, req: Request): Promise<Out> {
    const primary = pool.pick(agent);          // HA — nhiều replica
    try { return await primary.run(req); }
    catch (e) {
      metrics.record(e, primary);              // YYY — alert + SLO
      const backup = pool.failover(agent);     // plan B — backup steps in
      return replay(backup, req, primary.ckpt); // GGGGGG — từ checkpoint
    }
  }
  // SLO (Nobl9): availability% mục tiêu · error budget per month
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Gần như không downtime khi 1 node hỏng (Couchbase FT) | ❌ Redundancy tốn gấp đôi chi phí (2+ replica) |
| ✅ Sửa từ xa — không phải dừng cả hệ (failover kín) | ❐ State phải đồng bộ được giữa replica |
| ✅ Đo được bằng SLO/error budget (Nobl9) | ❌ Failover sai → cả 2 cái cùng hỏng |
| ✅ Xây trên NNNNNNN + YYY + GGG | ❌ Chaos test phức tạp — rủi ro khi test |

## Khác các hướng gần

| | NNNNNNN Self-Healing | NN Circuit Breaker | SSSSSSS: Fault Tolerance |
|---|---|---|---|
| Cách | Tự sửa lỗi | Ngắt nguồn xấu | **Chuyển sang dự phòng (failover)** |
| Mức | Task/hành động | 1 nguồn | **Toàn hạ tầng — replica + SLO** |
| Quan hệ | Sửa sau | Ngăn lan | **Chuyển + dự phòng trước** |

## Khi nào chọn

- Agent phục vụ quan trọng — downtime = mất tiền/tin cậy
- Chạy nhiều instance — muốn dự phòng provider/máy (GGG)
- Cần cam kết availability (SLO — Nobl9)
- Đã có NNNNNNN + YYY + GGG — thêm replica + failover + chaos test