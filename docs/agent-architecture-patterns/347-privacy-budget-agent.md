# Hướng MI: Privacy Budget Agent — tracking privacy budget + consent cho data processing

> **Nguồn gốc:** Differential privacy budget (ε — epsilon); "privacy budget accounting"; GDPR consent management; "privacy-preserving ML"; "data minimization" (284); "k-anonymity"; "purpose limitation"; DP-SGD; Apple/Google privacy budget
> **Coupling:** 🟡 — cần budget tracker + consent registry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (data-minimization/classification sẵn — chưa có privacy budget tracking)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Differential privacy** (Dwork): mỗi query revealing data → "tiêu tốn" privacy budget (ε). Budget có giới hạn — khi hết → không query thêm (protect individual). **Privacy budget accounting**: track ε tiêu tốn qua nhiều query. **GDPR consent**: data nhạy cảm cần consent — purpose limitation (chỉ dùng cho mục đích đã đồng ý), right to withdraw. **Data minimization** (284): chỉ collect/process tối thiểu. Nguyên tắc: agent xử lý data nhạy cảm phải **track budget** (ε tiêu tốn) + **check consent** (purpose) + **enforce limit** (hết budget → deny).

## Mô tả

mya privacy budget agent: khi agent xử lý user data (PII, sensitive), track **privacy budget** (ε tiêu tốn mỗi query/processing) + **consent** (user đồng ý mục đích này không?). Khi budget hết hoặc consent thiếu/thu hồi → deny processing. Nối 283 data-classification (classify PII → budget needed), 284 data-minimization (minimize → tiết kiệm budget), 332 policy-enforcement (deny when budget/consent fail). Agent có "privacy accountant" — track ε across session.

## Kiến trúc

```
  AGENT wants to PROCESS USER DATA
        │
        ▼
  ┌─── PRIVACY GATE ─────────────────────────┐
  │                                          │
  │  1. CONSENT CHECK (GDPR):                 │
  │     · user consent for purpose X? ✅/❌   │
  │     · consent withdrawn? → DENY           │
  │                                          │
  │  2. DATA CLASSIFICATION (283):            │
  │     · PII? sensitive? → needs budget      │
  │                                          │
  │  3. BUDGET CHECK:                         │
  │     · remaining ε: 0.8                   │
  │     · this query costs: 0.3              │
  │     · 0.8 - 0.3 = 0.5 ≥ 0? ✅             │
  │                                          │
  │  4. MINIMIZE (284):                       │
  │     · strip fields not needed → save ε    │
  │         │                                │
  │    ┌────┴────┐                           │
  │    │ ALLOW    │ DENY (budget/consent)     │
  │    └────┬────┘                           │
  └─────────┼────────────────────────────────┘
            │
       ALLOW → process (deduct ε)
            │ record: { user, purpose, ε_spent, timestamp }
            │
       DENY → agent nhận "privacy budget exhausted / consent missing"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 283 data-classification — classify PII (budget input)
// ✅ 284 data-minimization — strip unnecessary (save budget)
// ✅ 332 LT policy-enforcement — deny (privacy gate outcome)
// ✅ 198 GP audit — log budget spend (accountant record)
// ✅ 282 encrypted-memory-at-rest — encrypt sensitive (nền)

// ❌ THIẾU: privacy budget tracker (ε accounting)
// ❌ THIẾU: consent registry (user purpose consent + withdrawal)
// ❌ THIẾU: privacy gate (consent + budget + minimize before process)
// ❌ THIẾU: budget per user/session (limit enforcement)
```

## Implementation

```typescript
// packages/privacy/src/budget.ts (NEW)
interface ConsentRecord {
  userId: string;
  purpose: string;
  granted: boolean;
  grantedAt: number;
  withdrawnAt?: number;
}

interface BudgetEntry {
  userId: string;
  purpose: string;
  epsilonSpent: number;
  timestamp: number;
}

class PrivacyAccountant {
  constructor(
    private consentStore: Map<string, ConsentRecord> = new Map(),
    private budgetLog: BudgetEntry[] = [],
    private budgetLimit: number = 2.0, // total ε per user
  ) {}

  // Privacy gate — check consent + budget before processing
  async gate(userId: string, purpose: string, dataClassification: string, epsilonCost: number): Promise<void> {
    // 1. Consent check (GDPR)
    const consent = this.checkConsent(userId, purpose);
    if (!consent) throw new PrivacyError(`no consent for purpose "${purpose}"`);

    // 2. Budget check (differential privacy)
    const remaining = this.budgetLimit - this.spent(userId);
    if (epsilonCost > remaining) {
      throw new PrivacyError(`budget exhausted: need ${epsilonCost}, have ${remaining.toFixed(2)}`);
    }

    // 3. Record spend
    this.budgetLog.push({ userId, purpose, epsilonSpent: epsilonCost, timestamp: Date.now() });
  }

  private checkConsent(userId: string, purpose: string): boolean {
    // Match by composite key
    const key = `${userId}:${purpose}`;
    const record = this.consentStore.get(key);
    if (!record || !record.granted) return false;
    if (record.withdrawnAt && record.withdrawnAt < Date.now()) return false;
    return true;
  }

  grantConsent(userId: string, purpose: string): void {
    this.consentStore.set(`${userId}:${purpose}`, { userId, purpose, granted: true, grantedAt: Date.now() });
  }

  withdrawConsent(userId: string, purpose: string): void {
    const key = `${userId}:${purpose}`;
    const record = this.consentStore.get(key);
    if (record) record.withdrawnAt = Date.now();
  }

  private spent(userId: string): number {
    return this.budgetLog.filter(e => e.userId === userId).reduce((sum, e) => sum + e.epsilonSpent, 0);
  }

  remaining(userId: string): number {
    return Math.max(0, this.budgetLimit - this.spent(userId));
  }
}

// Usage:
// accountant.grantConsent('user-1', 'analytics');
// await accountant.gate('user-1', 'analytics', 'PII', 0.3); // ✅ or ❌
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Privacy guarantee (differential privacy proven) | ❌ Budget tracking overhead |
| ✅ GDPR consent compliance | ❌ ε tuning khó (quá chặt → deny nhiều) |
| ✅ Data minimization saves budget (284) | ❌ Consent UX friction (user phải đồng ý) |
| ✅ Audit trail (mọi spend logged) | ❌ Budget reset policy cần design (per session? per day?) |

## Khác các hướng gần

| | 283 Data Classification | 284 Data Minimization | 332 Policy Enforcement | MI: Privacy Budget |
|---|---|---|---|---|
| Cái gì | Classify PII | Strip fields | Behavior rule | **Budget + consent accounting** |
| Quantify | ❌ | ❌ | ❌ | ✅ ε tracking |
| Consent | ❌ | ❌ | ❌ | ✅ GDPR |
| Limit | ❌ | ❌ | Rule | **ε budget cap** |

## Khi nào chọn

- Agent xử lý user data nhạy cảm (PII, health, financial)
- Cần differential privacy guarantee (ε budget)
- GDPR/privacy compliance (consent + purpose limitation)
- Kết hợp 283 classification (PII → budget cost) + 284 minimization (save ε) + 332 policy (enforce deny); design budget reset policy carefully
