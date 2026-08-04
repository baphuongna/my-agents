# Fix Plan: Cron Session Timeout + Tool Status (2 fixes from Contrabass review)

> **Source**: Contrabass analysis — `docs/contrabass-analysis.md` → "2 fixes thật sự đáng làm"
> **Status**: Draft — chưa review rounds
> **Estimated**: 1.5h (Fix 1) + 0.5h (Fix 2) + 0.5h tests
> **NO TEST = NO MERGE** — mỗi fix phải có test file matching.

---

## Context (từ verify code thật)

Contrabass có 2 features mya thiếu:
1. **Stall detection** — agent bị kẹt → abort + timeout. mya có SPI `PromptOpts.signal` nhưng **không wire**.
2. **Agent stage/tool classification** — dashboard chỉ hiện "idle|thinking". SPI đã định nghĩa `"tool:<name>"` nhưng runtime collapse thành binary.

### Verify findings (quan trọng — tránh làm sai)

```
FINDING V1: piSession.prompt() KHÔNG nhận signal
  PromptOptions (upstream pi-coding-agent):
    { expandPromptTemplates?, images?, streamingBehavior?, source?, preflightResult? }
  → KHÔNG pass signal được. Fix phải dùng piSession.abort() thay thế.

FINDING V2: piSession.abort() CÓ tồn tại
  AgentSession.abort(): Promise<void>
    → abortRetry() + agent.abort() (AbortController) + waitForIdle()
  → abort turn hiện tại, KHÔNG dispose session. Đúng cái cần.

FINDING V3: abort() khiến prompt() RESOLVE (không reject)
  agent.abort() → handleRunFailure(aborted=true) → agent_settled
  → _runAgentPrompt() resolves bình thường
  → onRunOnSession nhận text (có thể rỗng) thay vì throw
  → Cron sweep thấy "empty response" — sai message nhưng functionally OK

FINDING V4: Tool events có trong PiEventNormalizer
  tool_execution_start → { type: "tool_call", name, toolCallId, args }
  tool_execution_end   → { type: "tool_result", toolCallId, output, error }
  → PiInProcessRuntime nhận nhưng KHÔNG track current tool name

FINDING V5: pi chạy tool PARALLEL (toolExecution default "parallel")
  agent-loop.js:290: if sequential → executeToolCallsSequential
                  else      → executeToolCallsParallel
  → Parallel: emit tool_execution_start cho TẤT CẢ rồi mới await kết quả
  → Nhiều tool_start liên tiếp → KHÔNG có "current single tool"
  → Track "currentToolName" theo start/end → sẽ bị overwrite → SAI

FINDING V6: RuntimePool.release({force}) ĐÃ gọi session.abort()
  pool.ts:199: void Promise.resolve(entry.session.abort()).catch(() => {});
  → "kill session" đã có abort path — chỉ thiếu TIMEOUT tự động
```

**Hệ quả thiết kế**: KHÔNG track "current tool" qua start/end (V5 sai). Thay bằng **snapshot pending tool calls** — đếm số tool đang chạy từ `AgentState.pendingToolCalls`.

---

## Fix 1: Cron Session Timeout (AbortSignal → piSession.abort())

### Problem

Cron sweep `await onRunOnSession(...)` không có timeout. Nếu session bị kẹt (LLM hang, tool hang):
- `cronSweeping = true` mãi mãi → **ALL cron ticks skip** (re-entrancy guard)
- Không có cách abort turn (chỉ có `dispose()` = teardown vĩnh viễn)

### Files thay đổi

| File | Thay đổi |
|---|---|
| `packages/core/src/runtime-spi.ts` | Không đổi — `PromptOpts.signal` ĐÃ CÓ |
| `packages/print/src/runtimes/pi-in-process.ts` | `prompt()`: wire signal → `piSession.abort()` |
| `packages/print/src/main.ts` | `onRunOnSession` signature: thêm `signal` param |
| `packages/gateway/src/index.ts` | `cronSweep`: tạo `AbortController` + `setTimeout` |
| `packages/gateway/src/gateway-types.ts` | `onRunOnSession` type: thêm `signal` param |

### Step 1 — `pi-in-process.ts`: wire signal → abort

