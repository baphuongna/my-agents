# Skills & Subagents

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §9 · §10.



## 9. Skills (provenance + curator + progressive disclosure)

- **`SkillProvenance`** enum gating edits: `Bundled | HubInstalled | UserCreated | AgentCreated` — **SPEC-proposed enhancement** over hermes's 3-value runtime `provenance()` function returning `'hub' | 'bundled' | 'agent'` (a separate ContextVar tags background-review writes). *(source: [hermes](../../hermes-agent/) + [mya-v1](../../mya-v1/) `skills/provenance.rs`.)*

```ts
// C6/R28: every other enum has a type block — SkillProvenance defined here, referenced by §9/§17.
type SkillProvenance = "Bundled" | "HubInstalled" | "UserCreated" | "AgentCreated";
```
- **Progressive disclosure:** index emits only `name + description` frontmatter; full SKILL.md loaded on invoke. Adopt the `agentskills.io` frontmatter standard for cross-tool compat. *(source: [hermes](../../hermes-agent/) + [pi-coding-agent](../../pi-coding-agent/).)*
- **`SkillCurator` task** — inactivity-triggered, runs as a separate handle on an **auxiliary provider chain** (preserve main prompt cache). Strict invariants: touches agent-created **and bundled built-in** skills (when `prune_builtins` is on, the default; hub-installed/external are off-limits), **archive-not-delete**, pinned skills bypass all auto-transitions. *(source: [hermes](../../hermes-agent/) [`agent/curator.py`](../../hermes-agent/agent/curator.py).)*
- **Supersession note (R26-C):** *SPEC [§9 Skills](06-skills-subagents.md) supersedes deepdive #02's `curator_can_archive()` (which allowed only `AgentCreated`) and deepdive #09's 3-variant `SkillProvenance` — the SPEC's 4-value enum + built-in curation (R24-F17/F18) is authoritative.*

---
## 10. Subagents & Multi-agent Topologies

- **Copy-on-write overlay-isolated subagents returning schema-validated objects** *(source: [oh-my-pi](../../oh-my-pi/) [`task`](../../oh-my-pi/packages/coding-agent/src/task/))* — each worker gets an isolated overlay (overlayfs/APFS-reflink/btrfs/ZFS via `pi-natives` `IsoBackendKind`; `git worktree` is one backend option) + own tool surface; the final yield is a **JSON-Schema/JTD-validated object** (JTD normalized to JSON Schema, AJV-class validator; Zod appears only in tests/examples) the parent reads directly. No prose parsing, no orphaned edits. **(R27-7/O2: file edits are NOT auto-merged silently — see the CoW merge-back policy below.)**
- **CoW merge-back policy (R27-7/O2):** the child yields `{ ok: true; data: unknown; changedPaths?: string[] }`. The parent 3-way-merges using the CoW base snapshot as common ancestor; on conflict → `SubagentResult` becomes `{ ok: false; error: ConflictError }` (child may retry, or the parent resolves). hashline ([§7 Tools](03-tools-permission.md)) guards line-level silent overwrite. *Conflicts surface as typed errors — there is no silent cross-buffer merge.*
- **Subagent isolation:** a hard `DELEGATE_BLOCKED_TOOLS` denylist every child inherits; `HumanApproval` routed through an explicit `ApprovalChannel` handle passed at spawn — **never parent-stdin-resolved** (avoids deadlock). *(source: [hermes](../../hermes-agent/) [`delegate_tool.py`](../../hermes-agent/tools/delegate_tool.py).)* **Bridge filter (R27-8/O3): the code-exec bridge's `callTool(name,args)` is filtered by the SAME `DELEGATE_BLOCKED_TOOLS` as the child's direct toolSurface — blocked names rejected. The bridge kernel runs **in-process** (R30 sandbox-removal; [§14b](08-observability-security.md)); it is bounded by the same `DELEGATE_BLOCKED_TOOLS` filter at the `callTool` boundary and by the [§7 permission gate](03-tools-permission.md) at the underlying `subprocess`/`Bun.spawn` call. Restricted children may also drop `codeExecBridge` from their surface entirely.**
- **Hierarchical approval propagation (R27-9/O4):** in `hierarchical` topology a child MUST forward the same `ApprovalChannel` it received. Requests carry `{ chainDepth; originalRequester: LaneId }`. `MAX_APPROVAL_CHAIN_DEPTH` (default 3); exceeding fail-closes to Deny. A child MAY wrap the channel in a delegating proxy that auto-approves a declared subset, never auto-denies.**
- **6 declarable topologies** *(source: [harness](../../harness/) catalog, research-validated)*: Pipeline / Fan-out-Fan-in / Expert Pool / Producer-Reviewer / Supervisor / Hierarchical Delegation — as a `TeamTopology` enum; cron/SOP/skills declare which shape. *(source: [openhuman](../../openhuman/) [`model_council`](../../openhuman/src/openhuman/model_council/) = Expert Pool variant.)*
- **Optional advisor lane** per turn + hindsight review (automated advisor/critic = **oh-my-pi advisor lane**); plus an **interactive human-in-the-loop plan-approval gate** — `plan_review` (openhuman) parks the live turn on `PlanReviewGate` until the user decides Approve/Reject/Revise (10-min TTL, fail-closed Reject); NOT an automated critic.

