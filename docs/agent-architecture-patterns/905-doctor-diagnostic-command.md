# Hướng AHU: Doctor-Diagnostic-Command — lệnh `/doctor` kiểm tra toàn bộ hạ tầng (discovery agents, isAsyncAvailable, intercom bridge state, session dirs) — đưa chẩn đoán lỗi cấu hình lên mặt nước thay vì chôn trong log

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟢 — observability | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có các phần check rời; chưa có lệnh /doctor tổng hợp) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents** extension có lệnh **`/doctor`** kiểm tra toàn bộ hạ tầng: discovery agents từ mọi source, `isAsyncAvailable`, intercom bridge state, session dirs — đưa chẩn đoán lỗi cấu hình **lên mặt nước** thay vì chôn trong log. Nguyên tắc: **one-command health check** — user chạy `/doctor` → thấy ngay cái gì hỏng; **surface không dig** — lỗi cấu hình phải hiển thị, không ẩn trong log; **actionable** — mỗi check trả pass/fail + hint sửa.

## Mô tả

Với mya, pattern = **`/doctor` command tổng hợp**: (1) mya đã có các check rời — intercom state (packages/intercom), memory sqlite health, cron lifecycle-guard, provider health (packages/ai); (2) AHU gom thành **một command** chạy tất cả check; (3) **check categories**: providers (health()), async availability, intercom broker state, memory sqlite, cron store, session dirs (pool), natives loaded; (4) mỗi check → `{ name, status: "ok"|"warn"|"fail", detail, hint }`; (5) render table trong TUI (natives/print) — user thấy ngay.

## Kiến trúc (ASCII)

```
  /doctor
    │
    ├─ CHECK: providers (ai.health() per provider)
    │    └─ ok | warn | fail + hint
    ├─ CHECK: async availability (natives loaded?)
    ├─ CHECK: intercom broker (runtime-claim state, socket)
    ├─ CHECK: memory sqlite (open? schema migrate?)
    ├─ CHECK: cron store (lock? lifecycle-guard)
    ├─ CHECK: session dirs (pool AgentSessionEntry writable?)
    ├─ CHECK: discovery agents (every source)
    ▼
  REPORT (table TUI)
    ┌──────────────────┬────────┬─────────────────────┐
    │ Check            │ Status │ Hint                │
    ├──────────────────┼────────┼─────────────────────┤
    │ providers        │ ✅ ok   │                     │
    │ intercom broker  │ ❌ fail │ broker.sock missing │
    │ memory sqlite    │ ⚠️ warn │ schema v3→v4 pending│
    └──────────────────┴────────┴─────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai — provider health() (per provider status)
// ✅ packages/intercom runtime-claim.ts — broker state (claim check)
// ✅ packages/cron lifecycle-guard.ts — cron health (nền check)
// ✅ packages/memory sqlite-db.ts — sqlite health (nền check)
// ✅ packages/agent pool.ts — session dirs (nền check)
// ✅ packages/print mya-bridge.ts — command registration (nền /doctor)

// ❌ THIẾU: /doctor command tổng hợp (gom các check rời)
// ❌ THIẾU: CheckResult schema { name, status, detail, hint }
// ❌ THIẾU: render table TUI report
```

## Implementation

```typescript
// packages/print/src/doctor.ts (NEW)
import type { ProviderProfile } from "@my-agent/core";

export type CheckStatus = "ok" | "warn" | "fail";
export interface CheckResult { name: string; status: CheckStatus; detail: string; hint?: string }

export async function runDoctor(checks: {
  providers: ProviderProfile[];
  intercomState: () => unknown;
  memoryOk: () => boolean;
  sessionDirWritable: () => boolean;
}): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const p of checks.providers) {
    const h = p.health?.() ?? "Unknown";
    out.push({ name: `provider:${p.id}`, status: h === "Healthy" ? "ok" : "fail",
      detail: `health=${h}`, hint: h === "Failed" ? "check API key/model" : undefined });
  }
  out.push({ name: "intercom-broker", status: checks.intercomState() ? "ok" : "fail",
    detail: "broker claim", hint: "restart intercom extension" });
  out.push({ name: "memory-sqlite", status: checks.memoryOk() ? "ok" : "fail",
    detail: "db open", hint: "run migrate" });
  out.push({ name: "session-dirs", status: checks.sessionDirWritable() ? "ok" : "fail",
    detail: "writable", hint: "check permissions" });
  return out;
}
// mya-bridge: register "/doctor" → runDoctor(...) → render table (natives/print ink).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ One-command health check — user thấy ngay | ❌ Gom nhiều check — một cái fail có thể chậm |
| ✅ Surface lỗi cấu hình (không chôn log) | ❌ Check phải không side-effect (read-only) |
| ✅ Actionable hint mỗi fail | ❌ Phải maintain checklist khi thêm component |
| ✅ Nối các check rời sẵn | ❌ Provider health() có thể block (timeout) |

## Khác các hướng gần

| | AHU Doctor-Diagnostic | AHR Stale-Run-Reconciler | AHV Session-Scoped-Schedule-Store |
|---|---|---|---|
| Trọng tâm | Health check tổng hợp | Sửa orphan run | Lưu schedule per-session |
| Cơ chế | Gom check → table report | PID-liveness + grace | <cwd>/.pi/ schedules + PID lock |
| Quan hệ | Read-only chẩn đoán | Active repair | Active persist |

## Khi nào chọn

- User báo "không chạy được" → cần chẩn đoán nhanh
- Muốn surface lỗi cấu hình thay vì dig log
- Đã có nhiều component (intercom/memory/cron/providers) → gom check
- Guard: check read-only (no side-effect), timeout mỗi check, hint actionable, table render TUI
