# Hướng AGB: Tool-Approval Broker — `approveTools` gate tool nguy hiểm (glob `github_delete_*`...) với allow-once/allow-session/deny; permission extension có thể claim quyết định qua event `MCP_TOOL_APPROVAL_REQUEST`; headless fail-closed `approval_required`

> **Nguồn gốc:** pi-mcp-adapter (tool-approval.ts) | **Coupling:** 🟡 — hook vào tool dispatch + event bus | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có approval.ts token-ledger + permission, thiếu MCP glob gate + extension claim) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-mcp-adapter** `approveTools` gate **tool nguy hiểm** — match glob như `github_delete_*`, `*_destroy*` — yêu cầu phê duyệt trước khi gọi. 3 chế độ phê duyệt: **allow-once** (1 lần), **allow-session** (cả session), **deny** (từ chối mãi). **Permission extension** có thể **claim quyết định** qua event `MCP_TOOL_APPROVAL_REQUEST` (extension xử lý thay vì prompt user). **Headless fail-closed**: khi không có người duyệt → trả `approval_required` (không tự chạy tool nguy hiểm). Nguyên tắc: **gate tool nguy hiểm, tùy chọn extension claim, fail-closed khi không có người duyệt**.

## Mô tả

mya tool-approval-broker: (1) **approval đã sẵn** — `packages/tools` approval.ts (ApprovalChannel + token-ledger auto-approve subset, scope glob `to:src/**`); (2) **permission đã sẵn** — permission.ts (requiresApproval + awaitHumanPrompt); (3) **glob gate** — match tên tool với pattern nguy hiểm; (4) **3 chế độ** — allow-once/allow-session/deny (persist qua token-ledger); (5) **extension claim** — event bus MCP_TOOL_APPROVAL_REQUEST cho extension quyết định; (6) **fail-closed** — headless → approval_required. Nối audit (approval RuntimeEvent).

## Kiến trúc (ASCII)

```
  AGENT gọi tool (vd github_delete_repo)
       │
       ▼  APPROVE-TOOLS GATE (glob match github_delete_*)
  tool nguy hiểm? 
   ├─ KHÔNG ──▶ chạy bình thường
   └─ CÓ  ──▶ cần phê duyệt:
        ├─ emit MCP_TOOL_APPROVAL_REQUEST
        │     ▼ extension claim quyết định? 
        │     ├─ CÓ ──▶ extension quyết (allow/deny)
        │     └─ KHÔNG ──▶ prompt USER
        ▼
  quyết định: allow-once | allow-session | deny
   ├─ allow-once/session ──▶ token-ledger ghi → chạy
   ├─ deny ──▶ block
   └─ KHÔNG có người duyệt (headless) ──▶ FAIL-CLOSED approval_required
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools approval.ts — ApprovalChannel + token-ledger (auto-approve subset)
// ✅ packages/tools approval.ts — scope glob match (to:src/**, * any, ** any-incl-slash)
// ✅ packages/tools permission.ts — requiresApproval + awaitHumanPrompt
// ✅ packages/audit index.ts — RuntimeEvent kind "approval"

// ❌ THIẾU: glob gate tool nguy hiểm (github_delete_*...)
// ❌ THIẾU: allow-once/allow-session/deny 3 chế độ
// ❌ THIẾU: extension claim qua MCP_TOOL_APPROVAL_REQUEST event
// ❌ THIẾU: headless fail-closed approval_required
```

## Implementation

```typescript
// packages/tools/src/tool-approval-broker.ts (MỚI)
export type ApprovalDecision = "allow-once" | "allow-session" | "deny";
export interface ApprovalConfig { dangerousGlobs: string[]; }   // github_delete_*, *_destroy*
export function isDangerous(tool: string, cfg: ApprovalConfig): boolean {
  return cfg.dangerousGlobs.some((g) => matchGlob(tool, g));
}
export interface ApprovalLedger {
  has(name: string): ApprovalDecision | null;
  set(name: string, d: ApprovalDecision): void;
}
/** Gate: nguy hiểm → phê duyệt; extension claim ưu tiên; headless fail-closed. */
export async function brokerApproval(
  tool: string,
  cfg: ApprovalConfig,
  ledger: ApprovalLedger,
  opts: { hasUser: boolean; extensionClaim?: () => Promise<ApprovalDecision | null> },
): Promise<{ allowed: boolean; reason: string }> {
  if (!isDangerous(tool, cfg)) return { allowed: true, reason: "not dangerous" };
  const cached = ledger.has(tool);
  if (cached === "deny") return { allowed: false, reason: "denied (session)" };
  if (cached === "allow-session") return { allowed: true, reason: "allowed (session)" };
  // Extension claim trước, user sau, headless fail-closed.
  const decision = opts.extensionClaim ? await opts.extensionClaim() : null;
  if (decision) { if (decision !== "allow-once") ledger.set(tool, decision); return { allowed: decision !== "deny", reason: "extension" }; }
  if (!opts.hasUser) return { allowed: false, reason: "approval_required (headless)" };  // fail-closed
  return { allowed: true, reason: "user allow-once" };   // awaitHumanPrompt → ledger
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Gate tool nguy hiểm — an toàn | ❌ Glob sai → miss tool nguy hiểm hoặc gate tool vô hại |
| ✅ allow-once/session — tiện không hỏi lại | ❌ allow-session quá rộng nếu tool thực sự nguy hiểm |
| ✅ Extension claim — tự động hóa | ❌ Headless fail-closed chặn workflow không người |
| ✅ Fail-closed — không tự chạy nguy hiểm | ❌ Extension claim chậm → block tool call |

## Khác các hướng gần

| | AGB Tool-Approval Broker | approval.ts token-ledger | permission.ts |
|---|---|---|---|
| Gate | glob tool nguy hiểm | auto-approve subset | requiresApproval |
| Chế độ | once/session/deny | token consume | human round-trip |
| Headless | fail-closed | n/a | prompt |

## Khi nào chọn

- Có tool nguy hiểm (delete/destroy) cần gate
- Muốn cho phép người dùng hoặc extension phê duyệt
- Cần fail-closed khi headless (không tự chạy nguy hiểm)
- Guard: glob list đầy đủ, allow-session cẩn trọng, extension claim timeout, fail-closed mặc định
