# Hướng AGS: Shared Singleton Symbol — FffService chia sẻ qua globalThis với Symbol.for(...) nên nhiều extension instance dùng chung 1 indexer; reset bằng delete key cho test

> **Nguồn gốc:** pi-pretty | **Coupling:** 🟢 — cross-instance sharing thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (mya có print/shared-instances.ts — cùng pattern singleton dùng chung) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-pretty** chia sẻ `FffService` (indexer đắt để build) qua **`globalThis`** với key **`Symbol.for("pi-pretty.fff-service")`**. Vì dùng `Symbol.for` (symbol registry toàn cục, cross-realm), **nhiều instance extension** (reload, multiple import) cùng tham chiếu **một indexer duy nhất** — không build lại index mỗi lần. Để test reset, chỉ cần `delete globalThis[sym]` — sạch, không leak. `Symbol.for` khác `Symbol()` (unique mỗi lần) — `for` registry đảm bảo cùng key → cùng symbol → cùng instance.

Nguyên tắc: **`Symbol.for` cho cross-realm singleton** (registry toàn cục); **chỉ 1 instance indexer đắt** (không rebuild mỗi import); **reset bằng delete key** (test-friendly); **chỉ dùng khi instance thực sự đắt/tồn tại dài hạn**.

## Mô tả

Với mya, packages/print có `shared-instances.ts` — tạo singleton (Brain, AuditLog, HookRegistry, CronScheduler...) **một lần, dùng chung mọi mode**. Đây chính là pattern shared singleton. mya **chưa dùng** `Symbol.for` registry toàn cục (hiện dùng module-level cache), nhưng cho indexer/service đắt (FFF, code-index) cần build lại khi reload, `Symbol.for` là cách sạch để cross-realm share + reset test.

## Kiến trúc (ASCII)

```
  Extension instance A ─┐
  Extension instance B ─┼─► globalThis[Symbol.for("pi-pretty.fff-service")]
  Reload (new module)  ─┘        │
                                 ▼
                          1 FffService duy nhất (index build 1 lần)
  ── test reset: delete globalThis[sym] → instance mới (sạch, không leak)
  ── Symbol.for ≠ Symbol(): registry toàn cục, cross-realm, cùng key → cùng sym
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/shared-instances.ts — singleton dùng chung mọi mode (Brain, Audit, Hook, Cron)
// ✅ Module-level cache pattern (tạo 1 lần, export instance)
// ⚠️ KHÔNG dùng Symbol.for registry toàn cục cho cross-realm share
// ❌ KHÔNG có reset-by-delete-key cho indexer đắt (test-friendly)
```

## Implementation

```typescript
// packages/tools/src/fff-singleton.ts (NEW)
const FFF_SYM = Symbol.for("pi-pretty.fff-service");   // registry toàn cục, cross-realm

export interface FffService { /* ...interface... */ }

declare global {
  // eslint-disable-next-line no-var
  var __fffService: FffService | undefined;
}

/** Lấy (hoặc tạo) FffService duy nhất. Nhiều import → cùng instance. */
export function getFffService(factory: () => FffService): FffService {
  const g = globalThis as Record<symbol, FffService | undefined>;
  if (!g[FFF_SYM]) g[FFF_SYM] = factory();             // build 1 lần duy nhất
  return g[FFF_SYM]!;
}

/** Reset cho test — delete key, instance GC, test sau tạo mới sạch. */
export function resetFffService(): void {
  delete (globalThis as Record<symbol, unknown>)[FFF_SYM];
}

// Lưu ý: Symbol.for("...") ≠ Symbol("..."):
//   Symbol.for dùng registry toàn cục → cùng key string → CÙNG symbol → cùng slot
//   Symbol() tạo symbol unique mỗi lần → MỖI import slot khác → leak instance
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 1 instance indexer đắt (không rebuild mỗi import) | ❌ globalThis pollution (cần namespace Symbol rõ) |
| ✅ Cross-realm share (Symbol.for registry) | ❌ Test quên reset → leak state giữa test |
| ✅ Reset sạch bằng delete key (test-friendly) | ❌ Chỉ hợp lý khi instance thực sự đắt/dài hạn |

## Khác các hướng gần

| | AGS Singleton Symbol | AGR SDK Fallback | shared-instances.ts |
|---|---|---|---|
| Trọng tâm | Cross-realm share 1 instance | Degrade khi thiếu dep | Singleton dùng chung mode |
| Cơ chế | globalThis + Symbol.for | isAvailable → SDK | Module-level cache |
| Quan hệ | Nối instance sharing | Nối robustness | Nối DI bootstrap |

## Khi nào chọn

- Service/indexer đắt build, cần dùng chung cross-realm (reload, multiple import)
- Muốn reset sạch cho test (delete key thay vì hack)
- Pattern DI phức tạp quá mức — singleton registry đủ dùng
- Guard: Symbol.for (không Symbol()), namespace key rõ, reset test sau dùng
