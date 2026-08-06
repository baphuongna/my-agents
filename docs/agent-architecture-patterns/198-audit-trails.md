# Hướng QQQQQQQQ: Audit Trails & Traceability — mọi hành động agent có vết không thể sửa, tái dựng được

> **Nguồn gốc:** Collibra (audit trail = chronological traceable record — inputs, decisions, outputs, actions, data); ArmoSec "Minimum Viable Audit Trail" (security team cần audit 72h sau agent làm chuyện lạ); EU AI Act Art 12 (tamper-proof chronological record — immutable storage); loginradius (audit = who/what/why — khác log kỹ thuật); IETF draft-agent-audit-trail (standard logging format)
> **Coupling:** 🟡 — mọi hành động/decision phải ghi qua layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (VV audit + QQQQ trace sẵn; thiếu tamper-proof)
> **Effort:** 2-4 tuần

## Nguồn gốc

Audit trail: **bản ghi chronological + tamper-proof: ai, làm gì, vì sao, dùng dữ liệu nào — dựng lại được toàn bộ quyết định** — Collibra: "chronological, traceable record of what an AI system did and why — inputs, decisions, outputs, actions, data"; ArmoSec: "The first time a security team needs an audit trail is usually 72 hours after the agent has already done something it shouldn't have" (đã muộn — cần từ đầu); EU AI Act Art 12: "tamper-proof chronological record of every tool call, policy decision, and agent action — requires immutable storage"; loginrad: "a log records technical events (errors, latency), an audit trail records the who, what, and why of decision-making". Điểm khác **VV audit log** (ghi log kỹ thuật — đã có) và **QQQQ trace** (theo dõi execution) — QQQQQQQQ *bản ghi pháp lý*: (1) decision trace — ghi "ai/quyết định gì/vì sao" (streamkap — decision traces); (2) tamper-proof — immutable storage (append-only, hash chain, hàng băm chống sửa — supra-wall cho EU AI Act); (3) chuẩn AAT — format log chuẩn (IETF draft — chuẩn hóa); (4) đủ chi tiết — tool call, policy decision, action, dữ liệu liên quan (EU Art 24), citations (agentman — citations + access controls); (5) audit query — tra lại dễ: action của agent nào, chuỗi quyết định nào (ArsoSec), đầy đủ spec tái dựng (Collibra); (6) compliance — EU AI Act Art 24 (hệ thống dùng cao), SOX/GDPR audit. Nối VV (log kỹ thuật nền), QQQQ (trace — execution span), 194 (RAG cite), MMMMMMM (guardrail — sự kiện chặn cũng vào audit), 195 (decision log), IIIIIII (supply chain — audit source), PPPPPPP (quyết định trace cho mainstream reproduce), LLLLLLLL (per tenant audit).

## Kiến trúc

```
  HÀNH ĐỘNG/RUYẾT ĐỊNH (tool call · policy · action · data)
        │
        ▼
  DECISION TRACE (streamkap — who/what/why, replayi được)
        │
        ├── LOG KỸ THUẬT (VV — errors/latency — khác audit)
        ├── AUDIT IMMUTABLE (immutable ledger — supra EU AI Act)
        │     hash chain · append-only · chống sửa
        └── FORMAT CHUẨN (IETF draft — AAT)
        │
        ▼
  QUERY AUDIT: theo taskID/agent (ArmoSec 72h — tìm nhanh)
   · tái dựng toàn bộ (Collibra) · compliance (EU AI Act Art 12)
```

```
mya: VV + QQQQ SẴN — thiếu: immutable + decision trace + chuẩn
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ VV audit log — ghi bản ghi kỹ thuật (nền)
// ✅ QQQQ trace — execution trace (nền)
// ✅ LLLLLLLL — per-action context (rủi ro)
// ✅ TTTT explanation + citations (agentman — decision reasoning)
// ✅ MMMMMMMM guardrails — sự kiện cũng audit được
// ✅ 155 right-to-be-forgotten — policy xóa (đương đầu với immutable!)

// ❌ THIẾU: immutable storage (hash chain — immutability)
// ❌ THIẾU: decision trace (who/what/why riêng — không chỉ log kỹ thuật)
// ❌ THIẾU: AAT format chuẩn (IETF)
// ❌ THIẾU: query/replay cho auditor (helium — biết chừng nào)
```

## Implementation

```typescript
// packages/audit/src/trail.ts (NEW)
export class AuditTrail {
  record(e: Event): void {
    const entry = { ...e, ts: now(), hash: hashChain(prev) }; // immutable (supra)
    storage.append(entry);   // append-only — EU AI Act Art 12
  }
  query(taskId: string): DecisionTrace {   // ArmoSec — tìm lại task nào
    return rebuild(chain, taskId);          // streamkap — ai/quyết gì/vì sao
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tuân thủ pháp lý — EU AI Act Art 24, GDPR (immutable) | ❌ Lưu trữ thêm — chi phí/khối lượng lớn |
| ✅ Điều tra được 72h trước — tái dựng được (Armo) | ❐ Đầy đủ dữ liệu phải ghi ngay — thiếu sót là mù truy vết |
| ✅ Quyết định dễ kiểm — auditor không cần dùng AI | ❌ Immutable ≈ không xóa — mâu thuẫn quyền quên (155) |
| ✅ Xây trên VV + QQQQ + TTTT | ❌ Chuẩn còn non — IETF draft; hệ 2026 đổi |

## Khác các hướng gần

| | VV Audit | QQQQ Trace | QQQQQQQ String: Audit Trail |
|---|---|---|---|
| Mức | Log kỹ thuật | Execution | **Pháp lý + tái sự** |
| Đặc tính | Error/latency | Steps | **Immutable + who/what/why** |
| Quan hệ | Nền | Nền | **Bản chống sửa — tra cứu lại** |

## Khi nào chọn

- Vùng pháp lý bắt (EU AI Act Art. 12) — cần audit hợp lệ
- Agent làm việc quan trọng — cần khiếu kiện khi lỗi (Armo notice)
- Điều 73/CS: cần tra lại chuỗi quyết định (streamkap)
- Đã có VV + QQQQ — thêm immutable + decision trace + IETF format