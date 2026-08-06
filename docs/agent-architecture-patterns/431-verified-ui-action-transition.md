# Hướng PO: Verified UI Action Transition — mỗi act_ui qua validate-prepare-execute-verify, stateId gốc

> **Nguồn gốc:** pi-computer-use (actions.ts — prepareAction, validatePoint, ActionState; contract.ts — UiAction, StateTargetParams, stateId; state.ts — stateId, StoredState); "verified UI action"; "validate-prepare-execute-verify cycle"; "stateId grounding"; "outcome verification"
> **Coupling:** 🟡 — thêm 4-phase action pipeline + stateId grounding vào computer-use tool
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pi-computer-use prepareAction + validatePoint + outcomeAfterCheck sẵn — chưa có 4-phase pipeline trong mya)
> **Effort:** 2-3 tuần

## Nguồn gốc

**pi-computer-use** (`actions.ts`, `contract.ts`, `state.ts`) thực hiện UI action qua **4 phase**: (1) **Validate**: `validatePoint(x, y)` — kiểm tra tọa độ hợp lệ (trong bounds), `UiAction` schema valid. (2) **Prepare**: `prepareAction(action, state, env)` — chuyển UiAction (high-level: click ref "button1") → PreparedAction (low-level: target {ref} hoặc {x,y}, params: button/clickCount/text). Xử lý focus tracking (`establishesFocus`, `usesCurrentFocus`), foreground requirement (`needsForeground`). (3) **Execute**: platform backend (macOS AXUIElement, Linux AT-SPI, Windows UIA) thực hiện PreparedAction. (4) **Verify**: `outcomeAfterCheck(current, check)` — sau action, check outcome (worked/didnt/unknown) qua `outcomeAfterObservedValues` (setText → check value matches) hoặc visual diff. **stateId gốc**: mỗi action grounded trong `stateId` — action thực hiện trên state cụ thể (screenshot/observation), verify trên state mới. Nếu stateId mismatch (UI changed between observe and act) → action fail (stale state). Nguyên tắc: **mỗi action được verify** — không fire-and-forget. Khác **95 tool-call-recovery** (retry failed tool) — PO là **verify-then-proceed**.

## Mô tả

mya verified UI action transition: mỗi `act_ui` → **4-phase pipeline** — (1) **Validate**: check UiAction schema (ref/x,y hợp lệ, bounds trong image), `validatePoint` cho tọa độ. (2) **Prepare**: `prepareAction` — resolve target (ref → wireRef hoặc center point), compute params (button, clickCount, text), track focus/foreground. (3) **Execute**: platform backend thực hiện (macOS/Linux/Windows). (4) **Verify**: post-action check — outcome worked/didnt/unknown, verify value (setText → check), visual diff (screenshot before/after). **stateId grounding**: action grounded trong stateId gốc (observation snapshot) — nếu UI thay đổi giữa observe và act → stale → fail. Agent biết action **có worked hay không** — không fire-and-forget. mya có computer-use tool — PO thêm **4-phase pipeline + stateId grounding + outcome verification**.

## Kiến trúc

```
  AGENT: act_ui({ action: "click", ref: "submit-btn", stateId: "s1" })
        │
        ▼
  ┌─── 1. VALIDATE ──────────────────────────────────────┐
  │  • UiAction schema valid? (action type, ref/x,y)      │
  │  • stateId "s1" exists? (observation snapshot)        │
  │  • validatePoint: ref → center(x,y) → in bounds?      │
  │  • if invalid → throw (before any execution)          │
  └───────────────────────┬───────────────────────────────┘
                          │ (validated UiAction)
                          ▼
  ┌─── 2. PREPARE (prepareAction) ───────────────────────┐
  │  • resolve target:                                    │
  │    ref "submit-btn" → wireRef OR center(x,y)          │
  │  • compute params:                                    │
  │    button: "left", clickCount: 1                      │
  │  • track state:                                       │
  │    establishesFocus? usesCurrentFocus? needsForeground?│
  │  • → PreparedAction (low-level, ready to execute)     │
  └───────────────────────┬───────────────────────────────┘
                          │ (PreparedAction)
                          ▼
  ┌─── 3. EXECUTE (platform backend) ────────────────────┐
  │  • macOS: AXUIElement.performAction                   │
  │  • Linux: AT-SPI accessible_action                    │
  │  • Windows: UIA.Invoke                                │
  │  • grounded in stateId "s1" (original observation)    │
  │  • if stateId stale (UI changed) → FAIL               │
  └───────────────────────┬───────────────────────────────┘
                          │ (executed)
                          ▼
  ┌─── 4. VERIFY (outcome check) ────────────────────────┐
  │  • outcomeAfterObservedValues:                        │
  │    setText "hello" → check ref value == "hello"?      │
  │  • visual diff: screenshot before/after               │
  │  • outcomeAfterCheck: worked / didnt / unknown        │
  │  • → report outcome to agent                          │
  │  • if "didnt" → canRetryInForeground? → retry once    │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ computer-use tool (pi-computer-use integration) — UI automation (nền — PO = 4-phase verify)
// ✅ 95 tool-call-recovery — retry failed tool (nền — PO = verify-then-proceed)
// ✅ pi-computer-use actions.ts + contract.ts + state.ts (source/ — reference impl)

// ❌ THIẾU: 4-phase pipeline (validate → prepare → execute → verify)
// ❌ THIẾU: stateId grounding (action on specific observation snapshot)
// ❌ THIẾU: outcome verification (worked/didnt/unknown post-action)
// ❌ THIẾU: foreground retry (canRetryInForeground — retry if didnt work)
```