```typescript
// packages/print/src/runtimes/pi-in-process.ts
// TRONG async prompt(text, opts?) — hiện tại (line ~207):
async prompt(text: string, opts?: PromptOpts): Promise<void> {
    if (this.disposed) throw new Error("Session disposed");
    this.textBuffer = "";
    this.accumulatedUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    this.turnActive = true;
    this.turnClosed = false;

    this.emit({ type: "turn_start", ... });

    const onAbort = () => {
      // V3: abort() resolve prompt() (không reject) — vẫn cần signal handler
      // vì pi không nhận signal qua PromptOptions
      void this.piSession.abort().catch(() => {});
    };

    const signal = opts?.signal;
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await this.piSession.prompt(text, {
        streamingBehavior: opts?.streamingBehavior ?? "followUp",
      });
      // ... turn_end emit (giữ nguyên)
    } catch (e) {
      // ... error emit (giữ nguyên)
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
}
```

**Chú ý**:
- `addEventListener("abort", onAbort, { once: true })` + `removeEventListener` trong `finally` — tránh leak
- KHÔNG pass signal vào `piSession.prompt()` (upstream không nhận — V1)
- Nếu abort xảy ra, `piSession.abort()` resolve prompt (V3) → textBuffer có partial text → cron thấy "empty response" nếu rỗng
- **R1-3 HARDENING (INFO) — M2 FIX: đây là REPLACEMENT cho phần signal ở trên, không phải thêm mới** (tránh re-declare `const signal`). Đoạn Step 1 hoàn chỉnh:

```typescript
// THAY TOÀN BỘ phần khai báo signal + addEventListener trong prompt() bằng:
const signal = opts?.signal;
const onAbort = () => {
  // V3: abort() resolve prompt() (không reject) — vẫn cần signal handler
  // vì pi không nhận signal qua PromptOptions
  void this.piSession.abort().catch(() => {});
};
if (signal?.aborted) {
  // R1-3: AbortSignal không replay abort event — nếu ĐÃ aborted trước khi vào
  // prompt (prompt queue sau turnLock) → abort ngay, không đợi listener
  void this.piSession.abort().catch(() => {});
}
signal?.addEventListener("abort", onAbort, { once: true });

// finally giữ nguyên:
// signal?.removeEventListener("abort", onAbort);
```

### Step 2 — `main.ts`: onRunOnSession + signal param

```typescript
// packages/print/src/main.ts — doRunOnSession hiện tại (line ~419):
function runOnSession(sessionId: string, prompt: string, onEvent?: (e: unknown) => void): Promise<string> {
    return doRunOnSession(sessionId, prompt, onEvent);
}

// SỬA thành:
function runOnSession(
    sessionId: string,
    prompt: string,
    onEvent?: (e: unknown) => void,
    signal?: AbortSignal,  // THÊM
): Promise<string> {
    return doRunOnSession(sessionId, prompt, onEvent, signal);
}

async function doRunOnSession(
    sessionId: string,
    prompt: string,
    onEvent?: (e: unknown) => void,
    signal?: AbortSignal,  // THÊM
): Promise<string> {
    // ... (giữ nguyên acquire, subscribe, responseText tracking)
    try {
      await session.prompt(prompt, {
        streamingBehavior: "followUp",
        ...(signal ? { signal } : {}),  // THÊM
      });
    } catch (e) {
      // (giữ nguyên error handling)
    }
}
```

**R1-1 FIX (HIGH — QUAN TRỌNG): gateway wiring arrow cũng phải forward signal**

```typescript
// packages/print/src/main.ts — gateway wiring (hiện tại line ~706):
onRunOnSession: (session, prompt, onEvent) => runOnSession(session, prompt, onEvent),

// SỬA thành (forward đủ 4 args):
onRunOnSession: (session, prompt, onEvent, signal) => runOnSession(session, prompt, onEvent, signal),
```

> **Vì sao bắt buộc**: Gateway gọi `this.onRunOnSession(sessionId, prompt, onEvent, controller.signal)` (4 args).
> Nếu arrow chỉ nhận 3 args, signal chết tại boundary → Fix 1 hoàn toàn vô hiệu trong production.
> TypeScript CHO PHÉP assign 3-param function vào 4-param type → pass typecheck, không báo lỗi.
> Đây là lỗi "tests green, prod broken" kinh điển — unit test với mock nhận 4 args vẫn pass,
> nhưng production wiring drop signal. **Bắt buộc sửa cả arrow này.**

### Step 3 — `gateway-types.ts`: update type

