# Hướng DY: Shadow Deployment — chạy agent song song, so sánh trước khi áp dụng

> **Nguồn gốc:** Agentic Digital Twins (Ivanov 2026, Int. J. Prod. Research — A-SCDT); Materialize "Digital Twin for AI Agents" 2026; XMPro 2026; AWS Agentic AI + Digital Twins blog 2026
> **Coupling:** 🟡 — cần mirror môi trường + hook so sánh kết quả
> **Agent-agnostic:** ⚠️ — cần capture + replay input (pi/RPC)
> **Code sẵn:** ⚠️ (trajectory replay SSSS + eval PP sẵn; thiếu mirror + comparator)
> **Effort:** 2-3 tuần

## Nguồn gốc

Agentic digital twin (Ivanov 2026): **mô hình song song phản ánh agent thật, chạy simulation trước khi quyết định thật** — "bridging model-based and AI-driven approaches"; Materialize: "a closed environment where you can run thousands of scenarios, edge cases, and failure modes"; XMPro: "modeling the consequences of potential actions before execution". Điểm khác **SSSS replay** (chạy lại quá khứ) — ZZZZZ *chạy song song hiện tại*: mỗi quyết định được agent-thật thực thi, agent-shadow nhận cùng input nhưng kết quả KHÔNG áp dụng — comparator đo lệch (giống canary cho agent). Nối SSSS (cơ chế capture), PP (đánh giá), YYYY (đo lệch), WWW (BDI — chọn hành động trong shadow trước).

## Mô tả

mya shadow loop: (1) **capture** — mỗi turn: input, context, tool results (dùng cơ chế SSSS replay); (2) **mirror** — agent-shadow (có thể model khác/prompt khác/config khác) chạy trên cùng input, kết quả ghi shadow-log KHÔNG thực thi; (3) **comparator** — so sánh hành động/chi phí/kết quả shadow vs thật (YYYY: lệch vượt ngưỡng → cảnh báo); (4) **promote** — shadow thắng ổn định (N lần) → trở thành production config; (5) **an toàn** — shadow không bao giờ có quyền thực thi (policy UUUU), chỉ đọc; (6) **dùng khi** — nâng cấp model/prompt/config mới, test rủi ro thay đổi mà không rollback.

## Kiến trúc

```
  INPUT THẬT ──► AGENT PRODUCTION ──► HÀNH ĐỘNG (thực thi)
        │                ▲
        └──► AGENT SHADOW ──► shadow-log (KHÔNG thực thi — read-only)
                 │
        COMPARATOR (YYYY) — lệch > ngưỡng → cảnh báo
                 │
        PROMOTE — shadow thắng N lần ổn định → lên production
```

```
mya: SSSS capture + PP eval SẸN — thiếu: mirror runner + comparator + promote gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ SSSS replay — capture trajectory (dùng cho mirror input)
// ✅ PP eval — đo kết quả (so sánh shadow vs thật)
// ✅ UUUU dynamic perms — shadow chỉ read-only
// ✅ model cascade HHH — có model khác để chạy shadow

// ❌ THIẾU: shadow runner (chạy song song không thực thi)
// ❌ THIẾU: comparator (đo lệch + ngưỡng)
// ❌ THIẾU: promote gate (quyết định khi nào shadow lên production)
```

## Implementation

```typescript
// packages/shadow/src/shadow.ts (NEW)
export class ShadowRunner {
  constructor(
    private prod: AgentHandle,
    private shadow: AgentHandle,  // config khác — model/prompt
    private cmp: Comparator,      // YYYY — đo lệch
  ) {}

  async runTurn(input: TurnInput): Promise<void> {
    const real = await this.prod.execute(input);
    const alt = await this.shadow.execute(input); // READ-ONLY — không thực thi
    const diff = this.cmp.compare(real, alt);     // hành động/cost/kết quả
    if (diff.exceedsThreshold()) this.alerts.emit("shadow-drift", diff);
    if (this.wins(alt)) this.promote(alt.config); // thắng N lần ổn định
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Test config mới không rủi ro rollback | ❌ Tốn 2x token (shadow chạy song song) |
| ✅ Phát hiện sớm config xấu (trước khi phổ biến) | ❐ Cần capture input đầy đủ (SSSS) |
| ✅ Quyết định promote bằng dữ liệu, không cảm tính | ❌ Comparator khó viết cho output mở |
| ✅ An toàn — shadow read-only (UUUU) | ❌ Nhiều config — nhiều shadow — cost nhân lên |

## Khác các hướng gần

| | SSSS Replay | XX Canary/Honeypot | ZZZZZ: Shadow |
|---|---|---|---|
| Thời gian | Quá khứ | Hiện tại (bẫy) | **Hiện tại (song song)** |
| Mục đích | Tái chạy lỗi | Phát hiện thao túng | **So sánh config trước khi đổi** |
| Kết quả shadow | Không có | Phát hiện | **Không thực thi + promote** |

## Khi nào chọn

- Nâng cấp model/prompt nhưng sợ hồi quy — test song song trước
- Muốn đổi config dựa trên dữ liệu (không cảm tính)
- Đã có SSSS + PP — thêm mirror + comparator
- Rủi ro thay đổi cao (finops XXXXX, sai tool tốn tiền)