## Implementation

```typescript
// packages/agent/src/verified-ui-action.ts (MỚI — port từ pi-computer-use)
type Outcome = 'worked' | 'didnt' | 'unknown';

interface UiAction {
  action: 'press' | 'click' | 'setText' | 'typeText' | 'keypress' | 'scroll' | 'drag';
  ref?: string;
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];
}

interface ActionState {
  currentFocus: boolean;
}

interface PreparedAction {
  action: string;
  target: { ref?: string } | { x: number; y: number } | { focus: { x: number; y: number } };
  params: Record<string, unknown>;
  establishesFocus: boolean;
  needsForeground: boolean;
}

// Phase 1: Validate
function validateAction(action: UiAction, imageBounds: { width: number; height: number }): void {
  if (!action.action) throw new Error('Missing action type');
  if (action.ref) return; // ref-based — validated in prepare
  if (action.x != null && action.y != null) {
    if (action.x < 0 || action.x > imageBounds.width ||
        action.y < 0 || action.y > imageBounds.height) {
      throw new Error(`Point (${action.x}, ${action.y}) out of bounds`);
    }
  }
}

// Phase 2: Prepare
function prepareAction(action: UiAction, state: ActionState, env: ActionEnvironment): PreparedAction {
  // resolve target (ref → wireRef or center point), compute params, track focus
  // (simplified — see pi-computer-use actions.ts for full impl)
  const target = action.ref ? { ref: action.ref } : { x: action.x!, y: action.y! };
  return {
    action: action.action,
    target,
    params: action.text ? { text: action.text } : {},
    establishesFocus: action.action === 'click' && Boolean(action.ref),
    needsForeground: false,
  };
}

// Phase 3: Execute (platform backend)
async function executeAction(prep: PreparedAction, backend: PlatformBackend): Promise<void> {
  await backend.perform(prep);
}

// Phase 4: Verify
function verifyOutcome(
  action: UiAction,
  valueForRef: (ref: string) => string | undefined,
): Outcome {
  if (action.action === 'setText' && action.ref) {
    const matches = valueForRef(action.ref) === (action.text ?? '');
    return matches ? 'worked' : 'didnt';
  }
  return 'unknown'; // non-text actions → visual diff or unknown
}

// Full 4-phase pipeline
async function verifiedActUi(
  action: UiAction,
  stateId: string,
  env: ActionEnvironment,
  backend: PlatformBackend,
): Promise<{ outcome: Outcome; newStateId: string }> {
  // Check stateId validity (observation snapshot exists + not stale)
  if (!env.stateStore.has(stateId)) throw new Error(`Stale stateId: ${stateId}`);

  // Phase 1: Validate
  validateAction(action, env.imageBounds);
  // Phase 2: Prepare
  const prepared = prepareAction(action, { currentFocus: false }, env);
  // Phase 3: Execute
  await executeAction(prepared, backend);
  // Phase 4: Verify
  const outcome = verifyOutcome(action, (ref) => env.valueForRef(ref));
  // Retry in foreground if didnt work
  if (outcome === 'didnt' && canRetryInForeground(prepared, outcome, env.headless)) {
    await executeAction(prepared, backend);
  }
  const newStateId = env.captureNewState();
  return { outcome, newStateId };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Verified (mỗi action biết worked/didnt — không fire-and-forget) | ❌ 4-phase overhead (validate+prepare+execute+verify — slower) |
| ✅ stateId grounding (action trên state cụ thể — stale detection) | ❌ stateId management (store/cleanup observations) |
| ✅ Foreground retry (didnt work → retry once) | ❌ False negative verify (visual diff không reliable) |
| ✅ Focus tracking (establishesFocus/usesCurrentFocus — đúng keyboard target) | ❌ Platform differences (macOS/Linux/Windows verify khác nhau) |

## Khác các hướng gần

| | 95 Tool-Call-Recovery | PO: Verified-UI-Action |
|---|---|---|
| Cái gì | Retry failed tool | **4-phase verify per action** |
| Verify | ❌ (just retry) | ✅ worked/didnt/unknown |
| stateId | ❌ | ✅ grounding in observation |
| Retry | ✅ (on failure) | ✅ foreground retry on didnt |

## Khi nào chọn

- Computer-use tool (UI automation — cần verify mỗi action)
- Muốn stateId grounding (action trên snapshot cụ thể — detect stale UI)
- Muốn outcome verification (agent biết action worked hay không)
- Nối 95 tool-call-recovery (PO = verify layer, 95 = retry layer) + pi-computer-use (reference impl); guard false negative verify (visual diff unreliable → fallback semantic check)
