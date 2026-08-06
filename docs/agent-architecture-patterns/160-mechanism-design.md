# Hướng EEEEEEE: Mechanism Design — thiết kế "luật chơi" để agent phối hợp tự nguyện

> **Nguồn gốc:** Hurwicz (Nobel 2007, incentive compatibility); Parkes "Dynamic Incentive Mechanisms" (31 cites); Garg "Foundations of Mechanism Design" tutorial (81 cites); Wikipedia Mechanism Design (economic engineering)
> **Coupling:** 🟢 — thêm lớp luật chơi, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (market + negotiation + consensus sẵn; thiếu mechanism layer)
> **Effort:** 2-4 tuần

## Nguồn gốc

Mechanism design: **thiết kế quy tắc (institution) sao cho hành vi ích kỷ của mỗi agent dẫn tới kết quả tốt chung** — Hurwicz/Nobel: incentive compatibility là trung tâm; Garg: "incentive compatibility — it should be in every agent's own best interest to reveal information truthfully"; Parkes: "mechanism design theory insists on designs that enjoy incentive compatibility — it should be in every agent's own best interest to ..."; Wikipedia: "designs rules — called mechanisms or institutions — that produce good outcomes even when agents act in their own self-interest". Điểm khác **AA market** (đấu giá Value — đặc thù) và **OOO negotiation** (thỏa thuận song phương) — EEEEEEE *thiết kế luật chơi có mục tiêu*: muốn phối hợp N agent (chia task, quyết nguồn, tránh khuyến khích sai): đặt incentive sao cho nói thật/đóng góp là tối ưu cá nhân. Chống "gaming": agent khai báo độ khó thật (nếu khai cao để tránh việc — phạt); agent nhận việc đúng năng lực. Nối AA (market — nền đấu giá), OOO (negotiation), WW (policy — khung luật), AAAAAAA (commerce — incentive bằng tiền), LL (stigmergy — phối hợp gián tiếp), EEEEEE (consensus — decision).

## Mô tả

mya mechanism: (1) **bài toán** — mục tiêu chung (chia task công bằng, gán task đúng năng lực, tránh đổ lỗi) + hành vi ích kỷ của agent (lười, giấu tin, đổ việc); (2) **thiết kế mechanism** — quy tắc + payment/punishment: báo giá độ khó → nếu khai sai bị phạt (incentive trung thực — truthful); (3) **verification** — sau khi xong: đo thực tế (PP/audit) so với khai báo (khai gian bị phát hiện — GGGG process reward ghi công thật); (4) **cân bằng Nash** — kiểm chứng: với quy tắc này, agent cá nhân có lợi nhất khi làm đúng không (thiết kế sao cho cân bằng = hành vi mong muốn); (5) **triển khai** — mechanism thành policy WW + payment (AAAAAAA) + audit VV; (6) **theo dõi** — đo có gaming không (EEEEE credit attribution — agent bịp điểm), điều chỉnh mechanism (feedback RRRRRR).

## Kiến trúc

```
  MỤC TIÊU (chia task công · gán đúng năng lực · tránh đổ lỗi)
        │
        ▼
  THIẾT KẾ: quy tắc + incentive (payment/punishment — truthful design)
        │  khai báo sai → phạt · làm thật → thưởng (Parkes IC)
        ▼
  VERIFY SAU: đo thực tế (PP/audit VV + GGGG credit) vs khai báo
        │
        ▼
  CÂN BẰNG NASH: ích kỷ cá nhân → kết quả tốt chung? (Hurwicz)
        │
        ▼
  TRIỂN KHAI: policy WW + payment (AAAAAAA commerce) + audit
        │
        ▼
  GIÁM SÁT GAMING: EEEEE credit — ai bịp → điều chỉnh mechanism (RRRRRR)
```

```
mya: AA market + negotiation + consensus SẸN — thiếu: mechanism layer (incentive design)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ AA market — đấu giá (nền mechanism — một dạng)
// ✅ OOO negotiation — thỏa thuận song phương
// ✅ EEEEEE consensus — quyết định nhóm
// ✅ WW policy — khung luật (triển khai)
// ✅ AAAAAAA commerce — payment/incentive
// ✅ GGGG process reward + EEEEE credit — đo công thật
// ✅ VV audit + PP — verify khai báo

// ❌ THIẾU: mechanism design layer (incentive + IC check)
// ❌ THIẾU: verification (so khai báo vs thực tế — trừ GGGG)
// ❌ THIẾU: gaming monitor
```

## Implementation

```typescript
// packages/mechanism/src/incentive.ts (NEW)
export class Mechanism {
  assign(task: Task, agents: Agent[]): Assignment {
    const bids = agents.map(a => ({ a, cost: a.bid(task) }));
    // incentive-trung-thực: quá cao để tránh việc → để agent đúng năng lực (Garg)
    // sau khi xong: verify (PP + GGGG) — khai sai → phạt (Parkes IC)
    return pickEfficient(bids);
  }
  isIncentiveCompatible(rules: Rules): boolean {
    return nash(rules); // với rule này, nói thật là tối ưu cá nhân (Hurwicz)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent ích kỷ vẫn dẫn tới kết quả tốt chung (cân bằng) | ❌ Thiết kế mechanism khó — lý thuyết kinh tế học |
| ✅ Chống gaming (khai sai bị phạt — verify sau) | ❐ Cần verification tốn kém (PP/audit mỗi task) |
| ✅ Công bằng — gán đúng năng lực, tránh đổ việc | ❌ Agent chỉ tự nguyện nếu có quyền từ chối thật |
| ✅ Xây trên market + commerce + audit | ❌ Task không có "ích kỷ" — mechanism thừa |

## Khác các hướng gần

| | AA Market | OOO Negotiation | EEEEEEE: Mechanism |
|---|---|---|---|
| Phạm vi | Đấu giá task | 2 bên | **Toàn bộ luật phối hợp** |
| Lý thuyết | Giá | Thỏa thuận | **Incentive compatibility (Nobel)** |
| Quan hệ | 1 dạng mechanism | 1 dạng | **Thiết kế có mục tiêu + game chống** |

## Khi nào chọn

- Nhiều agent tự chủ — cần chúng phối hợp mà không cần ép
- Nguy cơ gaming (khai man độ khó, đổ việc, giấu tin)
- Đã có market + commerce + consensus + credit — thêm incentive layer
- Phân bổ nguồn/task giữa các "cá nhân ích kỷ"