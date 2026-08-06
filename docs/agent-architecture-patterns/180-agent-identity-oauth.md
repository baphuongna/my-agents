# Hướng FX: Agent Identity & OAuth — danh tính riêng cho agent: OIDC/OAuth 2.1, token exchange

> **Nguồn gốc:** OpenID Foundation "Identity Management for Agentic AI" (OAuth/OIDC designed cho user — agents trong shared codebases/chat channels); Curity "SSO for AI Agents with OpenID Connect" (OAuth token exchange để giữ user identity qua agent); SecureAuth "Identity 101 for AI Agents" (OAuth 2.1 + OIDC cho enterprise); IETF draft-klrc-aiagent-auth (model auth/authorization cho agent interactions)
> **Coupling:** 🟡 — mọi agent phải có danh tính + token hợp lệ khi gọi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (TTTTTT identity + KKKK broker sẵn; thiếu OAuth flows)
> **Effort:** 2-4 tuần

## Nguồn gốc

Agent identity: **mỗi agent có danh tính riêng — auth bằng OAuth 2.1/OIDC chuẩn, token theo user/agent, không dùng chung credential** — OpenID: "OAuth and OpenID Connect were designed for individual user authorization, agents can be employed in shared codebases or chat channels in groups" (vấn đề: agent là cái gì trong OAuth — cần mở rộng); Curity: "utilize OpenID Connect and a new form of OAuth token exchange, to maintain user identities across agents" (token exchange — agent thay mặt user); SecureAuth: "OAuth 2.1 and OpenID Connect for securing AI agent identities in the enterprise — authorization flows"; IETF: "model for authentication and authorization of AI agent interactions — leverages existing standards". Điểm khác **TTTTTT identity** (danh tính + auth cơ bản đã có) và **KKKK credential broker** (giữ secret) — YYYYYYY *hoàn thiện theo chuẩn*: (1) agent client — agent là OAuth client có client_id/secret riêng (SecureAuth), scope riêng; (2) user delegation — user ủy quyền agent (user consent → agent có token thay mặt — vouched human-to-agent authorization), token exchange (Curity — maintain user identity); (3) flows — client credentials (agent tự chủ), authorization code + consent (khi cần quyền user — CCCC), refresh; (4) shared environment — agent trong team/chat dùng chung scope (OpenID — group); (5) chuẩn hóa — theo OAuth 2.1 (Parecki — agent làm vỡ pattern cũ), rotation token (KKKK); (6) audit — token dùng ai/phục vụ gì (VV + continuous monitoring — VVVVVVV).

## Kiến trúc

```
  AGENT = OAUTH CLIENT (SecureAuth — OAuth 2.1/OIDC enterprise)
   · client_id/secret riêng · scope riêng (agent cần gì → scope đó)
        │
        ▼
  USER DELEGATION (vouched human-to-agent authorization):
   · user consent → token thay mặt user (Curity token exchange)
   · agent tự chủ → client_credentials (không cần user)
        │
        ▼
  FLOWS (OpenID): auth code + consent (CCCC) · refresh · rotation (KKKK)
   · shared: agent nhóm dùng scope nhóm (OpenID group)
        │
        ▼
  AUDIT: token → ai/phục vụ gì (VV + VVVVVVV monitor) · hết hạn/rotate
```

```
mya: TTTTTT + KKKK SẴN — thiếu: OAuth flows + user delegation
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ TTTTTT identity — danh tính agent (nền)
// ✅ KKKK credential broker — secret per agent (rotation nền)
// ✅ CCCC HITL — consent moment (human approval)
// ✅ UUUU perms — scope mapping (đã có quyền)
// ✅ VV audit + VVVVVVV — theo dõi token dùng

// ❌ THIẾU: OAuth 2.1/OIDC flows (auth code/client creds/refresh)
// ❌ THIẾU: user delegation (token exchange — Ccurity)
// ❌ THIẾU: consent cho user (ủy quyền agent)
```

## Implementation

```typescript
// packages/identity/src/oauth.ts (NEW)
export class AgentOAuth {
  async tokenFor(a: Agent, user?: User): Promise<Token> {
    if (user) return exchange(user.token, a.scope);  // Ccurity token exchange — giữ user identity
    return clientCredentials(a.clientId, a.secret);  // agent tự chủ (SecureAuth)
  }
  async consent(a: Agent, scopes: string[]): Promise<Grant> {
    return hitl.approve(a, scopes);                  // CCCC — user consents
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chuẩn — tương thích IAM hiện có (OAuth 2.1/OIDC) | ❌ OAuth flows phức tạp (Parecki: agent vỡ pattern cũ) |
| ✅ Ủy quyền rõ — user cho phép agent làm gì (vouched) | ❐ Consent mỗi lần — phiền khi agent tự chủ |
| ✅ Không dùng chung credential — agent có danh tính riêng | ❌ Token exchange bảo mật khó (không thấm nước) |
| ✅ Xây trên TTTTTT + KKKK + CCCC | ❌ Agent không có user đứng sau — scope trống |

## Khác các hướng gần

| | TTTTTT Identity | KKKK Broker | YYYYYYY: OAuth |
|---|---|---|---|
| Mức | Danh tính | Bí mật | **Chuẩn ủy quyền (OAuth/OIDC)** |
| Cơ chế | Auth cơ bản | Giữ secret | **Flows + token exchange + consent** |
| Quan hệ | Nền | Nền | **Hoàn thiện theo chuẩn ngành** |

## Khi nào chọn

- Agent gọi service bên ngoài có OAuth (API, SaaS)
- User cần ủy quyền agent (human-to-agent authorization — vouched)
- Môi trường enterprise — chuẩn IAM bắt buộc (OAuth 2.1)
- Đã có TTTTTT + KKKK + CCCC — thêm flows + delegation