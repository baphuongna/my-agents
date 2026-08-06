# Hướng ST: Preflight Static Model Resolution — model ref tĩnh resolve+check preflight, động resolve khi agent start

> **Nguồn gốc:** pi-extensible-workflows `validation.ts` (`preflight()`, `resolveModelReference`, `validateModelAliasAvailability`, `validateModelAliases`), `host-phases.ts` (preflight phase); "static model ref resolve before launch"; "alias availability check"; "dynamic resolve at agent start"; "preflight phase before agents" | **Coupling:** 🟢 — thêm preflight gate trước workflow launch (resolve model tĩnh, fail sớm) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (model config + validation sẵn — chưa có preflight gate + static/dynamic resolve split) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-extensible-workflows** chạy **preflight** trước khi launch workflow: resolve **model reference tĩnh** (alias → model id) + check **availability** (model có trong registry/settings không) **trước khi spawn agent** — fail sớm (user thấy lỗi model sai trước khi tốn token). Model reference **động** (resolve runtime, vd auto-router theo task) thì resolve **khi agent start** (lúc có context đủ). Workflow có **preflight phase** riêng (phase id `preflight`, trước mọi agent phase). Nguyên tắc: **cái có thể check tĩnh → check trước** (fail fast), **cái cần context → resolve động** — tránh launch rồi mới phát hiện model sai. Khác **77 dspy-compile** (compile) — ST là **model-ref validation gate**; khác runtime-resolve — ST **2 lớp static/dynamic**.

## Mô tả

mya preflight static model resolution: (1) **Parse**: workflow config → model refs (alias như `fast`, `smart`, hoặc explicit id). (2) **Static resolve**: alias tĩnh → resolve + check availability preflight (model có trong registry? alias map đúng?); fail → reject launch. (3) **Dynamic resolve**: alias động (auto-router, capability-based) → resolve khi agent start (lúc có task context). (4) **Preflight phase**: phase riêng trước agents, surface lỗi rõ (model nào, alias nào, thiếu gì). mya có model config + validation — ST thêm **preflight gate** + **static/dynamic classifier** + **availability check**.

## Kiến trúc

```
  WORKFLOW CONFIG: agents: [A(model=fast), B(model=auto), C(model=gpt-5)]
        │
        ▼
  ┌─── PREFLIGHT (before launch) ───────────────────────┐
  │  A: fast      → static resolve → gpt-4o-mini ✓ avail │
  │  C: gpt-5     → static resolve → gpt-5      ✓ avail │
  │  B: auto      → DYNAMIC (need task context) → defer  │
  │  (alias sai / model thiếu → FAIL sớm, không spawn)   │
  └───────────────────────┬─────────────────────────────┘
                          │ (static OK, dynamic deferred)
                          ▼
  ┌─── AGENT PHASES (launch) ────────────────────────────┐
  │  A starts → model=gpt-4o-mini (static, sẵn dùng)       │
  │  C starts → model=gpt-5 (static)                        │
  │  B starts → resolve "auto" runtime (task context)       │
  │           → pick model theo capability/cost → gpt-4o     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai model registry — available models (nền — ST availability check)
// ✅ model config / aliases — alias map (nền — ST resolve)
// ✅ validation utils — config validate (nền — ST preflight)

// ❌ THIẾU: preflight gate (resolve + check before launch)
// ❌ THIẾU: static/dynamic classifier (alias → can resolve now? or need context?)
// ❌ THIẾU: availability check (model in registry/settings?)
// ❌ THIẾU: preflight phase (UI phase trước agents, surface lỗi rõ)
```

## Implementation

```typescript
// packages/agent/src/preflight-model.ts (MỚI)
interface ModelRef { raw: string; kind: 'static' | 'dynamic' }
type PreflightResult = { ok: true; resolved: Map<string, string> } | { ok: false; errors: string[] };

class PreflightModelResolution {
  constructor(
    private aliases: Record<string, string>,         // alias → id (static)
    private available: Set<string>,                   // registry
    private dynamicMatchers: RegExp[],                // /auto|router|capability/
  ) {}

  classify(ref: string): ModelRef['kind'] {
    if (this.dynamicMatchers.some(r => r.test(ref))) return 'dynamic';
    if (ref in this.aliases || this.available.has(ref)) return 'static';
    return 'static'; // unknown → try static resolve (will fail availability)
  }

  preflight(refs: Record<string, string>): PreflightResult {
    const resolved = new Map<string, string>();
    const errors: string[] = [];
    for (const [agent, ref] of Object.entries(refs)) {
      const kind = this.classify(ref);
      if (kind === 'dynamic') continue; // defer to agent start
      // static resolve
      const id = this.aliases[ref] ?? ref;
      if (!this.available.has(id)) { errors.push(`${agent}: model "${ref}" → "${id}" not available`); continue; }
      resolved.set(agent, id);
    }
    return errors.length ? { ok: false, errors } : { ok: true, resolved };
  }

  // dynamic resolve at agent start (has task context)
  resolveDynamic(ref: string, pickModel: (ctx: string) => string, ctx: string): string {
    return pickModel(ctx); // auto-router / capability-based
  }
}

// Usage:
// const pf = preflight.preflight({ A:'fast', B:'auto', C:'gpt-5' });
// if (!pf.ok) → surface errors, reject launch (fail fast)
// A,C static ready; B resolveDynamic at start
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail fast (model sai → lỗi trước khi tốn token) | ❌ Dynamic deferred (không check hết preflight) |
| ✅ Alias rõ (resolve trước, không mơ hồ runtime) | ❌ Registry drift (model thêm/bỏ sau preflight) |
| ✅ Preflight phase (UI surface lỗi rõ) | ❌ Dynamic matcher sai (classify nhầm static/dynamic) |
| ✅ Tách static/dynamic (cái gì check được → check) | ❌ Latency preflight (thêm 1 phase) |

## Khác các hướng gần

| | 77 DSPy-Compile | Runtime-Resolve | ST: Preflight-Model |
|---|---|---|---|
| Cái gì | Compile → code | Resolve khi chạy | **Static resolve+check preflight** |
| Khi | Compile time | Runtime | **Preflight (pre-launch)** |
| Fail | Compile err | Runtime err (tốn token) | **Fail fast (pre-launch)** |

## Khi nào chọn

- Workflow nhiều agent nhiều model — muốn catch model-sai trước launch
- Có alias map (fast/smart/auto) — cần resolve + check availability
- Muốn tách static (check được) vs dynamic (cần context)
- Nối packages/ai model registry + model config/aliases + validation utils; guard dynamic classifier (matcher đúng), registry freshness (drift sau preflight), và error clarity (lỗi model/alias rõ, actionable); ST = preflight gate cho model ref, kết hợp 77 dspy-compile (compile cũng cần model sẵn)