```typescript
// packages/gateway/src/gateway-types.ts — hiện tại (line ~130):
onRunOnSession?: (sessionId: string, prompt: string, onEvent?: (e: unknown) => void) => Promise<string>;

// SỬA thành:
onRunOnSession?: (
    sessionId: string,
    prompt: string,
    onEvent?: (e: unknown) => void,
    signal?: AbortSignal,  // THÊM
) => Promise<string>;
```

### Step 4 — `gateway/index.ts`: timeout trong cronSweep

**R1-H2 FIX (HIGH — thêm field + constructor wiring trước khi dùng):**

```typescript
// packages/gateway/src/index.ts — thêm field (gần cronIntervalMs, ~line 117):
/** Timeout (ms) cho mỗi cron-fired session. Quá hạn → abort session turn.
 * 0 = disable (không tạo timer). Mặc định 5 phút. */
private readonly cronSessionTimeoutMs: number;

// packages/gateway/src/index.ts — constructor (gần this.cronIntervalMs = opts.cronIntervalMs ?? 30_000):
this.cronSessionTimeoutMs = opts.cronSessionTimeoutMs ?? 5 * 60_000;
```

```typescript
// packages/gateway/src/index.ts — cronSweep, trong Promise.allSettled batch.map(async (job) => {
// Hiện tại (line ~571):
const sessionId = `_cron:${job.id}`;
const text = await this.onRunOnSession(sessionId, prompt, (e: unknown) => this.broadcast(`_cron:${job.id}`, e));

// SỬA thành:
const sessionId = `_cron:${job.id}`;
const controller = new AbortController();
const timeoutMs = this.cronSessionTimeoutMs; // field ĐÃ có default 5*60_000 từ constructor
let timer: NodeJS.Timeout | undefined;
// R1-2 FIX (HIGH): 0 = disable timeout — KHÔNG setTimeout(fn, 0) (abort tức thì)
if (timeoutMs > 0) {
  timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
}
let text: string | undefined;
try {
  text = await this.onRunOnSession(sessionId, prompt, (e: unknown) => this.broadcast(`_cron:${job.id}`, e), controller.signal);
} finally {
  if (timer) clearTimeout(timer);
}
// → phần còn lại (runOutput = text ?? undefined) giữ nguyên
```

**Chú ý**:
- `cronSessionTimeoutMs` là **Gateway class field** (constructor default `5 * 60_000`), KHÔNG phải chỉ là GatewayOptions — thiếu field → `Property 'cronSessionTimeoutMs' does not exist on type 'Gateway'`
- Nếu timeout: `controller.abort()` → piSession.abort() → prompt resolve với partial text (V3) → cron thấy "empty response" hoặc partial — **không throw, không crash sweep**
- `timer.unref?.()` — không giữ process alive nếu gateway shutdown

### Step 5 — GatewayOptions: thêm cronSessionTimeoutMs

```typescript
// packages/gateway/src/gateway-types.ts — thêm field:
/** Timeout (ms) cho mỗi cron-fired session. Quá hạn → abort session turn.
 * Mặc định 5 phút. 0 = disable timeout (không tạo timer).
 * R1-H1 FIX: undefined KHÔNG disable — default 5 phút qua constructor. */
cronSessionTimeoutMs?: number;
```

### Test plan (Fix 1)

```typescript
// packages/print/src/runtimes/pi-in-process.test.ts — THÊM test case:
describe("prompt signal abort", () => {
  it("[unit] abort signal triggers piSession.abort()", async () => {
    // mock piSession: prompt() giữ promise pending, abort() đánh dấu
    // tạo runtime với mock
    // gọi prompt(text, { signal })
    // controller.abort()
    // assert: mock.abortCalled === true
    // assert: prompt() resolve (V3)
  });
});

// packages/gateway/src/cron-sweep.test.ts — THÊM test case (KHÔNG dùng gateway.test.ts — file đó không tồn tại, R1-5):
describe("cron session timeout", () => {
  it("[unit] cron sweep aborts session sau timeout", async () => {
    // mock onRunOnSession: giữ promise pending, track signal
    // tạo gateway với cronSessionTimeoutMs = 50
    // trigger cronSweep
    // await sleep(100)
    // assert: signal.aborted === true
    // assert: cron complete với "failed" (empty response)
  });
  it("[unit] cronSessionTimeoutMs=0 disables timer (không abort)", async () => {
    // R1-2 regression test
    // mock onRunOnSession resolve nhanh
    // assert: controller.signal.aborted === false
  });
});
```

