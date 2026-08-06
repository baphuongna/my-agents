# Hướng EX: Non-Stationary Adaptation — agent phát hiện môi trường đổi, cập nhật tri thức

> **Nguồn gốc:** arXiv 2505.17902 "Evolving ML in Non-Stationary Environments" (Data Drift / Concept Drift / Catastrophic Forgetting); Evidently AI "Concept Drift"; arXiv 2602.1841 "LLM-Agent Framework for Adaptive Task Allocation" (state modeling, semantic context encoding); Medium "Continuous Adaptation in Non-Stationary RL"
> **Coupling:** 🟢 — thêm lớp phát hiện/cập nhật, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent drift + memory + flywheel sẵn; thiếu drift detector + refresh)
> **Effort:** 2-3 tuần

## Nguồn gốc

Non-stationary: **môi trường thay đổi (dữ liệu/quy tắc/định nghĩa) — agent phải phát hiện và thích nghi** — arXiv 2505.17902: "four categories — Data Drift, Concept Drift, Catastrophic Forgetting" — đây là bài toán ML cổ điển đặt lên agent; Evidently: "Concept drift is a change in the relationship between input data and model target — reflects evolution of the underlying problem"; Hu 2026 (7 cites): "state modeling and semantic context encoding mechanisms that capture environmental non-stationarity"; RL: "the world changes, so the agent's policy becomes wrong — concept drift + forgetting trap". Điểm khác **YYYY drift** (chất lượng agent suy giảm — đo output) — YYYYYY *môi trường thay đổi — cập nhật nguồn*: phát hiện KB/API/rule stale (docs cũ, API đổi schema, workflow tổ chức đổi), cập nhật knowledge source (đọc lại docs, re-index KB), đánh dấu tri thức hết hạn (không xóa vội — ghi tag expiry), retrain prompt/skill nếu cần (FFFF + RRRRRR). Nối YYYY (agent drift — hệ quả), GGG (RAG — KB stale phát hiện), WW (policy đổi — cập nhật), MM (memory — dữ liệu cũ vô hiệu), NNN (skill lỗi thời), FFFFFF (version — deploy bản mới).

## Mô tả

mya non-stationary loop: (1) **phát hiện** — 3 tín hiệu: Data Drift (input user đổi phân phối), Concept Drift (định nghĩa/quan hệ đổi — câu hỏi cũ giờ trả lời khác: Evidently đo qua eval), Environment Signal (KB/API/rule có dấu hiệu stale — mtime, version, lỗi schema); (2) **phân loại mức** — nhỏ (cập nhật source), lớn (re-onboard — XXXXXX), khẩn (thu hồi agent khỏi fleet — BBBBBB); (3) **refresh** — cập nhật nguồn tri thức: đọc lại docs, re-index (GGG), đổi policy WW, đổi prompt/skill (FFFF); (4) **expiry tag** — tri thức cũ gắn thẻ hết hạn (không xóa ngay — cần bằng chứng mới) — đánh dấu "verified 2026-05" vs "stale"; (5) **verification** — sau khi refresh: PP eval lại (agent hiểu đúng thế giới mới chưa); (6) **tránh vòng xoáy** — đừng cập nhật liên tục theo nhiễu (RL trap — thế giới đổi rồi chính sách sai → đổi loạn): threshold + eval gate mỗi lần thay đổi.

## Kiến trúc

```
  TÍN HIỆU DRIFT: Data Drift (input) · Concept Drift (eval — Evidently)
                   Environment (KB/API/rule stale)
        │
        ▼
  PHÂN LOẠI MỨC: nhỏ (refresh) · lớn (re-onboard XXXXXX) · khẩn (thu hồi BBBBBB)
        │
        ▼
  REFRESH: đọc lại docs · re-index KB (GGG) · đổi policy WW · prompt/skill (FFFF)
        │
        ▼
  EXPIRY TAG: tri thức cũ "stale" (không xóa vội — cần bằng chứng mới)
        │
        ▼
  VERIFY (PP): eval lại — agent đúng thế giới mới chưa → mới giữ bản đổi
        │
        ▼
  CHỐNG VÒNG XOÁY: threshold + gate — không cập nhật theo nhiễu (RL trap)
```

```
mya: drift + GGG + FFFFFF SẸN — thiếu: drift detector + refresh pipeline + expiry tag
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ YYYY agent drift — đo suy giảm output (triệu chứng concept drift)
// ✅ GGG agentic RAG — KB (re-index khi stale)
// ✅ WW policy — rule (cập nhật khi tổ chức đổi)
// ✅ MM memory — dữ liệu (tag expiry)
// ✅ NNN skill — lỗi thời phát hiện
// ✅ FFFFFF versioning + RRRRRR flywheel — cập nhật có gate

// ❌ THIẾU: drift detector (3 tín hiệu — data/concept/environment)
// ❌ THIẾU: refresh pipeline (tự cập nhật nguồn)
// ❌ THIẾU: expiry tag (verified vs stale)
```

## Implementation

```typescript
// packages/nonstationary/src/drift.ts (NEW)
export class DriftDetector {
  async check(): Promise<DriftReport> {
    return {
      data: this.dataDrift(),                       // input phân phối đổi
      concept: await this.conceptDrift(),           // eval cũ vs mới (Evidently)
      env: this.envStale(),                         // KB/API/rule — mtime/version
    };
  }
  async react(r: DriftReport) {
    if (r.major) return onboarding.reonboard();     // XXXXXX
    if (r.urgent) return fleet.recall();            // BBBBBB — thu hồi
    const fix = await this.refresh(r);              // docs/KB/policy/skill (FFFF)
    return evalGate(fix);                           // PP — xác nhận đúng thế giới mới
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent không "lỗi thời" — cập nhật theo thế giới thực | ❌ Phát hiện drift tốn (eval định kỳ) |
| ✅ Phân biệt data/concept/environment — xử đúng chỗ | ❐ Cập nhật sai hướng nếu theo nhiễu (RL trap) |
| ✅ Expiry tag — tri thức stale rõ ràng không dùng nhầm | ❌ Re-index KB/đọc lại docs tốn thời gian |
| ✅ Xây trên drift + GGG + FFFFFF | ❌ Môi trường ổn định — cơ chế thừa |

## Khác các hướng gần

| | YYYY Agent Drift | RRRRRR Flywheel | YYYYYY: Non-Stationary |
|---|---|---|---|
| Drift gì | Chất lượng agent | Cải thiện | **Môi trường/tri thức** |
| Hệ quả | Cảnh báo | Improve | **Cập nhật nguồn + re-verify** |
| Quan hệ | Triệu chứng | Kênh cải thiện | **Gốc của cả 2** |

## Khi nào chọn

- KB/API/rule thay đổi thường xuyên (docs cũ, API version mới)
- Eval suy giảm nhưng không rõ do đâu — phân biệt drift loại nào
- Đã có drift + GGG + FFFFFF — thêm detector + refresh + expiry tag
- Môi trường thật sự không ổn định (không phải nhiễu)