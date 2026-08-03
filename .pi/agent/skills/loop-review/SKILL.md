---
name: loop-review
description: "Adversarial review loop for specs, plans, and code. Multi-round, multi-perspective, fix-then-reverify until 2 consecutive clean rounds. Distilled from 22 rounds of real use (spec v1→v11 + impl plans 14 files)."
origin: mya
triggers:
  - review loop
  - adversarial review
  - cold review
  - spec review
  - plan review
  - 2 consecutive clean
  - iterate until clean
  - review rounds
---

# loop-review

Core principle: **review is adversarial, not validating.** Reviewers exist to break things, not to confirm correctness. Each round fixes findings, then a fresh round verifies the fixes didn't introduce regressions. Continue until **2 consecutive rounds with ZERO CRITICAL/HIGH findings**.

Distilled from 22 real review rounds:
- **Spec review** (option-d-spec): 11 rounds, ~25 reviewers, ~100 findings fixed
- **Impl plans review** (option-d-impl, 14 files): 11 rounds, ~13 reviewers, ~100 findings fixed

## When to Use

- Writing a spec/plan that must be bulletproof before implementation
- Reviewing a multi-file change where correctness is critical
- User demands "review until clean" or "2 consecutive zeros"
- Any document/code where implementation cost of bugs is high

## When NOT to Use

- Quick sanity check on 1-2 files (use `multi-perspective-review` instead)
- User says "just look at this quickly"
- Time-boxed review (use single-pass `review` skill)

## Protocol

### Phase 1: Setup

```
1. Identify target: file(s) or document(s) to review
2. Identify reference material: source code, prior specs, actual APIs
3. Choose perspectives (see below)
4. Set quality gate: 2 consecutive clean rounds (CRITICAL/HIGH = 0)
```

### Phase 2: Review Loop

```
Round N:
  1. Launch reviewer(s) — 1 per perspective (parallel if 2+)
  2. Collect ALL findings from ALL reviewers
  3. Deduplicate across reviewers
  4. Assign fix IDs: R{round}-{seq} (e.g., R3-1, R3-2)
  5. Fix ALL findings (CRITICAL first, then HIGH, then MEDIUM)
  6. Commit with message: "round N fixes — X findings"
  7. If clean (0 CRITICAL/HIGH): increment clean streak
  8. If not clean: reset clean streak to 0
  9. If clean streak == 2: DONE — target is FINAL
  10. Otherwise: go to Round N+1
```

### Phase 3: Perspectives

Choose 1-3 perspectives per round. **Round 1 should always use 3.**

| Perspective | Focus | When |
|---|---|---|
| **Cross-reference consistency** | Do contracts match between sections/files? Imports correct? Types defined where referenced? | Always (Round 1) |
| **Spec/source alignment** | Does the document match the actual codebase/spec? API signatures, field names, return types? | Always (Round 1) |
| **Implementability** | Can an engineer follow this step-by-step? Missing imports? Wrong paths? ESM issues? Private access? | Always (Round 1) |
| **Fix verification** | Were previous round's fixes correctly applied? Any regressions introduced? | Round 2+ (when fixes exist) |
| **Cold check** | Fresh perspective, no trust in prior analysis. Read from scratch. | Round 3+, alternating |
| **Focused** | Only check specific items from previous round. Faster, targeted. | Round 5+ (when close to clean) |

### Phase 4: Reviewer Prompt Template

```
Round {N} Review — {perspective name}

Read: {target files}
Reference: {actual source code paths}

Previous rounds fixed {total} findings. Round {N-1} fixed:
{list of key fixes}

Check specifically:
{numbered checklist of items to verify}

Focus on CRITICAL/HIGH only{if late round}:
1. {specific check}
2. {specific check}

If ZERO CRITICAL/HIGH: "ZERO CRITICAL/HIGH FINDINGS — CLEAN ROUND."
Otherwise list every issue with severity.
```

### Phase 5: Finding Format

```text
[SEVERITY] Phase X / File:line
Issue: What's wrong
Impact: What breaks if unfixed
Fix: How to fix it
```

Severity:
- 🔴 **CRITICAL**: compile error, runtime crash, data loss, security breach
- 🟠 **HIGH**: logic bug, silent wrong behavior, test failure
- 🟡 **MEDIUM**: missing edge case, doc inconsistency, fragile pattern
- 🟢 **LOW**: style, naming, dead code, unused import

**Only CRITICAL + HIGH count toward the clean-streak gate.**

## Anti-Regression Rules (CRITICAL — learned the hard way)

> **The #1 source of bugs in later rounds is FIXES FROM EARLIER ROUNDS.**
> In the impl plans review, Rounds 5-9 all had regressions introduced by Round 4-8 fixes.

### Rule 1: Never blanket-fix with sed

```
❌ sed -i 's/Date.now()/nowWallclock()/g' *.md
```
This adds imports to files that don't need them, duplicates imports in files with multiple code blocks, and misses multi-line import patterns.

```
✅ For each file individually:
   1. Check if the function is actually CALLED in this code block
   2. Check if it's already IMPORTED
   3. Add import only where needed, with unique context for the edit
```

### Rule 2: Fix ALL occurrences, not just the first

When a finding affects multiple locations (e.g., wrong import path), grep for ALL occurrences before fixing.

### Rule 3: After fixing imports, verify every code block

A single document may contain multiple code blocks (implementation + tests). Each block needs its own import verification.

