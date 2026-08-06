# Hướng YY: Label-Gated Auto-PR — pipeline zero-human: issue form → maintainer gắn label approved → auto-PR → validate → auto-merge (CodeQL gate) — vai trò người chỉ còn 1 click label
> **Nguồn gốc:** awesome-persona-distill-skills (FINDINGS.md) | **Coupling:** 🟡 — thêm label-gate vào workflow runner + gateway approval | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflows runner + audit approval sẵn — chưa có label-gate trigger) | **Effort:** 2-3 tuần

## Nguồn gốc

**awesome-persona-distill-skills** build pipeline xử lý issue hoàn toàn tự động: user mở issue theo form → bot (agent) tạo PR → **maintainer chỉ cần gắn label `approved`** → workflow phát hiện label → tự chạy **validate** (build, test, CodeQL security gate) → pass hết → **auto-merge**. Vai trò con người giảm còn **một cú click label** — không cần review từng dòng, không cần approve thủ công từng bước. Gate nằm ở **label state** (GitHub-native, audit được, ai cũng thấy), không phải token ngầm. Nguyên tắc: **zero-human pipeline, human = 1 decision point duy nhất**.

## Mô tả

mya label-gated auto-PR: (1) **Issue form** → agent nhận task qua webhook/channel (mya có channel-adapters webhook). (2) **Auto-PR**: agent tạo nhánh + PR + gắn metadata. (3) **Label gate**: workflow poll/nghe label event — chỉ khi label `approved` xuất hiện mới chạy validate. (4) **Validate**: build + test + security gate (mya có eval tiers + osv-check + threat-scan). (5) **Auto-merge**: pass hết → merge + cleanup. Human chỉ còn gắn label — mọi thứ khác do agent + CI. mya có workflows/runner.ts (chạy process tự động) + gateway approval-relay + audit — YY thêm **label-gate trigger** + **validate pipeline** + **auto-merge step**.

## Kiến trúc

```
  USER ──issue form──▶ mya (webhook/channels)
                         │
                         ▼
              ┌── AUTO-PR (agent) ──┐
              │  branch + PR + meta  │
              └──────────┬───────────┘
                         ▼
              ⏸ CHỜ LABEL (human = 1 click)
              ┌──────────────────────┐
              │  label: approved?     │
              │  └─ no  → chờ (idle)  │
              │  └─ yes → proceed     │
              └──────────┬───────────┘
                         ▼
              ┌── VALIDATE ──────────────────┐
              │  build │ test │ CodeQL gate   │
              │  osv-check │ eval tiers       │
              │  fail → comment + reopen      │
              └──────────┬───────────────────┘
                         ▼
              ┌── AUTO-MERGE ──┐
              │  merge + cleanup│
              └────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — chạy workflow JS (nền — YY chạy validate/merge ở đây)
// ✅ packages/gateway channel-adapters.ts — webhook adapter (nền — YY nhận issue event)
// ✅ packages/gateway approval-relay.ts — ApprovalRelay (nền — YY label event analog)
// ✅ packages/eval tiers.ts — integration/credentialed tiers (nền — YY validate gate)
// ✅ packages/tools osv-check.ts — security scan (nền — YY CodeQL-gate analog)

// ❌ THIẾU: label-gate trigger (chỉ chạy khi label approved xuất hiện)
// ❌ THIẾU: auto-PR workflow (branch + PR + metadata)
// ❌ THIẾU: auto-merge step + fail → reopen loop
```

## Implementation

```typescript
// packages/workflows/src/label-gated-pr.ts (MỚI)

interface LabelEvent { repo: string; issue: number; label: string; action: "labeled" | "unlabeled" }

class LabelGate {
  constructor(
    private validate: (pr: { repo: string; number: number }) => Promise<{ ok: boolean; report: string }>,
    private merge: (pr: { repo: string; number: number }) => Promise<void>,
    private comment: (pr: { repo: string; number: number }, body: string) => Promise<void>,
  ) {}

  // Gate: label approved → validate → merge; fail → comment + giữ mở
  async onLabelEvent(ev: LabelEvent): Promise<string> {
    if (ev.label !== "approved") return "ignored";              // gate chặn mọi label khác
    if (ev.action !== "labeled") return "unlabeled-ignored";
    const pr = { repo: ev.repo, number: ev.issue };
    const result = await this.validate(pr);
    if (!result.ok) {
      await this.comment(pr, `❌ Validate fail:\n${result.report}`);  // không merge
      return `validate-failed: ${result.report}`;
    }
    await this.comment(pr, "✅ Validate pass (build/test/security) — auto-merging");
    await this.merge(pr);                                     // auto-merge sau gate
    return `merged: ${pr.repo}#${pr.number}`;
  }
}
// Usage:
// const gate = new LabelGate(validatePipeline, mergePr, commentPr);
// // mya nhận webhook label → gate.onLabelEvent(ev)
// // human chỉ cần gắn label "approved" — phần còn lại zero-human
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Human effort = 1 click label | ❌ Label gate dễ bị abuse (ai có quyền label?) |
| ✅ Deterministic pipeline (label → validate → merge) | ❌ Validate fail vẫn cần human xử lý |
| ✅ Audit được (label event là log public) | ❌ Auto-merge rủi ro nếu validate thiếu sót |
| ✅ Không cần review từng dòng | ❌ Form/issue phải đủ cấu trúc để agent tự làm |

## Khác các hướng gần

| | Manual review | Full auto (không gate) | YY: Label-Gated |
|---|---|---|---|
| Human role | Review mọi thứ | Không có | **1 click label** |
| Gate | Con người | Không | **Label state** |
| Rủi ro | Thấp | Cao | **Vừa (validate bù)** |

## Khi nào chọn

- Pipeline lặp lại nhiều (issue → PR → merge) muốn tự động hóa triệt để
- Muốn human giữ quyền quyết định tối thiểu (1 click) nhưng không bỏ hẳn
- Cần audit trail rõ (label event + merge log)
- Nối packages/workflows runner.ts + gateway channel-adapters.ts + approval-relay.ts + eval tiers + tools osv-check.ts; guard label-permission (chỉ maintainer gắn label approved), validate-completeness (build+test+security đủ trước merge), và audit-trail (mọi bước ghi audit); YY = label-gated auto-PR, kết hợp 682 ZF evidence-driven-completion (validate = evidence gate) + 684 ZH quality-convergence (đo chất lượng validate)
