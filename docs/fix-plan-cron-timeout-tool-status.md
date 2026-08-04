# Fix Plan: Cron Session Timeout + Tool Status (2 fixes from Contrabass review)

> **Source**: Contrabass analysis — `docs/contrabass-analysis.md` → "2 fixes thật sự đáng làm"
> **Status**: Round 8 (final fix verification, qwen3.7-max) — **ZERO CRITICAL/HIGH** (CLEAN #3) + 3 LOW fixed (R8-LOW-1..3). Clean streak: 3 (R6/R7/R8). **Plan FINAL — user gate đạt: 2+ consecutive rounds zero findings mọi severity (R7 còn LOW đã fix ở R7; R8 LOW đã fix; chờ Round 9 confirm zero findings toàn bộ).**
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
  → R5-1 FIX: doRunOnSession detect signal.aborted → trả marker "[error: cron session timed out]"
    → cronSweep detect marker → complete "failed" (không false success, message đúng)

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

**Hệ quả thiết kế**: KHÔNG track "current tool" qua start/end (V5 sai). Thay bằng **track qua subscribe events** — Map<toolCallId, toolName> từ tool_execution_start → tool_call (xem Fix 2).

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
// TRONG async prompt(text, opts?) — hình dung MỤC TIÊU (illustration — KHÔNG phải source hiện tại):
// source hiện tại (line ~207) KHÔNG có signal handling nào. Đoạn này chỉ để hình dung target.
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
- **BEFORE block trên (lines 92-110) chỉ để minh họa — KHÔNG áp dụng. Chỉ áp dụng đoạn THAY TOÀN BỘ bên dưới.** (R5-LOW: tránh implementer copy nhầm version cũ)
- `addEventListener("abort", onAbort, { once: true })` + `removeEventListener` trong `finally` — tránh leak
- KHÔNG pass signal vào `piSession.prompt()` (upstream không nhận — V1)
- Nếu abort xảy ra, `piSession.abort()` resolve prompt (V3) → doRunOnSession detect `signal.aborted` → trả marker (R4-2/R5-1) → cron thấy "failed" với lý do timeout
- **R1-3 HARDENING (INFO) — M2 FIX: đây là REPLACEMENT cho phần signal ở trên, không phải thêm mới** (tránh re-declare `const signal`). Đoạn Step 1 hoàn chỉnh:

```typescript
// THAY TOÀN BỘ phần khai báo signal + addEventListener trong prompt() bằng:
// R8-LOW-3: `this.pendingToolNames` được declare ở Fix 2 Step 1 — implement Fix 1 trước
// sẽ typecheck fail (`Property 'pendingToolNames' does not exist`). Same-file change-set,
// implement cả 2 fix cùng lúc hoặc thêm field trước. Ordering note.
// R7-2 FIX (MEDIUM): clear pendingToolNames ở đầu prompt() (R8-LOW-2: thực tế SAU
// turn_start emit ở trên — comment "trước turn_start" sai; functional OK vì getState poll-based)
// agent_settled KHÔNG luôn fire (pi-in-process.test.ts:81 safety net: prompt() success/catch
// paths emit turn_end mà không có agent_settled) → stale "tool:bash" leak sang turn sau.
this.pendingToolNames.clear();
const signal = opts?.signal;
if (signal?.aborted) {
  // R1-3 + R2-5: AbortSignal không replay abort event. Nếu ĐÃ aborted trước khi vào
  // prompt (queue sau turnLock) → short-circuit NGAY: không gọi piSession.prompt
  // (piSession đang idle, abort() chả abort gì — R2-5). Emit turn_start đã xảy ra ở trên,
  // nên emit turn_end đóng turn rỗng → doRunOnSession detect aborted → marker (R4-2/R5-1)
  this.turnActive = false;
  this.turnClosed = true;
  this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
  return;
}
const onAbort = () => {
  // V3: abort() resolve prompt() (không reject) — vẫn cần signal handler
  // vì pi không nhận signal qua PromptOptions
  void this.piSession.abort().catch(() => {});
};
signal?.addEventListener("abort", onAbort, { once: true });

// finally giữ nguyên:
// signal?.removeEventListener("abort", onAbort);
```

### Step 2 — `main.ts`: onRunOnSession + signal param

```typescript
// packages/print/src/main.ts — doRunOnSession hiện tại (line ~423; runOnSession wrapper ~419):
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
      // R4-2/R5-1 FIX: abort resolve với partial text → KHÔNG trả partial như success.
      // Detect signal.aborted → trả error marker để cronSweep complete "failed" với lý do đúng
      // (tránh false success khi timeout giữa chừng — textBuffer có partial).
      // R7-LOW-1 note: boundary race — timer fire ngay sau khi prompt resolve với full text
      // (microtask gap) → marker → complete "failed" dù text đầy đủ. Chấp nhận (deadline semantics).
      if (signal?.aborted) return "[error: cron session timed out]";
    } catch (e) {
      // R5-1 note (HIGH): non-V3 edge — nếu pi THROW khi abort (không resolve như V3),
      // partial responseText sẽ return như success. Guard: detect signal.aborted trong catch
      // và trả marker thay vì partial:
      if (signal?.aborted) return "[error: cron session timed out]";
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
// packages/gateway/src/gateway-types.ts — hiện tại (line ~132):
onRunOnSession?: (sessionId: string, prompt: string, onEvent?: (e: unknown) => void) => Promise<string>;

// SỬA thành:
onRunOnSession?: (
    sessionId: string,
    prompt: string,
    onEvent?: (e: unknown) => void,
    signal?: AbortSignal,  // THÊM
) => Promise<string>;
```

### Step 3b (R2-1 CRITICAL FIX) — `gateway/index.ts`: update CLASS FIELD type (bắt buộc)

> **Vì sao cần**: `GatewayOptions` (Step 3) là type khởi tạo, nhưng cronSweep gọi **class field**
> `this.onRunOnSession` — field này được khai báo riêng với type 3-param tại index.ts:101.
> Không sửa field → `TS2554: Expected 3 arguments, but got 4` khi Step 4 gọi 4 args.

```typescript
// packages/gateway/src/index.ts — hiện tại (line ~101):
private readonly onRunOnSession?: (sessionId: string, prompt: string, onEvent?: (e: unknown) => void) => Promise<string>;

// SỬA thành (đồng bộ với Step 3):
private readonly onRunOnSession?: (
    sessionId: string,
    prompt: string,
    onEvent?: (e: unknown) => void,
    signal?: AbortSignal,  // THÊM
) => Promise<string>;
```

**Kiểm tra**: sau khi sửa, grep toàn bộ `onRunOnSession` trong repo — type ở 2 nơi (gateway-types.ts Step 3 + index.ts Step 3b) phải khớp nhau và khớp với arrow wiring ở main.ts:706 (R1-1).

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

**R7-3 FIX (MEDIUM — env plumbing):** thêm vào Gateway construction (main.ts ~line 633):
```typescript
// R8-LOW-1 FIX: env=0 phải disable (KHÔNG dùng `parseInt || undefined` — 0 → undefined → default 5 min)
const cronSessionTimeoutMsEnv = Number(process.env.MYA_CRON_SESSION_TIMEOUT_MS);
cronSessionTimeoutMs: Number.isFinite(cronSessionTimeoutMsEnv) && cronSessionTimeoutMsEnv >= 0 ? cronSessionTimeoutMsEnv : undefined,
```
Đồng bộ pattern `MYA_CRON_*` env khác (MYA_CRON_MAX_JOBS, MYA_CRON_APPROVAL_MODE). Không có env → undefined → default 5 phút qua constructor. `MYA_CRON_SESSION_TIMEOUT_MS=0` → disable. E2E dùng `MYA_CRON_SESSION_TIMEOUT_MS=10000`.

```typescript
// packages/gateway/src/index.ts — cronSweep, trong Promise.allSettled batch.map(async (job) => {
// Hiện tại (line ~571):
const sessionId = `_cron:${job.id}`;
const text = await this.onRunOnSession(sessionId, prompt, (e: unknown) => this.broadcast(`_cron:${job.id}`, e));

// SỬA thành (R2-4: THAY THẾ toàn bộ dòng const text = await ... — không để dư 2 declaration):
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
// R5-1 FIX (HIGH): doRunOnSession trả "[error: cron session timed out]" khi abort —
// marker NON-EMPTY → phần classify hiện tại (`text == null || trim()===""`) sẽ coi là SUCCESS
// (false success!). Phải detect marker TRƯỚC phần classify:
// R6-1 FIX (MEDIUM): exact-match marker — KHÔNG startsWith("[error:") vì đụng format
// `[error: ${message}]` có sẵn (main.ts:455) → mất message thật của non-abort errors.
const TIMEOUT_MARKER = "[error: cron session timed out]";
if (text === TIMEOUT_MARKER) {
  this.cron!.complete(run.runId, "failed", "cron session timed out");
} else {
// → phần còn lại (runOutput = text ?? undefined + classify succeeded/failed) giữ nguyên, đóng else:
}
```

**Chú ý**:
- `cronSessionTimeoutMs` là **Gateway class field** (constructor default `5 * 60_000`), KHÔNG phải chỉ là GatewayOptions — thiếu field → `Property 'cronSessionTimeoutMs' does not exist on type 'Gateway'`
- Nếu timeout: `controller.abort()` → piSession.abort() → prompt resolve với partial text (V3) → doRunOnSession detect `signal.aborted` → trả marker `"[error: cron session timed out]"` → cronSweep detect marker → complete "failed" — **không throw, không crash sweep, không false success**
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
    // mock piSession: prompt() giữ promise pending (deferred), abort() resolve deferred + đánh dấu
    // R2-LOW FIX: mock abort phải resolve pending promise — nếu không test hang mãi
    //   let resolvePending!: () => void;
    //   const pending = new Promise<void>((r) => { resolvePending = r; });
    //   mock.prompt = () => pending; mock.abort = () => { abortCalled = true; resolvePending(); return Promise.resolve(); };
    //   R7-1 FIX: mock.abort phải RETURN Promise — Step 1 impl gọi `void this.piSession.abort().catch(() => {})`;
    //   nếu abort() trả undefined → undefined.catch throws TypeError → controller.abort() lỗi → test fail.
    // tạo runtime với mock
    // gọi prompt(text, { signal })
    // controller.abort()
    // assert: mock.abortCalled === true
    // assert: prompt() resolve (V3 — vì abort() resolve deferred)
  });
});