---

## Fix 2: Tool Status — snapshot pending tool calls

### Problem

`SessionState.status` SPI đã định nghĩa `"tool:<name>"` nhưng `getState()` chỉ trả `"idle" | "thinking"`. Dashboard không biết agent đang chạy tool nào.

### Design decision (sau verify V5)

```
❌ Track qua tool_execution_start/end (sequential assumption — SAI, pi chạy parallel)
❌ getActiveToolNames() (trả tool registry, không phải tool đang chạy)

✅ Snapshot AgentState.pendingToolCalls:
   - AgentState.pendingToolCalls: ReadonlySet<string> — tool call IDs đang chạy
   - Map pendingToolCalls → tool names qua subscribe events
   - Track Map<toolCallId, toolName> từ tool_execution_start events
   - getState(): pendingToolNames = [...map.values()].join(",") → status: "tool:bash,read"
   - Cleanup: tool_execution_end → delete từ map
```

### Files thay đổi

| File | Thay đổi |
|---|---|
| `packages/print/src/runtimes/pi-in-process.ts` | Track `Map<toolCallId, toolName>`; update `getState()` |
| `packages/core/src/runtime-spi.ts` | Không đổi — `status: "tool:<name>"` ĐÃ CÓ |
| `packages/print/src/pi-web-shape.ts` | Không đổi — status pass-through |

### Step 1 — pi-in-process.ts: track pending tool map

```typescript
// packages/print/src/runtimes/pi-in-process.ts — THÊM field:
private pendingToolNames = new Map<string, string>(); // toolCallId → toolName

// TRONG constructor subscribe handler — hiện tại (line ~162):
// Sau phần PiEventNormalizer.toAgentEvent(event, ...):
if (agentEvent) {
    if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
    // THÊM — track tool call names (parallel-safe: Map theo toolCallId):
    if (agentEvent.type === "tool_call") {
      this.pendingToolNames.set(agentEvent.toolCallId, agentEvent.name);
    } else if (agentEvent.type === "tool_result") {
      this.pendingToolNames.delete(agentEvent.toolCallId);
    }
    this.emit(agentEvent);
}
```

### Step 2 — pi-in-process.ts: getState() trả tool names

```typescript
// packages/print/src/runtimes/pi-in-process.ts — getState() hiện tại (line ~271):
getState(): SessionState {
    const usage = this.piSession.getContextUsage?.();
    const pendingTools = [...this.pendingToolNames.values()];
    return {
      model: this.piSession.model?.id ?? "unknown",
      thinking: this.piSession.thinkingLevel,
      // THÊM — status: "tool:<names>" khi có tool đang chạy:
      status: this.piSession.isIdle ? "idle"
        : pendingTools.length > 0 ? `tool:${pendingTools.join(",")}` as SessionState["status"]
        : "thinking",
      tokensIn: this.accumulatedUsage.tokensIn,
      tokensOut: this.accumulatedUsage.tokensOut,
      contextPct: usage?.percent ?? 0,
      contextWindow: usage?.contextWindow ?? 200_000,
      costUsd: this.accumulatedUsage.costUsd ?? 0,
      startedAt: this.createdAt,
      lastActivity: nowWallclock(),
    };
}
```

**Chú ý**:
- Dùng `Map<toolCallId, toolName>` — parallel-safe (mỗi toolCallId riêng)
- `join(",")` cho nhiều tool chạy song song — `"tool:bash,read"`
- Cast `as SessionState["status"]` — type-safe vì SPI string union
- `nowWallclock()` — AGENTS.md invariant (không `Date.now()`)
- **R1-4 HARDENING (INFO) — L2 FIX: đặt clear TRƯỚC early-return `agent_settled`** (hiện tại early-return ở line ~167-190 chặn sau normalizer → clear sau đó là dead code với agent_settled):

```typescript
// TRONG constructor subscribe handler, TRƯỚC if (e.type === "agent_settled") { ...; return; }:
if (e.type === "turn_start" || e.type === "agent_settled") {
  this.pendingToolNames.clear();
}
// ... rồi mới đến agent_settled early-return + normalizer + tool tracking
```

### Test plan (Fix 2)

