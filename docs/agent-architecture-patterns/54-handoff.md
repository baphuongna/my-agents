# Hướng CCC: Explicit Handoff — chuyển quyền điều khiển tường minh

> **Nguồn gốc:** OpenAI Swarm (2024); LangChain — 1 trong 4 foundation patterns (subagents, skills, handoffs, routers)
> **Coupling:** 🟢 — chỉ qua giá trị trả về, không cần biết agent kia
> **Agent-agnostic:** ✅ — bất kỳ agent trả về handoff
> **Code sẵn:** ⚠️ (1 phần — intercom làm transport; thiếu handoff protocol có cấu trúc)
> **Effort:** 3-5 ngày

## Nguồn gốc

LangChain tổng kết 4 pattern nền tảng của multi-agent apps: **subagents, skills, handoffs, routers**. Handoff (OpenAI Swarm): agent thay vì *trả lời* thì trả về **`handoff(next_agent, context)`** — chuyển quyền điều khiển cuộc hội thoại cho agent khác kèm context đã chốt. Khác message/broadcast (intercom): handoff là **quyền điều khiển duy nhất tại một thời điểm** — đúng 1 agent chủ động, đúng 1 agent kế tiếp; audit được chuỗi ai-tiếp-ai.

## Mô tả

Agent đang chạy gặp việc không thuộc phạm vi (pi gặp phần frontend, reviewer gặp security) → trả về handoff có cấu trúc: `{ to: "claude", context: { files, rationale, state } }`. mya xác thực (agent kia có tồn tại + permission theo OO) → chuyển session/context → agent kia tiếp tục. Mỗi handoff ghi vào event ledger (K) → chuỗi điều phối tái tạo được. Khác UU (escalation — leo bậc khi *fail*): handoff là *điều hướng bình thường* khi agent tự biết giới hạn.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│               HANDOFF CHAIN (mya)                           │
│                                                            │
│  triage ──► pi (bug-fix)                                    │
│              │  gặp phần frontend → không thuộc phạm vi     │
│              ▼                                              │
│            handoff(claude, {files, rationale})              │
│              ▼                                              │
│  ┌──────────────────────────┐                               │
│  │ mya HANDOFF GATE         │                               │
│  │ 1. validate to-exists    │                               │
│  │ 2. permission check (OO) │                               │
│  │ 3. context chuyển        │                               │
│  │ 4. log vào event ledger  │                               │
│  └──────────────────────────┘                               │
│              ▼                                              │
│  claude (frontend-fix) ──► xong ──► trả artifact cho user   │
│              │                                               │
│              └─ có thể handoff tiếp (pi nhận lại phần core)  │
│                                                            │
│  chain: triage → pi → claude → pi   (audit đủ từng bước)    │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom/src/intercom.ts — messaging (reply/broadcast) giữa agents
// ✅ packages/print/src/role-subagent-spawn.ts — spawn theo role (điều hướng thủ công)
// ✅ packages/tools/src/kanban-sqlite.ts — task chuyển owner (stage/owner)
// ✅ packages/print/src/mya-bridge.ts — registerTool (có thể expose handoff tool)

// ❌ THIẾU: kiểu trả về handoff có cấu trúc + gate xác thực.
//    Intercom hiện là messaging tự do; chưa có "đúng 1 agent chủ động".
//    ❌ THIẾU: chuỗi handoff trong event ledger (ai → ai → ai).
```

## Implementation

```typescript
// packages/intercom/src/handoff.ts (NEW)
interface Handoff {
  kind: "handoff";
  to: string;                                  // agent id (AgentCard, BBB)
  context: {                                  // state đã chốt, không phải transcript
    files: string[];
    findings: Array<{ file: string; issue: string }>;
    blockedOn: string;                         // vì sao chuyển
    taskId: string;
  };
}

type AgentResult = Handoff | { kind: "done"; artifact: string };

// Gate: trước khi thực hiện handoff
async function handleHandoff(result: AgentResult): Promise<void> {
  if (result.kind === "done") { await finishTask(result.artifact); return; }
  const target = await cardRegistry.find(result.to);       // BBB: tồn tại?
  if (!target) return escalateUnknown(result);             // UU: escalate
  if (!permitted(target, result.context)) return reject(result);  // OO: permission
  await ledger.append({ type: "handoff", from: currentAgent, to: target.id, context });  // K
  await acquireSession(target.id);                          // Q: pool
  await runWithContext(target.id, result.context);          // agent kế tiếp
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đúng 1 agent chủ động mỗi lúc (không tranh quyền) | ❌ Context chuyển phải tự chốt (không thô transcript) |
| ✅ Chuỗi ai→ai→ai audit được (event ledger) | ❌ Handoff vòng (A→B→A→B) nếu phân loại kém |
| ✅ Agent tự nhận giới hạn → đúng người đúng việc | ❌ Gate xác thực thêm 1 lớp kiểm tra |
| ✅ 1 trong 4 foundation patterns của LangChain | ❌ Agent không chủ động handoff → vẫn kẹt |
| ✅ intercom + kanban + ledger sẵn | |

## Khác Intercom hiện tại

| | Intercom (hiện có) | CCC: Handoff |
|---|---|---|
| Quyền điều khiển | Nhiều agent cùng gửi/nhận | Đúng 1 agent chủ động |
| Nội dung | Message tự do | `{ to, context }` có cấu trúc |
| Vòng đời | Reply/broadcast | Chuyển hẳn quyền + context |
| Audit | Có message log | Chuỗi handoff tái tạo được |
| Permission | Không chặn | Gate theo OO + BBB |

## Khi nào chọn

- Agents có phạm vi chồng lấn (cần chuyển việc đúng người)
- Muốn chuỗi điều phối audit được (ai → ai vì sao)
- Muốn chốt đủ 4 foundation patterns (subagents, skills, handoffs, routers)
- Đã có intercom + kanban + ledger — thêm protocol là đủ
