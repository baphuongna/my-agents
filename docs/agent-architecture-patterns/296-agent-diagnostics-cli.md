# Hướng KJ: Agent Diagnostics CLI — lệnh chẩn đoán trace/state/memory on-demand

> **Nguồn gốc:** `kubectl describe/diagnose`; `docker inspect`; Go `pprof`; Rust diagnostics; `git status`
> **Coupling:** 🟢 — CLI tool tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (logs/otel sẵn — thiếu lệnh chẩn đoán tổng hợp)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Diagnostics CLI**: lệnh on-demand cho operator chẩn đoán hệ thống. `kubectl describe pod` (toàn bộ state pod), `docker inspect` (config/state container), Go `pprof` (CPU/heap profile), `git status` (state repo). Tính chất: **chỉ-đọc** (không sửa state), **tổng hợp** (nhiều nguồn → 1 view), **có cấp độ** (summary → detail). Nguyên tắc: khi lỗi, operator chạy 1 lệnh → thấy **toàn bộ bức tranh** (state, trace, memory, cost) thay vì đục lục từng file log.

## Mô tả

mya diagnostics CLI: lệnh `mya doctor <session>` gom state agent — phiên đang ở bước nào (74 stateful-graph), trace gần đây (128 otel), memory snapshot (165), cost/token đã dùng (44/167), tool đã gọi (40), lỗi (KI). Có cấp độ: `--summary` (1 dòng health), `--detail` (full trace), `--profile` (CPU/heap nếu local model). Nối 61 agent-observability (logs) + 136 time-travel-debugging (replay). Khác "đọc log": diagnostics **tổng hợp + có cấu trúc** — operator 1 lệnh thấy tất cả.

## Kiến trúc

```
  $ mya doctor <session-id>
        │
        ├─ STATE:    step 5/10 (74 graph) — đang gọi tool "search"
        ├─ TRACE:    last 5 LLM calls (128 otel span)
        ├─ MEMORY:   3.2k tokens (165) — last consolidated 2m ago
        ├─ COST:     $0.042 (44/167) — 1.2k in / 800 out
        ├─ TOOLS:    search✓ read✓ edit✗(validation)
        ├─ ERRORS:   1x E_VALIDATION (KI) → recovered
        └─ HEALTH:   🟢 OK | p50 latency 2.1s | deadline 30s left

  Cấp độ:  --summary (1 dòng)  --detail (full)  --profile (CPU/heap)
  Nguồn:   state-graph + otel + memory + cost + tool-log + error-codes
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 61 agent-observability — logs/traces
// ✅ 128 otel-observability — OpenTelemetry span (nguồn trace)
// ✅ 74 stateful-graph — agent state (nguồn state)
// ✅ 44 cost-budget / 167 per-task-cost — cost (nguồn cost)
// ✅ 136 time-travel-debugging — replay (tiền đề profile)
// ✅ 165 hierarchical-memory — memory (nguồn memory)

// ❌ THIẾU: diagnostics CLI (gom nhiều nguồn → 1 view)
// ❌ THIẾU: structured summary (có cấp độ)
// ❌ THIẾU: health check tổng hợp (🟢/🟡/🔴)
// ❌ THIẾU: profile (CPU/heap cho local model)
```

## Implementation

```typescript
// packages/agent/src/diagnostics.ts (NEW)
interface DiagLevel { summary: boolean; detail: boolean; profile: boolean; }

async function doctor(sessionId: string, level: DiagLevel): Promise<string> {
  const [state, traces, mem, cost, errors] = await Promise.all([
    graph.getState(sessionId),         // 74
    otel.recentSpans(sessionId, 5),    // 128
    memory.snapshot(sessionId),        // 165
    cost.total(sessionId),             // 44/167
    errors.recent(sessionId),          // KI
  ]);

  const health = computeHealth({ state, traces, cost, errors }); // 🟢/🟡/🔴
  if (level.summary) return `${health.emoji} ${state.step} | $${cost.total}`;

  // detail view
  return [
    `STATE:  ${state.stepLabel}`,
    `TRACE:  ${traces.length} spans, p50 ${p50(traces)}s`,
    `MEMORY: ${mem.tokens} tokens`,
    `COST:   $${cost.total} (${cost.in}/${cost.out})`,
    `ERRORS: ${errors.map((e) => e.code).join(", ") || "none"}`,
    `HEALTH: ${health.emoji} ${health.reason}`,
  ].join("\n");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Operator 1 lệnh thấy tất cả (kubectl/docker proven) | ❌ Gom nhiều nguồn (coupling tạm) |
| ✅ Có cấp độ (summary → detail → profile) | ❌ Một số nguồn không có (local profile) |
| ✅ Chỉ-đọc — an toàn (không sửa state) | ❌ Output phức tạp (cần format) |
| ✅ Health tổng hợp (🟢/🟡/🔴) | ❌ Nguồn phải ổn định (API thay đổi) |

## Khác các hướng gần

| | 61 Observability | 128 OTel | KJ: Diagnostics CLI |
|---|---|---|---|
| Dạng | Log/stream | Span/trace | **Lệnh on-demand tổng hợp** |
| Khi | Luôn (background) | Luôn | **Khi cần chẩn đoán** |
| Tổng hợp | ❌ (raw log) | ❌ (trace only) | ✅ state+trace+cost+mem |
| Cấp độ | ❌ | ❌ | ✅ summary/detail/profile |

## Khi nào chọn

- Operator cần chẩn đoán nhanh khi agent fail/kẹt
- Muốn 1 lệnh thấy toàn bộ state (không đục lục log)
- Cần health check tổng hợp (🟢/🟡/🔴)
- Debug local model cần profile (CPU/heap)
