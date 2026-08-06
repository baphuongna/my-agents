# Hướng GK: Multi-Tenant Agent Isolation — 1 hệ, nhiều khách; dữ liệu/tài nguyên tách kín

> **Nguồn gốc:** Azure Architecture "Tenancy Models for Multitenant Solution" (isolation level là cân nhắc lớn nhất); Redis "Data isolation in multi-tenant SaaS" (isolation models — ngoài DB chính, scaling); AWS Bedrock "Implementing tenant isolation" (agents trong multi-tenant environment); blaxel "Multi-tenant AI agent isolation" (container — process tree riêng, isolated network/filesystem); fast.io "Multi-Tenant AI Agent Architecture" (1 agent system phục vụ nhiều tenant — data/files/chats tách)
> **Coupling:** 🟡 — mọi component phải biết tenant + tôn trọng ranh giới
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (141 multi-tenancy sẵn; thiếu isolation hardening)
> **Effort:** 3-6 tuần

## Nguồn gốc

Multi-tenant isolation: **nhiều khách dùng chung 1 hệ — nhưng dữ liệu/tài nguyên/quy trình của từng tenant phải kín tuyệt đối** — Azure: "level of isolation that each tenant needs là cân nhắc lớn nhất"; Redis: "core isolation models — extend isolation beyond primary database, scaling strategies"; AWS: tenant isolation cho agents (knowledge bases, memory, tools per tenant); blaxel: "containers isolate at the process level — separate process tree, isolated network and filesystem views" (mức mạnh — mỗi tenant 1 container riêng); fast.io: "one agent system serves many customers — keeps their data, files, chats separate". Điểm khác **141 multi-tenancy** (chia sẻ hạ tầng tổng quát — đã có) — LLLLLLLL *chuyên cô lập agent*: (1) data isolation — mỗi tenant: knowledge base (RAG), memory (J — episodic/semantic), files, chats riêng (fast.io); tenant_id mọi bảng (sharding — Medium); (2) agent isolation — mức độ: shared agent + tenant context (nhẹ), agent riêng per tenant (container — blaxel — nặng, an toàn nhất); (3) tool/cost isolation — tool registry per tenant, cost attribution per tenant (LLLLLLL); (4) cache isolation — cache LLM per tenant (JJJJJJJJ SafeKV — chống prompt leakage giữa tenant); (5) scaling — model DB/tenant hay shared (Redis scaling); (6) governance — policy per tenant (VVVVVVV data governance + UUUU perms), audit per tenant. Nối 141 (nền), VVVVVVV (data policy), UUUU (perms), JJJJJJJJ (cache per tenant), LLLLLLL (cost per tenant), WWWW (billing per tenant), MMMMMMM (guardrail per tenant), KKKKKKKK (pricing per tenant).

## Kiến trúc

```
  1 HỆ — NHIỀU TENANT (fast.io: data/files/chats tách)
        │
        ▼
  DATA ISOLATION (Redis/Azure): tenant_id mọi bảng · KB/RAG riêng · memory riêng
        │
        ├── MỨC NHẸ: shared agent + tenant context (tenant_id trong prompt)
        ├── MỨC MẠNH: agent riêng per tenant — container (blaxel process tree)
        └── CACHE: per tenant (JJJJJJJJ SafeKV — chống prompt leakage)
        │
        ▼
  COST (LLLLLLL per tenant) · POLICY (VVVVVVV + UUUU per tenant)
   · BILLING (WWWW) · GUARDRAIL (MMMMMMM per tenant)
```

```
mya: 141 multi-tenancy SẴN — thiếu: isolation hardening (agent/cache/data)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 141 multi-tenancy — chia sẻ hạ tầng (nền)
// ✅ UUUU perms + VVVVVVV data policy — quyền per tenant
// ✅ LLLLLLL cost + WWWW billing — per tenant
// ✅ JJJJJJJJ cache — per tenant (nền)
// ✅ MMMMMMM guardrails — per tenant (nền)
// ✅ J memory + R kb — scope per tenant (tenant_id)

// ❌ THIẾU: agent isolation mạnh (container per tenant — blaxel)
// ❌ THIẾU: cache isolation enforcement (SafeKV)
// ❌ THIẾU: tenant scaling model (Redis — sharding per tenant)
```

## Implementation

```typescript
// packages/tenancy/src/isolation.ts (NEW)
export class Tenancy {
  scope(t: Tenant): Scope {                    // mọi request mang tenant
    return { db: t.id, mem: mem.namespace(t), kb: rag.namespace(t),
             tools: registry.byTenant(t), cache: cache.namespace(t) };
  }
  spawn(agent: Agent, t: Tenant): Process {    // blaxel: container riêng
    return isolate.container(agent, t);        // process tree + net/fs riêng
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 1 hạ tầng — nhiều khách (chi phí chia sẻ) | ❌ Isolation mạnh = tốn hạ tầng (container riêng) |
| ✅ An toàn tuyệt đối giữa tenant (blaxel process tree) | ❐ tenant_id thiếu sót 1 chỗ = rò dữ liệu |
| ✅ Scale: thêm tenant không thêm hạ tầng | ❌ Chính sách/guardrail nhân bản per tenant |
| ✅ Xây trên 141 + UUUU + VVVVVVV | ❌ Debug cross-tenant khó |

## Khác các hướng gần

| | 141 Multi-Tenancy | VVVVVVV Data Gov | LLLLLLLL: Isolation |
|---|---|---|---|
| Trọng tâm | Chia hạ tầng | Quyền dữ liệu | **Cô lập agent/cache/process** |
| Mức | Logical | Policy | **Logical + container (blaxel)** |
| Quan hệ | Nền | 1 lớp | **Hardening toàn diện** |

## Khi nào chọn

- Bán SaaS agent cho nhiều khách — dữ liệu nhạy cảm (B2B)
- Tenant cần mức cô lập cao (process/network — blaxel)
- Cache LLM dùng chung — phải tách per tenant (SafeKV)
- Đã có 141 + VVVVVVV — thêm container isolation + scaling