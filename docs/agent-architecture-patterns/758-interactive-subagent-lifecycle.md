# Hướng ACD: Interactive Subagent Lifecycle — subagent có flag `interactive` giữ session sống sau response đầu để multi-turn qua `crew_respond`, dispose bằng `crew_done`

> **Nguồn gốc:** pi-crew (README.md) | **Coupling:** 🟡 — thêm interactive flag + multi-turn protocol vào subagent layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có subagent pool + abort + `<DONE>` — chưa có interactive session giữ sống) | **Effort:** 2 tuần

## Nguồn gốc

**pi-crew** cho phép subagent khai báo **`interactive: true`** — thay vì chạy một lần rồi trả kết quả, subagent **giữ session sống sau response đầu** để nhận tiếp câu hỏi multi-turn qua tool **`crew_respond`**. Lifecycle được quản lý tường minh: tool **`crew_done`** dispose session (giải phóng memory/context), và **abort có phân biệt reason** — "Aborted by tool request" (subagent tự yêu cầu dừng giữa chừng vì lý do nghiệp vụ) khác với shutdown-triggered (hệ thống tắt, ví dụ parent thoát). Nguyên tắc: **interactive ≠ fire-and-forget** — session sống có chủ đích, chết có chủ đích, và lý do chết được ghi rõ.

## Mô tả

mya interactive subagent lifecycle: `spawnSubagent` hiện tại (packages/agent) là một-shot — chạy xong là chết. ACD thêm: (1) **flag `interactive`** trên SubagentOptions — khi bật, session giữ nguyên history sau response đầu, subagent vẫn chạy (status "running"), parent gửi tiếp prompt qua **respond(id, text)**; (2) **tool `crew_respond`** — subagent nhận câu hỏi mới như một turn bình thường trên cùng session (giữ context); (3) **tool `crew_done`** — subagent tự dispose session, trả kết quả cuối cùng, giải phóng memory; (4) **abort reason discriminated** — `AbortReason = "tool-request" | "shutdown" | "user"` — khi subagent abort do tool-request thì output hiện tại vẫn hợp lệ, còn shutdown thì output được đánh dấu không tin cậy. Nối pool.ts (AgentPool) — interactive session tham gia LRU/TTL như session thường.

## Kiến trúc

