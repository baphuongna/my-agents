# Hướng WI: Event Intercept Extensions — extension intercept core event (session_before_compact/tree/project_trust) → hủy hoặc cung cấp implementation riêng

> **Nguồn gốc:** pi `extension event intercept` (core emit event: `session_before_compact`, `tree`, `project_trust`; extension intercept → cancel hoặc override implementation); "extension intercepts core event", "cancel the default action", "provide own implementation" | **Coupling:** 🟡 — thêm event-intercept hook vào core lifecycle (compaction/trust/tree) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (extension system + events sẵn — chưa có intercept-cancel + override semantics) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi** core emit **lifecycle event** tại các điểm quan trọng: `session_before_compact` (trước khi compact), `tree` (khi build directory tree), `project_trust` (khi check trust). Extension có thể **intercept** event: (1) **Cancel** — trả cancel → core **bỏ qua** default action (vd extension quyết định không compact, hoặc tự compact khác). (2) **Override** — extension cung cấp **implementation riêng** thay thế default. (3) **Passthrough** — không intercept → core chạy default. Nguyên tắc: **extension = hook có quyền veto** — không chỉ observe (log/audit) mà **cancel hoặc thay thế** behavior cốt lõi.

## Mô tả

mya event-intercept extensions: (1) **Core emit interceptable event** tại lifecycle point (before_compact, trust, tree). (2) **Extension register** interceptor cho event. (3) **Intercept decision**: `cancel` (core skip default), `override` (extension implementation thay), `passthrough` (core default). (4) **Priority**: interceptor chạy theo priority — cancel wins (bất kỳ ai cancel → skip). (5) **Default fallback**: không interceptor → core default behavior. mya có extension system + events — WI thêm **intercept semantics** (cancel/override) vào event flow.

## Kiến trúc

```
  CORE LIFECYCLE POINT (vd: sắp compact)
        │
        ▼
  ┌─── EMIT interceptable event ────────────────────────┐
  │  event: "session_before_compact"                      │
  │  payload: { session, history, tokenUsage }            │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── EXTENSION INTERCEPTORS (priority order) ──────────┐
  │  interceptor[0] (priority HIGH):                      │
  │    → check: context còn đủ → return CANCEL            │
  │    → core sẽ SKIP compact (không compact)             │
  │                                                        │
  │  HOẶC:                                                 │
  │  interceptor[1] (priority MED):                        │
  │    → return OVERRIDE { impl: customCompact }           │
  │    → core dùng customCompact thay vì default           │
  │                                                        │
  │  HOẶC:                                                 │
  │  interceptor[2] → return PASSTHROUGH                   │
  │  → core chạy default compact                           │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── CORE ACTION theo decision ────────────────────────┐
  │  CANCEL     → skip (không làm gì)                      │
  │  OVERRIDE   → chạy extension impl (thay default)       │
  │  PASSTHROUGH→ chạy core default                        │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core telemetry.ts — event emit (nền — WI interceptable event)
// ✅ packages/agent sdk.ts — extension/plugin (nền — WI interceptor register)
// ✅ packages/core session.ts — lifecycle (nền — WI before_compact point)
// ✅ packages/558 UL plugin-hook-aggregation — hook system (nền — WI intercept layer)

// ❌ THIẾU: interceptable event semantics (cancel/override/passthrough)
// ❌ THIẾU: interceptor priority + cancel-wins logic
// ❌ THIẾU: override-impl injection (extension impl thay core default)
```

## Implementation

```typescript
// packages/core/src/event-intercept-extensions.ts (MỚI)
type InterceptDecision =
  | { kind: "cancel" }                          // skip default
  | { kind: "override"; impl: () => Promise<void> } // extension impl thay
  | { kind: "passthrough" };                    // core default

interface Interceptor {
  event: string;
  priority: number;
  run: (payload: unknown) => Promise<InterceptDecision>;
}

class InterceptableEventBus {
  private interceptors = new Map<string, Interceptor[]>();

  on(interceptor: Interceptor): void {
    const list = this.interceptors.get(interceptor.event) ?? [];
    list.push(interceptor);
    list.sort((a, b) => a.priority - b.priority); // priority asc
    this.interceptors.set(interceptor.event, list);
  }

  // emit → run interceptors → decision (cancel wins) → default if passthrough
  async emit(event: string, payload: unknown, defaultImpl: () => Promise<void>): Promise<void> {
    const list = this.interceptors.get(event) ?? [];
    for (const int of list) {
      const decision = await int.run(payload);
      if (decision.kind === "cancel") return; // cancel → skip ALL (including default)
      if (decision.kind === "override") { await decision.impl(); return; } // override → ext impl
      // passthrough → tiếp tục next interceptor
    }
    await defaultImpl(); // không cancel/override → core default
  }
}

// Usage:
// bus.on({ event: "session_before_compact", priority: 0,
//   run: async (p) => tokenUsageOK(p) ? { kind: "cancel" } : { kind: "passthrough" } });
// bus.on({ event: "project_trust", priority: 0,
//   run: async (p) => ({ kind: "override", impl: customTrustCheck }) });
// await bus.emit("session_before_compact", payload, defaultCompact);
```

## Được

- ✅ Extension veto power (cancel core action — extension kiểm soát lifecycle)
- ✅ Override flexibility (extension thay implementation — custom behavior)
- ✅ Decoupled (extension không sửa core — intercept qua event)
- ✅ Safe default (passthrough → core default vẫn chạy)

## Mất

- ❌ Cancel ambiguity (extension cancel sai → core skip quan trọng)
- ❌ Override responsibility (extension impl sai → bug khó debug)
- ❌ Priority conflict (2 extension cancel → first wins, mơ hồ)
- ❌ Event proliferation (quá nhiều intercept point → core rối)

## Khác

Khác **558 UL plugin-hook-aggregation** (hook decision chain: allow/warn/deny cho tool) — WI là **lifecycle intercept** (cancel/override core behavior, không chỉ tool guard). Khác **observe-only event** (log/audit — chỉ xem) — WI **mutate behavior** (cancel/override). Khác **config flag** (tắt/bật feature) — WI **runtime dynamic** (extension quyết định per-event).

## Khi nào chọn

- Cần extension kiểm soát lifecycle cốt lõi (compact, trust, tree) — không chỉ observe
- Muốn custom behavior thay default (vd custom compact, custom trust)
- Extension ecosystem mạnh (nhiều extension cần veto/override)
- Nối packages/core telemetry.ts + session.ts + packages/agent sdk.ts + 558 UL; guard cancel-safety (document cancel effect — test), override-validation (ext impl phải pass test như default), và priority-documentation (rõ thứ tự — test cancel-wins); WI = event-intercept extensions, kết hợp 558 UL plugin-hook-aggregation (hook chain) + 555 UI permission-mode (trust = interceptable)
