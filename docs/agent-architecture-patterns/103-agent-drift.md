# Hướng ZZZZ: Agent Drift — bắt chất lượng agent suy giảm âm thầm theo thời gian

> **Nguồn gốc:** "Agent Drift: Measuring Performance Degradation" (2026); galileo output drift monitoring; golden-task regression (2026)
> **Coupling:** 🟢 — tầng giám sát, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval + trace sẵn; thiếu drift detector)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agent drift: **chất lượng agent giảm âm thầm theo thời gian** — model provider đổi (upgrade/điều chỉnh), prompt bị trôi, data phân phối đổi, tool schema đổi (TTTT) → output lệch nhưng không ai biết vì không có verify liên tục (medium 2026 "Agent Drift" paper; galileo 2026 "output drift monitoring"; getmaxim "AI agent drift degrades over time through model updates, data distribution changes, prompt variations"). GP đỏ: IBM "accuracy can degrade within days of deployment". Kỹ thuật chính: **golden-task regression** — giữ 20-100 input đại diện, chạy định kỳ/trước model/prompt changes, score bằng fixed rubric (reddit LangChain 2026 + QQQQ/SSSS). Khác **QQQQ replay** (chạy khi debug cá nhân) — drift là *chạy định kỳ tự động* trên golden set; khác **JJJ observability** (metrics real-time — latency/token) — drift đo *chất lượng output* theo thời gian.

## Mô tả

mya drift detector (nightly — cron sẵn): (1) **golden set** — 20-100 task đại diện (NNNN synth + QQQQ golden thật) — phủ capabilities chính; (2) **luồng chạy định kỳ** (cron-sweep) — chạy golden qua agent (stub UUUU, model thật hoặc rẻ PPPP) → GGGG judge + expected → điểm; (3) **baseline** — điểm ngày đầu làm chuẩn; (4) **detect** — điểm trượt ±ngưỡng → alert triage (CCC): nghi model provider đổi (MM, registry — nối 52) / prompt đổi / tool đổi → tự trigger SSSS gate + QQQQ replay chi tiết; (5) **trend** — ghi timeline (JJJ) → đảo chiều khi sửa. Nối TTTT (đổi schema = nguồn drift) + VV audit (thay đổi gần đây tìm nguyên nhân).

## Kiến trúc

```
  GOLDEN SET (20-100 task đại diện — NNNN synth + QQQQ golden thật)
        │  nightly (cron-sweep sẵn)
        ▼
  RUN qua agent (stub UUUU · model real/rẻ PPPP) ──► GGGG judge + expected
        │
        ▼
  ĐIỂM ──► so basline ngày đầu
        ├─ ≥ ngưỡng ──► OK (ghi trend JJJ)
        └─ trượt ──► ALERT triage (CCC)
               ├─ nghi model đổi (52 registry) · prompt đổi · tool đổi (TTTT)
               ├─ SSSS gate + QQQQ replay chi tiết
               └─ VV audit: thay đổi gần đây → nguyên nhân
```

```
mya: cron + eval + trace SẴN — thiếu golden set + detect δ + alert
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ gateway/cron-sweep + packages/cron — nightly runner (nền)
// ✅ packages/eval + 53 — golden runner (PP)
// ✅ NNNN + QQQQ — golden set (synth + trace thật)
// ✅ GGGG judge — chấm (rubric ổn định)
// ✅ UUUU stub — chạy không side-effect
// ✅ VVV audit + 52 registry — tìm nguyên nhân (model/prompt đổi)
// ✅ TTTT drift schema — nguồn drift tiềm năng

// ❌ THIẾU: golden set chuẩn (20-100 per capability)
// ❌ THIẾU: baseline + threshold detect
// ❌ THIẾU: alert → triage + trend timeline
```

## Implementation

```typescript
// packages/eval/src/drift.ts (NEW)
interface DriftDetector { baseline: Record<Capability, number>; threshold: number; }

function detect(d: DriftDetector, run: GoldenRun): DriftReport {
  const delta = mapDiff(run.scores, d.baseline);
  const dropped = delta.filter((cap) => cap.d < -d.threshold);
  return dropped.length
    ? { alert: true, caps: dropped, trend: run.trend }   // → triage (CCC)
    : { alert: false, trend: run.trend };               // → ghi timeline (JJJ)
}
// nguyên nhân: 52 registry (model đổi) · TTTT (tool đổi) · VV (prompt/spec)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt suy giảm âm thầm (model/prompt/data/tool) | ❌ Golden set phải duy trì (per capability) |
| ✅ Golden regression là chuẩn công nghiệp 2026 | ❐ Chi phí nightly (PPPP local + stub giảm) |
| ✅ Trơ trigger SSSS/QQQQ khi trượt | ❌ Threshold đỏ lẫn nhiễu (run n seeds) |
| ✅ Trend timeline — thấy drift sớm | ❌ Nếu model provider đổi nhanh — trễ 1 đêm |
| ✅ Nối toàn bộ stack eval/trace/audit | |

## Khác các hướng gần

| | QQQQ Replay | JJJ Observability | ZZZZ: Drift |
|---|---|---|---|
| Chạy khi | Debug cá nhân | Real-time | **Định kỳ tự động** |
| Đo gì | Diff theo version | Metrics | **Chất lượng output theo t** |
| Mối quan hệ | Khi drift nghi | Cung cấp trend | **Điều phối golden** |

## Khi nào chọn

- Agent chạy production lâu ngày (model provider hay đổi)
- Đã có cron + eval + golden (NNNN/QQQQ) — thêm detector
- Muốn phát hiện trước khi user kêu
- Golden set phủ đủ capability (20-100)