```typescript
// packages/print/src/runtimes/pi-in-process.test.ts — THÊM test case:
describe("tool status", () => {
  it("[unit] status là tool:name khi tool đang chạy", async () => {
    // mock piSession: isIdle=false, getContextUsage → 10%
    // emit tool_execution_start event → normalizer → tool_call
    // assert: getState().status === "tool:bash"
  });
  it("[unit] status về thinking khi tool xong", async () => {
    // emit tool_execution_end → tool_result
    // assert: getState().status === "thinking"
  });
  it("[unit] parallel tools → status tool:bash,read", async () => {
    // emit 2 tool_execution_start (2 toolCallId)
    // assert: status === "tool:bash,read"
  });
});
```

---

## Verification checklist (sau khi implement)

```
□ typecheck: npx tsc --noEmit -p packages/print/tsconfig.json
□ typecheck: npx tsc --noEmit -p packages/gateway/tsconfig.json
□ test: npx vitest run packages/print/src/runtimes/pi-in-process.test.ts
□ test: npx vitest run packages/gateway/src/cron-sweep.test.ts
□ test: npx vitest run packages/gateway/src/drain-gate.test.ts (cron sweep không bị regression)
□ bundle: npm run bundle
□ real E2E (cron): 
    - MYA_CRON_APPROVAL_MODE=deny (default)
    - Tạo cron job "hi" với 1 phút interval
    - Verify: sweep fire, session complete, broadcast WS
□ real E2E (timeout):
    - Tạo cron job prompt "sleep 300" (bash tool hang)
    - cronSessionTimeoutMs = 10_000
    - Verify: sau 10s session aborted, sweep tiếp tục chạy
```

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| V3: abort resolve (không reject) | Cron thấy "empty response" thay vì "timeout" | Chấp nhận — functionally OK, message hơi sai. Improve sau: detect `signal.aborted` trong main.ts và trả error message riêng |
| `piSession.abort()` chờ `waitForIdle()` mãi nếu agent loop stuck | Timeout không bao giờ resolve → cronSweeping giữ true → ALL cron blocked | **M3 FIX: fix này chỉ cover abort-respecting hangs (LLM hang).** Với tool hang (abort-ignoring): thêm escalation 2× timeout → `pool.release({force})` (dispose session, ĐÃ gọi abort bên trong pool.ts:199). Xem Step 4b bên dưới. Document là known limitation |
| Parallel tools → status nhiều tool | UX hơi noise | `join(",")` — dashboard có thể show tối đa 2 cái |
| Gateway signature change | Typecheck fail nếu bỏ sót caller | Grep tất cả `onRunOnSession(` callers sau khi sửa |

### Step 4b (M3 FIX — escalation cho tool hang)

```typescript
// packages/print/src/main.ts — doRunOnSession, sau khi session.prompt() reject/abort:
// Nếu abort không resolve trong X ms → force-release (dispose) session:
// (escalation tầng 2 — pool.release({force}) gọi entry.session.abort() + delete entry)
```

> **Design note (M3)**: Fix 1 core (AbortController → piSession.abort()) xử lý LLM hang (abort-respecting).
> Tool hang (bash sleep 300 ignore abort) — abort() chờ waitForIdle() mãi → timeout không resolve.
> Giải pháp thực tế: E2E verification phải dùng LLM-hang scenario (không phải bash hang).
> Tool-hang escalation (force-release sau 2× timeout) là OUT OF SCOPE cho plan này — document, không implement.

## Files touched summary

```
packages/print/src/runtimes/pi-in-process.ts   (Fix 1 Step 1 + Fix 2 Steps 1-2)
packages/print/src/main.ts                     (Fix 1 Step 2)
packages/gateway/src/gateway-types.ts          (Fix 1 Steps 3+5)
packages/gateway/src/index.ts                  (Fix 1 Step 4)
packages/print/src/runtimes/pi-in-process.test.ts  (2 fix tests)
packages/gateway/src/cron-sweep.test.ts        (Fix 1 test)
```

## Out of scope (explicitly NOT doing)

```
❌ Stage classification (Exploration→Editing→Testing→Reviewing) — cần git diff tracking,
   không phù hợp in-process (mya thấy tool events trực tiếp). Documented trong analysis.
❌ ETA estimation — mya có contextPct, không cần Contrabass's confidence-banded ETA.
❌ Cron change verification — cron default READ-ONLY (deny mode), không thể sửa code.
❌ Deterministic FNV backoff — single-process, không cần reproducible jitter.
```
