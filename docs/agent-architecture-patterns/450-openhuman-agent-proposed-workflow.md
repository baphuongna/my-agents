# Hướng QH: Agent Proposed Workflow — agent soạn automation n8n-style, chỉ human save mới kích hoạt

> **Nguồn gốc:** OpenHuman (agent proposed workflow); "agent-as-automation-designer"; "n8n/node-style visual workflow"; "human-approved automation activation"; "drafted workflow gate"
> **Coupling:** 🟡 — cần workflow editor + draft→approval→activate lifecycle
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (workflows package + dynamic-workflows sẵn — chưa có agent-authored workflow + human-activate gate)
> **Effort:** 3-4 tuần

## Nguồn gốc

**OpenHuman** cho phép agent **soạn automation** (n8n-style: trigger → node → node → action) khi thấy user lặp tác vụ. Nhưng automation **chỉ kích hoạt** khi **human save** (review + approve). Agent = **designer**, human = **activator**. Giống **copilot** (suggest) nhưng cho workflow (không phải code). **n8n / node-based flow**: visual DAG — trigger (webhook/cron/event) → nodes (transform, call API) → action (notify, write). Agent draft DAG → human review → save → activate. Nguyên tắc: **agent đề xuất, human quyết định** — automation có side-effect → cần human gate. Khác **pi-extensible-workflows** (human-authored) — QH là **agent-authored**; khác **398 test-gated** (auto convergence) — QH là **human-gated activation**.

## Mô tả

mya agent proposed workflow: agent phát hiện user lặp tác vụ → **draft workflow** (DAG: trigger → nodes → action). Workflow ở trạng thái **draft** (chưa active). Human xem **visual editor** (n8n-style) → review → **save** (activate) hoặc **discard**. Khi active → workflow chạy tự động (trigger fires → nodes execute). Agent có thể **propose improvement** cho workflow đã active (draft edit → human approve). Nối pi-extensible-workflows + pi-dynamic-workflows + 124 dynamic-permissions.

## Kiến trúc

```
  AGENT detects repetitive task:
  "User runs test + lint + deploy every commit"
        │
        ▼
  ┌─── DRAFT WORKFLOW (agent-authored, n8n-style DAG) ──────┐
  │                                                           │
  │  [trigger: git-push]                                      │
  │       ↓                                                   │
  │  [node: npm test]                                         │
  │       ↓                                                   │
  │  [node: npm run lint]                                     │
  │       ↓                                                   │
  │  [node: npm run deploy]                                   │
  │       ↓                                                   │
  │  [action: notify slack "deployed"]                        │
  │                                                           │
  │  STATUS: draft (NOT active)                               │
  └───────────────────────┬───────────────────────────────────┘
                          │
                          ▼
  ┌─── HUMAN REVIEW (visual editor) ────────────────────────┐
  │                                                           │
  │  User sees proposed workflow in editor                    │
  │  → review nodes, adjust, approve                          │
  │                                                           │
  │  ┌─ SAVE ──────┐    ┌─ DISCARD ─────┐                    │
  │  │ activate    │    │ delete draft   │                    │
  │  │ workflow    │    │                │                    │
  │  └─────────────┘    └────────────────┘                    │
  └───────────┬───────────────────────────────────────────────┘
              │ (save)
              ▼
  ┌─── ACTIVE WORKFLOW ─────────────────────────────────────┐
  │  git-push → test → lint → deploy → notify               │
  │  → runs automatically on every push                     │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ pi-extensible-workflows — workflow engine (nền — QH = agent-authored)
// ✅ pi-dynamic-workflows — runtime workflow (nền — QH = draft→activate)
// ✅ 124 dynamic-permissions — permission gate (nền — QH = human-activate gate)
// ✅ 398 test-gated-convergence — auto gate (relate — QH = human gate)

// ❌ THIẾU: agent workflow authoring (detect repeat → draft DAG)
// ❌ THIẾU: draft→approve→activate lifecycle
// ❌ THIẾU: visual workflow editor (n8n-style DAG UI)
// ❌ THIẾU: workflow improvement proposal (agent edits active workflow → draft edit → approve)
```

## Implementation

```typescript
// packages/agent/src/proposed-workflow.ts (NEW)
interface WorkflowNode {
  id: string;
  type: 'trigger' | 'transform' | 'call' | 'action';
  config: Record<string, unknown>;
}
interface WorkflowEdge { from: string; to: string; }

interface ProposedWorkflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: 'draft' | 'active' | 'discarded';
  proposedBy: 'agent';
  proposedAt: number;
}

class WorkflowProposer {
  // Agent detects repetitive pattern → draft workflow
  async proposeFromPattern(repeatedActions: string[]): Promise<ProposedWorkflow> {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { event: 'git-push' } },
      ...repeatedActions.map((cmd, i) => ({
        id: `node-${i}`, type: 'call' as const, config: { command: cmd },
      })),
      { id: 'notify', type: 'action', config: { channel: 'slack', message: 'done' } },
    ];
    const edges: WorkflowEdge[] = nodes.slice(0, -1).map((n, i) => ({
      from: n.id, to: nodes[i + 1]!.id,
    }));
    return {
      id: crypto.randomUUID(), name: 'Auto Deploy Pipeline',
      nodes, edges, status: 'draft', proposedBy: 'agent', proposedAt: Date.now(),
    };
  }

  // Human reviews → save (activate) or discard
  activate(draft: ProposedWorkflow): ProposedWorkflow {
    return { ...draft, status: 'active' };
  }
  discard(draft: ProposedWorkflow): ProposedWorkflow {
    return { ...draft, status: 'discarded' };
  }

  // Agent proposes improvement to active workflow
  proposeEdit(active: ProposedWorkflow, changes: Partial<ProposedWorkflow>): ProposedWorkflow {
    return { ...active, ...changes, status: 'draft', id: crypto.randomUUID() }; // new draft
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự động hóa tác vụ lặp (designer role) | ❌ Workflow engine complexity (DAG, trigger, nodes) |
| ✅ Human-gated activation (side-effect → cần approve) | ❌ Visual editor UI (n8n-style cần build) |
| ✅ Audit trail (ai đề xuất, khi nào active) | ❌ False proposal (agent đề xuất workflow không cần) |
| ✅ Improvement loop (agent edit active → draft → approve) | ❌ Maintenance (workflow break khi API thay đổi) |

## Khác các hướng gần

| | pi-extensible-workflows | pi-dynamic-workflows | 398 Test-Gated | QH: Proposed-Workflow |
|---|---|---|---|---|
| Tác giả | Human | Human/runtime | Auto | **Agent (draft) + Human (activate)** |
| Gate | ❌ | ❌ | Test | **Human save** |
| Khi | Human tạo | Runtime | Convergence | **Agent phát hiện repeat** |

## Khi nào chọn

- Agent phát hiện user lặp tác vụ (đề xuất automation)
- Cần human-gated activation (side-effect → approve trước khi active)
- Muốn agent-as-designer, human-as-activator
- Nối pi-extensible-workflows + pi-dynamic-workflows + 124 dynamic-permissions
