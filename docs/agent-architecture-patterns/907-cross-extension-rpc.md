# Hướng AHW: Cross-Extension-RPC — extension khác spawn/stop subagent qua `pi.events` với RPC `subagents:rpc:ping/spawn/stop`, reply envelope chuẩn hóa + protocol versioning; handlers chỉ đăng ký ở `session_start` đầu tiên để activation bị filter-out không quảng cáo dịch vụ giả

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — extension RPC | **Agent-agnostic:** ⚠️ (pi extension API) | **Code sẵn:** ⚠️ (có JSON-RPC transport; chưa có subagents:rpc namespace + readiness gating) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-subagent3** cho phép extension khác **spawn/stop subagent** qua `pi.events` với RPC `subagents:rpc:ping/spawn/stop`, dùng **reply envelope chuẩn hóa** + **protocol versioning**; handlers chỉ đăng ký ở **`session_start` đầu tiên** để activation bị filter-out không quảng cáo dịch vụ giả. Nguyên tắc: **event-bus RPC** — extension giao tiếp qua events, không import trực tiếp; **reply envelope** — request có id, response envelope chuẩn; **versioning** — protocol version để detect mismatch; **readiness gating** — chỉ đăng ký handler khi activation thật (không phải filtered-out).

## Mô tả

Với mya, pattern = **cross-extension RPC qua event bus**: (1) mya đã có **rpc package** (JSON-RPC 2.0 transport) — đúng envelope pattern; (2) mya có **intercom broker** cho inter-agent messaging — nền event bus; (3) AHW thêm **`subagents:rpc:*` namespace** — ping/spawn/stop; (4) **reply envelope** `{ id, ok, result/error, protocolVersion }`; (5) **readiness gating** — handler đăng ký ở first `session_start` (nối AID rpc-readiness-gating) — filtered activation im lặng, không quảng cáo.

## Kiến trúc (ASCII)

```
  EXTENSION A (caller)              EXTENSION B = subagents (provider)
    │                                  │
    │  pi.events.emit("subagents:rpc:spawn",     │
    │     { id, protocolVersion, agent, prompt })│
    │ ─────────────────────────────────────────► │ (handler đăng ký ở first
    │                                  │          session_start — readiness gate)
    │                                  │ spawn subagent
    │  ◄──reply envelope────────────── │
    │     { id, ok:true, result:{subId}, protocolVersion }
    │
    │  pi.events.emit("subagents:rpc:ping")
    │ ─────────────────────────────────────────► │
    │  ◄──{ ok:true } (service alive)            │
  (filtered-out activation: KHÔNG đăng ký handler — không quảng cáo dịch vụ giả)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/rpc index.ts — JSON-RPC 2.0 envelope (request/response/notification)
//   + RpcHandler (prompt/cancel/status/heartbeat) — nền reply envelope
// ✅ packages/intercom broker — event bus inter-agent (nền events)
// ✅ packages/intercom extension-api.ts — extension registration (nền cross-ext)
// ✅ packages/agent — spawnSubagent/killSubagent (RPC target action)

// ❌ THIẾU: subagents:rpc:* namespace (ping/spawn/stop)
// ❌ THIẾU: protocol versioning trên envelope
// ❌ THIẾU: readiness gating (first session_start only)
```

## Implementation

```typescript
// packages/agent/src/cross-extension-rpc.ts (NEW)
export const PROTOCOL_VERSION = 1;
export interface RpcEnvelope {
  id: string; method: "ping" | "spawn" | "stop";
  protocolVersion: number; params?: { agent?: string; prompt?: string; subId?: string };
}
export type RpcReply =
  | { id: string; ok: true; result: unknown; protocolVersion: number }
  | { id: string; ok: false; error: string; protocolVersion: number };

/** Provider — đăng ký handler chỉ ở first session_start (readiness gate). */
export function registerSubagentRpc(pi: {
  events: { on(method: string, h: (e: RpcEnvelope) => void): void; emit(method: string, r: RpcReply): void };
  spawn: (agent: string, prompt: string) => string; stop: (subId: string) => boolean;
  activated: boolean;
}): () => void {
  if (!pi.activated) return () => {}; // filtered-out — KHÔNG đăng ký (no fake service)
  const handle = (e: RpcEnvelope): void => {
    if (e.protocolVersion !== PROTOCOL_VERSION) {
      pi.events.emit(`subagents:rpc:reply`, { id: e.id, ok: false, error: "version mismatch", protocolVersion: PROTOCOL_VERSION });
      return;
    }
    if (e.method === "ping") pi.events.emit(`subagents:rpc:reply`, { id: e.id, ok: true, result: { alive: true }, protocolVersion: PROTOCOL_VERSION });
    else if (e.method === "spawn") pi.events.emit(`subagents:rpc:reply`, { id: e.id, ok: true, result: { subId: pi.spawn(e.params!.agent!, e.params!.prompt!) }, protocolVersion: PROTOCOL_VERSION });
    else if (e.method === "stop") pi.events.emit(`subagents:rpc:reply`, { id: e.id, ok: true, result: { stopped: pi.stop(e.params!.subId!) }, protocolVersion: PROTOCOL_VERSION });
  };
  pi.events.on("subagents:rpc:request", handle);
  return () => {}; // unregister
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Extension giao tiếp qua events — loose coupling | ❌ Event bus — debug khó hơn direct call |
| ✅ Reply envelope + versioning — contract rõ | ❌ Version mismatch cần handle downgrade |
| ✅ Readiness gating — no fake service | ❌ Filtered activation phải detect chính xác |
| ✅ Nối rpc + broker sẵn | ❌ Latency event bus > direct |

## Khác các hướng gần

| | AHW Cross-Extension-RPC | AID RPC-Readiness-Gating | AHQ Intercom-Supervisor-Bridge |
|---|---|---|---|
| Trọng tâm | Extension ↔ extension RPC | Khi đăng ký RPC handler | Subagent → supervisor |
| Cơ chế | event bus + reply envelope | first session_start bound | contact_supervisor + reference-only |
| Quan hệ | Channel cross-extension | Gating cho AHW | Channel con→cha |

## Khi nào chọn

- Extension khác cần điều khiển subagent (spawn/stop) mà không import trực tiếp
- Muốn loose coupling qua event bus + versioned contract
- Cần readiness gating (filtered activation không quảng cáo dịch vụ giả)
- Guard: protocol version, reply envelope chuẩn, readiness gate at first session_start, error envelope cho mismatch
