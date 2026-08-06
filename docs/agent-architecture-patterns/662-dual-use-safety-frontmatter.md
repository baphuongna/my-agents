# Hướng YL: Dual-Use Safety Frontmatter — skill offensive/dual-use (phishing sim, C2, exploitation) kèm cảnh báo authorized-use trong README + SECURITY.md — phân tầng safety theo mức độ rủi ro skill (README.md, SECURITY.md)

> **Nguồn gốc:** Anthropic-Cybersecurity-Skills (README.md, SECURITY.md) | **Coupling:** 🟢 — metadata + gating, không đổi runtime lõi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có permission + approval + trust — chưa có skill safety tier) | **Effort:** 2-3 tuần

## Nguồn gốc

**Anthropic-Cybersecurity-Skills** phân loại skill theo mức độ rủi ro: skill **offensive/dual-use** (phishing simulation, C2, exploitation) không chỉ là "công cụ" — chúng có thể bị dùng sai. Mỗi skill dạng này kèm **cảnh báo authorized-use** trong README + SECURITY.md: chỉ dùng trong môi trường được phép (authorized engagement, lab riêng), không dùng lên hệ thống không thuộc quyền. Safety được **phân tầng theo mức độ rủi ro skill**: skill benign (parse log) không cần gate; skill dual-use phải có cảnh báo + quy trình xác nhận authorization; skill nguy hiểm nhất phải có approval thủ công.

## Mô tả

mya áp dụng dual-use-safety-frontmatter: schema Skill thêm **`safety_tier`**: `benign` / `dual_use` / `offensive`. Skill load lúc nào cũng được nhưng **invoke** bị gate theo tier: benign → chạy tự do; dual_use → yêu cầu `authorized-use` xác nhận (frontmatter + prompt cảnh báo "chỉ dùng trong environment được phép"); offensive → cần **approval thủ công** (nối packages/tools approval.ts). Mỗi skill dual-use/offensive bắt buộc có `authorizedUse` field: môi trường hợp lệ (lab CIDR, tên project, engagement ID). Vi phạm (dùng ngoài authorized scope) → chặn + log audit. mya có sẵn permission.ts (kiểm tra trước chạy), approval.ts (approve/deny), audit/trust.ts (trust gate) — YL thêm **safety tier field** + **invoke gate**.

## Kiến trúc

```
  Skill frontmatter:
    safety_tier: dual_use | offensive | benign
    authorizedUse: { scopes: ["lab-*", "project-x"], requireApproval: true }

  Invoke gate:
    benign    → chạy tự do
    dual_use  → check scope: trong authorizedUse? → chạy + log
                         ngoài scope?            → BLOCK + audit ⛔
    offensive → approval.ts: operator approve → chạy
                           deny → block
  README + SECURITY.md: cảnh báo authorized-use per skill
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools permission.ts — kiểm tra trước khi chạy tool (nền — YL invoke gate)
// ✅ packages/tools approval.ts — approve/deny tool call (nền — YL offensive gate)
// ✅ packages/audit trust.ts — trust gate per project (nền — YL scope check)
// ✅ packages/audit — log hành vi (nền — YL audit trail)

// ❌ THIẾU: safety_tier field trong Skill schema
// ❌ THIẾU: invoke gate theo tier (scope check + approval)
// ❌ THIẾU: authorizedUse validation (scope hợp lệ mới chạy)
```

## Implementation (TS)

```typescript
// packages/skills/src/safety-gate.ts (MỚI)
export type SafetyTier = "benign" | "dual_use" | "offensive";

export interface SkillSafety {
  tier: SafetyTier;
  authorizedScopes: string[]; // "lab-*", "project-x", "engagement-42"
  requireApproval: boolean;
}

export interface InvokeContext {
  scope: string;      // môi trường hiện tại đang chạy
  operatorApproved?: boolean;
}

export class SafetyGate {
  constructor(private safety: SkillSafety) {}

  check(ctx: InvokeContext): { allowed: boolean; reason?: string } {
    if (this.safety.tier === "benign") return { allowed: true };

    // dual_use: scope phải thuộc authorizedScopes
    const inScope = this.safety.authorizedScopes.some(
      (s) => ctx.scope === s || (s.endsWith("*") && ctx.scope.startsWith(s.slice(0, -1))),
    );
    if (!inScope) {
      return { allowed: false, reason: `⛔ ${ctx.scope} ngoài authorized-use (${this.safety.authorizedScopes.join(", ")})` };
    }

    // offensive: cần approval thủ công
    if (this.safety.tier === "offensive" && !ctx.operatorApproved) {
      return { allowed: false, reason: "⛔ offensive skill cần operator approval" };
    }
    return { allowed: true };
  }

  /** Cảnh báo authorized-use — chèn vào prompt/README khi skill dual-use. */
  warning(): string {
    if (this.safety.tier === "benign") return "";
    return `⚠️ Skill ${this.safety.tier}: CHỈ dùng trong scope được phép: ${this.safety.authorizedScopes.join(", ")}. Vi phạm bị chặn + audit.`;
  }
}

// Usage:
// const gate = new SafetyGate({ tier: "dual_use", authorizedScopes: ["lab-*"], requireApproval: false });
// const r = gate.check({ scope: "production" });
// r.allowed || blockAndAudit("phishing-sim", r.reason); // ngoài lab → chặn
```

## Được

- ✅ Phân tầng rủi ro — benign tự do, dual-use scope-check, offensive approval
- ✅ Cảnh báo ngay trong skill — authorized-use không nằm ở doc ngoài
- ✅ Scope enforce bằng máy — dùng ngoài authorized → chặn cứng
- ✅ Audit trail — invoke skill nguy hiểm đều log
- ✅ Nối approval có sẵn — offensive tier tái dùng approval.ts

## Mất

- ❌ Scope heuristic — "lab-*" wildcard có thể match nhầm môi trường
- ❌ User tự khai — authorizedScopes do skill viết tự khai, cần review
- ❌ False block — scope đúng nhưng format lệch → chặn oan tốn thời gian

## Khác các hướng gần

| | Chặn hết skill nguy hiểm | Cảnh báo prompt đơn thuần | YL: Safety Tier Gate |
|---|---|---|---|
| Benign | khó chịu | không nhiễu | **tự do** |
| Dual-use | không chạy | dễ bỏ qua | **scope check cứng** |
| Offensive | không chạy | cảnh báo | **approval thủ công** |

## Khi nào chọn

- Skill library có offensive/dual-use skill (pentest, phishing sim) cần kiểm soát
- Muốn phân tầng: benign không gate, nguy hiểm approval
- Có permission + approval + trust sẵn — YL thêm tier + scope check
- Nối packages/tools permission.ts (invoke gate) + approval.ts (offensive) + audit/trust.ts (scope) + audit (log); guard scope-wildcard (wildcard match kiểm tra boundary — không "lab" match "lab-production"), self-declared-scope (authorizedScopes review trong curator), và approval-expiry (approval có TTL, không approve một lần dùng mãi); YL = safety tier, kết hợp 658 YH multi-framework-mapping (frontmatter thống nhất) + 69-agentic-firewall (lớp bảo vệ invoke) + 70-llm-gateway
