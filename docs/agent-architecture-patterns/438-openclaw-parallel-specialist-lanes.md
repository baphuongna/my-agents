# Hướng PV: Openclaw Parallel Specialist Lanes — làn chuyên gia song song coder/savant, mỗi lane giữ context ghim

> **Nguồn gốc:** openclaw (lanes.ts — specialist lanes; subagent-spawn — parallel lanes; agent-scope — per-lane context); "parallel specialist lanes"; "pinned context per lane"; "coder/savant separation"; "parallel agent specialization"
> **Coupling:** 🟡 — thêm parallel-lane manager vào multi-agent orchestrator
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (openclaw lanes + subagent-spawn sẵn — chưa có lane manager trong mya)
> **Effort:** 2-3 tuần

## Nguồn gốc

**openclaw** (`lanes.ts`, `subagent-spawn.ts`, `agent-scope.ts`) có khái niệm **parallel specialist lanes** — nhiều làn chuyên gia chạy song song, mỗi làn giữ **context ghim** riêng. Lane = specialist agent với role cụ thể (coder = implement code, savant = research/analyze, reviewer = review quality). Mỗi lane có: (1) **Pinned context**: context riêng (system prompt, tools, memory) — không chia sẻ với lane khác (isolation). (2) **Specialization**: lane coder có edit/write/bash tools, lane savant có read/grep/find tools (least-privilege per lane). (3) **Parallel execution**: lanes chạy song song (không đợi nhau) — mỗi lane độc lập. (4) **Coordination**: lane output merge (coder produces code, savant produces analysis, reviewer validates). `subagent-spawn.ts` — spawn lane as subagent (own session, own context). `agent-scope.ts` — per-lane workspace/scope isolation. Nguyên tắc: **mỗi lane là chuyên gia** — context ghim, tools chuyên biệt, chạy song song. Khác **87 agent-topology** (topology chung) — PV là **specialist lanes** (role-based parallel).

## Mô tả

mya parallel specialist lanes: task phức tạp → **phân làn chuyên gia song song** — (1) **Lane definition**: mỗi lane có role (coder/savant/reviewer), system prompt chuyên biệt, tool set chuyên biệt (least-privilege). (2) **Pinned context**: mỗi lane giữ context riêng — không chia sẻ (isolation, không noise chéo). (3) **Parallel spawn**: lanes chạy song song (coder viết code, savant research, reviewer check — cùng lúc). (4) **Coordination**: lane output merge — coder's code + savant's analysis + reviewer's feedback → tổng hợp. (5) **Scope isolation**: mỗi lane có workspace/scope riêng (agent-scope). Agent tận dụng **chuyên môn hóa** — mỗi lane giỏi 1 việc, context ghim không bị loãng. mya có 87 agent-topology + subagent — PV thêm **specialist lane manager** (role-based lanes + pinned context + parallel coordination).

## Kiến trúc

```
  COMPLEX TASK: "Implement auth module + research best practices + review code"
        │
        ├──► LANE: CODER (specialist) ─────────────────────┐
        │   • role: implement code                          │
        │   • pinned context: codebase structure,           │
        │     coding conventions, file map                  │
        │   • tools: edit, write, bash, read (least-priv)   │
        │   • scope: workspace/src/                          │
        │   • OUTPUT: auth.ts, auth.test.ts (code)          │
        │                                      code          │
        ├──► LANE: SAVANT (specialist) ────────────────────┤
        │   • role: research / analyze                       │
        │   • pinned context: docs, patterns, best practices│
        │   • tools: read, grep, find, web-search (read-only)│
        │   • scope: docs/, external                         │
        │   • OUTPUT: "Use JWT + refresh tokens, avoid..."  │
        │                                   analysis         │
        ├──► LANE: REVIEWER (specialist) ──────────────────┤
        │   • role: review quality / security               │
        │   • pinned context: security checklist, lint rules│
        │   • tools: read, grep (read-only, no edit)        │
        │   • scope: workspace/src/ (read)                   │
        │   • OUTPUT: "2 issues: hardcoded secret, no rate  │
        │     limit"                                         │
        │                                  feedback          │
        ▼                                                     ▼
  ┌─── COORDINATION (merge lane outputs) ───────────────┐
  │                                                       │
  │  coder's code (auth.ts)                               │
  │  + savant's analysis (best practices)                  │
  │  + reviewer's feedback (2 issues)                      │
  │  → merge: coder fixes 2 issues based on feedback       │
  │  → final: auth.ts (reviewed, best-practice-aligned)    │
  │                                                       │
  │  EACH LANE: pinned context (isolated, no noise)        │
  │  PARALLEL: all lanes run simultaneously                │
  │  SPECIALIZED: each lane expert at 1 thing              │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 87 agent-topology — multi-agent topology (nền — PV = specialist lane variant)
// ✅ subagent pool (packages/agent) — parallel subagents (nền — PV = lane manager)
// ✅ 86 agent-topology — topology patterns (nền — PV = parallel specialist)
// ✅ openclaw lanes + subagent-spawn + agent-scope (source/ — reference impl)

// ❌ THIẾU: lane manager (role-based lane definition + spawn)
// ❌ THIẾU: pinned context per lane (isolated context, no sharing)
// ❌ THIẾU: specialist tool set (least-privilege per lane role)
// ❌ THIẾU: lane coordination (merge outputs, cross-lane feedback)
// ❌ THIẾU: scope isolation (per-lane workspace)
```

## Implementation

