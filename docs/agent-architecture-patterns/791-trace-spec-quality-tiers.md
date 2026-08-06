# Hướng ADK: Trace Spec Quality Tiers — schema trace chuẩn với 3 quality tiers và auto-scoring

> **Nguồn gốc:** harness-experimental | **Coupling:** 🟡 — ghi vào SQLite, cần hook vào agent loop | **Agent-agnostic:** ✅ — schema thuần, không phụ thuộc model | **Code sẵn:** ⚠️ (sẵn audit + sqlite; thiếu trace schema + scorer) | **Effort:** 1-2 tuần

## Nguồn gốc

**TRACE_SPEC.md** của **harness-experimental** chuẩn hóa cách agent ghi lại những gì nó làm: schema SQLite bảng `trace` với các cột **task_summary, files_read, files_changed, decisions_made, errors, harness_friction**... — tức là không chỉ "kết quả" mà cả **hành trình** (files đọc, quyết định, friction gặp phải khi dùng harness).

Chất lượng trace được xếp **3 tiers**: **minimal** (chỉ task_summary + files_changed), **standard** (thêm files_read + decisions_made), **detailed** (thêm errors + harness_friction + timestamps chi tiết). Agent ghi trace, **`harness-cli score-trace`** chấm điểm tự động theo tier, review dựa trên **friction context** — biết agent vấp ở đâu để sửa harness, không phải đổ lỗi agent.

## Mô tả

Với mya, trace spec nối vào **turn lifecycle**: mỗi turn `runTurn` emit events (core đã có `RuntimeEvent`), một **TraceWriter** nghe events và ghi vào SQLite (`packages/memory` đã có sqlite-db wrapper với WAL). `packages/audit` đã có `AuditRecord` + `Checkpoint` — trace spec mở rộng hơn: bổ sung friction channel (agent report "công cụ khó dùng", "không tìm thấy doc"). Score tính tự động: đủ cột theo tier + friction giảm dần = điểm cao. Kết quả dùng cho cả **debug session** lẫn **cải thiện harness** (nối ADL product-vs-harness-delta).

## Kiến trúc (ASCII)

```
  AGENT LOOP (runTurn)
    │  RuntimeEvent: tool_call, tool_result, decision, error
    ▼
  TRACE WRITER (nghe events)
    │
    ▼
  SQLite bảng trace
    ├─ task_summary      (minimal)
    ├─ files_read        (standard)
    ├─ files_changed     (standard)
    ├─ decisions_made    (standard)
    ├─ errors            (detailed)
    └─ harness_friction  (detailed)
            │
            ▼
  harness-cli score-trace
    ├─ tier detection: minimal/standard/detailed
    └─ score + friction report → review
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core — RuntimeEvent + TurnEvent + LaneHeartbeat
//   (nguồn dữ liệu cho TraceWriter)
// ✅ packages/memory/src/sqlite-db.ts — SQLite wrapper WAL + transaction
//   (nền bảng trace)
// ✅ packages/audit — AuditLog + Checkpoint (durable records gần tương đương)
// ✅ packages/eval — harness.ts ParityHarness (nền scorer machinery)

// ❌ THIẾU: trace schema chuẩn (task_summary/files_read/decisions/errors/friction)
// ❌ THIẾU: TraceWriter nghe RuntimeEvent ghi vào SQLite
// ❌ THIẾU: score-trace (tier detection + friction scoring)
```

## Implementation

```typescript
// packages/audit/src/trace.ts (NEW)
export type TraceTier = "minimal" | "standard" | "detailed";

export interface TraceRecord {
  taskSummary: string;
  filesRead: string[];
  filesChanged: string[];
  decisions: string[];
  errors: string[];
  friction: string[];         // agent report khó khăn khi dùng harness
}

export function tierOf(t: TraceRecord): TraceTier {
  if (t.errors.length > 0 || t.friction.length > 0) return "detailed";
  if (t.filesRead.length > 0 && t.decisions.length > 0) return "standard";
  return "minimal";
}

export function scoreTrace(t: TraceRecord): number {
  let score = 0;
  score += t.taskSummary.length > 0 ? 20 : 0;
  score += Math.min(t.filesRead.length, 10);       // standard+
  score += Math.min(t.filesChanged.length, 20);    // minimal+
  score += Math.min(t.decisions.length, 20);       // standard+
  score += t.errors.length > 0 ? 10 : 20;          // detailed ghi errors = tốt
  score += Math.min(t.friction.length, 10);        // friction context
  return score; // 0..100 — tier càng cao càng đủ cột
}

// TraceWriter: subscribe RuntimeEvent → upsert vào SQLite bảng trace
export function makeTraceWriter(db: Database): (e: RuntimeEvent) => void {
  return (e) => {
    if (e.type === "tool") traceToolCall(db, e);
    if (e.type === "decision") traceDecision(db, e);
  };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ghi hành trình, không chỉ kết quả | ❌ Mỗi event đều ghi — overhead I/O |
| ✅ Friction context → sửa harness đúng chỗ | ❌ Agent phải tự report friction (có thể lệch) |
| ✅ Score tự động, tier rõ ràng | ❌ Schema đổi → migration SQLite |
| ✅ Debug session nhanh hơn | ❌ Trace chi tiết tốn dung lượng |

## Khác các hướng gần

| | ADK Trace Tiers | AEC Apply Log | AEE Fidelity Rubric |
|---|---|---|---|
| Ghi gì | Hành trình turn (files, decisions, friction) | Thay đổi từng dòng | Độ trung thực migration |
| Scoring | Tự động theo tier | Tsc clean + test | Self-score 5 câu hỏi |
| Dùng cho | Debug + cải thiện harness | Audit trail | Đánh giá migration |

## Khi nào chọn

- Muốn biết agent "đã đọc gì, quyết định gì" khi debug
- Friction từ agent là input cải thiện harness (nối ADL)
- Đã có SQLite + RuntimeEvent — chỉ thêm writer + scorer
- Cần số liệu trace để review khách quan