### Rule 4: Don't trust "already fixed" without verification

Reviewer says "Phase 5 AgentSession import fixed"? Verify it in BOTH pool.ts AND adapter.ts code blocks within the same file.

### Rule 5: Test assertions must match implementation

If you change what a function does (e.g., remove a parameter), update ALL test assertions that check that parameter. This was the #2 source of regressions.

## Empirical Data

### What reviewers find (by frequency)

| Finding type | % of total | Example |
|---|---|---|
| Wrong import source | 15% | `AgentSession` from `@my-agent/core` (actually in `@my-agent/agent`) |
| Missing import | 12% | `nowWallclock` used but not imported |
| Type mismatch | 10% | Object missing required field, wrong return type |
| Gateway/framework mismatch | 10% | Using Express API when gateway uses raw `http.createServer` |
| Test assertion mismatch | 8% | Test expects field that implementation doesn't produce |
| Dead code from fixes | 8% | Extracted values then discarded (`void x; void y;`) |
| Fix introduced regression | 7% | `await` in sync function, duplicate import, deleted wrong line |
| Path/route mismatch | 5% | `/sessions/:id` vs `/pool/sessions/:id` |
| Private member access | 5% | Test calls `pool.sweepIdle()` which is `private` |
| ESM violation | 4% | `require()` in ESM module |
| Stale reference | 4% | Counts, names, or sections referenced after rewrite |

### Round-by-round finding decay

```
Round 1:  27 findings (broad sweep — finds everything)
Round 2:   8 findings (fix verification — catches partial fixes)
Round 3:  10 findings (cold check — finds new category)
Round 4:   6 findings (getting close)
Round 5:  15 findings (REGRESSION SPIKE from Round 4 fixes!)
Round 6:   7 findings (regression from Round 5 fixes)
Round 7:   5 findings (all same category — import issues)
Round 8:   4 findings (1 CRITICAL — regression from Round 7)
Round 9:  15 findings (cold check finds deep logic bugs)
Round 10:  0 CRITICAL/HIGH ← FIRST CLEAN
Round 11:  0 CRITICAL/HIGH ← SECOND CLEAN → FINAL
```

**Key insight**: Finding count is NOT monotonic. Regressions cause spikes. Don't despair at Round 5-6 spikes — they're fix-introduced, not original.

### Typical round count by document complexity

| Complexity | Rounds | Example |
|---|---|---|
| Single file, <500 lines | 3-4 | Component spec |
| Multi-file plan, 2-3 files | 5-7 | Feature design |
| Large spec, 500+ lines | 8-11 | Architecture spec |
| Multi-file plans, 10+ files | 10-12 | Full implementation plans |

## Reviewer Launch Patterns

### Pattern A: Sequential (recommended for 1-2 perspectives)

```
for each round:
  launch 1 reviewer (Agent, subagent_type=reviewer, model=opus)
  wait for result
  fix findings
  commit
```

### Pattern B: Parallel (recommended for Round 1)

```
Round 1 only:
  launch 3 reviewers in parallel (different perspectives)
  wait for all
  merge findings
  fix all
  commit

Round 2+:
  launch 1 reviewer (fix verification)
  wait
  fix
  commit
```

### Pattern C: Cold + Focused alternating

```
Round 3: cold check (fresh perspective, broad)
Round 4: focused (verify Round 3 fixes only)
Round 5: cold check (different focus area)
Round 6: focused (verify Round 5 fixes only)
...
```

## Commit Discipline

After EVERY round:

```bash
git add {target files}
git commit -m "docs: {target} round {N} fixes — {count} findings

CRITICAL ({count}):
- R{N}-1: {description}

HIGH ({count}):
- R{N}-2: {description}

MEDIUM ({count}):
- R{N}-3: {description}"
git push
```

This creates an audit trail. If a regression appears in Round N+2, you can `git diff` to find which fix introduced it.

## Completion Criteria

```
✅ Target is FINAL when:
  1. 2 consecutive rounds with ZERO CRITICAL/HIGH findings
  2. All findings from all rounds are fixed or documented as implementation notes
  3. Commits pushed with audit trail

❌ Do NOT declare final if:
  - Only 1 clean round (could be lucky)
  - Clean round used same reviewer as previous (confirmation bias)
  - LOW findings remain that affect user-facing behavior
```

## Integration with pi-crew

```bash
# Launch reviewer via Agent tool
Agent(
  description="Round N: {perspective}",
  model="opus",  # always use strongest model for review
  prompt="{reviewer prompt from Phase 4}",
  subagent_type="reviewer",
  run_in_background=true  # for parallel pattern
)

# Check status
get_subagent_result(agent_id="{id}", wait=true)

# For team-based review
team action='run', team='review', goal="Review {target} round {N}"
```

## Common Mistakes to Avoid

1. **Don't skip Round 1 breadth** — 3 perspectives in Round 1 catches 50%+ of all findings
2. **Don't use same reviewer for consecutive clean rounds** — confirmation bias
3. **Don't fix only CRITICAL and skip HIGH** — HIGH bugs become CRITICAL in production
4. **Don't trust the fix without verification** — always verify in next round
5. **Don't use `claude`/`sonnet` for review** — use `opus` (strongest model)
6. **Don't stop at Round 5-6 spike** — regressions are normal, keep going
7. **Don't forget to commit after each round** — audit trail is essential for debugging regressions