// packages/gateway/src/cron-sweep.test.ts — THÊM test case (KHÔNG dùng gateway.test.ts — file đó không tồn tại, R1-5):
describe("cron session timeout", () => {
  it("[unit] cron sweep aborts session sau timeout", async () => {
    // mock onRunOnSession: giữ promise pending, track signal
    // R4-LOW FIX: mock phải resolve pending promise khi signal abort — nếu không
    //   cronSweep await mãi → test hang. Mock mẫu:
    //   let resolvePending!: () => void;
    //   let sig: AbortSignal | undefined;
    //   const pending = new Promise<string>((r) => { resolvePending = r; });
    //   mockOnRunOnSession = (sid, p, onEvent, signal) => {
    //     sig = signal;
    //     signal?.addEventListener("abort", () => resolvePending("[error: cron session timed out]"));
    //     return pending;
    //   };
    // tạo gateway với cronSessionTimeoutMs = 50
    // trigger cronSweep
    // await sleep(100)
    // R5-LOW FIX: controller là local trong cronSweep — phải capture qua mock param:
    // assert: sig?.aborted === true
    // assert: cron complete với "failed" (marker detect — R5-1)
    // R7-LOW-2 note: test này hơi tautological — mock tự resolve marker, chỉ cover
    // cronSweep classification. Chain abort→piSession.abort()→marker (Step 2) + R1-1 4-arg
    // forward chỉ cover bằng real E2E (xem checklist). Chấp nhận — E2E bắt buộc.
  });
  it("[unit] cronSessionTimeoutMs=0 disables timer (không abort)", async () => {
    // R1-2 regression test
    // mock onRunOnSession resolve nhanh
    // assert: controller.signal.aborted === false
  });
});
```

---

## Fix 2: Tool Status — track pending tool names

### Problem

`SessionState.status` SPI đã định nghĩa `"tool:<name>"` nhưng `getState()` chỉ trả `"idle" | "thinking"`. Dashboard không biết agent đang chạy tool nào.

### Design decision (sau verify V5)

```
❌ Track qua tool_execution_start/end (sequential assumption — SAI, pi chạy parallel)
❌ getActiveToolNames() (trả tool registry, không phải tool đang chạy)

