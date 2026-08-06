# Hướng GGGGGG: Time-Travel Debugging — ghi lại mọi bước, tua ngược tái dựng lỗi

> **Nguồn gốc:** Reddit "Time-travel debugger for AI agents" (flight recorder); Undo.io "Agentic Debugging with Time Travel" (MCP); Tian Pan "Deterministic Replay: Debug AI Agents" 2026; Temporal "Time-travel debugging production code"
> **Coupling:** 🟢 — ghi event, không đổi runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (SSSS replay + VV audit + QQQQ trace sẵn; thiếu state snapshot + rewind)
> **Effort:** 2-3 tuần

## Nguồn gốc

Time-travel debugging: **record execution như black-box flight recorder, replay từ điểm lỗi** — Reddit: "Record execution like a black box flight recorder. When something fails, replay from the exact failure point. Cache what worked"; Undo.io: kết hợp TTD + LLM reasoning qua MCP; Tian Pan 2026: "Record every LLM call, tool response, and timestamp during agent execution, then replay the exact sequence to reproduce failures" — vì agent non-deterministic, replay deterministic; Temporal: "rewind and debug past executions". Điểm khác **SSSS replay** (chạy lại trajectory để sửa prompt/sinh eval) và **VV audit** (ghi sự kiện) — GGGGGG *tua ngược tương tác*: ghi checkpoint sau mỗi step (LLM call, tool result, state) → khi lỗi: tua về step N, sửa state/prompt, chạy tiếp từ đó (không chạy lại từ đầu); xem biến/state ở bất kỳ điểm nào (như gdb `reverse-continue`). Nối SSSS (dữ liệu trajectory), QQQQ (trace — bản đồ step), YYYY (metric — phát hiện step lỗi), PP (sinh eval từ lỗi tìm thấy).

## Mô tả

mya TTD: (1) **flight recorder** — sau mỗi LLM call/tool call/MCP call: ghi request, response, timestamp, state snapshot (context/session, cost, retry) — dữ liệu có sẵn từ SSSS/QQQQ; (2) **checkpoint index** — đánh dấu step đã snapshot (tăng dần, nén context cũ — RRRR); (3) **rewind** — lỗi xảy ra ở step 40 → `rewind 40`: khôi phục state snapshot step 40, sẵn sàng chạy lại từ đó; (4) **sửa rồi replay** — đổi prompt (FFFFFF version), mock tool result (tool mocking), đổi model → chạy lại từ 40, không phải từ 1 (tiết kiệm token — SS); (5) **inspect** — xem bất kỳ LLM call/tool response nào giữa (grep timeline); (6) **sinh eval** — lỗi đã tua xong → thành test case (PP synthetic), chống tái phạm. Chỉ non-deterministic (LLM) cần ghi; phần deterministic (tool) tái dựng được từ hàm.

## Kiến trúc

```
  STEP 1..N: LLM CALL · TOOL RESULT · MCP — flight recorder (như black box)
        │ ghi: request · response · timestamp · state snapshot (nén — RRRR)
        ▼
  CHECKPOINT INDEX (step → state) — chạy dài không giữ hết (chỉ snapshot)
        │
  LỖI ở step 40
        ▼
  REWIND 40 — khôi phục state · sửa prompt (FF) / mock tool / đổi model
        ▼
  REPLAY từ 40 (không từ 1 — tiết kiệm token SS) → thử lần 2
        ▼
  Lỗi đã tua xong → SINH EVAL (PP) chống tái phạm
```

```
mya: SSSS + VV + QQQQ SẸN — thiếu: state snapshot + rewind + inspect UI
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ SSSS replay — dữ liệu trajectory (request/response/tool)
// ✅ VV audit — sự kiện có timestamp (flight recorder thô)
// ✅ QQQQ trace — bản đồ step (index tua)
// ✅ PP eval — sinh test từ lỗi (anti-regression)
// ✅ RRRR long-context — nén snapshot cũ

// ❌ THIẾU: state snapshot per step (để rewind)
// ❌ THIẾU: rewind engine (khôi phục + replay từ điểm)
// ❌ THIẾU: inspect timeline (gdb-style xem state bất kỳ)
```

## Implementation

```typescript
// packages/ttd/src/recorder.ts (NEW)
export class Recorder {
  private index = new Map<number, Snapshot>();   // step → state
  async record(step: Step, s: Snapshot): Promise<void> {
    this.index.set(step, s);                     // checkpoint nén (RRRR)
  }
  rewind(step: number): Snapshot {               // như gdb reverse-continue
    return this.index.get(step)!;                // state đúng tại điểm đó
  }
  async replay(s: Snapshot, patch: Patch): Promise<Result> {
    return this.run(s, patch);                   // prompt mới/mock tool/model mới
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sửa lỗi bằng cách tua — không chạy lại từ đầu | ❌ Ghi snapshot tốn storage (nén RRRR) |
| ✅ Reproduce non-deterministic (LLM) bằng deterministic replay | ❐ Mock/replay sai state → chẩn đoán sai |
| ✅ Inspect bất kỳ step nào (không đoán lỗi ở đâu) | ❌ Tool external side-effect không replay được (chỉ mock) |
| ✅ Lỗi tua xong → eval chống tái phạm (PP) | ❌ Phức tạp — 1 máy 1 người hiếm cần đủ |

## Khác các hướng gần

| | SSSS Replay | VV Audit | GGGGGG: TTD |
|---|---|---|---|
| Mục đích | Chạy lại trajectory | Bằng chứng | **Tua ngược + sửa + chạy tiếp** |
| Tương tác | Chạy từ đầu | Đọc log | **Rewind đến điểm + replay từ đó** |
| Thêm so với SSSS | — | — | **State snapshot + rewind engine** |

## Khi nào chọn

- Lỗi non-deterministic (LLM) khó reproduce — replay deterministic
- Trajectory dài, lỗi ở cuối — không muốn chạy lại từ đầu (SS)
- Đã có SSSS + VV + QQQQ — thêm snapshot + rewind
- Đang debug agent tinh vi (tool chain phức tạp)