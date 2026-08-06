# Hướng AIC: Per-Session-Registry-Claim — registry `Symbol.for("pi-subagents:manager")` chỉ được claim bởi activation đầu tiên; child sessions khi re-activate không ghi đè slot, và chỉ owning activation được release khi shutdown — tránh con trỏ vào child manager đã chết

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟢 — registry singleton | **Agent-agnostic:** ⚠️ (global registry) | **Code sẵn:** ⚠️ (có runtime-claim; chưa có Symbol.for registry + ownership release) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-subagent3** registry **`Symbol.for("pi-subagents:manager")`** chỉ được claim bởi **activation đầu tiên**; child sessions khi re-activate **không ghi đè slot**, và chỉ **owning activation** được release khi shutdown — tránh con trỏ vào child manager đã chết. Nguyên tắc: **first-activation wins** — global registry slot, ai claim trước giữ; **no overwrite on re-activate** — child session không cướp slot; **ownership-gated release** — chỉ owner release, tránh child release nhầm manager khác; **dangling-pointer safe** — không bao giờ trỏ manager đã chết.

## Mô tả

Với mya, pattern = **global registry claim ownership**: (1) mya đã có **runtime-claim.ts** (packages/intercom) — broker runtime claim (singleton pattern nền); (2) AIC thêm **`Symbol.for` global registry** — cross-realm stable key; (3) **claim**: first activation set `global[Symbol.for("...:manager")] = this`; (4) **re-activate check**: nếu slot đã có + khác mình → không ghi đè (chỉ dùng owner); (5) **release**: chỉ release khi `slot === this` (ownership check); (6) shutdown owner → release; child shutdown → no-op.

## Kiến trúc (ASCII)

```
  global[Symbol.for("pi-subagents:manager")]  (singleton slot)
    │
    ├─ ACTIVATION 1 (first) ──► CLAIM: slot = manager1  ✓ owns
    │
    ├─ ACTIVATION 2 (child re-activate):
    │    └─ slot đã có (manager1, khác mình) ──► KHÔNG ghi đè (dùng owner)
    │
    ├─ ACTIVATION 2 shutdown:
    │    └─ slot === this? NO (slot=manager1) ──► NO-OP (không release nhầm)
    │
    └─ ACTIVATION 1 (owner) shutdown:
         └─ slot === this? YES ──► RELEASE: slot = null  ✓ (chỉ owner release)
  → không bao giờ con trỏ vào manager đã chết
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom runtime-claim.ts — broker runtime claim (singleton claim)
// ✅ packages/intercom extension-state.ts — extension state tracking
// ✅ packages/core session.ts — session lifecycle (nền activation)

// ❌ THIẾU: Symbol.for global registry key
// ❌ THIẾU: first-activation-wins + no-overwrite logic
// ❌ THIẾU: ownership-gated release (slot === this)
```

## Implementation

```typescript
// packages/agent/src/registry-claim.ts (NEW)
const MANAGER_KEY = Symbol.for("pi-subagents:manager");

export interface Manager { readonly id: string; shutdown(): void }

interface RegistryWithSlot { [k: symbol]: Manager | null }
function getSlot(): Manager | null {
  return ((globalThis as unknown as RegistryWithSlot)[MANAGER_KEY] as Manager | null) ?? null;
}
function setSlot(m: Manager | null): void {
  (globalThis as unknown as RegistryWithSlot)[MANAGER_KEY] = m;
}

/** First activation wins — child re-activate không ghi đè. */
export function claimManager(self: Manager): Manager {
  const existing = getSlot();
  if (existing) return existing;          // đã có owner — dùng owner, KHÔNG ghi đè
  setSlot(self);                          // first — claim
  return self;
}

/** Chỉ owner release — tránh child release nhầm manager khác. */
export function releaseManager(self: Manager): void {
  if (getSlot()?.id === self.id) setSlot(null);  // ownership check
}
// activation: const mgr = claimManager(this); ... shutdown: releaseManager(this);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Singleton an toàn — first-wins | ❌ Symbol.for global — phải namespace key cẩn thận |
| ✅ No dangling pointer (ownership release) | ❌ Child không bao giờ own — bất đối xứng |
| ✅ Cross-realm stable (Symbol.for) | ❌ Global state — test phải reset giữa case |
| ✅ Nối runtime-claim sẵn | ❌ Re-activate child phụ thuộc owner còn sống |

## Khác các hướng gần

| | AIC Per-Session-Registry-Claim | AID RPC-Readiness-Gating | AHW Cross-Extension-RPC |
|---|---|---|---|
| Trọng tâm | Singleton registry ownership | Khi đăng ký RPC handler | Extension ↔ extension RPC |
| Cơ chế | Symbol.for + first-wins + owner-release | first session_start bound | event bus + reply envelope |
| Quan hệ | Ai own manager | Khi handler active | Channel cross-extension |

## Khi nào chọn

- Cần singleton manager cross-activation (một owner duy nhất)
- Tránh dangling pointer khi child/session re-activate
- Muốn ownership-gated release (chỉ owner cleanup)
- Guard: Symbol.for namespace key, first-wins, no-overwrite, slot===this release, test reset global
