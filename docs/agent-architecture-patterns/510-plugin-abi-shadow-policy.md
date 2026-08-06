# Hướng SP: Plugin ABI Shadow Policy — kiểm tra ABI-stamp plugin WASM, cấm shadow tên builtin

> **Nguồn gốc:** mya-v1 (plugin ABI policy); "ABI-stamp WASM plugin validation"; "forbid shadowing builtin names"; "plugin version ABI compatibility check"; "plugin name collision with core"
> **Coupling:** 🟡 — thêm plugin validator gate (load → check ABI-stamp + name → reject/load)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (plugin loader + tool registry sẵn — chưa có ABI-stamp check + shadow policy)
> **Effort:** 1-2 tuần

## Nguồn gốc

**mya-v1** plugin system: plugin (WASM) load vào core, nhưng 2 rủi ro: (1) **ABI mismatch** — plugin built cho ABI version cũ, load vào core version mới → crash/undefined behavior (struct layout đổi, export signature đổi). **ABI-stamp**: mỗi plugin mang **ABI version stamp** (metadata), loader check stamp vs core ABI → reject nếu mismatch (không load plugin hỏng). (2) **Shadow builtin** — plugin đăng ký tên trùng **builtin tool** (`read`, `edit`) → override builtin → behavior đổi bất ngờ (plugin `read` thay builtin `read` → security/logic break). **Shadow policy**: **cấm** plugin shadow tên builtin — reject load nếu tên trùng. Nguyên tắc: **plugin phải tương thích ABI + không được chiếm tên builtin**.

## Mô tả

mya plugin ABI shadow policy: (1) **ABI-stamp**: mỗi WASM plugin có metadata `{ abiVersion, name, exports }` — stamp ghi ABI version nó build cho. (2) **ABI check**: load → so stamp vs core ABI → nếu mismatch (plugin v1 vs core v3) → **reject** (không load, báo "ABI mismatch — rebuild plugin"). (3) **Name extract**: parse plugin export names (tool names nó đăng ký). (4) **Shadow check**: so names vs builtin tool set → nếu trùng (`read`, `edit`) → **reject** (báo "name shadows builtin — rename"). (5) **Load**: pass cả 2 check → load plugin vào registry. mya có plugin loader + tool registry — SP thêm **ABI-stamp validator** + **shadow policy gate**.

## Kiến trúc

```
  PLUGIN WASM (candidate):
  ┌─────────────────────────────────────────────────────┐
  │  metadata: { abiVersion: 1, name: "my-plugin",        │
  │              exports: ["read", "custom-tool"] }       │
  └───────────────┬─────────────────────────────────────┘
                  │ load
                  ▼
  ┌─── GATE (2 check) ──────────────────────────────────┐
  │  1. ABI-STAMP CHECK:                                 │
  │     plugin.abiVersion (1) vs core.abiVersion (3)      │
  │     → MISMATCH ✗ → REJECT "ABI mismatch — rebuild"   │
  │                                                       │
  │  2. SHADOW CHECK (nếu ABI OK):                       │
  │     exports ["read", "custom-tool"]                   │
  │     vs builtin ["read", "edit", "bash", ...]          │
  │     → "read" TRÙNG builtin ✗ → REJECT "shadows builtin"│
  └───────────┬───────────────────┬─────────────────────┘
              │ cả 2 pass          │ 1 fail
              ▼                    ▼
  ┌─── LOAD ────────────┐  ┌─── REJECT ──────────────────┐
  │  plugin vào registry │  │  không load, báo lý do       │
  │  (exports đăng ký)    │  │  (ABI mismatch / shadow)     │
  └──────────────────────┘  └──────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ plugin loader — load WASM plugin (nền — SP gate trước nó)
// ✅ tool registry — tool.meta.name (nền — SP shadow check vs nó)
// ✅ 497 filter-trust-records — trust gate (gần — SP = ABI/name gate)

// ❌ THIẾU: ABI-stamp metadata (plugin { abiVersion, name, exports })
// ❌ THIẾU: ABI validator (stamp vs core → reject mismatch)
// ❌ THIẾU: shadow policy (export name vs builtin → reject collision)
```

