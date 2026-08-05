# Hướng CC: Chemical Reaction Network — computation là emergent

> **Nguồn gốc:** Gamma calculus (Banâtre & Métayer, 1986), Chemical Abstract Machine (Berry & Boudol, 1990)
> **Coupling:** 🟡 Reaction rules (pattern → transformation)
> **Agent-agnostic:** ⚠️ — agents là molecules
> **Effort:** 3-4 tuần

## Nguồn gốc

Banâtre và Métayer's Gamma calculus (1986). Berry và Boudol's Chemical Abstract Machine (1990). Programs modeled như chemical solutions — molecules (data) react theo reaction rules. Computation = consumption + production của molecules qua reactions.

**Tham chiếu:**
- Banâtre, J.-P. & Métayer, D. L. (1986). "A new computational model and its discipline of programming." *INRIA*.
- Berry, G. & Boudol, G. (1990). "The Chemical Abstract Machine." *POPL '90*, 81–94.

## Mô tả

KHÔNG CÓ program, KHÔNG CÓ loop, KHÔNG CÓ control flow. Có **solution** (pool of molecules = tasks, knowledge, resources, results) + **reaction rules** (pattern → transformation). Khi molecules collide (đồng thời present), reaction fires tự động. System chạy đến khi no reactions can fire = chemical equilibrium.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│              CHEMICAL REACTION NETWORK                       │
│                                                              │
│  MOLECULES (floating in solution):                           │
│    ⟨Task, "fix-auth-bug", open⟩                             │
│    ⟨Task, "write-tests", open⟩                              │
│    ⟨Knowledge, "auth-uses-JWT"⟩                             │
│    ⟨File, "auth.ts", lines=142⟩                             │
│    ⟨Capability, "typescript-expert", agent=007⟩             │
│    ⟨Result, "auth-fix", status="needs-review"⟩              │
│                                                              │
│  REACTION RULES (fire when reactants present):              │
│                                                              │
│  Reaction-1 (Task Assignment):                              │
│    ⟨Task, desc, open⟩, ⟨Capability, skill, agent=A⟩        │
│    → ⟨Task, desc, assigned, agent=A⟩                        │
│    Condition: skill matches desc                            │
│                                                              │
│  Reaction-2 (Task Execution):                               │
│    ⟨Task, desc, assigned, agent=A⟩, ⟨Capability, *, A⟩     │
│    → ⟨Result, desc, status="pending"⟩                       │
│    Side effect: agent A processes task                      │
│                                                              │
│  Reaction-4 (Review):                                       │
│    ⟨Result, desc, status="pending"⟩,                       │
│    ⟨Capability, "reviewer", agent=R⟩                        │
│    → ⟨Result, desc, status="reviewing", reviewer=R⟩         │
│                                                              │
│  Reaction-6 (Decomposition):                                │
│    ⟨Task, complex-desc, assigned⟩                           │
│    → ⟨Task, subtask-1⟩, ⟨Task, subtask-2⟩                  │
│    Condition: too large for one agent                       │
│                                                              │
│  Reaction-7 (Inhibition):                                   │
│    ⟨Lock, file, holder=A⟩ + ⟨Task, edit-file⟩              │
│    → (no reaction — inhibited by lock)                     │
│                                                              │
│  EXECUTION MODEL:                                           │
│  1. Scan solution for matching reactants                    │
│  2. Fire all applicable reactions (parallel)                │
│  3. Consume reactants, produce products                     │
│  4. Repeat until no reactions fire (equilibrium)            │
│                                                              │
│  NO CONTROL FLOW. NO LOOP. NO DISPATCHER.                   │
│  Reactions fire khi conditions met.                         │
│  System "settles" như chemical equilibrium.                 │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/chemical/src/reaction.ts
interface Molecule {
  tag: string;
  attrs: Record<string, unknown>;
}

interface ReactionRule {
  name: string;
  reactants: MoleculePattern[];   // What must be present
  condition?: (molecules: Molecule[]) => boolean;
  consume: string[];              // Which reactants to consume
  produce: Molecule[];            // What to produce
  sideEffect?: (molecules: Molecule[]) => Promise<void>;
}

const rules: ReactionRule[] = [
  {
    name: "task-assignment",
    reactants: [
      { tag: "Task", attrs: { status: "open" } },
      { tag: "Capability", attrs: {} },  // any capability
    ],
    condition: ([task, cap]) => matches(task.attrs.requirements, cap.attrs.skill),
    consume: ["Task"],
    produce: [{ tag: "Task", attrs: { status: "assigned", agent: "{{cap.agent}}" } }],
    sideEffect: ([task, cap]) => spawnAgent(cap.attrs.agent, task.attrs.desc),
  },
  {
    name: "review",
    reactants: [
      { tag: "Result", attrs: { status: "pending" } },
      { tag: "Capability", attrs: { role: "reviewer" } },
    ],
    consume: ["Result"],
    produce: [{ tag: "Result", attrs: { status: "reviewing" } }],
    sideEffect: ([result, reviewer]) => spawnAgent(reviewer.attrs.agent, `review ${result.attrs.desc}`),
  },
];

class ChemicalMachine {
  private solution: Molecule[] = [];

  addMolecule(m: Molecule) { this.solution.push(m); }

  async run() {
    // Loop until equilibrium (no reactions fire)
    let fired = true;
    while (fired) {
      fired = false;
      for (const rule of rules) {
        const matches = this.findReactants(rule);
        if (matches.length > 0) {
          this.applyRule(rule, matches);
          fired = true;
        }
      }
    }
  }

  private findReactants(rule: ReactionRule): Molecule[][] {
    // Find all combinations of molecules matching reactants
    // (simplified: greedy first-match)
    const results: Molecule[][] = [];
    for (const m of this.solution) {
      if (matchesPattern(m, rule.reactants[0])) {
        // ... find remaining reactants
      }
    }
    return results;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Maximum parallelism (all reactions fire together) | ❌ Non-deterministic (firing order undefined) |
| ✅ Natural decomposition (complex → subtasks) | ❌ Chain reaction explosion (unbounded growth) |
| ✅ Catalyst pattern (knowledge accelerates) | ❌ Debugging (which reaction caused state?) |
| ✅ Self-terminating (reaches inert state) | ❌ Deadlock (saturation — no reaction fires) |
| ✅ Resilient (failed reaction → reactants remain) | ❌ Rule design complexity |

## Khi nào chọn

- Want emergent computation (no control flow)
- Complex task systems (many interacting parts)
- Want maximum parallelism (reactions fire concurrently)
- Research/experimental (chemical model)
- OK with non-determinism
