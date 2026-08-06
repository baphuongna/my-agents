# Hướng RRRRRRRR: Delegation & Task Handoff — agent giao việc cho agent; ủy quyền, theo dõi, thu quyền về

> **Nguồn gốc:** arXiv 2501.09674 "Authenticated Delegation and Authorized AI Agents" (framework — authenticated, authorized, auditable delegation of authority; user securely ủy quyền); fast.io "AI Agent Delegation Patterns" (4 architectures — distribute tasks, share context, coordinate); Scalekit "On-Behalf-Of" (secure scoped delegation — agent hoạt động trong scope user cấp); WorkOS (delegation chain 4 agents 3 handoffs tái dựng từ 1 task ID); cellcog (bounded child task — delegating agent giữ quyền)
> **Coupling:** 🟡 — runtime phải hỗ trợ delegation chain + scoped authority
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent + TTTTTT identity sẵn; thiếu delegation contract)
> **Effort:** 2-4 tuần

## Nguồn gốc

Delegated authority: **agent giao task cho agent khác — nhưng quyền đi kèm phải rõ (chain, scope, thu hồi), confirm + ghi lại để tái dựng** — arXiv 2501.09674: "authenticated, authorized, and auditable delegation of authority — human users can securely delegate"; fast.io Agent Delegation Patterns; Scalekit: "secure, scoped delegation — operating within the permissions granted by the user" (on-behalf-of); WorkOS: "a delegation chain spanning four agents and three handoffs should be reconstructable from a single task ID"; cellcog: "bounded child task — delegating agent keeps". Điểm khác **B subagent orchestration** (supervisor chia việc — đã có) và **172 team config** (team khai báo) — RRRRRRRR *quyền ủy quyền + chuỗi*: (1) delegation contract — ai giao cho ai, task nào, scope quyền gì (Scalekit on-behalf-of), thời hạn; (2) authenticated — người/user xác thực chủ ủy quyền (arXiv 2501.09674 — authenticated delegated authority), YYYYYYY OAuth token exchange nền; (3) chain — chuỗi ủy quyền (agent A → B → C), giữ task ID xuyên suốt (WorkOS — 1 ID tái dựng toàn bộ); (4) bounded — child task giới hạn (cellcog — bounded child), agent con không tự ý giao tiếp thêm; (5) audit — mọi handoff ghi (QQQQQQQQ immutable), có thể audit; (6) thu hồi — hết thời hạn/quyền bị thu (revoke — OAuth), không để quyền vương vãi (GGGGGGGG least privilege — JIT). Nối B (subagent — nền), 172 (team config), YYYYYYY (OAuth — delegation token), 188 (scope), QQQQQQQQ (audit chain), MMMMMMM guardrails (chặn hành động ngoài scope).

## Kiến trúc

```
  USER ủy quyền (arXiv 2501.09674 — authenticated, authorized)
        │
        ▼
  DELEGATION CONTRACT (Scalekit on-behalf-of — scoped):
   · agent A nhận → giao task nhỏ cho agent B · scope · deadline
   · bounded child task (cellcog — giới hạn)
        │
        ▼
  CHAIN (WorkOS): A → B → C — cùng 1 task ID · mọi handoff trace
        │
        ▼
  AUDIT (QQQQQQQQ) + REVOKE (thu hồi scope khi hết hạn — GGGGGGGG JIT)
```

```
mya: subagent + TTTTTT SẴN — thiếu: delegation contract + chain + revoke
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ B subagent orchestration — supervisor giao việc (nền)
// ✅ 172 team config — ai gọi ai (nền)
// ✅ YYYYYYY OAuth — token + exchange (delegation auth nền)
// ✅ GGGGGGGG least privilege — scope theo task (nền)
// ✅ QQQQQQQQ audit — ghi chain
// ✅ GGGGGGGG least privilege — JIT (thu hồi tự động)

// ❌ THIẾU: delegation contract (scope/điều kiện/giao cho ai)
// ❌ THIẾU: chain tracking (task ID xuyên A→B→C)
// ❌ THIẾU: revoke giữa chừng (thu hồi quyền khi agent cầm quá lâu)
```

## Implementation

```typescript
// packages/delegation/src/contract.ts (NEW)
export class Delegation {
  delegate(from: Agent, to: Agent, task: Task, scope: Scope): DelegateToken {
    const t = { taskId, from, to, scope, expires } // bounded child task (cellcog)
    audit.chain(taskId, t);                          // WorkOS — 1 ID tái dựng
    return t;
  }
  revoke(t: DelegateToken): void {                   // thu hồi giữa chừng
    oauth.revoke(t.token);                           // YYYYYYY — hết quyền ngay
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự giao việc — mở rộng tự nhiên (fast.io patterns) | ❌ Chain sâu — lỗi lan rộng nếu scope sai |
| ✅ Rõ ràng + audit — ai làm gì trong chuỗi (WorkOS) | ❐ Delegation mỗi lần — thêm vòng quản lý |
| ✅ Thu hồi được — an toàn nhất ủy quyền (Scalekit) | ❌ Được quá nhiều scope → risk (GGGGGGGG cần) |
| ✅ Xây trên subagent + OAuth + scope | ❌ Việc nhỏ deleg - overhead |

## Khác các hướng gần

| | B Subagent | 172 Team | RRRRRRRR: Delegation |
|---|---|---|---|
| Sự linh hoạt | Giao việc | Khai báo | **Chuỗi Ủy quyền + contract** |
| Quyền | implicit | cấu hình | **Token + scope + revoke** |
| Quan hệ | Nền | Cấu hình | **Chuỗi giao việc an toàn** |

## Khi nào chọn

- Agent dài giao tiếp - chuỗi agent → agent (nhiều tầng)
- Cần audit + thu hồi khi delegate (production)
- Có many distinct teams/work internals — bounded
- Đã có subagent + YYYYYYY + audit — thêm contract + chain