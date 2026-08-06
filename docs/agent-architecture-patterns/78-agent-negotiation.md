# Hướng BZ: Multi-Agent Negotiation — đàm phán hai chiều giữa agents

> **Nguồn gốc:** AgenticPay (arXiv 2602.06008, 2026); ACM 2026 bilateral negotiation; game theory → Diplomacy
> **Coupling:** 🟡 — 2 phía đối thoại, cần protocol chung
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (intercom sẵn; thiếu protocol + scoring)
> **Effort:** 2 tuần

## Nguồn gốc

Multi-agent negotiation: hai (hoặc nhiều) agent **đối thoại trao đổi** — offer/counter-offer, thuyết phục, nhượng bộ, cam kết — tới thỏa thuận (agreement) hoặc rút lui (impasse). Nghiên cứu 2025-2026: AgenticPay (arXiv 2602.06008) — benchmark mô phỏng buyer–seller negotiation bằng ngôn ngữ tự nhiên; ACM 2026 — LLM đàm phán **thận trọng, chấp nhận hầu hết đề nghị** (điểm yếu cần protocol); game theory → Diplomacy: negotiation là cốt lõi của hợp tác phức tạp. Khác **24 Market Auction** (đấu giá qua giá tập trung — clearing mechanism) — negotiation là **trao đổi trực tiếp** (lời lẽ, quyền lợi, cam kết); khác **CCC Handoff** (1 chiều chuyển quyền) — negotiation là *hai chiều* tìm đồng thuận.

## Mô tả

mya dùng khi 2 agent xung đột tài nguyên/mục tiêu (agent A muốn giữ session model xịn, agent B cần nó; 2 task cạnh tranh kanban slot): mở **negotiation channel** (intercom sẵn) với protocol — mỗi bên gửi offer có cấu trúc `{ demand, concession, deadline }` → vòng đối thoại giới hạn (SS budget) → agreement: ghi vào ledger (K) thành cam kết ràng buộc; impasse → **escalate** (UU) hoặc arbitration (agent 3 trọng tài / council). Fairness đo được (MDPI 2026). Bắt buộc **scoring + deadline** — nếu không LLM chấp nhận mọi offer (ACM 2026) hoặc đàm phán vô hạn.

## Kiến trúc

```
  AGENT A ◄──negotiation channel (intercom)──► AGENT B
  (offer: {demand, concession, deadline})
      │  vòng giới hạn (SS: max rounds)
      │
      ├── AGREEMENT ──► ghi cam kết vào ledger (K) — ràng buộc cả hai
      │                    ──► thực thi (kanban / task store)
      │
      └── IMPASSE ──► arbitrator (agent 3 / council) hoặc escalate (UU)
                          │ quyết định cuối, ghi ledger
```

```
mya: packages/intercom (channel sẵn) + kanban (tài nguyên tranh chấp) + ledger (K) sẵn
     thiếu: negotiation protocol (offer format, rounds, deadline) + scoring fairness
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom — kênh hai chiều (transport đàm phán)
// ✅ packages/tools/src/kanban-sqlite.ts — tài nguyên tranh chấp (task/slot)
// ✅ AuditLog (K) — ghi cam kết sau agreement
// ✅ SS rate-limiter — chặn số vòng đàm phán
// ✅ council (JJ) — arbitrator sẵn

// ❌ THIẾU: offer format + protocol (rounds, deadline, concession rules)
// ❌ THIẾU: scoring fairness (ai lợi/thiệt — MDPI 2026)
// ❌ THIẾU: cam kết ràng buộc (agreement → ledger enforced, không mặc cả lại)
```

## Implementation

```typescript
// packages/intercom/src/negotiate.ts (NEW)
interface Offer {
  id: string;
  demands: string[];          // muốn gì
  concessions: string[];      // trả gì
  deadline: number;           // vòng tối đa (SS)
}

async function negotiate(a: AgentId, b: AgentId, issue: string, rounds: number) {
  const chan = await intercom.open(a, b);
  for (let r = 0; r < rounds; r++) {
    const offer = await chan.request(r === 0 ? null : lastOffer);  // đối thoại
    const eval = scoreFairness(offer);                              // scoring
    if (eval.accept) { await ledger.append({ kind: "agreement", a, b, terms }); return ok; }
    if (r === rounds - 1) return impasse;                           // → UU/council
  }
}
// ACM 2026 cảnh báo: LLM nhượng bộ quá dễ → protocol phải ép concession nhỏ
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giải xung đột tài nguyên không cần con người | ❌ LLM nhượng bộ dễ — fairness kém nếu không scoring (ACM 2026) |
| ✅ Cam kết ghi ledger — ràng buộc thực thi | ❌ Đàm phán vô hạn nếu thiếu deadline (SS) |
| ✅ Intercom + kanban + ledger sẵn — thêm protocol | ❌ Impasse cần arbitrator (thêm hop) |
| ✅ Đo fairness được (MDPI 2026) | ❌ 2 agent cùng phe có thể "thông đồng" (cần rules) |
| ✅ Nguồn 2026 mạnh (AgenticPay benchmark) | |

## Khác các hướng gần

| | 24 Market Auction | CCC Handoff | AAAA: Negotiation |
|---|---|---|---|
| Cơ chế | Giá tập trung (clearing) | Chuyển quyền 1 chiều | **Trao đổi hai chiều** |
| Kết quả | Giá thắng | Quyền điều khiển | **Thỏa thuận + cam kết** |
| Fairness | Qua giá | Không liên quan | Đo được (scoring) |
| Transport | Order book | Handoff msg | Intercom channel |

## Khi nào chọn

- 2 agent xung đột tài nguyên/mục tiêu (model slot, kanban task, session)
- Muốn cam kết ràng buộc ghi ledger (audit, không mặc cả lại)
- Đã có intercom + kanban + council — thêm protocol + scoring
- Chấp nhận complexity khi xung đột hiếm (đơn giản thì UU đủ)