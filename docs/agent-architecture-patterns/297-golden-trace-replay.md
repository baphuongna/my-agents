# Hướng KK: Golden Trace Replay — replay trace "vàng" làm regression baseline

> **Nguồn gốc:** Golden-file testing (Go); VCR record/replay cassettes; snapshot testing (Jest); regression baselines
> **Coupling:** 🟢 — test layer, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (trajectory-replay sẵn — thiếu golden set + diff)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Golden file testing** (Go): lưu output "đúng" (golden), mỗi test so sánh output mới với golden — lệch = regression. VCR (Ruby): record HTTP call thành cassette, replay lại (không gọi thật). Snapshot testing (Jest): first run = baseline, run sau diff với baseline. Nguyên tắc: một bộ trace "vàng" đại diện hành vi đúng — mỗi thay đổi (prompt 173, model upgrade, tool đổi) replay trace, so output mới với golden, lệch = regression cần xem. Deterministic nhờ 293 hermetic config + 298 mock LLM.

## Mô tả

mya golden trace replay: một bộ session "vàng" (đại diện: success path, recovery path, edge case). Mỗi PR/upgrade → replay golden set (chạy lại agent trên input đã lưu, với mock LLM 298 deterministic) → diff output/tool-calls với golden. Lệch = regression (prompt đổi gây hành vi khác, tool đổi gây chọn khác). Khác 94 trajectory-replay (replay 1 session để debug): KK = **bộ baseline + CI gate** — chặn regression. Nối 299 regression-gates (KK là data cho gate).

## Kiến trúc

```
  GOLDEN SET (đại diện hành vi đúng):
    golden/success.json    (happy path — đúng tool, đúng output)
    golden/recovery.json   (LLM fail → retry đúng — 203)
    golden/edge-empty.json (input rỗng — xử lý gọn)

  MỖI PR / UPGRADE:
    replay golden set (agent + mock LLM 298 — deterministic)
        │
        ▼
  diff output + tool-calls với golden
        │
   ┌────┴────┐
   ▼         ▼
 match     mismatch
   │         │
 OK      REGRESSION → block PR (xem prompt/tool gì đổi)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 94 trajectory-replay — replay session (nền golden)
// ✅ 41 eval-harness — eval (nơi chạy golden)
// ✅ 122 agent-reproducibility — deterministic (cần cho golden)
// ✅ 293 hermetic-config — pin config (golden ổn định)
// ✅ 96 agent-ci-cd — CI (chạy golden mỗi PR)

// ❌ THIẾU: golden trace set (baseline đã curated)
// ❌ THIẾU: diff tool (output + tool-call mismatch)
// ❌ THIẾU: accept-regression flow (update golden khi cố ý)
// ❌ THIẾU: CI gate (chặn khi mismatch)
```

## Implementation

```typescript
// packages/eval/src/golden.ts (NEW)
interface GoldenTrace { input: string; expectedTools: string[]; expectedOutput: string; }

async function replayGolden(golden: GoldenTrace): Promise<"match" | "mismatch"> {
  const result = await agent.run(golden.input, { llm: mockLLM }); // 298 deterministic
  const toolsMatch = JSON.stringify(result.toolCalls) === JSON.stringify(golden.expectedTools);
  const outMatch = result.output.trim() === golden.expectedOutput.trim();
  return toolsMatch && outMatch ? "match" : "mismatch";
}

// CI gate: replay cả golden set — 1 mismatch = block PR
async function goldenGate(): Promise<void> {
  const traces = await loadGoldenSet(); // curated baseline
  const results = await Promise.all(traces.map(replayGolden));
  const regressions = results.filter((r) => r === "mismatch");
  if (regressions.length) throw new Error(`${regressions.length} golden regression(s)`);
}

// Cố ý đổi hành vi → `golden update` (approve mismatch, lưu golden mới)
async function acceptGolden(name: string): Promise<void> {
  const result = await agent.run(golden.input, { llm: mockLLM });
  await writeGolden(name, { ...golden, expectedTools: result.toolCalls, expectedOutput: result.output });
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn regression tự động (golden-file proven) | ❌ Golden phải curated (chọn case đại diện) |
| ✅ Deterministic (298 mock + 293 hermetic) | ❌ Drift khi cố ý đổi (cần accept flow) |
| ✅ Nhanh (mock, không gọi LLM thật) | ❌ Mock ≠ thật (miss regression integration) |
| ✅ Nối 299 regression-gate (data + gate) | ❌ Bảo trì golden khi prompt đổi nhiều |

## Khác các hướng gần

| | 94 Trajectory Replay | 84 LLM-as-Judge | KK: Golden Trace Replay |
|---|---|---|---|
| Mục | Debug 1 session | Đánh giá chất lượng | **Regression baseline (CI)** |
| So sánh | ❌ | ❌ (chấm điểm) | **Diff với golden** |
| Gate | ❌ | ❌ | ✅ block PR |
| Deterministic | Cần | ❌ | ✅ (mock+hermetic) |

## Khi nào chọn

- Muốn chặn regression mỗi PR/upgrade (prompt, model, tool đổi)
- Đã có eval + CI + reproducibility (41/96/122) — thêm golden set
- Cần deterministic baseline (không flaky)
- OK bảo trì golden khi cố ý đổi hành vi (accept flow)
