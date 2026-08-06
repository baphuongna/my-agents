# Hướng EEEEEE: Multi-Agent Consensus — nhiều agent bàn bạc, quyết định theo giao thức

> **Nguồn gốc:** Kaesberg "Voting or Consensus? Decision-Making in Multi-Agent" (ACL Findings 2025, 67 cites); Lee "Reliable Decision-Making for Multi-Agent LLM Systems" (MultiAgents 2025, 12 cites); Zylos "Consensus Protocols for Multi-Agent Decision Making" 2026
> **Coupling:** 🟢 — lớp quyết định mới, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (MoA DDD + negotiation + eval PP sẵn; thiếu voting engine)
> **Effort:** 1-2 tuần

## Nguồn gốc

Multi-agent consensus: **nhiều agent độc lập đưa lời giải, quyết định cuối theo giao thức bỏ phiếu/đồng thuận** — Kaesberg 2025: 7 giao thức — majority (50%), supermajority (66%), unanimity (100%)... "voting protocols improve performance by 13.2% in reasoning tasks, consensus protocols by 2.8% in knowledge tasks"; Lee 2025: "Majority Voting: multiple agents independently generate responses, final response by majority vote"; Zylos 2026: "multi-agent LLM systems face a distinct problem where agents actively revise solutions based on reasoning from peers — simple majority không đủ". Điểm khác **DDD MoA** (gộp lời giải bằng aggregator LLM) và **OOO negotiation** (thỏa thuận 2 bên có lợi ích) — EEEEEE *bỏ phiếu/đồng thuận theo giao thức định sẵn*: chọn theo loại task — reasoning → majority vote (rẻ, 13% cải thiện); knowledge → consensus; rủi ro cao → supermajority/unanimity; agent có confidence signal (đi kèm độ tự tin) + trọng số theo năng lực (Arena AAAAAA rating). Nối DDD (tạo đa lời giải), AAAAAA (trọng số Elo), GGGG (process reward — chấm từng đề xuất), PP (đánh giá).

## Mô tả

mya consensus flow: (1) **chọn giao thức theo task** — reasoning/creative → majority vote; knowledge/correct-answer → consensus (agents xem lời giải nhau rồi sửa); rủi ro cao (quyết định đắt) → supermajority/unanimity + confidence; (2) **đa lời giải** — spawn N agents độc lập (KK mapreduce / DDD) cùng task, input khác khởi điểm; (3) **vote/đồng thuận** — majority: đếm phiếu đơn thuần; consensus: các vòng trình bày + sửa (giới hạn vòng — PPPP) rồi vote lại; (4) **trọng số** — phiếu nhân trọng số năng lực (Arena Elo), confidence tự khai báo (đối chiếu calibration); (5) **kết luận** — chọn phương án thắng, kèm số phiếu/độ phân tán (độ tự tin tổng); phân tán cao mà vẫn phải chọn → escalate người (CCCCCC); (6) **chi phí** — N× token cho 1 quyết định — chỉ dùng quyết định quan trọng (SS gate + XXXXX).

## Kiến trúc

```
  TASK (quan trọng? chọn giao thức)
     │
     ▼
  SPAWN N AGENTS ĐỘC LẬP (KK/DDD — cùng task, khác khởi điểm)
     │
     ▼
  GIAO THỨC:
   reasoning   → MAJORITY vote (đếm phiếu — 13.2% cải thiện, Kaesberg)
   knowledge   → CONSENSUS (trình bày → sửa → vote lại, giới hạn vòng)
   rủi ro cao  → SUPERMAJORITY/unanimity + confidence
     │
     ▼
  TRỌNG SỐ (Arena Elo) × CONFIDENCE (calibrated)
     │
     ▼
  KẾT LUẬN + độ phân tán → phân tán cao → escalate người (CCCCCC)
```

```
mya: DDD + PP SẸN — thiếu: voting engine + confidence + weighted protocol
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ DDD MoA — đa lời giải (nguồn phiếu bầu)
// ✅ KK mapreduce — spawn song song (sinh N agents độc lập)
// ✅ AAAAAA arena — Elo rating (trọng số phiếu)
// ✅ PP eval — đánh giá phương án (calibrate confidence)
// ✅ SS cost gate — trần chi phí (N× token)

// ❌ THIẾU: voting engine (majority/supermajority/unanimity)
// ❌ THIẾU: consensus rounds (trình bày → sửa → vote lại)
// ❌ THIẾU: confidence calibration + weighted vote
```

## Implementation

```typescript
// packages/consensus/src/vote.ts (NEW)
export function decide(protocol: Protocol, votes: Vote[], weights: Map<AgentId, number>) {
  switch (protocol) {
    case "majority": return majority(votes);                       // 50%
    case "supermajority": return supermajority(votes);             // 66% (Kaesberg)
    case "unanimity": return unanimity(votes);                     // 100%
  }
}
// reasoning → majority (13.2% cải thiện — Kaesberg 2025)
// knowledge → consensus rounds (trình bày → sửa → vote lại, giới hạn PPPP)
// phiếu × Elo (AAAAAA) × confidence (calibrated bằng PP)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Quyết định đáng tin hơn 1 agent (vote giảm lỗi) | ❌ Tốn N× token cho 1 quyết định (SS+XXXXX) |
| ✅ Có độ tự tin/độ phân tán — biết khi nào không chắc | ❐ Nhiễu nếu agents không thực sự độc lập |
| ✅ Giao thức theo task (13.2% reasoning / 2.8% knowledge) | ❌ Latency — chờ N agents xong |
| ✅ Weighted (Elo) + confidence — không đếm phiếu phẳng | ❌ Consensus nhiều vòng — tốn thêm (giới hạn PPPP) |

## Khác các hướng gần

| | DDD MoA | OOO Negotiation | EEEEEE: Consensus |
|---|---|---|---|
| Mục đích | Gộp lời giải | Thỏa thuận lợi ích | **Quyết định theo giao thức** |
| Cơ chế | Aggregator LLM | Đàm phán 2 chiều | **Vote/đồng thuận định sẵn** |
| Kết quả | 1 lời giải tổng | Thỏa thuận | **Phương án + độ tin cậy** |

## Khi nào chọn

- Quyết định quan trọng — cần giảm lỗi 1-agent (vote)
- Có sẵn đa agent (spawn rẻ) — đổi token lấy độ tin cậy
- Reasoning task → majority; knowledge → consensus (Kaesberg)
- Đã có DDD + KK + AAAAAA — thêm voting engine + confidence