**Concrete subagent protocol (round 13):**
```ts
type TeamTopology = "pipeline" | "fanout-fanin" | "expert-pool"
                   | "producer-reviewer" | "supervisor" | "hierarchical";
interface SubagentSpawn {
  topology: TeamTopology;
  fsIsolation: "isolated" | "shared"; // R29-13/m3: CoW overlay (overlayfs/reflink/btrfs/ZFS; git worktree = one option); default "isolated" (FILESYSTEM isolation for subagent worktrees — distinct from any package runtime tier, §17 packages now run in-process trusted code, R30)
  toolSurface: ToolSet;               // own surface; DELEGATE_BLOCKED_TOOLS always removed
  approval: ApprovalChannel;          // explicit handle — parent stdin unreachable by type
  resultSchema: JSONSchema;           // worker MUST yield a schema-valid object (JTD→JSON-Schema, AJV)
  budget: BudgetConfig;               // own budget; child cannot exceed parent's remainder
}
type SubagentResult =
  | { ok: true;  data: unknown; changedPaths?: string[] }  // validated by resultSchema (R27-7)
  | { ok: false; error: LifecycleError };                   // a merge conflict ⇒ LifecycleError{phase:"subagent", cause: ConflictError} (R27-7)
// R27-7: CoW-overlay-isolation ⇒ no orphaned edits; file edits are NOT auto-merged silently — the
//   parent 3-way-merges against the CoW base; conflicts surface as {ok:false; error: ConflictError}
//   (a typed LifecycleError whose `cause` carries the ConflictError detail). schema-validated yield
//   ⇒ parent reads structured data, never prose. *(oh-my-pi `task`.)*
// R27-6: budget = parent.budget.deriveChild(child.total) under a lock at spawn (child cannot
//   self-declare); unused delta refunded on completion. child.unlimited = parent.unlimited && requested.
//   MAX_DEPTH + MAX_TREE_NODES bound the budget tree (not just MAX_CONCURRENT_SUBAGENTS).
//   CC2/CC10/CC13: see [§4 glossary BudgetConfig](01-core-loop.md) for the full invariant text.
// R27-10: on schema-validation failure — bounded repair: re-prompt the child with the AJV error path
//   + schema, SUBAGENT_SCHEMA_REPAIR_RETRIES (default 1); if still failing → error. LifecycleError.phase
//   gains "subagent"|"validation"; the error variant carries `partial` (raw invalid yield for salvage).
```

**§10.1 Worktree/CoW isolation lifecycle.** `SubagentSpawn.fsIsolation` picks a backend via `pi-natives` `IsoBackendKind`; the runner exposes the lifecycle below. *Source: [oh-my-pi](../../oh-my-pi/) [`task`](../../oh-my-pi/packages/coding-agent/src/task/) · [claw-code](../../claw-code/).*

```ts
type IsoBackend = "overlayfs" | "reflink_apfs" | "btrfs" | "zfs" | "git_worktree"; // pi-natives IsoBackendKind
// lifecycle: create(base_commit) → worktree_path → child runs → changedPaths() diff vs base
//   → mergeBack() 3-way-merge (CoW base = common ancestor) → conflict ⇒ SubagentResult{ok:false; error:ConflictError}
//   → cleanup() (ALWAYS, even on crash).
// branch = `mya/subagent/{taskId}/{rand}`; stale-base detector warns if base_commit > N behind HEAD.
// trust: untrusted project → worktree-only (no overlayfs); trusted → overlayfs allowed.
```

**Completeness (R31)** — CORE subagent feature folded in from [FEATURE-INVENTORY](../../.learned/FEATURE-INVENTORY.md) Part 1:

| Feature | 1-line | Source |
|---|---|---|
| **GreenContract (merge gate)** | 4-level green gate (`TargetedTests`/`Package`/`Workspace`/`MergeReady`) + evidence — the subagent merge contract a child must satisfy before merge-back | [claw-code](../../claw-code/rust/crates/runtime/src/green_contract.rs) |

**§10.2 GreenContract (merge gate).** Every child subagent MUST reach its declared `GreenLevel` and produce matching evidence before yield; parent verifies. *Source: [MyAgents](../../MyAgents/) · [oh-my-pi](../../oh-my-pi/) readiness-state pattern.*

```ts
type GreenLevel = "TargetedTests" | "Package" | "Workspace" | "MergeReady"; // scope of "green" before yield
type GreenContract = { required: GreenLevel; evidence: { ran: TestScope; passed: boolean; coverageDelta?: number } };
// child MUST run + pass tests at `required` scope before yielding; parent verifies evidence.
// fail-closed: missing/invalid evidence ⇒ SubagentResult{ok:false; error:"green-violation"}.
```

---
