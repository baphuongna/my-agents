# Hướng WX: Predicate Gate Routing — định tuyến bằng gate(field, branches, otherwise) + defineRoute; fallback không bao giờ âm thầm, audit row ghi chú

> **Nguồn gốc:** rpiv-mono (route DSL); "gate(field, branches, otherwise)", "defineRoute", "fallback never silent — audit row notes" | **Coupling:** 🟢 — thêm routing DSL (pure predicate, declarative) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (orchestration + audit sẵn — chưa có gate/branch DSL + defineRoute) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** định tuyến workflow qua **gate DSL** thay vì if/else rải rác: `gate(field, branches, otherwise)`. `field` là giá trị để phân nhánh; `branches` là map `{ matchValue → routeName }`; `otherwise` là route mặc định khi không khớp. Quy tắc cốt lõi: **fallback không bao giờ âm thầm** — khi không nhánh nào khớp, `otherwise` chạy **và** ghi **audit row** (ghi chú: "routed to default, no branch matched field=X") để người vận hành thấy flow đi lạc. `defineRoute` khai báo route có tên (registry), gate chỉ reference tên → dễ trace + validate trước runtime. Nguyên tắc: **routing tường minh + auditable** — mọi quyết định route (kể cả default) có dấu vết.

## Mô tả

mya predicate gate routing: workflow khai báo route qua `defineRoute(name, handler)` rồi `gate(field, branches, otherwise)` chọn route theo field. Nhánh khớp → chạy route đó; không khớp → otherwise route + audit row. mya có orchestration + audit — WX thêm **gate/branch DSL** + **defineRoute registry** + **non-silent-fallback audit**.

## Kiến trúc

```
  ┌─── defineRoute (registry) ───────────────────────────┐
  │  route "build"  → handlerBuild                         │
  │  route "test"   → handlerTest                          │
  │  route "deploy" → handlerDeploy                        │
  │  route "default"→ handlerDefault                       │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── gate(field, branches, otherwise) ─────────────────┐
  │  field = ctx.kind                                       │
  │  branches = { "feat": "deploy", "fix": "test" }         │
  │  otherwise = "default"                                  │
  │                                                          │
  │  ctx.kind == "feat"  → route "deploy" ✓                 │
  │  ctx.kind == "fix"   → route "test"  ✓                  │
  │  ctx.kind == "doc"   → NO MATCH → otherwise "default"   │
  │                        + AUDIT ROW: "no branch match doc"│ ← không âm thầm
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows orchestration.ts — orchestration (nền — WX route ở đây)
// ✅ packages/audit — audit trail (nền — WX fallback audit row)
// ✅ packages/core session-branch.ts — branching (nền — WX branch analog)

// ❌ THIẾU: gate(field, branches, otherwise) DSL
// ❌ THIẾU: defineRoute registry (named route)
// ❌ THIẾU: non-silent fallback audit (ghi row khi otherwise chạy)
```

## Implementation

```typescript
// packages/workflows/src/gate-routing.ts (MỚI)
type RouteHandler<C> = (ctx: C) => Promise<void>;

class RouteRegistry<C> {
  private routes = new Map<string, RouteHandler<C>>();
  defineRoute(name: string, handler: RouteHandler<C>): void { this.routes.set(name, handler); }
  has(name: string): boolean { return this.routes.has(name); }
  get(name: string): RouteHandler<C> | undefined { return this.routes.get(name); }
}

interface AuditFn { (row: { field: string; value: unknown; route: string; matched: boolean }): void; }

async function gate<C>(
  field: string, value: unknown,
  branches: Record<string, string>,   // matchValue → routeName
  otherwise: string,                  // route mặc định
  registry: RouteRegistry<C>, ctx: C, audit: AuditFn,
): Promise<void> {
  const routeName = branches[String(value)]; // nhánh khớp?
  const matched = routeName !== undefined;
  const target = matched ? routeName! : otherwise; // không khớp → otherwise
  if (!matched) audit({ field, value, route: target, matched: false }); // AUDIT (không âm thầm)
  const handler = registry.get(target);
  if (!handler) throw new Error(`unknown route: ${target}`);
  await handler(ctx);
}

// Usage:
// reg.defineRoute("deploy", hDeploy); reg.defineRoute("test", hTest); reg.defineRoute("default", hDefault);
// await gate("kind", ctx.kind, { feat:"deploy", fix:"test" }, "default", reg, ctx, auditRow);
// → kind=doc → "default" + audit row ghi "no branch match doc"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Routing tường minh (declarative gate, không if/else rải) | ❌ DSL learning curve (branch map syntax) |
| ✅ Non-silent fallback (otherwise + audit row) | ❌ Audit noise (nhiều default → nhiều row) |
| ✅ Named route (registry, dễ trace/validate) | ❌ Registry bloat (route khai nhiều không dùng) |
| ✅ Auditable (mọi quyết định route có dấu vết) | ❌ Field-coercion (value type mismatch silent) |

## Khác các hướng gần

| | if/else rải | switch-case | WX: Gate-DSL |
|---|---|---|---|
| Fallback | Silent default | Silent default | **✅ audit row** |
| Declarative | ❌ | ⚠️ | **✅ gate(field,branches)** |
| Trace | Khó | Trung bình | **✅ named route registry** |

## Khi nào chọn

- Workflow cần routing theo field mà mọi nhánh (kể cả default) phải auditable
- Muốn declarative routing (gate DSL) thay vì if/else rải rác
- Nối packages/workflows orchestration.ts + packages/audit + packages/core session-branch.ts; guard branch-coverage (warn nhánh không bao giờ hit), otherwise-required (gate bắt buộc otherwise — không silent skip), và field-type (coerce/stringify value trước match để tránh silent mismatch); WX = predicate gate routing, kết hợp 621 WW workflow-config-layering (route định nghĩa trong resolved config) + 620 WV outcome-collector-parser-validator (validate route outcome)
