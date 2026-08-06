# Hướng EK: Multi-Tenancy — cô lập dữ liệu/quyền/ngân sách giữa các người dùng

> **Nguồn gốc:** ScaleKit "Access Control for Multi-Tenant AI Agents" (channel-owned OAuth); LoginRadius "Isolating Misbehaving Tenants"; Blaxel "Multi-tenant AI agent isolation" (microVM); AWS "Tenant isolation using Bedrock Agents"; Figgo/Reddit tenant isolation 2026
> **Coupling:** 🟡 — tenant context phải thấm mọi layer (registry, memory, budget)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (finops tag + UUUU perms + memory per-profile sẵn; thiếu tenant scope layer)
> **Effort:** 2-3 tuần

## Nguồn gốc

Multi-tenancy: **mỗi tenant (user/phe/project) có dữ liệu, agents, tokens, workflows cách biệt** — LoginRadius: "Tenant isolation ensures each tenant's AI agents, data, tokens, and workflows remain segregated and cannot affect other tenants"; ScaleKit: "enforce tenant isolation, scope translation, and channel-owned OAuth — prevent cross-tenant data leak"; Blaxel: "microVM isolation, per-tenant networking, scoped storage"; Reddit AI_Agents: "The Hidden Risk in Scaling B2B AI Agents: Tenant Data Isolation" và "Multi-tenant AI agents need database-level isolation, not app-level filters". Điểm chính: *DB-level isolation* hơn filter — app-level filter dễ lọt dữ liệu chéo. Điểm khác **UUUU perms** (quyền tool) — LLLLLL *cô lập không gian*: mọi thứ (memory, session, budget, artifact, registry) mang tenant id; query/tool bị scope ép theo tenant (không nhìn thấy nhau); DB schema có tenant column (RLS-style) chứ không filter ở app layer. Nối XXXXX (finops tag tenant — meter/quota), WW (policy per tenant), UUUU (quyền theo tenant), KK (cô lập thực thi BLX — microVM per tenant nếu cần).

## Mô tả

mya tenancy: (1) **tenant id bắt buộc** — mọi entity/bảng có tenant col; session, memory, artifact, audit gắn tenant (không bao giờ thiếu tenant); (2) **scope translation** — identity → channel/user → tenant (ScaleKit), OAuth gắn channel; (3) **DB-level isolation** — RLS/schema-per-tenant (Reddit: app filter không đủ) — query luôn đi qua scope; (4) **resource quota** — metering/quota theo tenant (XXXXX finops): 1 tenant chạy quá → isolate/throttle không ảnh hưởng tenant khác (LoginRadius: "isolate misbehaving tenants"); (5) **execution isolation** (nặng) — agent tenant không tin cậy chạy microVM riêng (Blaxel); (6) **audit theo tenant** — VV ghi tenant id — trace được hoạt động từng khách.

## Kiến trúc

```
  IDENTITY ──► SCOPE TRANSLATION (ScaleKit: channel ← user ← tenant)
        │
        ▼
  MỌI LAYER MANG TENANT ID: session · memory · artifact · budget · registry
        │
        ▼
  DB-LEVEL ISOLATION (RLS / schema-per-tenant — Reddit: không chỉ app filter)
        │
        ▼
  QUOTA THEO TENANT (XXXXX finops) — tenant quá → throttle/cô lập (LoginRadius)
        │
        ▼
  EXECUTION CÔ LẬP (Blaxel): tenant không tin cậy → microVM riêng
        │
        ▼
  AUDIT VV — mọi bản ghi có tenant id (trace theo khách)
```

```
mya: XXXXX tag + UUUU + memory per-profile SẸN — thiếu: tenant scope layer + RLS
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ XXXXX finops — meter/quota theo tag (tenant = tag)
// ✅ UUUU dynamic perms — quyền theo ngữ cảnh (tenant context)
// ✅ memory per-profile — tựa tenant (chưa ép ở DB level)
// ✅ WW policy — rule theo tenant
// ✅ UUUU durable sessions — session gắn user

// ❌ THIẾU: tenant scope layer (bắt buộc id ở mọi entity)
// ❌ THIẾU: DB-level isolation (RLS/schema-per-tenant)
// ❌ THIẾU: execution cô lập nặng (microVM per tenant — Blaxel)
// ❌ THIẾU: audit tenant bắt buộc (VV thiếu cột)
```

## Implementation

```typescript
// packages/tenancy/src/scope.ts (NEW)
export class TenantScope {
  async exec<T>(tenant: TenantId, fn: () => Promise<T>): Promise<T> {
    await assertQuota(tenant);                  // XXXXX — meter/limit theo tenant
    const ctx = { tenant, rls: where("tenant_id = ?", tenant) }; // DB-level (Reddit)
    return withContext(ctx, fn);                // query luôn qua scope
  }
}
// identity → channel → tenant (ScaleKit OAuth)
// tenant không tin cậy → microVM riêng (Blaxel) — nối DDDDDD sandbox
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không lộ dữ liệu chéo tenant (RLS — DB level) | ❌ Mọi query thêm tenant col — hơi nặng |
| ✅ 1 tenant chạy quá không ảnh hưởng tenant khác | ❐ Scope sai → lỗi toàn hệ thống (thấm mọi layer) |
| ✅ Quota/audit theo khách (XXXXX + VV có tenant) | ❌ Không cần nếu 1 người dùng chính |
| ✅ Xây trên XXXXX + UUUU | ❌ MicroVM per tenant tốn (Blaxel) |

## Khác các hướng gần

| | XXXXX FinOps | UUUU Perms | LLLLLL: Tenancy |
|---|---|---|---|
| Cô lập gì | Ngân sách | Quyền tool | **Toàn không gian (data/quota/exec)** |
| Cơ chế | Tag + meter | Policy | **Tenant scope + DB RLS** |
| Quan hệ | 1 phần | 1 phần | **Bao trùm cả 2** |

## Khi nào chọn

- Nhiều người/khách dùng chung agent — không được lộ dữ liệu chéo
- B2B/SaaS agent — mỗi khách có data/agents riêng (ScaleKit)
- 1 tenant chạy quá gây ảnh hưởng người khác
- Đã có XXXXX + UUUU + memory per-profile — thêm scope layer + RLS