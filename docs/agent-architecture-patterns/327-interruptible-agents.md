# Hướng LO: Interruptible Agents — agent có thể bị ngắt giữa task, stop/redirect sạch

> **Nguồn gốc:** "Cancellation tokens" (C# / Go context); "cooperative cancellation"; SIGINT handling; "graceful shutdown"; "preemptible" computing; checkpoint/restore; user-in-the-loop
> **Coupling:** 🟡 — chạm agent-loop + tool-exec + state
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + checkpoint sẵn — thiếu interrupt signal + cooperative-cancel + clean-stop + redirect)
> **Effort:** 3-4 tuần

## Nguồn gốc

Cancellation tokens (C#/Go): truyền token qua call chain → caller set cancel → callee check + abort **cooperatively** (clean, not kill -9). Graceful shutdown: nhận SIGINT → finish current op → cleanup → exit (vs force-kill leak). Preemptible (cloud): VM có thể bị preempt → checkpoint state → resume later. User-in-the-loop: user interrupt giữa chừng → redirect ("thôi không làm X nữa, làm Y đi"). Checkpoint/restore: save state → resume từ điểm đó. Cốt lõi: **agent chạy lâu → user cần ngắt** — phải (1) nhận signal, (2) dừng sạch (finish atomic op, không half-state), (3) redirect hoặc resume.

## Mô tả

mya interruptible: user Ctrl-C hoặc "stop" giữa agent turn → (1) **signal** — cancellation token set; (2) **cooperative** — agent check token giữa LLM call / tool step → abort sạch (không để half-edit); (3) **checkpoint** — save progress (đã làm tới đâu) → có thể resume; (4) **redirect** — user nói "làm Y thay" → agent discard X, start Y. AGENTS.md: no `process::exit` in natives → phải cooperative (NativeResult). Nối 317 cross-agent-txn (compensate on interrupt), 328 deferred-questions (pause for question).

## Kiến trúc

```
  USER: [Ctrl-C / "stop"]  or  "actually do Y instead"
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  CANCELLATION TOKEN (set by user)                    │
  │  token.cancel() → all in-flight ops see it           │
  └──────────────────┬───────────────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  AGENT LOOP (cooperative — checks token at steps)    │
  │                                                      │
  │  step: LLM generate                                  │
  │    · check token before start → if cancel: abort     │
  │    · (or AbortController on fetch)                   │
  │  step: tool.edit (write file)                        │
  │    · ATOMIC: finish write, then check token          │
  │    · ❌ never leave half-written file                 │
  │  step: tool.test                                     │
  │    · check token → if cancel: skip (don't start)     │
  └──────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────────┐    ┌──────────────────────────┐
  │ CHECKPOINT       │    │ REDIRECT                 │
  │ save progress:   │    │ user: "do Y instead"     │
  │  · steps done    │    │ → discard X state        │
  │  · partial result│    │ → compensate (317)       │
  │ → resume later   │    │ → start Y fresh          │
  └──────────────────┘    └──────────────────────────┘
```

```
mya: agent-loop + AbortController-ready fetch sẵn — thiếu interrupt token threading + checkpoint + redirect
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — agent-loop (sẵn — check points here)
// ✅ AbortController — fetch cancellation (sẵn — LLM call cancel)
// ✅ 317 cross-agent-txn — compensate on interrupt (documented)
// ✅ AGENTS.md no process::exit — cooperative (NativeResult)

// ❌ THIẾU: cancellation token threaded through loop + tools
// ❌ THIẾU: checkpoint (save progress → resume)
// ❌ THIẾU: clean-stop (finish atomic op before abort)
// ❌ THIẾU: redirect handler (discard X, start Y)
```

## Implementation

```typescript
// packages/agent/src/interrupt.ts (NEW)
export class CancellationToken {
  private cancelled = false;
  private listeners: (() => void)[] = [];
  cancel(): void { this.cancelled = true; this.listeners.forEach((l) => l()); }
  get isCancelled(): boolean { return this.cancelled; }
  onCancel(fn: () => void): void { this.listeners.push(fn); }
  throwIfCancelled(): void { if (this.cancelled) throw new InterruptError("cancelled"); }
}

class InterruptibleAgent {
  constructor(private model: ModelProvider, private tools: Map<string, Tool>) {}

  async run(task: string, token: CancellationToken): Promise<Result> {
    const progress: string[] = [];
    for (let step = 0; ; step++) {
      token.throwIfCancelled(); // cooperative check between steps

      const response = await this.model.generate(task, { signal: token }); // AbortController
      if (token.isCancelled) break;

      if (response.toolCall) {
        // ATOMIC: finish tool op, THEN check token (no half-state)
        const result = await this.tools.get(response.toolCall)!.run(response.input);
        progress.push(`step ${step}: ${response.toolCall} done`);
        token.throwIfCancelled(); // check after atomic completion
      } else {
        return { output: response.text, progress };
      }
    }
    // Interrupted → checkpoint progress (resume later)
    return { output: null, progress, interrupted: true };
  }

  // Redirect: user says "do Y instead" mid-X
  async redirect(fromTask: string, toTask: string, token: CancellationToken): Promise<void> {
    token.cancel(); // stop X
    // compensate X's side-effects (317 saga)
    // start Y fresh
    await this.run(toTask, new CancellationToken());
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User control — ngắt giữa chừng (user-in-loop) | ❌ Cooperative complexity (thread token everywhere) |
| ✅ Clean stop — no half-state (atomic) | ❌ Checkpoint overhead (save progress) |
| ✅ Redirect — đổi task linh hoạt | ❌ Compensate on redirect (317) cost |
| ✅ Resume from checkpoint | ❌ Long ops can't checkpoint mid-LLM-stream |

## Khác các hướng gần

| | 317 Cross-Agent-Txn | 328 Deferred-Questions | LO: Interruptible |
|---|---|---|---|
| Dừng | Compensate (rollback) | Pause for question | **User cancel + redirect** |
| Khi | Failure | Need input | **User explicit (Ctrl-C)** |
| Resume | ❌ | Resume after answer | **✅ checkpoint restore** |

## Khi nào chọn

- Agent chạy lâu — user cần ngắt/redirect
- User-in-the-loop (interactive — Ctrl-C, "stop", "do Y")
- Cần resume from checkpoint (long task interrupted)
- Nối 317 cross-agent-txn (compensate) + 328 deferred-questions + AGENTS.md (cooperative)
