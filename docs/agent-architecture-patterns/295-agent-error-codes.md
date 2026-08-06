# Hướng KI: Agent Error Codes — taxonomy mã lỗi, chuẩn fault diagnosis

> **Nguồn gốc:** HTTP/gRPC status codes; errno (POSIX); Windows HRESULT; Sentry error grouping; OpenTelemetry exception taxonomy
> **Coupling:** 🟢 — error layer tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retry/catch sẵn — thiếu code chuẩn + taxonomy)
> **Effort:** 1 tuần

## Nguồn gốc

**Status code taxonomy**: HTTP (4xx client / 5xx server), gRPC (`INVALID_ARGUMENT`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`), errno (POSIX — `ENOENT`, `EACCES`, `ETIMEOUT`). Tính chất: code **ổn định** (không đổi nghĩa), **có nhóm** (client/server/transient), **machine-readable** (agent quyết retry/escalate theo code, không parse text). Sentry: nhóm lỗi theo taxonomy → trend, regression detection. Nguyên tắc: mỗi lỗi có code — 203 retry-loops quyết retry theo code (transient → retry, permanent → stop).

## Mô tả

mya error codes: mỗi lỗi (tool fail, LLM timeout, auth, validation) có code ổn định. Nhóm: **transient** (LLM 429/503, network — retry theo 203), **permanent** (validation 400, not-found 404 — không retry, 231 DLQ), **auth** (401/403 — 62 credential refresh), **policy** (225 guardrail block — escalate 46). Agent đọc code → quyết đường: retry / DLQ / refresh cred / escalate. Khác error message text: code **machine-readable** — agent không parse chuỗi, hành vi ổn định. Nối 95 tool-call-recovery (classify) + 118 error-analysis.

## Kiến trúc

```
  TOOL/LLM FAIL
        │
        ▼
  ┌────────────── ERROR TAXONOMY ──────────────┐
  │  E_LLM_429      → TRANSIENT → retry (203)   │
  │  E_LLM_503      → TRANSIENT → retry         │
  │  E_AUTH_401     → AUTH      → refresh (62)  │
  │  E_VALIDATION   → PERMANENT → DLQ (231)     │
  │  E_NOT_FOUND    → PERMANENT → DLQ           │
  │  E_POLICY_BLOCK → POLICY    → escalate (46) │
  │  E_DEADLINE     → TIMEOUT   → cancel (KE)   │
  └──────────────────┬──────────────────────────┘
                     ▼ code = machine-readable
        Agent quyết đường (không parse text)
        203 retry | 231 DLQ | 62 refresh | 46 escalate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 203 failure-detection-retry-loops — retry (cần code để quyết)
// ✅ 95 tool-call-recovery — recovery (classify lỗi)
// ✅ 118 error-analysis — phân tích lỗi
// ✅ 231 dead-letter-queue — quarantine (permanent error)
// ✅ 42 circuit-breaker — stop (transient quá nhiều)

// ❌ THIẾU: error code chuẩn (ổn định, machine-readable)
// ❌ THIẾU: taxonomy (transient/permanent/auth/policy)
// ❌ THIẾU: code → action mapping (retry/DLQ/refresh/escalate)
// ❌ THIẾU: error grouping/registry (giống Sentry)
```

## Implementation

```typescript
// packages/agent/src/errors.ts (NEW)
const ErrorCode = {
  LLM_RATE_LIMIT: { code: "E_LLM_429", group: "transient", action: "retry" },
  LLM_UNAVAILABLE: { code: "E_LLM_503", group: "transient", action: "retry" },
  AUTH_EXPIRED: { code: "E_AUTH_401", group: "auth", action: "refresh" },
  VALIDATION: { code: "E_VALIDATION", group: "permanent", action: "dlq" },
  NOT_FOUND: { code: "E_NOT_FOUND", group: "permanent", action: "dlq" },
  POLICY_BLOCK: { code: "E_POLICY_BLOCK", group: "policy", action: "escalate" },
  DEADLINE: { code: "E_DEADLINE", group: "timeout", action: "cancel" },
} as const;

class AgentError extends Error {
  constructor(public meta: { code: string; group: string; action: string }, msg: string) {
    super(`${meta.code}: ${msg}`);
  }
}

// Agent đọc action → quyết đường (machine-readable, không parse text)
async function handleError(e: AgentError, task: Task): Promise<void> {
  switch (e.meta.action) {
    case "retry": await retry(task); break;       // 203
    case "refresh": await creds.refresh(); await retry(task); break; // 62
    case "dlq": await dlq.quarantine(task, e); break;     // 231
    case "escalate": await escalation.notify(task, e); break; // 46
    case "cancel": await tree.cancel(); break;    // KE
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Machine-readable — agent quyết đường ổn định (gRPC/HTTP) | ❌ Phải duy trì registry (code ổn định) |
| ✅ Nhóm lỗi → trend/regression (Sentry) | ❌ Mapping code→action cần thiết kế |
| ✅ Retry đúng (transient yes, permanent no — tiết kiệm) | ❌ Code có thể thiếu (unclassified → fallback) |
| ✅ Nối 203/95/118/231 bằng code chung | ❌ Operator học thêm bảng code |

## Khác các hướng gần

| | 203 Retry Loops | 118 Error Analysis | KI: Error Codes |
|---|---|---|---|
| Mục | Retry transient | Phân tích lỗi | **Taxonomy + code chuẩn** |
| Đầu vào | Exception | Lỗi text/log | **Code machine-readable** |
| Đầu ra | Retry/skip | Root cause | **Action (retry/DLQ/escalate)** |
| Ổn định | ❌ | ❌ | ✅ code cố định |

## Khi nào chọn

- Agent cần quyết retry/DLQ/escalate theo loại lỗi (không đoán)
- Muốn trend/regression theo nhóm lỗi (Sentry-style)
- Nhiều loại lỗi (LLM, tool, auth, policy) cần xử lý khác nhau
- Cần audit chuẩn (code ổn định qua version)
