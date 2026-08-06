# Hướng AIR: Abort Signal Threading — ESC interrupt thread qua `Agent.execute → manager.spawnAndWait() → SpawnOptions.signal`; `startAgent()` attach abort listener detach ở cả `.then`/`.catch`

> **Nguồn gốc:** pi-subagents2 | **Coupling:** 🟡 — xuyên spawn boundary (parent → child) | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (spawnSubagent signal + runTurn signal; thiếu background-agent no-forward) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents2** thread **ESC interrupt** xuyên toàn bộ delegation chain: `Agent.execute → manager.spawnAndWait() → SpawnOptions.signal`. `startAgent()` **attach `{ once: true }` abort listener** gọi `this.abort(id)` (status "stopped") và **detach ở cả `.then` lẫn `.catch`** — không rò rỉ listener, không double-abort. Điểm tinh tế: **background agents cố tình không forward signal** — background phải sống lâu hơn tool call đã spawn nó (signal của tool call không được giết background job).

Nguyên tắc: **interrupt phải thread qua mọi boundary (execute → spawnAndWait → SpawnOptions.signal)** — không chỉ abort turn hiện tại; **listener attach `{once:true}` + detach ở cả thành công lẫn thất bại** (không leak, không abort nhầm turn sau); **forward signal là quyết định có chủ đích** — foreground delegation forward, background job không forward (sống lâu hơn caller).

## Mô tả

Với mya, pattern = **AbortSignal threading hoàn chỉnh**: (1) **core/loop.ts đã hỗ trợ** — `runTurn({ signal })`, internal AbortController, `signal.addEventListener("abort", () => cancel("abort signal"))` — nền đúng; (2) **agent/src/index.ts `spawnSubagent` đã forward** — `options.signal` → external AbortController combine internal `ac`, `{ once: true }` listener cập nhật status "aborted" — đúng pattern; (3) **sdk.ts `prompt/stream`** nhận `opts.signal` → `runTurn` — đúng; (4) **thiếu**: spawnAndWait cấp manager (AgentPool/print pool spawn child process), detach listener ở `.catch` (mya detach tự nhiên qua addEventListener trả về hàm — cần đảm bảo ở cả then/catch), và **background job policy** — task chạy nền không forward signal của tool call (giống background agents pi-subagents2). Nối intercom `cancelAsk` (hủy message chờ reply) + `waitForReply(signal)` — đã dùng signal đúng cách.

## Kiến trúc (ASCII)

```
  USER (ESC) ──► Agent.execute
                  │
                  ▼
             manager.spawnAndWait()
                  │  SpawnOptions.signal
                  ▼
             CHILD PROCESS / SUBAGENT
                  │  startAgent():
                  │    signal.addEventListener("abort", () => this.abort(id),
                  │                             { once: true })
                  │    // detach ở .then VÀ .catch — không leak listener
                  ▼
             status = "stopped" (child bị abort đúng chỗ)
  ── FOREGROUND delegation: signal FORWARD (abort cha ⇒ abort con)
  ── BACKGROUND job: signal KHÔNG forward (sống lâu hơn tool call đã spawn)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — runTurn({ signal }) + cancel("abort signal")
// ✅ packages/agent sdk.ts — prompt/stream nhận opts.signal → runTurn
// ✅ packages/agent index.ts — spawnSubagent options.signal → ac.abort + {once:true}
// ✅ packages/intercom intercom.ts — waitForReply(signal, cancelOnAbort) + cancelAsk
// ✅ packages/core types.ts — TurnContext.cancel?: AbortSignal

// ❌ THIẾU: spawnAndWait cấp manager (AgentPool/print pool) nhận signal
// ❌ THIẾU: detach listener ở .catch (hiện only-abort-path)
// ❌ THIẾU: background job policy — không forward signal tool call
```

## Implementation

```typescript
// packages/agent/src/abort-threading.ts (NEW)
/** Attach abort listener an toàn: { once: true } + detach ở CẢ then và catch. */
export function onAbortSafe(
  signal: AbortSignal,
  handler: () => void,
): () => void {
  if (signal.aborted) { handler(); return () => {}; }
  const off = () => signal.removeEventListener("abort", handler);
  signal.addEventListener("abort", handler, { once: true });
  return off;
}

/** spawnAndWait — spawn subagent kèm signal; abort → status "stopped". */
export async function spawnAndWait(
  spawn: () => { id: string; abort(): void; wait(): Promise<string> },
  opts: { signal?: AbortSignal; forward: boolean },   // forward=false: background
): Promise<{ id: string; output: string; stopped: boolean }> {
  const handle = spawn();
  if (opts.signal && opts.forward) {
    const off = onAbortSafe(opts.signal, () => handle.abort());
    try {
      const output = await handle.wait();
      off();                       // detach ở thành công
      return { id: handle.id, output, stopped: false };
    } catch (e) {
      off();                       // detach ở thất bại — không leak listener
      throw e;
    }
  }
  const output = await handle.wait();   // background: không forward signal
  return { id: handle.id, output, stopped: false };
}
// spawnSubagent: dùng onAbortSafe thay cho addEventListener trực tiếp.
// Background jobs (agent "background" mode): forward=false — sống lâu hơn caller.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Interrupt xuyên chain delegation — không abort hụt | ❌ Forward nhầm vào background job giết job đang chạy |
| ✅ Không leak listener (detach then+catch) | ❌ AbortListener chạy sync — handler nặng làm chặn event loop |
| ✅ Status rõ "stopped" thay vì mơ hồ | ❌ Signal aborted sẵn phải check trước (pre-abort) |
| ✅ Nối waitForReply/cancelAsk (intercom) | ❌ Child spawn ngoài process cần kill thật, không chỉ cờ |

## Khác các hướng gần

| | AIR Abort Threading | ADE Mailbox Dispatch | AIP Allowed-Env |
|---|---|---|---|
| Trọng tâm | Điều khiển lifecycle qua signal | Audit messaging | Ranh giới quyền |
| Cơ chế | AbortSignal + listener {once:true} | State machine + idempotent | Env + registry filter |
| Quan hệ | Nối spawn lifecycle | Nối messaging | Nối spawn boundary |

## Khi nào chọn

- Interrupt (ESC/ctrl-c) phải dừng cả chuỗi delegation, không chỉ turn hiện tại
- Spawn nhiều subagent — cần abort đúng con, không rò rỉ listener
- Phân biệt foreground (forward) vs background (sống lâu hơn caller)
- Guard: pre-abort check, {once:true} + detach cả then/catch, background policy tường minh