# Hướng AAAAAAA: Agent Commerce — agent trả phí cho dịch vụ/tool của nhau

> **Nguồn gốc:** Nevermined "AI Agent Pay-Per-Use Pricing" (real-time metering); Unframe "Token-Based Pricing Is Broken — Outcome-Based"; Ibbaka "Pricing in the Agent Economy" (pricing layer cake); MightyBot "Agent Pricing Models 2026" (per-seat/per-token/per-task/per-outcome)
> **Coupling:** 🟢 — thêm lớp thanh toán/meter, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (metering XXXXX + market AA sẵn; thiếu billing/payment)
> **Effort:** 2-3 tuần

## Nguồn gốc

Agent commerce: **agent trả phí cho agent/API/service khác — giá theo use** — Nevermined: "real-time metering enables fair, scalable monetization for AI services"; Unframe: "Token-based billing runs a meter every time a model processes a request, regardless of whether the output delivers value" — chỉ trích: token-pricing đếm input không phản ánh giá trị → outcome-based (trả theo kết quả); Ibbaka: "Agentic AI Pricing Layer Cake — pricing cho agent cân bằng phức tạp và hiệu quả"; MightyBot: "four models — per-seat, per-token, per-task, per-outcome". Điểm khác **XXXXX finops** (agent chủ quản chi phí của *mình*) và **AA market** (đấu thầu task) — AAAAAAA *thương mại giữa các agent*: meter service agent cung cấp (tool call, data, computation) → tính phí agent tiêu thụ; giá theo outcome (task xong) hơn token (Unframe); hóa đơn/budget giữa chủ sở hữu; khóa nếu quá tín dụng (XXXXX quota mở rộng cho người khác). Nối XXXXX (meter — nền), AA (market — giá động), EEEEEE (consensus — agent trả tiền để mua quyết định?), LLLLLL (tenant — hóa đơn per tenant), CCCC HITL (thanh toán thật cần người duyệt).

## Mô tả

mya commerce: (1) **meter dịch vụ** — service agent ghi metadata: task/outcome, tokens/cost, time (XXXXX meter mở rộng thêm "prov» người cung cấp"); (2) **pricing model** — chọn: per-task (có thành ra mới thu — phản ánh giá trị outcome, Unframe), per-token (đơn giản nhưng "broken" — chỉ khi khách quen), per-seat (subscription); (3) **ledger** — ghi nợ/có giữa agent (người dùng — cung cấp); (4) **hóa đơn theo tenant** — xuất theo user/tổ chức (LLLLLL), giới hạn credit (XXXXX); (5) **khóa/quota** — agent quá credit → dừng (SS gate) hoặc chuyển model rẻ; (6) **thanh toán thật** — tiền thật → CCCC HITL + KKKK (thẻ/identity), tiền ảo trong sandbox (test) → tự động.

## Kiến trúc

```
  DỊCH VỤ AGENT (tool/data/compute) ──► METER (XXXXX mở rộng: provider + outcome)
        │
        ▼
  PRICING MODEL: per-task (outcome — Unframe) > per-token (đơn giản) > per-seat
        │
        ▼
  LEDGER: nợ/có giữa agent — user (cung cấp) · người tiêu thụ
        │
        ▼
  HÓA ĐƠN THEO TENANT (LLLLLL) · CREDIT CAP (XXXXX) — quá → SS gate
        │
        ▼
  THANH TOÁN THẬT (tiền) → HITL (CCCC) + KKKK · ẢO (sandbox) → tự động
```

```
mya: XXXXX meter + AA market SẸN — thiếu: pricing + ledger + billing
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ XXXXX finops meter — metering usage (nền — thêm provider/outcome)
// ✅ AA market — đấu thầu task (nơi giá được quyết)
// ✅ SS cost gate — giới hạn chi (credit cap)
// ✅ LLLLLL tenancy — theo dõi theo tenant (hóa đơn)
// ✅ CCCC HITL + KKKK — thanh toán thật
// ✅ EEEEEE consensus — "mua" quyết định tin cậy

// ❌ THIẾU: pricing model (per-task/outcome)
// ❌ THIẾU: ledger (nợ/có giữa agent)
// ❌ THIẾU: billing theo tenant + credit
```

## Implementation

```typescript
// packages/commerce/src/ledger.ts (NEW)
export class Commerce {
  async bill(service: AgentId, consumer: AgentId, result: TaskResult) {
    const price = this.price(result);             // per-task/outcome — Unframe
    ledger.debit(consumer, price);                // consumer trả
    ledger.credit(service, price);                // service thu
    if (ledger.balance(consumer) <= 0) gate.deny(consumer); // XXXXX/SS — credit cap
  }
}
// tiền thật → HITL (CCCC) + KKKK · tiền ảo sandbox → tự động
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent trả theo giá trị (outcome) — không đếm token mù | ❌ Định giá outcome khó (task mở) |
| ✅ Metering real-time — fair + scale được (Nevermined) | ❐ Ledger/billing phức tạp giữa các chủ sở hữu |
| ✅ Quota/credit cap — không chạy quá ngân sách | ❌ Thanh toán thật — luật pháp/HITL bắt buộc |
| ✅ Xây trên XXXXX + AA | ❌ 1 người 1 agent — không có "thương mại" |

## Khác các hướng gần

| | XXXXX FinOps | AA Market | AAAAAAA: Commerce |
|---|---|---|---|
| Chi phí của | Chính agent | Đấu thầu task | **Thanh toán giữa agent** |
| Cơ chế | Meter/quota | Bid | **Pricing + ledger + billing** |
| Quan hệ | Nền metering | Nơi định giá | **Thêm thương mại lên cả 2** |

## Khi nào chọn

- Nhiều agent cung cấp dịch vụ (tool/data) — phải trả phí cho nhau
- Muốn giá phản ánh giá trị (outcome — Unframe) thay vì token
- Đã có XXXXX + AA — thêm pricing + ledger + billing
- Monetize agent service (Nevermined platform)