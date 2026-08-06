# Hướng DS: Explainable Actions — agent minh bạch lý do từng hành động

> **Nguồn gốc:** "Towards Responsible and Explainable AI Agents" (arXiv 2512.21699); loginradius/token.security 2026
> **Coupling:** 🟢 — tầng xuất, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit/trace sẵn; thiếu rationale layer)
> **Effort:** 1 tuần

## Nguồn gốc

Explainable agent: **mỗi hành động (tool call, quyết định, delegation) có lý do minh bạch, traceable** — loginradius 2026: "transparent, traceable reasoning for its decisions, actions, and delegated work"; token.security 2026: "agentic AI must be explainable to be trustworthy — techniques for transparent, auditable, aligned decisions"; arXiv 2512.21699: consortium candidates + explainability; gloat: "making agent's internal reasoning visible, interpretable, auditable". Ba mục đích: (1) **trust user** — hiểu vì sao làm thế (2) **audit** — EU AI Act / compliance (seekr 2026) (3) **debug** — lỗi tìm đúng bước. Khác **VV audit** (sự kiện thô: ai làm gì khi nào) — TTTTT *giải thích* (tại sao: reasoning + rationale ngôn ngữ tự nhiên gắn bước); khác **CCCC context engineering** (nhập context) — TTTTT *xuất giải thích*. Nối FFFFF interview (agent tự nói tại sao) — TTTTT làm *thường xuyên* (mỗi action) thay vì chỉ cuối task.

## Mô tả

mya explainability layer: (1) **rationale per action** — mỗi tool call/decision ghi: `reason` (mục tiêu phục vụ), `evidence` (context nào dẫn tới), `alternatives` (đã cân nhắc gì — token.security "aligned decisions") — gắn vào trace (QQQQ) không thêm token cho prompt chính (sinh sau — model rẻ PPPP); (2) **plan explanation** — khi lập kế hoạch (AAAAA): giải thích cấu trúc (vì sao nhánh này trước); (3) **xem** — CLI/TUI: `why <action>` truy vấn rationale + evidence (print); (4) **audit** — rationale + trace = chuỗi quyết định hoàn chỉnh (VV nối); (5) **chống** — rationale bịa (agent giải thích khác thực tế — hallucination) → đối chiếu: rationale ↔ trace thật (YYYY-style — đỏ) + khi mâu thuẫn → cảnh báo.

## Kiến trúc

```
  ACTION (tool call · quyết định · delegation)
        │
        ▼
  RATIONALE (sinh sau — model rẻ PPPP — không tốn prompt chính)
    reason (mục tiêu) · evidence (context dẫn tới) · alternatives (đã cân nhắc)
        │  gắn trace (QQQQ) — không làm prompt nặng
        ▼
  XEM: CLI/TUI `why <action>` (print — traceable)
  AUDIT: rationale + trace = chuỗi quyết định (VV · EU AI Act)
  CHỐNG BỊA: rationale ↔ trace thật đối chiếu (YYYY) — mâu thuẫn → cảnh báo
```

```
mya: audit + trace + print SẸN — thiếu: rationale layer + `why` query
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace — bước hành động (nơi gắn rationale)
// ✅ VV audit — chuỗi sự kiện (nối thành chuỗi quyết định)
// ✅ print CLI — `why <action>` (thêm command)
// ✅ FFFFF interview — tự giải thích cuối task (nền)
// ✅ PPPP local — sinh rationale rẻ (không tốn prompt chính)
// ✅ YYYY anti-hack — đối chiếu rationale ↔ trace thật

// ❌ THIẾU: rationale layer (reason/evidence/alternatives)
// ❌ THIẾU: `why` query (print)
// ❌ THIẾU: consistency check (rationale bịa — YYYY mở rộng)
```

## Implementation

```typescript
// packages/explain/src/rationale.ts (NEW)
interface Rationale {
  actionId: string; reason: string; evidence: TraceRef[];
  alternatives: string[];       // token.security: aligned decisions
}

function explain(action: TraceStep, ctx: TraceContext): Rationale {
  // sinh SAU action — model rẻ (PPPP) — không làm prompt chính nặng
  return {
    actionId: action.id,
    reason: goalOf(action, ctx),            // phục vụ mục tiêu nào
    evidence: ctx.refs(action),             // context dẫn tới (QQQQ)
    alternatives: considered(action, ctx),  // đã cân nhắc gì
  };
}
// CLI: `why <action>` → print rationale + evidence (trust)
// audit: rationale + trace = chuỗi quyết định hoàn chỉnh (VV)
// chống bịa: rationale ↔ trace đối chiếu (YYYY) — mâu thuẫn → flag
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tin cậy: user hiểu vì sao (loginradius) | ❌ Sinh rationale thêm calls (PPPP rẻ) |
| ✅ Audit/compliance (EU AI Act — seekr) | ❐ Rationale có thể bịa (consistency check) |
| ✅ Debug nhanh hơn (biết bước sai + lý do) | ❌ `why` query cần UI (print) |
| ✅ Không tốn token prompt chính (sinh sau) | ❌ Không phải action nào cũng cần chi tiết |

## Khác các hướng gần

| | VV Audit | GGGG Judge | TTTTT: Explain |
|---|---|---|---|
| Nội dung | Sự kiện thô | Điểm đánh giá | **Lý do hành động** |
| Mục đích | Truy vết | Chấm | **Tin tưởng + audit + debug** |
| Mối quan hệ | Nền sự kiện | Bổ sung | **Giải thích trên trace** |

## Khi nào chọn

- User/audit cần hiểu "tại sao agent làm vậy"
- Task nhiều quyết định quan trọng (hợp đồng, xóa, sửa)
- Đã có trace + audit + print — thêm rationale layer
- Chấp nhận consistency check (YYYY) chống bịa