# SPEC-FIXES — Round 28 (coherence + concurrency residuals)

> Verifier confirmed R27 23/23 clean (1 minor). Coherence review found 10 cross-section contradictions; concurrency review found 13 race/logic bugs (2 CRITICAL). Apply ALL to `AGENT-SPEC.md`. Sole file owner.

## Coherence (C1–C10)
- C1. §20 dependency chain: "§8 compression" → **"§5 compression"** (§8 is Memory).
- C2. §13 `RuntimeEvent.tool.result`: `ToolResult | DegradedResult` → **`ToolResult`** (it's a PER-CALL event; the batch `DegradedResult` lives only on `TurnEvent.ToolExec`). Remove the now-wrong "R25-12 widened to match §4" comment.
- C3. Memory role naming: §8 prose uses bare names matching the type — **`archivist`, `tree`, `diff`, `goals`, `sync`** (drop the `memory_` prefix in prose; the type `MemoryRoleId` already uses bare names).
- C4. `"working"` role: add a one-line description in §8 — "*`working` — ephemeral per-turn working set (the context the loop assembles for the current turn; not persisted).*"
- C5. §17 `runtime?: { isolation: ... }` → rename to **`runtime?: { moduleIsolation: "in-process"|"worker"|"isolated-vm"; trusted?: boolean }`** to disambiguate from §10's CoW filesystem `isolation`. Update all references.
- C6. §9: add a code block **`type SkillProvenance = "Bundled" | "HubInstalled" | "UserCreated" | "AgentCreated"`** (every other enum has a type block).
- C7. §23 #6: annotate "*partially resolved (R27-12): sigstore for third-party NATIVE packages = release-blocker; non-native package signing still open.*"
- C8. §24 glossary LaneBoard: add **`Unknown`** to the freshness list.
- C9. §3 4-gate audit: align to actual crates — **`natives`(crypto/ast/fs)=trust-boundary/a+c, `shell`=trust/a, `search`=hot-loop/b, `ast`=hot-loop/b, `compress`=hot-loop/b, `sandbox`=trust/a** (drop `pi-iso` which is an oh-my-pi concept not in this workspace; crypto is part of `natives`).
- C10. §4 `MAX_RETRIES = 3` → rename **`MAX_ATTEMPTS = 3`** and document "= total attempts including the first try (so 2 retries)." Update the §4 loop + any prose ref.

## Concurrency (CC1–CC13)
- **CC1 (CRITICAL): §4 `finish:"length"` retry never executes** — the `break` after `compressHistory` exits the for-retries loop. Fix: `let lengthHit = false;` set it on `finish:"length"`; after the for-each, `if (lengthHit) continue;` to re-enter the for-retries loop; `break` only on a successful (non-length) stream.
- **CC2 (CRITICAL): orphaned budget on child crash** — define "completion" as ANY terminal state (`Completed|Failed|Cancelled`); the `SubagentRunner` completion handler ALWAYS computes `refund = alloc - child.spent` and credits root; add `BudgetConfig.releasePrecharge(childId)`. Crashed children (§14b) refund too.
- CC3 (HIGH): §5 CCR store — per-content-hash mutex; concurrent compressions targeting the same hash block on the lock.
- CC4 (HIGH): §8 `MemoryBackend` — internal locking (read/write safe concurrent); `syncAll` holds a `drainLock` that blocks `prefetchAll` until drain completes/times out. State this in the interface.
- CC5 (HIGH): §4/§13 — set `blockedOn:"approval"` on the heartbeat **atomically BEFORE** the `AwaitingApproval` emit (or the heartbeat reads `TurnState` directly). Prevents false-Stalled→kill of an approval-pending lane.
- CC6 (HIGH): §4/§7 double permission eval — `requiresApproval(c, ctx)` returns a cached `PermissionDecision` that `runTool`/`authorize` REUSES (evaluated once); OR it evaluates only lightweight steps 1–2 (denied_tools/deny, no hooks) and the full pipeline runs once in `authorize`. Pick: cache the full decision.
- CC7 (MEDIUM): §7 — hooks in the pipeline are awaited before the next step evaluates (async hook results applied before ask-rule match).
- CC8 (MEDIUM): §4/§6 — `streamWithFallback` encapsulates emission: streaming callbacks COLLECT into the return value, never emit directly to the RuntimeEvent bus; only the turn loop's `emit()` feeds observers. (Prevents ghost events from a failed/abandoned profile.) State as an encapsulation invariant.
- CC9 (MEDIUM): §5 — move the `skillSetDirty` check INSIDE the while-loop (before prompt memoization), not once at runTurn top — fixes the TOCTOU where a skill write lands between the check and the first assembly.
- CC10 (MEDIUM): §10/§21 — `deriveChild` locks the PARENT node only (not root); lock hierarchy follows the tree root→child→grandchild; holding a parent lock never blocks a child's spawn. Prevents hierarchical-spawn deadlock.
- CC11 (MEDIUM): §4 — ask-tools need not wait for non-ask `Promise.all`: launch ask-tools (they block on human input) concurrently with non-ask tools. State the interleaved launch (or document the current sequential order as a deliberate simplification with the latency tradeoff).
- CC12 (LOW): §4 — wrap `compressHistory(...)` in try-catch → `Recoverable{phase:"resource"}` on `ResourceExhausted`.
- CC13 (LOW): §4/§21 — `spend()` uses atomic compare-and-swap that rejects a spend breaching `abortThreshold` (or each turn reserves its own slice via `deriveChild`). Bounds concurrent-turn overspend.

## Verifier minor
- VM1. Add `compressHistory(history): void` to the §4 glossary helper-signatures block (called in pseudocode, undeclared).

## NOT defects (keep)
- R27 23/23 clean. §14b, invariants #14/#15 intact.
