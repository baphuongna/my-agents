# Hướng K: Git-as-IPC — agents giao tiếp qua commits/PRs

> **Coupling:** 🟢 Git — zero infrastructure
> **Agent-agnostic:** ✅ — bất kỳ agent dùng git
> **Effort:** 3-5 ngày

## Mô tả

Agents giao tiếp qua shared git repository. Mỗi agent làm việc trên branch riêng. "Messages" là commits — code changes, review comments, structured data. PRs = result review. Merge = completion. Git history = communication log. Merge conflicts = coordination failure.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   ┌──────────┐         ┌──────────┐         ┌─────────┐  │
│   │ Agent A  │         │ Agent B  │         │ Agent C │  │
│   │ (coder)  │         │(reviewer)│         │(tester) │  │
│   └────┬─────┘         └────┬─────┘         └────┬────┘  │
│        │                    │                    │       │
│   branch:                  branch:              branch:  │
│   feat/auth                review/auth          test/auth│
│        │                    │                    │       │
│        │ commit + push      │                    │       │
│        ├───────────────────►│                    │       │
│        │                    │ PR review          │       │
│        │                    ├───────────────────►│       │
│        │                    │                    │ tests │
│        │                    │◄───────────────────┤       │
│        │ fix                │                    │       │
│        │◄───────────────────┤                    │       │
│        │                    │                    │       │
│        └──────► merge to main ◄──────────────────┘       │
│                                                          │
│   Git history = communication log                        │
│   PRs = result review                                    │
│   Merge conflicts = coordination failure                 │
│   Zero infrastructure (git IS the IPC)                   │
└──────────────────────────────────────────────────────────┘
```

## Workflow chi tiết

```
1. User: "implement authentication module"
   → mya creates branch: feat/auth
   → mya creates task file: .tasks/auth.md
     ---
     task: implement authentication
     status: open
     assigned: pi-agent
     ---

2. Agent A (pi):
   git checkout feat/auth
   pi --print "implement authentication per .tasks/auth.md"
   git add -A && git commit -m "feat: implement JWT auth"
   git push origin feat/auth

3. Agent B (reviewer):
   git checkout review/auth
   git merge feat/auth  (or GitHub PR)
   pi --print "review the auth implementation, check for bugs"
   # Agent B writes review to: .reviews/auth.md
   git add .reviews/auth.md
   git commit -m "review: 2 issues found in auth"
   git push

4. Agent A fixes:
   git checkout feat/auth
   pi --print "fix issues from .reviews/auth.md"
   git commit -m "fix: address review feedback"
   git push

5. Agent C (tester):
   git checkout test/auth
   git merge feat/auth
   pi --print "write tests for auth module"
   git commit -m "test: add auth integration tests"
   git push

6. mya merges to main:
   git checkout main
   git merge feat/auth test/auth
   git push
   → task complete
```

## Task files as coordination

```markdown
# .tasks/auth.md
---
task: implement authentication
status: in-progress
assigned: pi-agent-1
created: 2024-01-15T10:00Z
dependencies: [database-setup]
---

Implement JWT-based authentication for the API.

## Requirements
- Login endpoint
- Token refresh
- Role-based access control

## Status
- [x] JWT library integrated
- [x] Login endpoint
- [ ] Token refresh
- [ ] RBAC
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero infrastructure (git IS IPC) | ❌ Slow (commit/push/pull = high latency) |
| ✅ Human-readable history (commits, PRs) | ❌ Merge conflicts painful |
| ✅ Natural conflict detection | ❌ No real-time communication |
| ✅ Works offline (local commits) | ❌ Repository structure = API (rigid) |
| ✅ Leverages existing dev workflows | ❌ Doesn't scale beyond few agents |
| ✅ Branch isolation | ❌ Branch proliferation |
| ✅ Code review natural | |

## Code cần thêm

```typescript
// packages/gateway/src/git-coordinator.ts (NEW)
import { simpleGit } from "simple-git";

class GitCoordinator {
  // Monitor branches for agent work
  async pollBranches(repoDir: string) {
    const git = simpleGit(repoDir);
    const branches = await git.branchLocal();
    for (const branch of branches.all) {
      if (branch.startsWith("feat/") || branch.startsWith("fix/")) {
        await this.checkBranchStatus(branch);
      }
    }
  }

  // Create task branch for agent
  async createTaskBranch(task: Task): Promise<string> {
    const branch = `feat/${task.id}`;
    const git = simpleGit(task.repoDir);
    await git.checkoutLocalBranch(branch);
    await this.writeTaskFile(task);
    await git.add(".tasks/");
    await git.commit(`task: ${task.description}`);
    return branch;
  }

  // Check if branch is ready for review/merge
  async checkBranchStatus(branch: string) {
    const git = simpleGit(this.repoDir);
    const log = await git.log({ from: "main", to: branch });
    // Check for review files, test results, etc.
  }
}
```

## Khi nào chọn

- Coding agents (git is natural)
- Async coordination (không cần real-time)
- Want human-readable audit trail
- Small number of agents (2-5)
- Want to leverage existing PR/code review workflow
