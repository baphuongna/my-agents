# Hướng LT: Runtime Policy Enforcement — guardrail kiểm tra agent behavior tại runtime

> **Nguồn gốc:** Policy enforcement point (PEP) / policy decision point (PDP) — XACML; OPA Gatekeeper; network firewall rule chain; "runtime guardrails"; "policy-as-code"; admission controller (Kubernetes); AWS Service Control Policy
> **Coupling:** 🟡 — thêm policy engine layer vào agent runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (permissions/validation sẵn — chưa có dynamic policy engine)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**Policy enforcement** (XACML PEP/PDP): mỗi action đi qua **enforcement point** → check policy → allow/deny. **OPA Gatekeeper**: policy-as-code (Rego) kiểm tại admission (Kubernetes) — không deploy nếu vi phạm. **AWS SCP**: hard guardrail tại account level. Nguyên tắc: policy **tách khỏi code** — declare rule → engine enforce tại runtime. Khác **permissions** (ai được làm gì) — policy kiểm **behavior** (action có hợp lệ trong context này không); khác **290 precondition** (state check) — LT **dynamic policy** có thể đổi runtime; khác **124 DT permissions** (quyền tool) — LT kiểm **nội dung/ngữ cảnh** action không chỉ quyền.

## Mô tả

mya runtime policy enforcement: trước mỗi agent action, đi qua **policy engine** — check rule động (VD "không gửi email ngoài giờ", "không xóa file production", "data nhạy cảm phải qua approval"). Policy khai báo bằng code (JSON/DSL), có thể cập nhật runtime không deploy lại. PEP tại agent loop, PDP evaluate rule. mya có permissions (124) + precondition (290) — LT thêm **policy engine** động (rule thay đổi theo context, thời gian, data classification). Nối 283 data-classification — LT enforce **policy theo data sensitivity**.

## Kiến trúc

```
  AGENT proposes ACTION
        │
        ▼
  ┌──── POLICY ENFORCEMENT POINT (PEP) ────┐
  │                                        │
  │  context: { agent, action, data, time } │
  │         │                              │
  │         ▼                              │
  │  POLICY DECISION POINT (PDP):           │
  │   rule1: data.class=PII → require HR    │
  │   rule2: time>22h && action=email → DENY│
  │   rule3: target=prod && action=delete   │
  │           → DENY                        │
  │         │                              │
  │    ┌────┴────┐                         │
  │    │ ALLOW   │ DENY (block + reason)    │
  │    └────┬────┘                         │
  └─────────┼──────────────────────────────┘
            │
       ALLOW → EXECUTE action
       DENY  → agent nhận "vi phạm rule2: no email after 22h"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 124 DT dynamic permissions — quyền tool (nền — static)
// ✅ 290 KD precondition checks — state check (nền)
// ✅ 283 data-classification — classify data (policy input)
// ✅ 284 data-minimization — PII handling (policy source)
// ✅ 226 HR human-approval — approval gate (policy outcome)
// ✅ 198 GP audit — record policy decision (evidence)

// ❌ THIẾU: policy engine (PDP — evaluate rule động)
// ❌ THIẾU: PEP tại agent loop (intercept action)
// ❌ THIẾU: policy-as-code format (JSON/DSL, update runtime)
// ❌ THIẾU: context-aware rule (time/data/agent-specific)
```

## Implementation

```typescript
// packages/policy/src/engine.ts (NEW)
interface PolicyContext {
  agent: string;
  action: string;
  args: unknown;
  dataClassification: 'public' | 'internal' | 'PII' | 'secret';
  timestamp: number;
}

interface Policy {
  id: string;
  condition: (ctx: PolicyContext) => boolean;
  decision: 'allow' | 'deny' | 'require-approval';
  reason: string;
}

class PolicyEngine {
  constructor(private policies: Policy[] = []) {}

  // PDP — evaluate tất cả rule, deny priority
  decide(ctx: PolicyContext): { decision: string; reason: string } {
    for (const p of this.policies) {
      if (p.condition(ctx)) {
        if (p.decision === 'deny') return { decision: 'deny', reason: p.reason };
        if (p.decision === 'require-approval') return { decision: 'require-approval', reason: p.reason };
      }
    }
    return { decision: 'allow', reason: 'no policy matched' };
  }

  // PEP — intercept tại agent loop
  async enforce(ctx: PolicyContext, execute: () => Promise<unknown>): Promise<unknown> {
    const { decision, reason } = this.decide(ctx);
    if (decision === 'deny') throw new PolicyViolationError(reason);
    if (decision === 'require-approval') {
      const ok = await humanApproval.request(ctx); // HR 226
      if (!ok) throw new PolicyViolationError('approval denied');
    }
    return execute();
  }

  // Update policy runtime — không deploy lại
  update(policies: Policy[]): void { this.policies = policies; }
}

// VD: const engine = new PolicyEngine([
//   { id: 'no-prod-delete', condition: c => c.args?.env === 'prod' && c.action === 'delete',
//     decision: 'deny', reason: 'no delete in prod' },
// ]);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rule động, update runtime (OPA proven) | ❌ Overhead mỗi action đi qua engine |
| ✅ Policy tách code (policy-as-code) | ❌ Rule phức tạp → debug khó |
| ✅ Context-aware (time/data/agent) | ❌ False deny block hợp lệ |
| ✅ Nối 283 classification → enforce theo data | ❌ Engine = single point (cần fallback) |

## Khác các hướng gần

| | 124 Permissions | 290 Precondition | LT: Policy Enforcement |
|---|---|---|---|
| Kiểm gì | Quyền tool | State trước execute | **Behavior trong context** |
| Dynamic | ❌ (static) | ❌ (static rule) | ✅ update runtime |
| Context | ❌ | ❌ | ✅ time/data/agent |
| Format | Code | Code | **Policy-as-code** |

## Khi nào chọn

- Rule thay đổi thường xuyên (cần update không deploy)
- Context-aware (giờ, data sensitivity, agent identity)
- Muốn policy tách khỏi business logic
- Kết hợp 124 permissions (quyền) + 290 precondition (state) — LT thêm behavioral guardrail; audit mọi decision (198)