✅ Track qua subscribe events (R2-LOW FIX — design/code khớp):
   - Track Map<toolCallId, toolName> từ tool_execution_start → toAgentEvent → tool_call
   - (KHÔNG đọc AgentState.pendingToolCalls — toolCallId → name mapping chỉ có qua events; pendingToolCalls chỉ là Set<toolCallId> không có name)
   - getState(): pendingToolNames = [...map.values()].join(",") → status: "tool:bash,read"
   - Cleanup: tool_execution_end → delete từ map
```

### Files thay đổi

| File | Thay đổi |
|---|---|
| `packages/print/src/runtimes/pi-in-process.ts` | Track `Map<toolCallId, toolName>`; update `getState()` |
| `packages/print/src/main.ts` | **(R2-2 FIX) poolStatus consumer** — expose `status` từ `getState()` |
| `packages/core/src/runtime-spi.ts` | Không đổi — `status: "tool:<name>"` ĐÃ CÓ |
| `packages/print/src/pi-web-shape.ts` | Không đổi — event-shape only, không có status field |

> **R2-2 FIX (HIGH — quyết định consumer)**: Fix 2 chỉ hữu ích nếu có consumer đọc `getState().status`.
> Verify thực tế: KHÔNG có consumer nào (web/desktop/TUI không đọc `SessionState`; `poolStatus` ở main.ts:712
> chỉ đọc `meta?.status` — status từ SessionMetaStore, không phải `getState()`).
> Nếu không wire, Fix 2 compile + unit test pass nhưng **silent no-op**.
>
> **Quyết định (R2-2)**: wire consumer trong CÙNG plan này — thêm `status` vào `poolStatus()`:
>
> ```typescript
> // packages/print/src/main.ts — poolStatus (line ~712):
> poolStatus: () => pool.list().map((e) => {
>   const meta = sessionMeta.get(e.sessionId);
>   return {
>     sessionId: e.sessionId, messages: e.messageCount, lastActivity: e.lastActivity,
>     busy: e.busy, sessionFile: e.sessionFile, role: meta?.role, task: meta?.task,
>     model: meta?.model, parentSessionId: meta?.parentSessionId, status: meta?.status,
>     summary: meta?.summary, keyOutputs: meta?.keyOutputs,
>     // R2-2 THÊM: runtime tool status từ getState() (Fix 2) — fallback meta status nếu không có
>     toolStatus: e.session?.getState?.().status,
>   };
> }),
> ```
>
> Lưu ý: `AgentSession` interface (packages/agent/src/pool.ts:33) chỉ có `prompt/subscribe/abort/sessionFile` —
> **không có `getState()`**. RuntimeSessionAdapter (adapter.ts:90) implement `getState()`, nên dùng
> `(e.session as { getState?(): { status: string } }).getState?.()` hoặc thêm `getState()` vào interface.
> Chọn: thêm `getState?(): { status: string }` vào `AgentSession` interface (packages/agent/src/pool.ts) —
> optional để không phá các impl khác; adapter implement sẵn.
>
> **R4-LOW note (follow-up)**: `poolStatus` expose `toolStatus` qua `/pool/sessions` (index.ts:1212),
> nhưng WEB dashboard chưa render field này — cần web-side change (ngoài scope plan này).
> Follow-up: thêm toolStatus vào dashboard session list khi cần.

### Step 1 — pi-in-process.ts: track pending tool map

```typescript
// packages/print/src/runtimes/pi-in-process.ts — THÊM field:
private pendingToolNames = new Map<string, string>(); // toolCallId → toolName