## Implementation

```typescript
// packages/core/src/plugin-abi-policy.ts (MỚI)
interface PluginMeta { abiVersion: number; name: string; exports: string[] }

const BUILTIN_TOOLS = new Set(['read', 'edit', 'write', 'bash', 'grep', 'find', 'ls', 'glob']);

class PluginAbiShadowPolicy {
  constructor(private coreAbiVersion: number) {}

  // validate: ABI check + shadow check
  validate(meta: PluginMeta): { ok: true } | { ok: false; reason: string } {
    // 1. ABI-stamp check
    if (meta.abiVersion !== this.coreAbiVersion) {
      return { ok: false, reason: `ABI mismatch: plugin abiVersion=${meta.abiVersion} vs core=${this.coreAbiVersion} — rebuild plugin` };
    }
    // 2. shadow check: exports không trùng builtin
    const shadows = meta.exports.filter(e => BUILTIN_TOOLS.has(e));
    if (shadows.length > 0) {
      return { ok: false, reason: `name shadows builtin: ${shadows.join(', ')} — rename plugin export` };
    }
    // 3. duplicate plugin name (optional: 2 plugin cùng tên)
    return { ok: true };
  }

  // load wrapper: validate → load hoặc reject
  async loadGuarded(meta: PluginMeta, loader: (m: PluginMeta) => Promise<void>): Promise<{ loaded: boolean; reason?: string }> {
    const v = this.validate(meta);
    if (!v.ok) return { loaded: false, reason: v.reason };
    await loader(meta);
    return { loaded: true };
  }

  // allow-list override (nếu user EXPLICITLY cho shadow — opt-in, logged)
  withAllowShadow(meta: PluginMeta, allowShadow: Set<string>): { ok: true } | { ok: false; reason: string } {
    const shadows = meta.exports.filter(e => BUILTIN_TOOLS.has(e) && !allowShadow.has(e));
    if (shadows.length > 0) return { ok: false, reason: `name shadows builtin: ${shadows.join(', ')}` };
    if (meta.abiVersion !== this.coreAbiVersion) return { ok: false, reason: 'ABI mismatch' };
    return { ok: true };
  }
}

// Usage:
// const v = policy.validate(pluginMeta);
// if (!v.ok) → reject (ABI mismatch / shadow), không load
// const r = await policy.loadGuarded(meta, wasmLoader);
// // allowShadow: explicit opt-in (logged) — hiếm
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Anti-ABI-mismatch (plugin cũ không crash core) | ❌ Rebuild friction (ABI đổi → plugin phải rebuild) |
| ✅ Anti-shadow (plugin không override builtin) | ❌ Cấm shadow cứng (user muốn override → cần allow-list opt-in) |
| ✅ Bảo mật (plugin độc hại không chiếm builtin) | ❌ ABI-stamp metadata (plugin phải ghi đúng) |
| ✅ Phối 497 filter-trust (multi-gate) | ❌ Builtin set maintenance (thêm builtin → update set) |

## Khác các hướng gần

| | 497 Filter-Trust | Plugin Version-Check | SP: ABI-Shadow-Policy |
|---|---|---|---|
| Gate cái gì | Filter DSL trust | Phiên bản | **ABI-stamp + name shadow** |
| Khi mismatch | Ignore DSL | Reject | **Reject (ABI) + reject (shadow)** |
| Override builtin | — | — | **Cấm (allow-list opt-in)** |

## Khi nào chọn

- Hệ thống plugin (WASM/JS plugin load vào core)
- Muốn chống ABI mismatch (plugin cũ crash core)
- Bảo mật: cấm plugin shadow builtin (chiếm `read`/`edit`)
- Nối plugin loader + tool registry; guard ABI-stamp accuracy (plugin phải ghi đúng abiVersion) + builtin set (cập nhật khi thêm builtin) + allow-list audit (opt-in shadow phải logged); phối 497 filter-trust-records (multi-gate: trust + ABI + shadow); version bump policy (ABI đổi → major bump → plugin rebuild)
