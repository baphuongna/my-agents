# Hướng RB: Runtime Transition Reminders — harness inject system-reminder khi model đổi/container restart

> **Nguồn gốc:** Leaks Claude Code (`injected-reminders/model-switched.md`, `container-restart.md`); "harness injects `<system-reminder>` on runtime transition"; "model switched → notify"; "container restarted → re-orient stopped tasks"; "transparency on identity/environment change"
> **Coupling:** 🟢 — thêm transition-detector + reminder-injector vào context builder (inject trên event)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (system prompt + context builder sẵn — chưa có transition detector + reminder injector)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Leaks Claude Code** (`injected-reminders/`) mô tả: harness **inject `<system-reminder>`** khi **runtime transition** xảy ra — (1) **model-switched**: "The model for this session has been changed to ${model}" (agent biết mình đổi model — không confuse identity). (2) **container-restart**: "The container was restarted. Background tasks stopped: ${stoppedTasks}. Re-create them if still needed" (agent tái định hướng sau restart — biết task nào chết, cần tạo lại). Nguyên tắc: **transparency on transition** — môi trường/identity đổi → agent phải biết để điều chỉnh (không âm thầm dùng state cũ sai). Khác **292 lifecycle-hooks** (event) — RB là **context injection**; khác output — RB là **input reminder**.

## Mô tả

mya runtime transition reminders: (1) **Detect transition**: model-switch (session model đổi), container-restart (process restart), env-change (cwd/permissions đổi). (2) **Inject reminder**: harness chèn `<system-reminder>` vào context (system/user message) mô tả transition + state ảnh hưởng. (3) **Re-orient**: agent đọc reminder → biết mình đổi model (không assume), biết task nào chết (re-create), biết env đổi (re-check). (4) **Idempotent**: reminder chỉ inject một lần per transition (không lặp). mya có system-prompt builder + 292 lifecycle-hooks — RB thêm **transition detector** (model/env/restart change) + **reminder injector** (context += reminder) + **state snapshot** (task nào chạy trước restart).

## Kiến trúc

```
  RUNTIME TRANSITION detected (event):
  ┌─────────────────────────────────────────────────────┐
  │  EVENT: model switched 'opus-4.7' → 'opus-4.8'       │
  │  EVENT: container restarted (background tasks died)  │
  └───────────────────────┬─────────────────────────────┘
                          │ (transition detector)
                          ▼
  ┌─── REMINDER INJECTOR ───────────────────────────────┐
  │  model-switched:                                     │
  │  <system-reminder>The model for this session has     │
  │   been changed to opus-4.8. You are now opus-4.8.    │
  │   </system-reminder>                                 │
  │                                                       │
  │  container-restart:                                  │
  │  <system-reminder>The container was restarted.       │
  │   Background tasks stopped: [t1: build, t2: watch].  │
  │   Re-create them if still needed.                     │
  │   </system-reminder>                                 │
  └───────────────────────┬─────────────────────────────┘
                          │ (inject vào context, 1 lần/transition)
                          ▼
  ┌─── AGENT RE-ORIENT ─────────────────────────────────┐
  │  agent đọc reminder → "tôi giờ là opus-4.8"           │
  │   → "build/watch chết → re-create cargo test + watch" │
  │   (không âm thầm dùng state cũ sai)                  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ system prompt builder — context assembly (nền — RB inject vào đây)
// ✅ 292 lifecycle-hooks — event source (nền — RB detect transition)
// ✅ 095 tool-call-recovery — recover failure (nền — RB re-orient)

// ❌ THIẾU: transition detector (model-switch / container-restart / env-change)
// ❌ THIẾU: reminder injector (context += <system-reminder>)
// ❌ THIẾU: state snapshot before-restart (task nào chạy để báo)
// ❌ THIẾU: idempotent guard (inject 1 lần/transition)
```

## Implementation

```typescript
// packages/agent/src/transition-reminders.ts (MỚI)
type Transition = { type: 'model-switched' | 'container-restart' | 'env-change'; payload: Record<string, unknown> };

class TransitionReminders {
  private injected = new Set<string>(); // dedupe per transition
  private runningTasks: string[] = [];   // snapshot before restart

  constructor(private hooks: LifecycleHooks) {
    hooks.on('model-switched', (m: string) => this.queue({ type: 'model-switched', payload: { model: m } }));
    hooks.on('container-restart', () => this.queue({ type: 'container-restart', payload: { stopped: this.runningTasks } }));
  }

  trackTask(name: string, running: boolean): void {
    if (running) this.runningTasks.push(name);
    else this.runningTasks = this.runningTasks.filter(t => t !== name);
  }

  private pending: Transition[] = [];
  private queue(t: Transition): void { this.pending.push(t); }

  // called by context builder each turn — returns reminders to inject (1x each)
  drain(): string[] {
    const out: string[] = [];
    for (const t of this.pending) {
      const key = `${t.type}:${JSON.stringify(t.payload)}`;
      if (this.injected.has(key)) continue;
      this.injected.add(key);
      out.push(this.render(t));
    }
    this.pending = [];
    return out;
  }

  private render(t: Transition): string {
    switch (t.type) {
      case 'model-switched':
        return `<system-reminder>The model for this session has been changed to ${t.payload.model}. You are now running as ${t.payload.model}.</system-reminder>`;
      case 'container-restart':
        return `<system-reminder>The container was restarted. The following background tasks were running and are now stopped:\n${(t.payload.stopped as string[]).join(', ')}\nRe-create them if still needed.</system-reminder>`;
      case 'env-change':
        return `<system-reminder>Environment changed: ${JSON.stringify(t.payload)}.</system-reminder>`;
    }
  }
}

// Usage (in context builder):
// const reminders = transition.drain();   // 1x per transition
// if (reminders.length) context += '\n' + reminders.join('\n');
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent biết transition (không âm thầm dùng state cũ sai) | ❌ Reminder leak (inject quá nhiều → noise) |
| ✅ Re-orient sau restart (re-create task chết) | ❌ False transition (event nhầm → reminder thừa) |
| ✅ Transparency (identity/env change rõ ràng) | ❌ State snapshot lỗi (task list không chính xác) |
| ✅ Idempotent (1 lần/transition, không lặp) | ❌ Context token (reminder tốn token) |

## Khác các hướng gần

| | 292 Lifecycle-Hooks | 095 Tool-Call-Recovery | RB: Transition-Reminders |
|---|---|---|---|
| Cái gì | Event hooks | Recover failure | **Context injection on transition** |
| Hướng | Event → handler | Retry/fix | **Reminder → agent re-orient** |
| Khi | Mọi event | Tool fail | **Runtime transition** |

## Khi nào chọn

- Runtime đổi (model-switch, container-restart, env-change) thường xuyên
- Agent cần biết transition để điều chỉnh (không dùng state cũ sai)
- Background task có thể chết (restart → re-create)
- Nối system-prompt builder (inject point) + 292 lifecycle-hooks (event source) + 095 tool-call-recovery (re-orient); guard idempotent (1 lần/transition), state snapshot accuracy (task list trước restart), và reminder-conciseness (token budget); RB = transparency layer cho runtime transition
