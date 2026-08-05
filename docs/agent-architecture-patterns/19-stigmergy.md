# Hướng T: Stigmergic Coordination — kiến sửa môi trường, agent phản ứng

> **Nguồn gốc:** Sinh học — Entomology (Grassé, 1959)
> **Coupling:** 🟢 Zero — chỉ fs.watch filesystem
> **Agent-agnostic:** ✅ — bất kỳ agent sửa file
> **Effort:** 3-5 ngày (thấp nhất)

## Nguồn gốc

Stigmergy được nhà sinh học Pierre-Paul Grassé đặt tên năm 1959. Ông nghiên cứu cách mối xây tổ: KHÔNG CÓ kiến trúc sư trung tâm, KHÔNG CÓ giao tiếp trực tiếp. Mỗi con mối sửa môi trường (đặt viên bùn), môi trường đã sửa trigger con kế tiếp. Signal = environment modification itself.

**Tham chiếu học thuật:**
- Grassé, P.-P. (1959). "La reconstruction du nid..." *Insectes Sociaux*, 6(1), 41–80.
- Theraulaz, G. & Bonabeau, E. (1999). "A brief history of stigmergy." *Artificial Life*, 5(2), 97–116.
- Bonabeau, E. et al. (1999). *Swarm Intelligence*. Oxford University Press.

## Mô tả

Agents giao tiếp CHỈ bằng cách sửa môi trường chung (filesystem). Mỗi sửa đổi vừa là OUTPUT (kết quả agent) vừa là SIGNAL (trigger agent khác). Không message bus, không event stream, không orchestrator. Coordination emerge từ environment state.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   Agent A sửa file → Agent B thấy file đổi → phản ứng       │
│   Agent A tạo TODO.md → Agent B đọc → nhận việc             │
│   Agent A chạy test → Agent C thấy fail → fix               │
│                                                              │
│   ┌─────────┐         ┌──────────────┐         ┌─────────┐  │
│   │ Agent A │──sửa──► │  FILESYSTEM  │ ◄──đọc──│ Agent B │  │
│   │         │         │              │         │         │  │
│   │ writes: │         │  .tasks/     │         │ reads:  │  │
│   │ .tasks/ │         │  .results/   │         │ .tasks/ │  │
│   │ auth.md │         │  .reviews/   │         │ finds   │  │
│   │ (done)  │         │  .traces/    │         │ open    │  │
│   └─────────┘         │  test.log    │         │ task    │  │
│                       │  git diffs   │         └─────────┘  │
│   ┌─────────┐         │              │                      │
│   │ Agent C │◄─watch──│  = MEDIUM    │──watch─►┌─────────┐  │
│   │         │  poll   │  = MEMORY    │  poll   │ Agent D │  │
│   │ sees:   │         │  = SIGNAL    │         │         │  │
│   │ test    │         │              │         │ sees:   │  │
│   │ FAIL    │         └──────────────┘         │ review  │  │
│   └─────────┘                                  │ needed  │  │
│                                                └─────────┘  │
│                                                              │
│   KHÔNG CÓ message. KHÔNG CÓ orchestrator.                  │
│   Filesystem modification = signal phối hợp.                │
│   Giống kiến: pheromone trail = file trace.                 │
└──────────────────────────────────────────────────────────────┘
```

## Concrete implementation

```
.tasks/
  auth.md          ← task definition (stigmergic signal)
    ---
    task: implement authentication
    status: done        ← Agent A wrote "done" → triggers reviewer
    assigned: pi-agent
    ---

.results/
  auth.md          ← Agent A's output (triggers test agent)
    ---
    result: auth.ts created with JWT validation
    files: [auth.ts, auth.test.ts]
    ---

.reviews/
  auth.md          ← Agent B's review (triggers fix if issues)
    ---
    review: 2 issues found
    1. No rate limiting
    2. Hardcoded JWT secret
    status: needs-fix
    ---

.traces/
  pi-agent-001.jsonl  ← Agent A's event log (stigmergic memory)
    {"type":"turn_start","ts":"..."}
    {"type":"tool_call","tool":"read","file":"auth.ts"}
    {"type":"tool_result","ok":true}
    {"type":"turn_end"}

test.log           ← test output (triggers fix agent if FAIL)
  FAIL src/auth.test.ts
    ✗ should reject expired tokens
```

## Pheromone mechanics

| Khái niệm kiến | Ánh xạ agent |
|---|---|
| Pheromone trail | `.tasks/` files with status fields |
| Trail deposition | Agent writes task file with `status: done` |
| Trail following | Agent polls/watches `.tasks/` for open tasks |
| Trail evaporation | TTL: old tasks expire (stale = unavailable) |
| Trail reinforcement | Multiple agents touch same area → priority boost |
| Queen pheromone | `priority` field in task file |

## Code cần thêm

```typescript
// packages/gateway/src/stigmergy.ts (NEW)
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

class StigmergicCoordinator {
  private watchers: FSWatcher[] = [];

  // Watch task directory for status changes
  watchTasks(taskDir: string) {
    const w = watch(taskDir, async (event, filename) => {
      if (!filename?.endsWith(".md")) return;
      const content = await readFile(`${taskDir}/${filename}`, "utf8");
      const task = parseFrontmatter(content);

      if (task.status === "done") {
        // Task done → trigger review agent
        await this.spawnAgent("reviewer", `Review: ${task.task}`);
      }
      if (task.status === "needs-fix") {
        // Review found issues → trigger fix agent
        await this.spawnAgent("coder", `Fix: ${task.review}`);
      }
    });
    this.watchers.push(w);
  }

  // Watch test results
  watchTests(testLogFile: string) {
    const w = watch(testLogFile, async () => {
      const content = await readFile(testLogFile, "utf8");
      if (content.includes("FAIL")) {
        // Tests failing → trigger fix agent
        await this.spawnAgent("coder", `Fix failing tests:\n${content}`);
      }
    });
    this.watchers.push(w);
  }

  // Watch git diffs (what changed)
  watchGit(repoDir: string) {
    setInterval(async () => {
      const diff = await exec("git diff --name-only HEAD~1", repoDir);
      // Files changed → audit log
      auditLog.append({ kind: "git_change", files: diff.split("\n") });
    }, 5000);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero coupling (agents chỉ sửa files) | ❌ Polling latency (mitigated by fs.watch) |
| ✅ Natural fault tolerance (crashed agent → task expires) | ❌ No global ordering (concurrent writes conflict) |
| ✅ Debuggable (filesystem = visible state) | ❌ Opaque to humans (pheromone language) |
| ✅ Scales naturally (more agents = faster) | ❌ Potential deadlocks (waiting for trace) |
| ✅ Trivially parallel | ❌ Environment pollution (cleanup needed) |
| ✅ No infrastructure (filesystem = everything) | |

## Khác mọi pattern trước

| Pattern | Communication | Stigmergy |
|---|---|---|
| Orchestrator | Central controller assigns | No controller — tasks "found" in environment |
| Event-stream | Explicit messages pushed | No pushing — agents poll/watch |
| Broker | Intermediary routes messages | No intermediary — environment IS broker |
| Protocol | Defines message format | No protocol — coordination implicit |

**Fundamental shift:** communication = state mutation, không phải message passing.

## Khi nào chọn

- Muốn lowest effort (3-5 ngày)
- Want truly emergent coordination
- Coding agents (files are natural medium)
- OK with filesystem as coordination layer
- Want debuggable state (ls .tasks/ shows everything)
