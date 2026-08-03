# Phân tích SSSF (Super Simple Software Factory) — Áp dụng cho mya

> Nguồn: https://github.com/disler/super-simple-software-factory
> Phân tích: Aug 2026

---

## 1. SSSF là gì?

**Super Simple Software Factory** là một skill cho pi coding agent, tạo ra **"agents plus code" workflows** — deterministic Python scripts (ADW = AI Developer Workflow) sở hữu sequencing/retries/acceptance; agents là các node bounded trong graph đó.

**Triết lý cốt lõi: "Agent proposes, code disposes."**

```
Code (deterministic Python)     Agent (LLM bounded node)
─────────────────────────       ────────────────────────
Owns sequencing                 Reads + decides
Owns retries                    Proposes output
Owns acceptance gates           Bounded by typed contract
Owns git commits                Bounded by write permissions
Owns test/lint/build            Never owns the pipeline
```

### Kiến trúc 3 lớp

```
┌─────────────────────────────────────────────────────┐
│  ADW Script (Python, deterministic)                 │
│  e.g. adw_simple_sdlc.py                            │
│                                                     │
│  plan → commit → build → test → review →            │
│  retest → commit → changes → document → commit     │
│                                                     │
│  Each step is a PHASE in one of 3 lanes:            │
│  ┌──────────┬──────────┬──────────┐                │
│  │ engineer │  agent   │   code   │                │
│  │ (human)  │ (LLM)    │(subproc) │                │
│  └──────────┴──────────┴──────────┘                │
└───────────────────┬─────────────────────────────────┘
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
    ┌──────────┐ ┌────────┐ ┌──────────┐
    │ Envelope │ │ Gates  │ │ Quality  │
    │ (typed   │ │ (claim │ │ (code    │
    │  JSON    │ │  check)│ │  phase)  │
    │  output) │ │        │ │          │
    └──────────┘ └────────┘ └──────────┘
          │         │
          ▼         ▼
    ┌──────────────────────────┐
    │  sssf.db (SQLite WAL)    │
    │  ← visualizer polls      │
    └──────────────────────────┘
```

---

## 2. 6 Patterns Cốt lõi của SSSF

### 2.1 Typed Envelope Contract

Mỗi agent call khai báo một **output type** (Pydantic model). Response JSON được parse chống lại type đó. Không có untyped handoff.

```python
class EnvelopeBase(BaseModel):
    status: Literal["success", "fail"]    # load-bearing
    summary: str = ""
    artifacts: list[str] = []
    notes_for_next_agent: str = ""

class BuildOutput(EnvelopeBase):
    changed_files: list[str] = []
    commit_message: str = ""
```

**"Synced triad"**: type definition ↔ JSON example in user.md prompt ↔ `output_type=` at call site. Đổi 1 → phải đổi cả 3.

### 2.2 Gate System (Claim Verification)

Gate = `gate(envelope, run) -> GateReport`. Verify **mechanical claims** của envelope (không phải quality judgment):

- `artifacts_exist` — file khai báo có tồn tại?
- `files_non_empty` — file có content?
- `diff_matches_claims` — `changed_files` có thực sự trong diff?
- `verdict_consistent` — `approved=true` mà `blocking` có items?

Gate fail → **re-prompt cùng session** (context intact), bounded bởi `retries`.

### 2.3 Quality-as-Code

Test/lint/typecheck/build là **`kind="code"` phases**, KHÔNG phải agent phases:

> "An agent rediscovering `bun test` on every run costs a fortune to learn what a subprocess already knows."

Failures flow back to builder qua envelope adapter (`VerifyOutput`) — repair loop không đổi.

### 2.4 Write Permission Enforcement

`tools:` là capability list (không phải boundary). `writes:` mới là boundary, enforced **after-the-fact** bằng git tree comparison:

```python
def enforce(run, phase, agent, before):
    after = snapshot(run)           # git diff HEAD --numstat + ls-files
    touched = changed_paths(before, after)
    breaches = [p for p in touched if not permitted(p, agent, run.cfg)]
    # Rollback unauthorized changes, raise PermissionBreach
```

