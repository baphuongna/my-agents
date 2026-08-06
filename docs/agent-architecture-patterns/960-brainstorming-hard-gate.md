# Hướng AJX: Brainstorming Hard Gate — `/brainstorming` cấm mọi implementation skill/code/scaffold cho tới khi design được present và user approve, mọi project đều qua gate

> **Nguồn gốc:** superpowers (skills/brainstorming/SKILL.md) | **Coupling:** 🟡 — gate chặn implementation trong workflow | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có permission gate + approval; thiếu hard gate workflow) | **Effort:** 1 tuần

## Nguồn gốc

**superpowers** (skills/brainstorming/SKILL.md) có **`/brainstorming`** với **HARD-GATE**: (1) **cấm mọi implementation skill/code/scaffold** cho tới khi **design được present và user approve** — agent không được lén viết code trong lúc brainstorm; (2) **mọi project kể cả "quá đơn giản" đều qua gate** — không có ngoại lệ kiểu "cái này nhỏ mà"; (3) **design có thể ngắn vài câu** — gate không đòi document dài, chỉ đòi design *được present* (user thấy) và *được approve* (user đồng ý) trước khi code.

Giá trị: (1) **chống premature implementation** — agent hay nhảy vào code khi user chỉ muốn nghĩ; (2) **user giữ quyền định hướng** — mọi code đều sau khi design được chốt; (3) **công bằng với mọi task** — không có "task nhỏ thì khỏi cần"; (4) **gate rẻ** — present + approve có thể là vài câu, không phải ceremony.

## Mô tả

Với mya, pattern = **design-approval gate** trong workflow: (1) **brainstorm phase** — agent hỏi/thu thập yêu cầu, KHÔNG được gọi tool write/edit/bash (scaffold); (2) **present design** — tóm tắt design (vài câu → vài đoạn) cho user; (3) **approve gate** — chờ user approve (nối `ApprovalChannel` — `packages/tools/src/approval.ts`; deny → quay lại brainstorm, không code); (4) **chỉ sau approve** — mới cho phép implementation tools (permission mode gate — mya có `packages/core` Mode + `requiredMode` per tool); (5) nơi gắn — workflow: brainstorm là skill (`packages/skills`), gate là mode switch trong `packages/tools/src/permission.ts` (tool write/edit chưa approve → Deny). Đây là pattern **approval-before-action**: quyền tạo thay đổi được cấp theo phase, không phải theo tool.

## Kiến trúc (ASCII)

```
  USER: "/brainstorming <ý tưởng>"
    │
    ▼ BRAINSTORM PHASE (chỉ hỏi + thu thập — CẤM write/edit/bash)
  ├─ làm rõ yêu cầu (hỏi, không code)
  ├─ sketch design (vài câu — không cần dài)
    │
    ▼ PRESENT DESIGN cho user
    ▼ APPROVE GATE (ApprovalChannel — approval.ts)
  ├─ APPROVE ──► mở implementation mode (write/edit/bash được phép)
  └─ DENY ────► quay lại brainstorm (chỉnh design) — vẫn cấm code
    │
    ▼ IMPLEMENT (chỉ sau gate — mọi project đều qua, kể cả "quá đơn giản")
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/approval.ts — ApprovalChannel (nền — approve gate)
// ✅ packages/tools/src/permission.ts — requiresApproval + Mode (nền — mode gate)
// ✅ packages/core/src/types.ts — Mode + HookOverride ("Deny"|"Ask"|"Allow")
// ✅ packages/skills/src/skill.ts — Skill body (brainstorm skill content)
// ✅ packages/tools/src/registry.ts — ToolImpl.meta.requiredMode (per-tool mode)

// ❌ THIẾU: hard-gate workflow (brainstorm phase → present → approve → implement)
// ❌ THIẾU: mode lock — implementation tools bị Deny trong brainstorm phase
// ❌ THIẾU: no-exception rule (mọi task đều qua gate)
```

## Implementation

```typescript
// packages/workflows/src/hard-gate.ts (NEW)
export type BrainstormPhase = "collect" | "present" | "approved" | "implementing" | "denied";

export interface HardGateState {
  phase: BrainstormPhase;
  design: string;              // design đã present (có thể vài câu)
  approvals: number;
}

/** Tool gate — trong brainstorm phase, implementation tools bị chặn. */
const IMPLEMENTATION_TOOLS = new Set(["write", "edit", "bash", "mkdir", "scaffold"]);

export function gateToolCall(
  state: HardGateState,
  toolName: string,
): { allowed: boolean; reason: string } {
  if (state.phase === "collect" || state.phase === "present" || state.phase === "denied") {
    if (IMPLEMENTATION_TOOLS.has(toolName)) {
      return { allowed: false, reason: `HARD-GATE: tool "${toolName}" cấm trong phase ${state.phase} — present design + user approve trước` };
    }
  }
  return { allowed: true, reason: "" };
}

/** Present design → chờ approve. Deny quay lại collect, không bao giờ code. */
export function presentDesign(state: HardGateState, design: string): HardGateState {
  return { ...state, design, phase: "present" };
}

export function approveDesign(state: HardGateState): HardGateState {
  return { ...state, approvals: state.approvals + 1, phase: "approved" };
}

export function denyDesign(state: HardGateState): HardGateState {
  return { ...state, phase: "denied" };    // quay lại brainstorm — vẫn cấm implementation
}

/** No-exception rule — mọi task (kể cả "quá đơn giản") đều phải qua gate. */
export function isGateSatisfied(state: HardGateState): boolean {
  return state.phase === "approved";       // approve là điều kiện duy nhất
}
// Nối approval: approveDesign nối ApprovalChannel (humanPrompt Allow → approved)
// Nối permission: gateToolCall gắn vào requiresApproval path — phase chưa approved → Deny
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống premature implementation — code chỉ sau approve | ❌ Gate chặn cả việc sửa nhanh trong lúc brainstorm |
| ✅ User giữ quyền định hướng — design được chốt trước | ❌ Phiền cho task thật sự nhỏ — nhưng là rule cố ý |
| ✅ No-exception — không có "task nhỏ khỏi cần" | ❌ Approve phụ thuộc user online — latency |
| ✅ Gate rẻ — design vài câu là đủ | ❌ Agent có thể "present" design hời hợt — cần quality check |

## Khác các hướng gần

| | AJX Brainstorm Hard Gate | 646 Assumption Surfacing | 132 Human-in-the-Loop |
|---|---|---|---|
| Trọng tâm | Cấm code trước approve | Nêu giả định trước khi code | Người duyệt quyết định |
| Cơ chế | Mode lock theo phase | 4-phase gated | Approval channel |
| Quan hệ | Cứng hơn HITL (cấm luôn tool) | Giả định của design | Kênh approve của AJX |

## Khi nào chọn

- User hay bị agent "làm luôn" khi chỉ muốn bàn — cần gate cứng
- Muốn mọi thay đổi đều có design được present + approve (dù vài câu)
- Đã có ApprovalChannel + Mode — thêm phase lock là rẻ
- Guard: cấm implementation tools khi chưa approve, deny quay lại brainstorm, không ngoại lệ