// TRONG constructor subscribe handler — hiện tại (line ~162):
// Sau phần PiEventNormalizer.toAgentEvent(event, ...):
// R6-LOW-2 FIX: chỉ 1 canonical version (R4-1 guarded) — xóa unguarded BEFORE:
if (agentEvent) {
    if (agentEvent.type === "text") this.textBuffer += agentEvent.delta;
    // R4-1: guard CHỈ map-op — KHÔNG return sớm (drop tool events khỏi stream):
    if (agentEvent.type === "tool_call" && agentEvent.toolCallId && agentEvent.name) {
      this.pendingToolNames.set(agentEvent.toolCallId, agentEvent.name);
    } else if (agentEvent.type === "tool_result" && agentEvent.toolCallId) {
      this.pendingToolNames.delete(agentEvent.toolCallId);
    }
    this.emit(agentEvent);
}
```

> **R6-LOW-5 FIX**: guard thêm `&& agentEvent.name` — normalizer emit `name: toolName ?? ""` (pi-event-normalizer.ts:59); valid id + missing name → status `"tool:"` (empty). Với `&& name` → bỏ qua, không tạo empty status.

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
- **R2-LOW FIX (SPI union widening)**: `"tool:bash,read"` rộng hơn union `"tool:<name>"` (1 name). Cast `as SessionState["status"]` hợp lệ. Nếu muốn type-safe nghiêm ngặt: mở rộng union thành `"tool:<name>" | "tool:<name>,<name>"` — plan này giữ cast, ghi chú trong code comment.
- **R2-LOW FIX (toolCallId fallback — R4-1 SỬA)**: normalizer map `tool_execution_start` với `toolCallId ?? ""` — malformed event → key "" collides. Guard CHỈ map-op (canonical ở Step 1 trên), KHÔNG `return` — return sớm trong subscribe callback sẽ drop tool_call/tool_result khỏi AgentEvent stream → dashboard mất event.
- **R1-4 HARDENING (INFO) — L2 FIX: đặt clear TRƯỚC early-return `agent_settled`** (hiện tại early-return ở line ~167-190 chặn sau normalizer → clear sau đó là dead code với agent_settled):
- **R2-6 FIX (MEDIUM — rationale sửa): `turn_start` LÀ event thật** — agent-loop.js:50/68/90 emit `turn_start`, user listeners NHẬN qua `_handleAgentEvent` → `_emit(event)`. Nhưng: normalizer KHÔNG map `turn_start` (default null), và pi-in-process.ts subscribe handler không có branch riêng cho nó. Nếu clear ở `turn_start` trong subscribe handler thì cần check `e.type === "turn_start"` TRƯỚC (raw event). Thực tế chỉ cần `agent_settled` — fire ở mọi turn end (bao gồm abort) — nên clear tại đó là đủ và đơn giản hơn. Quyết định giữ nguyên: chỉ clear ở `agent_settled`.

```typescript
// TRONG constructor subscribe handler, TRƯỚC if (e.type === "agent_settled") { ...; return; }:
// R6-LOW-3: MERGE vào branch agent_settled hiện có (không tạo branch thứ 2 cùng condition):
if (e.type === "agent_settled") {
  this.pendingToolNames.clear();  // THÊM dòng này vào đầu branch agent_settled hiện có
  // ... (giữ nguyên turnClosed/turnActive/emit turn_end logic)
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
    - R2-3 FIX (HIGH): dùng LLM-hang scenario (abort-respecting), KHÔNG dùng bash sleep hang
      (tool hang abort-ignoring → waitForIdle() không resolve → timeout không fire — known limitation, M3)
    - Setup: cron job prompt tới model endpoint stalled/blackholed (hoặc prompt loop vô hạn)
    - Setup: cron job prompt tới model endpoint stalled/blackholed (hoặc prompt loop vô hạn)
    - MYA_CRON_SESSION_TIMEOUT_MS=10000 (R7-3 env plumbing)
    - Verify: sau ~10s session aborted, sweep tiếp tục chạy (không block ALL cron),
      cron run status = "failed" với lý do timeout (R5-1 marker detect — KHÔNG false success)
    - (Tùy chọn, exploratory) bash sleep 300 hang → verify sweep vẫn blocked → xác nhận known limitation
```

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| V3: abort resolve (không reject) | Cron thấy "empty response" thay vì "timeout" | **R5-1 FIX (HIGH — promoted từ R4-2)**: detect `signal.aborted` trong main.ts doRunOnSession sau khi prompt resolve → trả marker `"[error: cron session timed out]"` → cronSweep exact-match marker → complete "failed" với lý do đúng (R6-1: exact-match, không startsWith — tránh mất message thật của non-abort errors). Xem Step 2 + Step 4 |
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
>
> **R7-LOW-4 note (edge)**: mid-cron force-release (poolKill trong lúc run) — `pool.release({force})`
> → adapter.abort() → dispose trong khi piSession.prompt pending; prompt có settle sau dispose hay không
> chưa verify. Nếu không settle → sweep hang (timeout's abort trên disposed session không cứu).
> Pre-existing class (operator action). Verify 1 lần trong E2E.

## Files touched summary

```
packages/print/src/runtimes/pi-in-process.ts   (Fix 1 Step 1 + Fix 2 Steps 1-2)
packages/print/src/main.ts                     (Fix 1 Step 2 + R2-2 poolStatus consumer + R7-3 env plumbing)
packages/agent/src/pool.ts                     (R2-2: thêm getState?() vào AgentSession interface)
packages/gateway/src/gateway-types.ts          (Fix 1 Steps 3+5)
packages/gateway/src/index.ts                  (Fix 1 Step 3b field type + Step 4)
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
