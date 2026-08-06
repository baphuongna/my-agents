# Hướng ES: Delegated Agent Identity — agent hành động thay user, có quyền riêng + audit

> **Nguồn gốc:** OpenID "Identity Management for Agentic AI" 2025 (OAuth 2.1, "on-behalf-of"); ScaleKit "Delegated Agent Access" (scoped, auditable); arXiv 2501.09674 "Authenticated Delegation and Authorized AI Agents"; CSA Agent Identity Governance Framework v1; WorkOS "AI agent authentication guide"
> **Coupling:** 🟡 — identity phải thấm xác thực/ủy quyền mọi API call
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (credential broker KKKK + perms UUUU + audit VV sẵn; thiếu delegation chain)
> **Effort:** 2-3 tuần

## Nguồn gốc

Delegated identity: **agent có identity riêng, hành động "on-behalf-of" user với scope + audit** — ScaleKit: "AI agents need to act on behalf of users with scoped, auditable permissions, not full access"; OpenID 2025 whitepaper: "True delegation requires explicit 'on-behalf-of' flows where agents prove their delegated scope while remaining identifiable as distinct from the user"; arXiv 2501.09674: "authenticated, authorized, and auditable delegation of authority to AI agents"; Penligent: "binding identity, ownership, intent, authorization, delegation, runtime context, and evidence into one governable chain"; WorkOS: "give AI agents their own identity, authenticate them without borrowing user sessions". Điểm khác **KKKK credential broker** (secret không chạm agent) và **UUUU perms** (quyền tool per context) — TTTTTT *cấp quyền rõ ràng*: user ủy quyền cho agent (delegation token kèm scope/expiry); agent gọi API với identity agent + on-behalf-of user; audit ghi đầy đủ chuỗi (ai ủy → agent nào làm → hành động gì — VV); thu hồi được khi hết hạn/không dùng. Chống user session bị dùng chung (borrow sessions). Nối KKKK (bearer token/credential), CCCC HITL (ủy quyền, quyết định nhạy cảm vẫn cần người), IIIIII (supply chain — agent signature), LLLLLL (tenant — identity scope theo tenant).

## Mô tả

mya delegated identity: (1) **agent identity** — mỗi agent có principal riêng (không dùng chung session user — WorkOS); (2) **on-behalf-of flow** — user ủy quyền: delegation grant (scope: tool nào, hạn mức) — OpenID: explicit "on-behalf-of" chứng minh delegated scope; (3) **token** — agent gọi API với: identity agent + on-behalf-of user + scope + expiry (OAuth 2.1 — CSA baseline); (4) **delegation chain** — agent A ủy cho agent B: chuỗi ủy quyền phải đầy đủ (Penligent: governable chain) — không đứt giữa; (5) **audit** — mọi hành động: ai ủy, agent nào, thay mặt ai, phạm vi nào (VV + KKKK log); (6) **thu hồi** — hết hạn/quá scope/không dùng → tự thu hồi (least-privilege theo thời gian); nguy hiểm: ủy quyền quá rộng (full access) — cấm scope rộng, luôn scoped (ScaleKit).

## Kiến trúc

```
  USER ──► DELEGATION GRANT (scope tool · hạn mức · expiry — UUUU expand)
        │  OAuth 2.1 "on-behalf-of" (OpenID 2025)
        ▼
  AGENT IDENTITY (principal riêng — không dùng chung session user — WorkOS)
        │
        ▼
  API CALL: identity agent + on-behalf-of user + scope + expiry
        │
        ▼
  DELEGATION CHAIN (agent A → B): chuỗi đầy đủ không đứt (Penligent)
        │
        ▼
  AUDIT VV: ai ủy · agent nào · thay ai · scope gì — evidence chain
        │
        ▼
  THU HỒI: hết hạn/quá scope/không dùng → thu hồi (least-privilege)
```

```
mya: KKKK + UUUU + VV SẸN — thiếu: agent principal + on-behalf-of token + chain
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ KKKK credential broker — secret/token không chạm agent (nền)
// ✅ UUUU dynamic perms — scope tool (mở rộng thành delegated scope)
// ✅ VV audit — ghi hành động (thêm identity/on-behalf-of col)
// ✅ CCCC HITL — quyết định nhạy cảm vẫn cần user duyệt
// ✅ LLLLLL tenancy — scope theo tenant

// ❌ THIẾU: agent principal (identity riêng mỗi agent)
// ❌ THIẾU: on-behalf-of token (OAuth 2.1 deleg agg)
// ❌ THIẾU: delegation chain (agent → agent ủy)
// ❌ THIẾU: revocation (expiry/quá scope)
```

## Implementation

```typescript
// packages/identity/src/delegation.ts (NEW)
export class Delegation {
  async onBehalfOf(owner: Principal, agent: Principal, scope: Scope) {
    const tok = await oauth.issue({          // OAuth 2.1 — CSA baseline
      sub: agent.id, oauth: "on-behalf-of",  // OpenID 2025
      owner: owner.id, scope: scope, exp: now + scope.ttl,
    });
    return audit.delegate(owner, agent, scope, tok);  // VV — evidence chain
  }
  check(agent: Principal, action: Action) {
    if (!this.chainValid(agent)) throw new DelegationRevoked(agent.id); // Penligent
    assertInScope(agent, action);                                      // least-privilege
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rõ ai ủy, agent nào làm gì — audit đầy đủ (VV) | ❌ Triển khai OAuth 2.1/on-behalf-of không rẻ |
| ✅ Agent không dùng chung session user (WorkOS) | ❐ Chuỗi ủy quyền dài — khó quản (chain) |
| ✅ Least-privilege theo scope + expiry (thu hồi) | ❌ Ủy quyền quá rộng vẫn nguy hiểm (phải cấm) |
| ✅ Chống "borrow session" — bảo mật hơn | ❌ 1 user 1 agent — delegation ít lợi ích thêm |

## Khác các hướng gần

| | KKKK Credential | UUUU Perms | TTTTTT: Delegation |
|---|---|---|---|
| Quản gì | Secret | Quyền run-time | **Identity + ủy quyền + chain** |
| Cơ chế | Broker | Policy context | **OAuth 2.1 on-behalf-of + token** |
| Quan hệ | Cấp token | Scope | **Bao trùm cả 2 + identity riêng** |

## Khi nào chọn

- Agent gọi API/tool bên ngoài thay user (push, deploy, gửi) — cần danh tính rõ
- Nhiều agent ủy quyền nhau (chain) — cần governable chain
- Đã có KKKK + UUUU + VV — thêm agent principal + on-behalf-of
- Tuân chuẩn identity (OAuth 2.1, OpenID whitelist — CSA framework)