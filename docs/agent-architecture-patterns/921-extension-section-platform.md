# Hướng AIK: Extension-Section-Platform — companion extensions đăng ký menu sections, commands, status rows, settings, callbacks, delivery helpers qua public API; callback routing gửi callback đã biết về owner extension và callback lạ quay lại Pi — bridge thành platform mà không cần bot loop thứ hai

> **Nguồn gốc:** pi-telegram | **Coupling:** 🟡 — extension platform | **Agent-agnostic:** ⚠️ (UI/command model) | **Code sẵn:** ⚠️ (có extension-api + pkg; chưa có section/callback routing) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-telegram** companion extensions đăng ký **menu sections, commands, status rows, settings, callbacks, delivery helpers** qua public API; **callback routing** gửi callback đã biết về **owner extension** và callback lạ **quay lại Pi** — bridge thành platform mà không cần bot loop thứ hai. Nguyên tắc: **extension as platform participant** — companion extension đăng ký UI/command surface; **callback ownership routing** — known callback → owner, unknown → Pi default; **single bot loop** — bridge route, không spawn loop riêng; **declarative registration** — sections/commands/settings qua API.

## Mô tả

Với mya, pattern = **extension section platform**: (1) mya đã có **intercom extension-api** (IntercomExtensionRegistration) + **pkg** PackageHost (4 kinds incl. extensions); (2) AIK thêm **registration surface**: extension declare `{ menuSections, commands, statusRows, settings, callbacks, deliveryHelpers }`; (3) **platform registry** — collect all extension registrations; (4) **callback routing**: khi callback fire → lookup owner → known → dispatch owner handler, unknown → Pi default handler; (5) **single loop** — bridge route callbacks, extension không chạy bot loop riêng.

## Kiến trúc (ASCII)

```
  COMPANION EXTENSIONS (declare surface via public API)
    extA: { menuSections:[...], commands:[/foo], callbacks:[cb1,cb2], settings:[...] }
    extB: { statusRows:[...], commands:[/bar], callbacks:[cb3], deliveryHelpers:[...] }
         │
         ▼ PLATFORM REGISTRY (collect — single source)
    ┌─────────────────────────────────────────┐
    │  callback map: cb1→extA, cb2→extA,      │
    │                cb3→extB                  │
    └──────────────────┬──────────────────────┘
                       │ callback fire (from UI/bot)
                       ▼ ROUTING:
            known callback? ──► dispatch OWNER handler (extA/extB)
            unknown callback? ──► Pi DEFAULT handler (fallback)
  (single bot loop — bridge route, extension KHÔNG spawn loop riêng)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom extension-api.ts — IntercomExtensionRegistration
//   (extension registration contract — nền)
// ✅ packages/pkg index.ts — PackageHost (extensions kind + manifest)
// ✅ packages/intercom skills — skill registration (nền command surface)
// ✅ packages/gateway channel-bridge.ts — bridge routing pattern

// ❌ THIẾU: section surface (menuSections/statusRows/settings/callbacks)
// ❌ THIẾU: callback ownership routing (known→owner, unknown→default)
// ❌ THIẾU: platform registry (collect all extension surfaces)
```

## Implementation

```typescript
// packages/intercom/src/sections.ts (NEW)
export interface ExtensionSection {
  ownerId: string;
  menuSections?: string[]; commands?: string[];
  statusRows?: string[]; settings?: string[];
  callbacks?: string[];            // callback ids this extension owns
  deliveryHelpers?: string[];
}

/** Platform registry — collect all extension surfaces. */
export class SectionPlatform {
  private readonly sections = new Map<string, ExtensionSection>();
  private readonly callbackOwner = new Map<string, string>(); // cbId → ownerId
  private readonly handlers = new Map<string, (payload: unknown) => void>();

  register(s: ExtensionSection, handler: (payload: unknown) => void): void {
    this.sections.set(s.ownerId, s);
    for (const cb of s.callbacks ?? []) this.callbackOwner.set(cb, s.ownerId);
    this.handlers.set(s.ownerId, handler);
  }
  /** Route callback — known → owner, unknown → Pi default. */
  routeCallback(cbId: string, payload: unknown, piDefault: (p: unknown) => void): void {
    const owner = this.callbackOwner.get(cbId);
    if (owner) this.handlers.get(owner)!(payload);   // known → OWNER
    else piDefault(payload);                           // unknown → Pi DEFAULT
  }
}
// extension activate → platform.register({...}, handler). UI/bot → routeCallback.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Extension thành platform participant (UI/command) | ❌ Registration surface phức tạp |
| ✅ Callback ownership routing rõ | ❌ Callback id collision giữa extension |
| ✅ Single bot loop — bridge route | ❌ Unknown callback fallback phải an toàn |
| ✅ Nối extension-api + pkg sẵn | ❌ Platform registry phải sync lifecycle (unregister) |

## Khác các hướng gần

| | AIK Extension-Section-Platform | AHW Cross-Extension-RPC | AIJ Flat-Domain-DAG |
|---|---|---|---|
| Trọng tâm | Extension UI/command surface | Extension ↔ extension RPC | Codebase DAG |
| Cơ chế | Section registry + callback routing | event bus + reply envelope | Invariant test |
| Quan hệ | UI/command platform | RPC platform | Architectural constraint |

## Khi nào chọn

- Companion extension cần UI/command surface (menu/status/settings)
- Callback routing rõ (known→owner, unknown→default)
- Muốn single bot loop (bridge route, không spawn loop riêng)
- Guard: callback id namespace (avoid collision), unknown fallback safe, lifecycle unregister, single loop invariant
