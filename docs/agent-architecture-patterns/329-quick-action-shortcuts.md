# Hướng LQ: Quick Action Shortcuts — lệnh tắt resume/retry/fix, 1 lệnh

> **Nguồn gốc:** "Command palette" (VS Code); Unix one-liners / aliases; "macros" / "quick actions"; shell history `!!` retry; "intent shortcuts"; keyboard shortcuts; git aliases; "slash commands" (CLI bots)
> **Coupling:** 🟢 — UI/command layer, không đổi core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + history + commands sẵn — thiếu quick-action registry + alias expansion + intent mapping)
> **Effort:** 2 tuần

## Nguồn gốc

Command palette (VS Code Ctrl-P): gõ ngắn → match action → chạy nhanh. Unix aliases (`ll`=`ls -la`), shell history (`!!` retry last): **rút gọn** thao tác lặp thành 1 token. Macros: record sequence → replay 1 click. Slash commands (Slack/Discord bots): `/fix` → trigger complex action. Intent shortcuts: user gõ "retry" → agent hiểu "rerun last failed task". Keyboard shortcuts: muscle memory — 1 phím thay 5 click. Cốt lõi: **thao tác lặp → lệnh tắt** — giảm friction, 1 lệnh thay nhiều bước.

## Mô tả

mya quick actions: registry lệnh tắt → user gõ 1 từ → expand thành action. (1) **retry** — rerun task cuối bị fail; (2) **resume** — tiếp tục task bị interrupt (327 checkpoint); (3) **fix** — chạy lại + tự sửa (118 error-analysis); (4) **undo** — compensate last action (317); (5) **alias** — user-defined (`fixtest` = "run vitest + fix failures"). Nối 327 interruptible (resume), 328 deferred-questions (answer shortcut), 317 cross-agent-txn (undo = compensate).

## Kiến trúc

```
  USER types: "retry"
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  QUICK ACTION REGISTRY                              │
  │                                                      │
  │  "retry"  → rerun last FAILED task                   │
  │  "resume" → continue last INTERRUPTED task (327)     │
  │  "fix"    → rerun + auto-fix failures (118)          │
  │  "undo"   → compensate last action (317)             │
  │  "fixtest"→ "run vitest + fix failing tests" (alias) │
  │  "again"  → rerun last SUCCESSFUL task               │
  └──────────────────┬───────────────────────────────────┘
                     │ expand → full action
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  INTENT MAPPER (short → full prompt)                 │
  │  "retry"  → history.lastFailedTask → rerun it        │
  │  "fixtest"→ "Run: npx vitest run. For each failure,  │
  │             diagnose and fix. Then re-run."           │
  │  user alias "deploy" → "build + test + git push"     │
  └──────────────────┬───────────────────────────────────┘
                     │ full task
                     ▼
              AGENT EXECUTES (1 command → complex action)
```

```
mya: agent-loop + history + commands sẵn — thiếu quick-action registry + alias expansion + intent mapping
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — agent-loop (sẵn)
// ✅ command parsing — user commands (sẵn)
// ✅ 327 interruptible-agents — resume target (documented)
// ✅ 118 error-analysis — fix target (documented)

// ❌ THIẾU: quick-action registry (retry/resume/fix/undo)
// ❌ THIẾU: alias expansion (short → full prompt)
// ❌ THIẾU: history lookup (last failed/success task)
// ❌ THIẾU: user-defined aliases (custom shortcuts)
```

## Implementation

```typescript
// packages/agent/src/quick-actions.ts (NEW)
interface QuickAction {
  trigger: string;
  description: string;
  expand: (history: TaskHistory) => string | null; // → full task, null if N/A
}

export class QuickActionRegistry {
  private builtins: QuickAction[];
  private aliases = new Map<string, string>(); // user custom

  constructor() {
    this.builtins = [
      { trigger: "retry", description: "rerun last failed task",
        expand: (h) => h.lastFailed ? `Retry this task: ${h.lastFailed}` : null },
      { trigger: "again", description: "rerun last successful task",
        expand: (h) => h.lastSuccess ? `Do again: ${h.lastSuccess}` : null },
      { trigger: "resume", description: "continue interrupted task",
        expand: (h) => h.lastInterrupted ? `Resume: ${h.lastInterrupted}` : null },
      { trigger: "fix", description: "rerun + auto-fix failures",
        expand: (h) => h.lastFailed ? `Rerun and fix any errors in: ${h.lastFailed}` : null },
      { trigger: "undo", description: "compensate last action",
        expand: () => "Undo the last action you took (revert changes)." },
    ];
  }

  // User defines custom alias: "deploy" → "build + test + git push"
  defineAlias(trigger: string, expansion: string): void {
    this.aliases.set(trigger, expansion);
  }

  // Resolve short input → full task
  resolve(input: string, history: TaskHistory): string | null {
    // custom alias first
    if (this.aliases.has(input)) return this.aliases.get(input)!;
    // builtin
    const action = this.builtins.find((a) => a.trigger === input);
    return action ? action.expand(history) : null;
  }

  list(): { trigger: string; description: string }[] {
    return [
      ...this.builtins.map((a) => ({ trigger: a.trigger, description: a.description })),
      ...[...this.aliases.keys()].map((t) => ({ trigger: t, description: "custom alias" })),
    ];
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Friction giảm — 1 lệnh thay nhiều bước (alias) | ❌ Ambiguity ("retry" = which task?) |
| ✅ Muscle memory (command palette / shortcut) | ❌ Alias collision (user vs builtin) |
| ✅ Custom alias — user personalize workflow | ❌ Hidden behavior (short ≠ obvious action) |
| ✅ History-aware (retry last fail, resume interrupt) | ❌ Needs reliable history tracking |

## Khác các hướng gần

| | 327 Interruptible | 328 Deferred-Questions | LQ: Quick Actions |
|---|---|---|---|
| Mục | Ngắt sạch | Hỏi sau | **Lệnh tắt (1 từ → action)** |
| User | Ctrl-C | Trả lời | **Gõ ngắn (retry/fix/undo)** |
| History | Checkpoint | Queue | **Lookup last task** |

## Khi nào chọn

- User lặp thao tác (retry, fix, resume) → rút gọn thành 1 từ
- Muốn command palette UX (VS Code-style)
- User-defined alias (personalize workflow)
- Nối 327 interruptible (resume) + 328 deferred (answer) + 317 txn (undo) + 118 fix
