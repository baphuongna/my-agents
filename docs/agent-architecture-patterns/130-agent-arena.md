# Hướng AAAAAA: Agent Arena — xếp hạng năng lực agent bằng đấu trận Elo

> **Nguồn gốc:** LMArena Elo (Stanford AI Index 2026); Arena-Hard-Auto auto-benchmark; Bradley-Terry model; llm-stats.com/benchmarks 2026
> **Coupling:** 🟢 — thêm lớp đo, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval PP + tool bench JJJJJ sẵn; thiếu Elo + arena pairs)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agent Arena: **chấm agent bằng match Elo (Bradley-Terry) thay vì benchmark tĩnh** — LMArena (Stanford AI Index 2026): "Anthropic 1503, xAI 1495, Google 1494, OpenAI 1481 ... top tier Arena Elo" — con người hoặc judge chấm blind A/B, Elo cập nhật theo kết quả; Arena-Hard-Auto: "automatic evaluation benchmark"; clickrank 2026: "use over 1 million blind A/B comparisons ... GPT-5 highest Arena Elo 1561". Điểm khác **PP eval** (rubric chấm tuyệt đối vs ground truth) — AAAAAA *chấm tương đối*: 2 agent cùng giải 1 task, judge (NLG-graded — JJJJJ) chọn agent nào tốt hơn → Elo cập nhật → ranking thích nghi theo dữ liệu mới, bắt được "nháy" mà rubric cố định bỏ sót. Nối PP (benchmark pool), JJJJJ (tool-call judge), SSS (drift grading), GGGG (process reward — chấm từng bước trong match).

## Mô tả

mya arena loop: (1) **task pool** — task thật/tổng hợp (PP golden + task từ production log); (2) **match** — 2 agent (2 config/2 model) cùng xử lý 1 task, kết quả ẩn danh; (3) **judge** — LLM-as-judge (PP) hoặc con người chấm "cái nào tốt hơn" (preference); (4) **Elo update** — Bradley-Terry: win → +Δ, lose → −Δ, Δ theo expected score; (5) **ranking** — bảng Elo mỗi config agent — dùng để: chọn config mặc định, phát hiện hồi quy (config mới tụt Elo), so model cascade HHH; (6) **an toàn** — judge phải chống bias: ẩn tên model, order ngẫu nhiên, dùng judge-a-lot (nhiều judge) — court-style (KIEE rumble / LMFlow sebagai).

## Kiến trúc

```
  TASK POOL (PP golden + production) ──► MATCH: AgentA vs AgentB (blind)
        │                                    │
        ▼                                    ▼
  JUDGE (LLM Judge JJJJJ / human preference) ──► WIN ∈ {A, B}
        │                                    │
        ▼                                    ▼
  ELO UPDATE (Bradley-Terry) ──► RANKING per config
        │                                    │
        ▼ (hồi quy? config mới tụt Elo?)
  DÙNG: chọn config mặc định · phát hiện hồi quy · so cascade HHH
```

```
mya: PP eval + JJJJJ judge SẸN — thiếu: Elo rating + arena match scheduler
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PP eval — golden scenarios + drift grading (nguồn task pool)
// ✅ JJJJJ tool bench — LLM judge chấm tool call (dùng làm judge)
// ✅ SSS drift — theo dõi chất lượng theo thời gian
// ✅ HHH cascade — nhiều config để so sánh

// ❌ THIẾU: Elo rating (Bradley-Terry update)
// ❌ THIẾU: arena scheduler (match 2 config ngẫu nhiên, blind)
// ❌ THIẾU: bias guard (ẩn model name, order random, judge-a-lot)
```

## Implementation

```typescript
// packages/eval/src/arena.ts (NEW)
const K = 32;
export function eloUpdate(a: number, b: number, winA: boolean) {
  const eA = 1 / (1 + 10 ** ((b - a) / 400));   // Bradley-Terry expected
  return {
    a: a + K * ((winA ? 1 : 0) - eA),
    b: b + K * ((winA ? 0 : 1) - (1 - eA)),
  };
}
// judge: blind (ẩn model name + order ngẫu nhiên) — JJJJJ
// pool: PP golden + task production log → match (K cặp / round)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Xếp hạng tương đối thích nghi — bắt "nháy" | ❌ Tốn nhiều judge calls (mỗi match 1 judge) |
| ✅ Không cần ground truth tuyệt đối (task mở) | ❐ Elo nhiễu nếu judge bias/không nhất quán |
| ✅ Phát hiện hồi quy bằng thứ hạng, dễ hiểu | ❌ Cần đủ match để Elo hội tụ |
| ✅ Kết hợp PP (tuyệt đối) + arena (tương đối) | ❌ So ranking nội bộ — không so được ngoài |

## Khác các hướng gần

| | PP Eval | JJJJJ Tool-Bench | AAAAAA: Arena |
|---|---|---|---|
| Cách chấm | Rubric vs truth | Selection/schema | **Preference A/B (Elo)** |
| Đơn vị | Điểm tuyệt đối | % đúng | **Elo tương đối** |
| Dùng cho | Gate merge | Chọn tool | **Xếp hạng config/model** |

## Khi nào chọn

- Output mở, khó viết rubric tuyệt đối — dùng preference so sánh
- Nhiều config/model cần so — ranking thay vì chấm từng cái
- Muốn phát hiện hồi quy bằng thứ hạng (dễ thuyết phục)
- Đã có PP + JJJJJ — thêm Elo scheduler + bias guard