Catches `git checkout` (reversion = modification), not just writes.

### 2.5 Session Resumption

`agent_map.json` maps agent → pi session_id + model. Later ADWs rejoin existing context windows. Model change → fresh session (never bad resume).

### 2.6 Structured Observability

7 SQLite tables: `sessions`, `phases`, `events`, `envelopes`, `gate_results`, `processes`, `agent_sessions`. Every event logged against `adw_id + phase_id`. WAL mode for concurrent read/write.

---

## 3. So sánh với mya hiện tại

| SSSF Pattern | mya Hiện có | GAP |
|---|---|---|
| **Typed Envelope** | `AgentEvent` (loosely typed) | **GAP lớn** — no output schema per call |
| **Gate system** | `loop-review` skill (manual rounds) | **GAP lớn** — no automated claim verification |
| **Phase model (3 lanes)** | `WorkflowContext.spawn()` (single-level) | **GAP trung** — no phase decomposition |
| **Quality-as-code** | vitest/tsc/bundle (manual CLI) | **GAP nhỏ** — pattern exists, not formalized |
| **Write permission** | `RoleConfig.toolsAllowed/Denied` | **GAP lớn** — no `writes:` boundary enforcement |
| **Session resume** | `--session-id` create-or-continue | ✅ **Already have** |
| **Structured trace** | Brain facts + CostTracker | **GAP trung** — no phase-level trace table |
| **Subagent fanout** | `spawn-role-subagent` + `harness_engineering/subagents.ts` | ✅ **Already have** (SSSF uses same pi extension pattern!) |
| **Prompt engineering** | `mya-bridge` system prompt | **GAP nhỏ** — no `user.md` template with `{{previous_envelope}}` |
| **Config-driven agents** | `~/.mya/agent/roles/*.json` | ✅ **Already have** (similar to `sssf.config.yaml`) |

### What mya already has that SSSF doesn't

- **In-process runtime** (PiInProcessRuntime) — SSSF spawns `pi` subprocess mỗi call (more expensive)
- **Real-time WS push** — SSSF uses polling (500ms)
- **Memory system** (Brain + SQLite + DreamCycle) — SSSF has no memory
- **Multi-runtime** (pi + claude + mya-native + SmartRouter) — SSSF is pi-only
- **Web dashboard** (38 pages) — SSSF has a separate visualizer app
- **Cron scheduling** — SSSF is one-shot scripts

---

## 4. Đánh giá: Áp dụng được gì?

### 🟢 TIER 1 — Áp dụng ngay, ROI cao, không đổi architecture

#### 4.1 Gate Pattern → mya workflows

**Hiện tại**: mya's `loop-review` skill chạy review rounds thủ công. Mỗi round cần human-in-the-loop để đọc findings và fix.

**Port**: Thêm gate functions vào `packages/workflows/src/`:

```typescript
// packages/workflows/src/gates.ts (NEW)
export interface GateReport {
  checks: GateCheck[];
}
export interface GateCheck { item: string; ok: boolean; note: string; }

export type Gate = (output: unknown, ctx: WorkflowContext) => GateReport;

export const artifactsExist: Gate = (output, ctx) => {
  const env = output as EnvelopeBase;
  return {
    checks: env.artifacts.map(a => ({
      item: a,
      ok: existsSync(a),
      note: existsSync(a) ? statSync(a) : "missing"
    }))
  };
};
```

**Lợi ích**: Automated claim verification — agent nói "tôi đã tạo file X" → gate verify file tồn tại. Không cần human đọc review.

#### 4.2 Quality-as-Code Phase → mya cron/workflow

**Hiện tại**: Agent tự chạy `npx vitest run` qua bash tool. Mỗi lần = tokens để "rediscover" lệnh.

**Port**: Thêm `kind="code"` phase type vào workflow runner:

```typescript
// Instead of agent running tests:
// ctx.spawn("run the test suite")  ← costs tokens

// Code phase runs directly:
const result = await runQuality({
  test: ["npx", "vitest", "run", "--testTimeout=5000"],
  typecheck: ["npx", "tsc", "--noEmit"],
  lint: ["npx", "eslint", "packages/"],
});
// Failures → VerifyOutput envelope → back to builder agent
```

**Lợi ích**: Tiết kiệm tokens (không cần agent "discover" lệnh), deterministic, repeatable.

#### 4.3 Typed Envelope Types → mya workflow output

**Hiện tại**: `ctx.spawn(goal)` trả về `string` (raw text). Không có schema.

**Port**: Discriminated union cho workflow step outputs:

```typescript
// packages/workflows/src/envelopes.ts (NEW)
export type EnvelopeBase = {
  status: "success" | "fail";
  summary: string;
  artifacts: string[];
  notesForNextAgent: string;
};

export type BuildOutput = EnvelopeBase & {
  changedFiles: string[];
  commitMessage: string;
};

export type PlanOutput = EnvelopeBase & {
  commitMessage: string;
};

export type ReviewOutput = EnvelopeBase & {
  approved: boolean;
  findings: { requirement: string; met: boolean; evidence: string }[];
  blocking: string[];
};
```

**Lợi ích**: Type-safe handoff giữa workflow steps. Parse failures → re-prompt (không restart).

---

### 🟡 TIER 2 — Effort trung bình, module mới

#### 4.4 Write Permission Enforcement → role-subagent

**Hiện tại**: `RoleConfig` có `toolsAllowed`/`toolsDenied` nhưng `bash` runs anything, `write` reaches any path. Không có boundary thực sự.

**Port**: Thêm `writes?: string[]` vào `RoleConfig`, enforced qua git tree snapshot:

```typescript
// packages/agent/src/write-guard.ts (NEW)
export function snapshotWorkspace(cwd: string): Map<string, string> {
  // git diff HEAD --numstat + git ls-files --others --exclude-standard
}

export function enforceWrites(
  role: RoleConfig,
  before: Map<string, string>,
  after: Map<string, string>,
  cwd: string
): { breaches: string[]; rolled: string[] }
```

**Lợi ích**: Reviewer role thực sự read-only (không thể `git checkout` code đang review). Builder chỉ sửa files trong `writes:` allowlist.

**Rủi ro**: Cần cẩn thận với rollback logic — SSSF rollback `git checkout --` + delete untracked. mya cần test kỹ (đặc biệt với monorepo worktrees).

#### 4.5 Structured Run Trace → alongside Brain

**Hiện tại**: Brain tracks facts, CostTracker tracks tokens. Không có phase-level execution trace.

**Port**: Thêm SQLite trace table (reuse `memory.db` hoặc file riêng):

```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id TEXT PRIMARY KEY,
  request TEXT,
  status TEXT,  -- running | success | fail
  started_at TEXT, ended_at TEXT,
  total_tokens INTEGER, total_cost REAL
);
CREATE TABLE IF NOT EXISTS workflow_phases (
  phase_id TEXT PRIMARY KEY,
  run_id TEXT,
  seq INTEGER,
  name TEXT, kind TEXT, owner TEXT,
  status TEXT DEFAULT 'fail',
  description TEXT,
  started_at TEXT, ended_at TEXT
);
```

**Lợi ích**: Dashboard có thể hiển thị workflow execution timeline. Debug failed runs dễ hơn.

---

### 🔴 TIER 3 — Effort lớn, architecture addition

#### 4.6 Full ADW System → TS-native workflow pipeline

**Hiện tại**: mya có `packages/workflows` (vm sandbox + spawn), nhưng không có formal multi-phase pipeline definition.

**Port**: Tạo TS-native ADW equivalent — TypeScript workflows với phase composition:

