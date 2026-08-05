# Hướng AA: Reactive Dataflow — không có loop, chỉ có graph

> **Nguồn gốc:** Functional Reactive Programming (Elliott, 1997). Spreadsheet model.
> **Coupling:** 🟡 Data dependencies (not direct calls)
> **Agent-agnostic:** ✅ — nodes là pure functions
> **Effort:** 2-3 tuần

## Nguồn gốc

FRP (Elliott, 1997). Popularized bởi RxJS, ReactiveX, Elm. Spreadsheet metaphor: cells chứa formulas tự recalc khi dependencies đổi.

**Tham chiếu:**
- Elliott, C. & Hudak, P. (1997). "Functional Reactive Animation." *ICFP '97*.
- Bainomugisha, E. et al. (2013). "A survey on reactive programming." *ACM Computing Surveys*, 45(4).

## Mô tả

KHÔNG CÓ runTurn(). KHÔNG CÓ turn state. Agent = dependency graph của reactive cells. Data flows qua graph reactively như spreadsheet recalc. Mỗi node tự fire khi inputs sẵn sàng. No orchestrator decides what runs next — data dependencies decide.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│              REACTIVE DATAFLOW                               │
│                                                              │
│  KHÔNG CÓ runTurn(). KHÔNG CÓ turn state.                   │
│  Agent = dependency graph, tự recalc như spreadsheet.       │
│                                                              │
│  userInput$ ──► parseIntent$ ──► taskReady$                 │
│                                      │                       │
│                    ┌─────────────────┼───────────────┐      │
│                    ▼                 ▼                 ▼      │
│              memoryCtx$       toolPrepare$      roleApply$  │
│                    │                 │                 │      │
│                    └────────┬────────┘                 │      │
│                             ▼                           │      │
│                       llmCall$ ◄────────────────────────┘      │
│                             │                                  │
│                             ▼                                  │
│                       response$                                │
│                             │                                  │
│                             ▼                                  │
│                    broadcast$ (web/channels/TUI)              │
│                                                              │
│  Mỗi node tự fire khi inputs sẵn sàng.                       │
│  memoryCtx$ và toolPrepare$ chạy song song tự động.         │
│  Không ai quyết định "chạy gì tiếp" — data dependency quyết │
│  định.                                                       │
└──────────────────────────────────────────────────────────────┘
```

## Reactive chain code

```typescript
// No explicit loop — reactive pipeline
import { Subject, combineLatest, from } from "rxjs";
import { switchMap, map, filter, share, shareReplay } from "rxjs/operators";

// Input stream
const userInput$ = new Subject<string>();

// Node 1: Parse intent
const intent$ = userInput$.pipe(
  map(parseIntent),
  shareReplay(1),
);

// Node 2: Task ready detection
const taskReady$ = intent$.pipe(
  filter(i => i.type === "task"),
  map(i => i.task),
);

// Node 3a: Memory enrichment (parallel with tools)
const memoryCtx$ = taskReady$.pipe(
  switchMap(task => from(memory.recall(task.description))),
  share(),
);

// Node 3b: Tool preparation (parallel with memory)
const toolPrepare$ = taskReady$.pipe(
  switchMap(task => from(prepareTools(task.toolsNeeded))),
  share(),
);

// Node 4: Role application
const roleApply$ = intent$.pipe(
  map(i => applyRole(i.role, i.prompt)),
  share(),
);

// Node 5: LLM call (fires when memory + tools + role all ready)
const llmResponse$ = combineLatest([memoryCtx$, toolPrepare$, roleApply$]).pipe(
  switchMap(([memory, tools, prompt]) =>
    provider.stream(prompt, { memory, tools })),
  share(),
);

// Node 6: Broadcast to all sinks
llmResponse$.subscribe(event => {
  // → web dashboard (WebSocket)
  // → channels (WhatsApp/Matrix)
  // → TUI
  // → audit log
  broadcast(event);
});

// Error handling (reactive)
llmResponse$.pipe(
  retry(2),
  catchError(err => from(fallbackProvider.stream(...))),
).subscribe(...);
```

## Reactive properties

| Thuộc tính | Ý nghĩa |
|---|---|
| **shareReplay** | Memory context cached — không re-compute cho mỗi subscriber |
| **switchMap** | New input cancels previous LLM call (agent steer) |
| **combineLatest** | Fire only khi TẤT CẢ dependencies sẵn sàng |
| **parallel streams** | memoryCtx$ ∥ toolPrepare$ chạy song song tự động |
| **backpressure** | Buffer/drop khi downstream không theo kịp |
| **hot/cold** | Memory có thể lazy (cold) hoặc eager (hot) |

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No control flow bugs (dependencies auto-fire) | ❌ Debugging hell (dataflow graphs hard to trace) |
| ✅ Natural concurrency (independent nodes parallel) | ❌ No natural conversation model (humans think in turns) |
| ✅ Declarative (describe WHAT, not HOW) | ❌ Memory leaks (long-lived subscriptions) |
| ✅ Backpressure handling | ❌ Over-engineering for simple cases |
| ✅ Easy to add/remove nodes | ❌ Marble testing complexity |

## Khi nào chọn

- Want declarative agent (describe graph, not loop)
- Complex pipelines (many parallel stages)
- Need automatic concurrency (independent nodes)
- Want reactive updates (memory → agents auto-recompute)
- OK with RxJS/FRP learning curve