```
  PARENT                                   SUBAGENT (interactive: true)
    │  spawnSubagent(goal, {interactive})      │
    │──────────────────────────────────────────▶│  turn 1 — response đầu (session sống)
    │  respond(id, "câu hỏi thêm")             │
    │──────────────────────────────────────────▶│  turn 2 — cùng history (context giữ)
    │  respond(id, "kiểm tra lại")             │
    │──────────────────────────────────────────▶│  turn 3
    │◀──────────────────────────────────────────│  tool crew_done → dispose session
    │  done(output, keyOutputs)                 │  (giải phóng memory)
    │  abort(reason="tool-request")  ── output vẫn hợp lệ
    │  abort(reason="shutdown")      ── output đánh dấu không tin cậy
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent subagent (index.ts) — spawnSubagent + SubagentHandle
//   (status running/done/failed/aborted, abort() qua AbortSignal)
// ✅ packages/agent pool.ts — AgentPool (LRU + TTL, sessionFile persist)
// ✅ packages/print mya-bridge.ts — `<DONE>` sentinel + parseDoneResult
//   (structured result summary/keyOutputs — nền cho crew_done output)
// ✅ packages/print role-subagent-spawn.ts — spawn role-subagent (process riêng)
// ✅ packages/print report-subagent-status.ts — working/done status POST (nền abort reason)

// ❌ THIẾU: interactive flag (session sống sau response đầu)
// ❌ THIẾU: respond(id, text) multi-turn protocol
// ❌ THIẾU: abort reason phân biệt (tool-request vs shutdown-triggered)
```
## Implementation
```typescript
// packages/agent/src/interactive.ts (MỚI)
import type { SubagentHandle, SubagentStatus } from "./index.js";
export type InteractiveStatus = SubagentStatus | "awaiting";
export type AbortReason = "tool-request" | "shutdown" | "user";
export interface InteractiveSubagentOptions {
  interactive?: boolean;
  /** Turn cap — chống interactive session sống vô hạn. */
  maxTurns?: number;
}
export interface InteractiveHandle extends SubagentHandle {
  /** Gửi turn tiếp theo vào cùng session (giữ history/context). */
  respond(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
  /** Subagent tự dispose (crew_done analog) — giải phóng memory. */
  done(output: string, keyOutputs?: string[]): void;
  readonly turns: number;
  readonly abortReason?: AbortReason;
}
const DEFAULT_MAX_TURNS = 8;
/** Wrap một SubagentHandle một-shot thành interactive lifecycle. */
export function toInteractive(sub: SubagentHandle, opts: InteractiveSubagentOptions = {}): InteractiveHandle {
  if (!opts.interactive) return sub as InteractiveHandle;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const queue: string[] = [sub.goal]; // turn 0 = goal ban đầu
  let turns = 0;
  let abortReason: AbortReason | undefined;
  return {
    ...sub,
    get turns() { return turns; },
    get abortReason() { return abortReason; },
    async respond(text, o = {}) {
      if (sub.status !== "running" && sub.status !== "awaiting") {
        throw new Error(`interactive subagent ${sub.id} không còn sống (${sub.status})`);
      }
      if (turns >= maxTurns) {
        abortReason = "tool-request";
        throw new Error(`interactive subagent vượt maxTurns=${maxTurns}`);
      }
      queue.push(text);
      turns += 1;
      return sub.wait(); // turn mới chạy trên cùng session (implementer: nối prompt loop)
    },
    done(output, keyOutputs = []) {
      abortReason = "tool-request"; // tự dispose — output hợp lệ
      sub.output = output;
      (sub as { keyOutputs?: string[] }).keyOutputs = keyOutputs;
      sub.abort(); // mark aborted + cancel turn — implementer: đổi thành dispose session
    },
    abort() {
      // Override: nếu abort từ parent (không phải tool-request) → reason khác
      abortReason = "shutdown";
      sub.abort();
    },
  };
}
//        await sub.respond("giải thích thêm"); sub.done("xong", ["file.ts"]);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Multi-turn hỏi đáp với context giữ nguyên (không re-spawn tốn token) | ❌ Session sống lâu hơn → memory không được giải phóng sớm |
| ✅ Abort reason tách bạch — output tool-request vẫn dùng được | ❌ Cần protocol respond/done — surface API lớn hơn |
| ✅ `<DONE>` + keyOutputs tái dùng cho kết quả cuối | ❌ Interactive session cần timeout/TTL riêng (chống quên dispose) |
| ✅ Nối AgentPool — LRU/TTL áp dụng được | ❌ MaxTurns phải config — nếu thiếu là memory leak tiềm ẩn |

## Khác các hướng gần

| | Fire-and-forget (AAA) | ACD: Interactive Subagent |
|---|---|---|
| Vòng đời | Gửi observation 1 chiều, không trả lời | **Session sống nhiều turn, respond/done 2 chiều** |
| Memory | Worker giữ state bền | **Dispose chủ động qua crew_done** |
| Abort | Không có reason | **Phân biệt tool-request vs shutdown** |
| Dùng khi | Observation bất đồng bộ | **Cần hỏi đáp sâu với context giữ** |

## Khi nào chọn

- Subagent cần hỏi đáp nhiều vòng (interview, review điều tra, refine) — re-spawn mỗi vòng tốn context
- Cần kết quả cuối có cấu trúc (`<DONE>` + keyOutputs) nhưng vẫn muốn hỏi thêm giữa chừng
- Muốn phân biệt "subagent tự dừng vì xong" với "hệ thống tắt giữa chừng"
- Guard: maxTurns bắt buộc, timeout/TTL cho session interactive, abort reason ghi vào audit
