# Hướng JH: Petri Net Workflow — mô hình hóa workflow & concurrency, phân tích deadlock

> **Nguồn gốc:** Carl Adam Petri (1962); "Petri Nets: Properties, Analysis and Applications" (Murata 1989); workflow nets (van der Aalst); colored Petri nets; "Soundness of workflow nets"; deadlock/liveness analysis
> **Coupling:** 🟢 — workflow model tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pi-extensible-workflows + pi-dynamic-workflows sẵn — thiếu formal model + liveness analysis)
> **Effort:** 3-5 tuần

## Nguồn gốc

Petri net (Petri 1962): mô hình đồ thị cho **concurrent systems** — place (○, trạng thái) + transition (│, hành động) + token (●, mark state). Token di chuyển: transition fire khi input place có token → consume → produce ở output place. Murata (1989): formal analysis — **liveness** (mọi transition có thể fire), **boundedness** (không overflow), **reachability** (state có thể đạt), **deadlock-free**. Van der Aalst workflow nets: business process = petri net — phân tích **soundness** (luôn terminate, mỗi case reach end). Cốt lõi: **visual + mathematical** — vẽ workflow, rồi prove không deadlock / luôn complete.

## Mô tả

mya petri net: model workflow (pi-extensible-workflows) thành petri net — place = task state, transition = agent action, token = active instance. Phân tích trước deploy: deadlock-free? (không transition kẹt), liveness? (mọi action reachable), soundness? (luôn reach end). Nối JF (266) runaway: petri net detect structural loop (deadlock/livelock). Nối IV (256) contract-net: bidding = transition. Nối HY (233) work-stealing: petri net model worker concurrency.

## Kiến trúc

```
  PETRI NET MODEL of a workflow:

  ●──→(start)──→[parse]──→(parsed)──→┬─→[agent_A]──→(doneA)─┐
                                      │                        │
                                      └─→[agent_B]──→(doneB)─┤──→[merge]──→(end)
                                                               │
                            both done required (AND-join) ────┘

  ● = token (active instance)   ○ = place (state)   │ = transition (action)

  ANALYSIS (Murata 1989):
  ┌──────────────────────────────────────────────────────┐
  │ LIVENESS: every transition can fire?                 │
  │   [agent_A] reachable? ✓  [merge] reachable? ✓       │
  │ BOUNDEDNESS: any place overflow? (token cap)         │
  │   (doneA) max 1 token ✓ (bounded)                    │
  │ DEADLOCK-FREE: no state where nothing can fire?      │
  │   → if (doneA) filled but (doneB) never fires        │
  │     → DEADLOCK! (B stuck) → flag before deploy        │
  │ SOUNDNESS (van der Aalst): always reach (end)?       │
  └──────────────────────────────────────────────────────┘
```

```
mya: pi-extensible/dynamic-workflows sẵn — thiếu: petri net formal model + liveness/deadlock analysis + soundness check
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ pi-extensible-workflows — workflow engine (sẵn trong source/)
// ✅ pi-dynamic-workflows — runtime workflow (sẵn)
// ✅ HY (233) work-stealing — concurrency (documented)
// ✅ JF (266) runaway-loop — loop detect (documented)

// ❌ THIẾU: petri net formal model (place/transition/token)
// ❌ THIẾU: liveness analysis (every transition fireable?)
// ❌ THIẾU: deadlock detection (structural — before deploy)
// ❌ THIẾU: soundness check (always reach end)
```

## Implementation

```typescript
// packages/workflow/src/petri-net.ts (NEW)
interface Place { id: string; tokens: number; }
interface Transition { id: string; inputs: string[]; outputs: string[]; }

export class PetriNet {
  private places = new Map<string, Place>();
  private transitions: Transition[] = [];

  addPlace(id: string): void { this.places.set(id, { id, tokens: 0 }); }
  addTransition(t: Transition): void { this.transitions.push(t); }
  mark(placeId: string, n = 1): void { this.places.get(placeId)!.tokens += n; }

  // Fire all enabled transitions until fixpoint (reachability)
  run(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of this.transitions) {
        if (this.enabled(t)) { this.fire(t); changed = true; }
      }
    }
  }

  private enabled(t: Transition): boolean {
    return t.inputs.every((p) => this.places.get(p)!.tokens > 0);
  }
  private fire(t: Transition): void {
    t.inputs.forEach((p) => this.places.get(p)!.tokens--);
    t.outputs.forEach((p) => this.places.get(p)!.tokens++);
  }

  // Soundness: from start token, can we always reach end? (deadlock-free)
  analyze(): Analysis {
    const dead = this.transitions.filter((t) => !this.reachable(t)); // never fire = dead
    const overflow = [...this.places.values()].filter((p) => p.tokens > 1); // unbounded
    return {
      sound: dead.length === 0 && overflow.length === 0,
      deadTransitions: dead,
      unbounded: overflow,
    };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Formal deadlock/liveness analysis (Murata 1989) | ❌ Petri net modeling effort |
| ✅ Soundness — prove workflow terminate (van der Aalst) | ❌ State explosion (complex workflow) |
| ✅ Visual + mathematical (vẽ + prove) | ❌ Overkill cho simple sequential workflow |
| ✅ Catch structural bug before deploy | ❌ Dynamic workflow harder to model |

## Khác các hướng gần

| | Extensible Workflow | JF (266) Runaway | JH: Petri Net |
|---|---|---|---|
| Mô hình | DAG (informal) | Loop counter | **Formal place/transition/token** |
| Deadlock | ❌ (runtime才发现) | ❌ | ✅ **structural (pre-deploy)** |
| Analyze | ❌ | Runtime | **Liveness/boundedness/soundness** |

## Khi nào chọn

- Workflow phức tạp (concurrent, branching, sync) — cần prove đúng
- Deadlock/livelock risk cao (multi-agent dependency)
- Cần formal verification trước deploy (safety-critical)
- Nối pi-extensible-workflows + JF (266) runaway + IV (256) contract-net + HY (233)