```typescript
// packages/agent/src/specialist-lanes.ts (MỚI)
type LaneRole = 'coder' | 'savant' | 'reviewer' | 'tester' | 'architect';

interface SpecialistLane {
  id: string;
  role: LaneRole;
  systemPrompt: string;        // specialized prompt per role
  tools: string[];             // least-privilege tool set
  pinnedContext: string;       // isolated context (not shared)
  scope: string;               // workspace scope
}

interface LaneResult {
  laneId: string;
  role: LaneRole;
  output: string;              // lane's deliverable
  artifacts?: string[];        // files produced
}

// Lane templates (role → config)
const LANE_TEMPLATES: Record<LaneRole, Omit<SpecialistLane, 'id'>> = {
  coder: {
    role: 'coder',
    systemPrompt: 'You are a code implementation specialist. Write clean, tested code.',
    tools: ['edit', 'write', 'bash', 'read', 'grep'],
    pinnedContext: '',  // injected at spawn (codebase map)
    scope: 'workspace/src/',
  },
  savant: {
    role: 'savant',
    systemPrompt: 'You are a research specialist. Analyze patterns, find best practices.',
    tools: ['read', 'grep', 'find', 'web-search'],
    pinnedContext: '',  // injected at spawn (docs, patterns)
    scope: 'docs/',
  },
  reviewer: {
    role: 'reviewer',
    systemPrompt: 'You are a code review specialist. Find bugs, security issues, style violations.',
    tools: ['read', 'grep'],  // read-only — no edit
    pinnedContext: '',  // injected at spawn (checklist, lint rules)
    scope: 'workspace/src/',
  },
  tester: {
    role: 'tester',
    systemPrompt: 'You are a testing specialist. Write and run tests.',
    tools: ['edit', 'write', 'bash', 'read'],
    pinnedContext: '',
    scope: 'workspace/test/',
  },
  architect: {
    role: 'architect',
    systemPrompt: 'You are a software architect. Design systems, define interfaces.',
    tools: ['read', 'grep', 'find', 'write'],
    pinnedContext: '',
    scope: 'workspace/',
  },
};

class LaneManager {
  // Spawn parallel specialist lanes
  async runLanes(
    task: string,
    roles: LaneRole[],
    contextProvider: (role: LaneRole) => string,
  ): Promise<LaneResult[]> {
    const lanes = roles.map((role) => ({
      ...LANE_TEMPLATES[role],
      id: `lane-${role}-${Date.now()}`,
      pinnedContext: contextProvider(role),
    }));

    // Parallel spawn — all lanes run simultaneously
    const results = await Promise.all(
      lanes.map((lane) => this.runLane(lane, task)),
    );
    return results;
  }

  // Run a single lane (as subagent with pinned context)
  private async runLane(lane: SpecialistLane, task: string): Promise<LaneResult> {
    const subagent = await spawnSubagent({
      systemPrompt: lane.systemPrompt,
      tools: lane.tools,
      context: lane.pinnedContext,  // pinned (isolated)
      scope: lane.scope,
      task: this.tailorTask(task, lane.role),
    });
    const output = await subagent.complete();
    return {
      laneId: lane.id,
      role: lane.role,
      output: output.text,
      artifacts: output.files,
    };
  }

  // Tailor task description per lane role
  private tailorTask(task: string, role: LaneRole): string {
    switch (role) {
      case 'coder': return `Implement: ${task}`;
      case 'savant': return `Research best practices for: ${task}`;
      case 'reviewer': return `Review code quality for: ${task}`;
      case 'tester': return `Write tests for: ${task}`;
      case 'architect': return `Design architecture for: ${task}`;
    }
  }

  // Coordinate: merge lane outputs
  mergeResults(results: LaneResult[]): string {
    return results.map((r) =>
      `## ${r.role.toUpperCase()}\n${r.output}`,
    ).join('\n\n---\n\n');
  }
}

// Usage:
// const results = await laneManager.runLanes(
//   "implement JWT auth module",
//   ['coder', 'savant', 'reviewer'],
//   (role) => role === 'coder' ? codebaseMap : role === 'savant' ? docsContext : securityChecklist,
// );
// → 3 lanes run in parallel, each with pinned context
// → merge: code + analysis + review feedback
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Specialization (mỗi lane expert 1 việc — quality cao) | ❌ N× cost (mỗi lane = 1 agent = LLM cost) |
| ✅ Pinned context (isolation — không noise chéo giữa lanes) | ❌ Coordination overhead (merge outputs — có thể conflict) |
| ✅ Parallel (lanes chạy song song — fast) | ❌ Context duplication (mỗi lane build context riêng — redundant) |
| ✅ Least-privilege (reviewer read-only, coder edit — safety) | ❌ Lane imbalance (1 lane chậm → cả group đợi merge) |

## Khác các hướng gần

| | 87 Agent-Topology | 86 Agent-Topology | PV: Parallel-Specialist-Lanes |
|---|---|---|---|
| Cái gì | Topology chung | Topology patterns | **Role-based specialist lanes** |
| Context | Shared hoặc tùy | Varies | **Pinned per lane (isolated)** |
| Parallel | Tùy topology | Tùy | ✅ (luôn song song) |
| Specialization | ❌ | ❌ | ✅ (coder/savant/reviewer) |

## Khi nào chọn

- Task phức tạp cần nhiều chuyên môn (implement + research + review)
- Muốn specialization (mỗi lane expert 1 việc — quality cao hơn 1 agent làm tất cả)
- Muốn pinned context isolation (lane không nhiễu nhau)
- Muốn parallel (lanes chạy song song — fast)
- Nối 87 agent-topology (PV = specialist lane variant) + subagent pool (PV = lane = subagent) + 124 dynamic-permissions (PV = least-privilege tools per lane); guard coordination conflict (merge outputs — cần conflict resolution hoặc sequencer)
