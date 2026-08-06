# Hướng UL: Plugin Hook Aggregation — gộp hooks builtin/bundled/external theo HookEvent, HookRunner trả deny/warn có message

> **Nguồn gốc:** claw-code `PluginRegistry` (builtin/bundled/external plugin hooks, HookEvent aggregation), `HookRunner` (deny/warn decision with message); "PluginRegistry aggregate hooks across plugin sources", "per-HookEvent grouping", "HookRunner returns deny/warn with message" | **Coupling:** 🟡 — thêm plugin-registry + hook-runner vào tool dispatch | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tools + skills sẵn — chưa có plugin-registry + hook-runner aggregation) | **Effort:** 2-3 tuần

## Nguồn gốc

**claw-code** `PluginRegistry` gom hooks từ **3 nguồn plugin**: (1) **Builtin** — hook cứng trong core (vd path-safety, secret-scan). (2) **Bundled** — hook đi kèm package (vd skills, tools). (3) **External** — hook user-defined (config/plugin). Registry gom tất cả theo **HookEvent** (vd PreToolUse, PostToolUse, OnMessage) — mỗi event có list hook từ 3 nguồn, **xếp theo priority**. Khi event fire, `HookRunner` chạy tuần tự hook: mỗi hook trả **decision** — `allow` (tiếp tục), `warn` (cảnh báo + message, vẫn tiếp tục), hoặc `deny` (chặn + message, dừng). Nguyên tắc: **hook aggregation multi-source** + **decision chain** (deny chặn, warn cảnh báo, message giải thích).

## Mô tả

mya plugin hook aggregation: (1) **Plugin registry**: đăng ký hook từ builtin/bundled/external, gom theo HookEvent. (2) **Priority sort**: hook xếp theo priority (builtin trước, external sau). (3) **HookRunner**: event fire → chạy hook tuần tự → collect decision. (4) **Decision**: allow → tiếp; warn → log message, tiếp; deny → chặn + message. mya có tools + skills — UL thêm **plugin-registry** + **priority-sorter** + **hook-runner** + **decision-chain**.

## Kiến trúc

```
  PLUGIN SOURCES (3 nguồn)
  ┌─ Builtin  ── path-safety, secret-scan (priority HIGH) ──┐
  ├─ Bundled  ── skills hooks, tool hooks (priority MED) ───┤
  └─ External ── user-defined hooks (priority LOW) ─────────┘
        │ (aggregate by HookEvent)
        ▼
  ┌─── PLUGIN REGISTRY (per-HookEvent list) ────────────────┐
  │  PreToolUse: [path-safety, secret-scan, user-rule]        │
  │  PostToolUse: [audit-log, user-telemetry]                 │
  └───────────────────────┬─────────────────────────────────┘
                          │ (event fire)
                          ▼
  ┌─── HOOK RUNNER (decision chain) ─────────────────────────┐
  │  hook1 (path-safety): allow → tiếp                         │
  │  hook2 (secret-scan):  WARN "possible secret in args" → log│
  │  hook3 (user-rule):    DENY "blocked by user policy" → ⛔  │
  │  → decision: DENY + message "blocked by user policy"      │
  └────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools dispatch.ts — tool dispatch (nền — UL hook ở đây)
// ✅ packages/tools permission.ts — permission (nền — UL builtin hook)
// ✅ packages/core threat-scan.ts — secret scan (nền — UL builtin hook)
// ✅ packages/skills — skill hooks (nền — UL bundled hook)

// ❌ THIẾU: plugin-registry (builtin/bundled/external → per-event)
// ❌ THIẾU: priority-sorter (hook order)
// ❌ THIẾU: hook-runner (decision chain: allow/warn/deny + message)
// ❌ THIẾU: decision-collector (deny chặn, warn log, message giải thích)
```

## Implementation

```typescript
// packages/tools/src/plugin-hook-aggregation.ts (MỚI)
type HookEvent = 'PreToolUse' | 'PostToolUse' | 'OnMessage';
type Source = 'builtin' | 'bundled' | 'external';
type Decision = { kind: 'allow' } | { kind: 'warn'; message: string } | { kind: 'deny'; message: string };

interface Hook { event: HookEvent; source: Source; priority: number; run: (ctx: unknown) => Promise<Decision> }
const SOURCE_RANK: Record<Source, number> = { builtin: 0, bundled: 1, external: 2 };

class PluginRegistry {
  private hooks = new Map<HookEvent, Hook[]>();

  register(hook: Hook): void {
    const list = this.hooks.get(hook.event) ?? [];
    list.push(hook);
    list.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.priority - b.priority);
    this.hooks.set(hook.event, list);
  }

  get(event: HookEvent): Hook[] { return this.hooks.get(event) ?? []; }
}

class HookRunner {
  constructor(private registry: PluginRegistry) {}

  // run hooks for event → final decision (deny wins, warn accumulates)
  async run(event: HookEvent, ctx: unknown): Promise<Decision> {
    const warnings: string[] = [];
    for (const hook of this.registry.get(event)) {
      const d = await hook.run(ctx);
      if (d.kind === 'deny') return d;                 // deny → chặn ngay
      if (d.kind === 'warn') warnings.push(d.message); // warn → log, tiếp
    }
    if (warnings.length > 0) return { kind: 'warn', message: warnings.join('; ') };
    return { kind: 'allow' };
  }
}

// Usage:
// registry.register({event:'PreToolUse', source:'builtin', priority:0, run: pathSafetyCheck});
// registry.register({event:'PreToolUse', source:'external', priority:0, run: userRule});
// const d = await runner.run('PreToolUse', {tool:'write', args:{path:'/etc'}});
// → {kind:'deny', message:'blocked by user policy'}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hook multi-source (builtin+bundled+external gộp) | ❌ Hook conflict (2 hook deny nhau → first wins, mơ hồ) |
| ✅ Decision chain (deny/warn/allow rõ ràng) | ❌ Performance (mỗi event chạy N hook tuần tự) |
| ✅ Message giải thích (deny/warn có lý do) | ❌ Hook order sensitivity (priority sai → logic sai) |
| ✅ Extensible (user thêm external hook dễ) | ❌ Hook error handling (1 hook throw → chain break) |

## Khác các hướng gần

| | Single permission check | Pre-tool guard | UL: Plugin-Hook-Aggregation |
|---|---|---|---|
| Cái gì | 1 check allow/deny | Guard trước tool | **Multi-source hooks → decision chain** |
| Sources | 1 | 1 | **builtin + bundled + external** |
| Decision | binary | binary | **allow/warn/deny + message** |

## Khi nào chọn

- Cần hook từ nhiều nguồn (core + package + user) cho cùng event
- Muốn decision chain (deny chặn, warn cảnh báo, message giải thích)
- Cần extensibility (user thêm external hook không sửa core)
- Nối packages/tools dispatch.ts + permission.ts + packages/core threat-scan.ts + packages/skills; guard hook-error-isolation (1 hook throw không break chain — catch + continue/warn), deny-precedence-clarity (document first-deny-wins), và priority-tuning (builtin safety hook luôn trước external); UL = plugin hook aggregation, kết hợp 555 UI permission-mode (permission = builtin hook) + 547 UA memory-persistence-hooks (hook event system) + packages/skills (bundled hook source)