```typescript
// mya-workflows/sdlc.ts
import { defineWorkflow, phase, agentGate, codePhase } from "@my-agent/workflows";

export default defineWorkflow({
  name: "simple-sdlc",
  agents: ["planner", "builder", "reviewer", "documenter"],
  phases: [
    phase.engineer("request", "Capture the ask"),
    phase.agent("plan", "planner", PlanOutput, [artifactsExist]),
    phase.code("commit_plan", gitCommit),
    phase.agent("build", "builder", BuildOutput, [diffMatchesClaims]),
    phase.code("test", runTestSuite),    // ← quality-as-code
    phase.agent("review", "reviewer", ReviewOutput, [verdictConsistent]),
    phase.code("commit_build", gitCommit),
    phase.agent("document", "documenter", DocumentOutput),
    phase.code("commit_docs", gitCommit),
  ],
  retries: { agent: 1, fix: 3, revision: 2 },
});
```

**Lợi ích**: Users define repeatable dev workflows. Cron có thể trigger ADW định kỳ.

**Rủi ro**: Large surface area. Cần design carefully — mya's workflow runner uses `vm` sandbox, SSSF uses plain Python scripts. TS version cần balance giữa type safety và flexibility.

---

## 5. Kết luận & Khuyến nghị

### ✅ NÊN áp dụng (ROI cao nhất)

| # | Pattern | Effort | Impact | Priority |
|---|---|---|---|---|
| 1 | **Gate functions** | 1-2 days | Automated claim verification, giảm human review | **P0** |
| 2 | **Quality-as-code** phase | 1 day | Tiết kiệm tokens, deterministic test/lint | **P0** |
| 3 | **Typed Envelope types** | 2-3 days | Type-safe workflow handoffs | **P1** |
| 4 | **Write permission** (`writes:`) | 3-5 days | Real security boundary cho role-subagents | **P1** |

### 🟡 CÓ THỂ áp dụng (medium ROI)

| # | Pattern | Effort | Impact |
|---|---|---|---|
| 5 | **Run trace table** | 2-3 days | Better observability/debugging |
| 6 | **Prompt template system** (`{{previous_envelope}}`) | 1-2 days | Consistent prompt structure |

### ❌ KHÔNG NÊN áp dụng

| Pattern | Lý do |
|---|---|
| Python ADW scripts | mya là TS/Node — rewrite vô nghĩa |
| Polling-based UI | mya đã có WS push (better) |
| Pi subprocess spawning | mya đã có PiInProcessRuntime (more efficient) |
| `sssf.config.yaml` | mya đã có `~/.mya/agent/config.json` + roles/*.json |

### Insight quan trọng nhất

SSSF's philosophical core — **"Agent proposes, code disposes"** — là bài học giá trị nhất cho mya:

1. **Deterministic code owns the pipeline** (sequencing, retries, acceptance)
2. **Agents are bounded nodes** (prompt in → typed envelope out → gates verified)
3. **Known commands are code, not agents** (`bun test` là subprocess, không phải LLM judgment)
4. **Permission is enforced after-the-fact** (git tree comparison, not tool lists)

mya hiện tại có runtime diversity (3 runtimes) và memory system mạnh hơn SSSF, nhưng **thiếu structured workflow contract** (typed envelopes + gates + write permissions). Port 3 patterns đầu (Gates + Quality-as-code + Typed Envelopes) sẽ fill gap lớn nhất với effort thấp nhất.

---

## 6. Đề xuất thực hiện

Nếu user muốn proceed, đề xuất theo thứ tự:

```
Phase 1 (P0 — 3-4 days total):
  ├── packages/workflows/src/envelopes.ts     (typed output types)
  ├── packages/workflows/src/gates.ts          (gate functions)
  ├── packages/workflows/src/quality.ts        (code-phase runner)
  └── packages/workflows/src/envelopes.test.ts + gates.test.ts + quality.test.ts

Phase 2 (P1 — 5-7 days total):
  ├── packages/agent/src/write-guard.ts        (write permission enforcement)
  ├── packages/core/src/roles.ts               (add `writes?: string[]` to RoleConfig)
  └── write-guard.test.ts + roles integration test

Phase 3 (Optional — future):
  └── TS-native ADW system (full pipeline definition format)
```

Mỗi phase tuân thủ NO TEST = NO MERGE + 2-round clean review gate.
