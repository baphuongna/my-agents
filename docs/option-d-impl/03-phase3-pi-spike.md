# Phase 3: Spike — Log Actual pi Events to Verify Spec Assumptions

> Depends on: (none — foundation phase, parallel with Phases 1 & 2)
> Estimated: 1h
> Spec reference: §1.3 (Uniform Event Type), §2.1 (PiInProcessSession), §3 (Event Normalization)

## Objective

Before implementing `PiEventNormalizer` (Phase 4) and `PiInProcessSession` (Phase 4),
verify that the pi event types and payloads **actually match** what the spec
assumes. The spec's `AgentEvent` union (§1.3) is based on assumptions about pi's
internal event shapes. If those assumptions are wrong, Phase 4 will build a
normalizer that crashes on real data.

**This phase produces a document, not code.** The output is
`docs/option-d-impl/pi-event-map.md` — a verified mapping of every pi event type
to its actual payload schema, with examples captured from a real pi session.

**How this de-risks Phase 4:** Phase 4's `PiEventNormalizer.toAgentEvent()` must
handle every event type pi emits. Without the spike, we'd discover missing event
types or wrong field names only at runtime (likely during integration testing,
when the cost of fixing is highest). The spike makes Phase 4 a mechanical
translation task: "read the map, write the switch cases."

## Deliverables

- `docs/option-d-impl/pi-event-map.md` — verified event schemas (THE deliverable)
- `scripts/pi-event-spike.mjs` — throwaway harness script (kept for reference)

## Implementation Steps

### Step 1 — Create the spike harness script

This script creates a real pi `AgentSession`, subscribes to all events, and logs
every event with its full payload as JSON. It is **not** a test — it is a one-off
diagnostic tool.

```javascript
// scripts/pi-event-spike.mjs
// Run: node scripts/pi-event-spike.mjs "What is 2+2?"
//
// This script creates a real pi AgentSession and logs every event it emits.
// Output goes to stdout as newline-delimited JSON (one event per line).
// Capture: node scripts/pi-event-spike.mjs "prompt" > pi-events.jsonl
//
// Prerequisites:
//   - pi packages installed (npm install at workspace root)
//   - A valid API key in ~/.pi/agent/auth.json or env vars

import { createAgentSession, DefaultResourceLoader, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const prompt = process.argv[2] ?? "Say hello and then use the bash tool to run echo test";
const agentDir = join(homedir(), ".pi/agent");
const cwd = process.cwd();

// Ensure agentDir exists
mkdirSync(join(agentDir, "sessions"), { recursive: true });

console.error(`[spike] agentDir: ${agentDir}`);
console.error(`[spike] cwd: ${cwd}`);
console.error(`[spike] prompt: ${prompt}`);

// Create ModelRuntime (loads models.json + auth.json)
const modelRuntime = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"),
  modelsPath: join(agentDir, "models.json"),
});

// Create resource loader (minimal — no extensions)
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  extensionFactories: [],
});
await resourceLoader.reload();

// Create session
const { session } = await createAgentSession({
  cwd,
  agentDir,
  resourceLoader,
  modelRuntime,
  // Use a cheap model if available
  // model: modelRuntime.getModels().find(m => m.id.includes("haiku")),
});

console.error(`[spike] session created, subscribing to events...`);

// Subscribe to ALL events
const seenTypes = new Set();
let eventCount = 0;

session.subscribe((event) => {
  eventCount++;

  // Log every event as NDJSON
  const serialized = JSON.stringify(event, null, 0);
  process.stdout.write(serialized + "\n");

  // Track unique types for summary
  const type = event?.type ?? "UNKNOWN";
  if (!seenTypes.has(type)) {
    seenTypes.add(type);
    console.error(`[spike] NEW event type: ${type}`);
  }
});

// Subscribe to settle/idle events (may be separate from subscribe)
if (typeof session.onSettled === "function") {
  session.onSettled(() => {
    console.error(`[spike] session.onSettled() fired`);
  });
}

if (typeof session.onIdleChange === "function") {
  session.onIdleChange((idle) => {
    console.error(`[spike] session.onIdleChange(${idle}) fired`);
  });
}

// Send the prompt
console.error(`[spike] sending prompt...`);
await session.prompt(prompt, { streamingBehavior: "followUp" });

// Wait a moment for trailing events
await new Promise((resolve) => setTimeout(resolve, 2000));

console.error(`[spike] done. ${eventCount} events, ${seenTypes.size} unique types:`);
console.error(`[spike] types: ${[...seenTypes].sort().join(", ")}`);

// Cleanup
try {
  session.dispose();
} catch {}

process.exit(0);
```

### Step 2 — Run the spike with diverse prompts

Run the script multiple times with different prompt types to trigger different
event sequences. Capture each run's output to a separate `.jsonl` file:

```bash
# Basic text response (text streaming)
node scripts/pi-event-spike.mjs "What is 2+2?" > /tmp/pi-events-basic.jsonl 2>/tmp/pi-spike-basic.log

# Tool execution (tool_call, tool_result)
node scripts/pi-event-spike.mjs "Use the bash tool to run echo hello" > /tmp/pi-events-tool.jsonl 2>/tmp/pi-spike-tool.log

# Thinking/reasoning (if model supports it)
node scripts/pi-event-spike.mjs "Think step by step: what is 17 * 23?" > /tmp/pi-events-thinking.jsonl 2>/tmp/pi-spike-thinking.log

# Compaction (need a large context — may not trigger in short session)
# This one is harder to trigger; document what you observe.

# Model selection (if /model command is available)
# Note: may not emit events via subscribe() — check separate hooks
```

> **If the script fails to run** (missing deps, auth issues, etc.), document the
> failure in the event map with what was attempted and what blocked. Even a
> failed spike is valuable — it tells us what infrastructure Phase 4 needs.

### Step 3 — Analyze the captured events

For each unique `event.type` observed, extract:

1. **Type name** (the string value of `event.type`)
2. **Full payload schema** (all fields, their types, which are optional)
3. **Example payload** (one real JSON object from the log)
4. **When it fires** (start of turn, during streaming, after tool call, etc.)
5. **Frequency** (once per turn, once per token, once per tool call, etc.)

Use a quick analysis one-liner:

```bash
# List all unique event types with their first occurrence
cat /tmp/pi-events-*.jsonl | \
  jq -r '.type // "UNKNOWN"' | \
  sort | uniq -c | sort -rn

# Show the full schema of each type (first occurrence)
cat /tmp/pi-events-basic.jsonl | \
  jq -s 'group_by(.type) | map({type: .[0].type, sample: .[0], count: length}) | sort_by(.count)'
```

### Step 4 — Write `pi-event-map.md`

Create the verified event map document. Structure:

```markdown
# pi Event Map (Spike Results)

> Generated: [date]
> pi version: [from package.json]
> Models tested: [list]
```

For each event type, document:

#### Event: `agent_start`

| Field | Type | Required | Example |
|-------|------|----------|---------|
| `type` | `"agent_start"` | ✅ | `"agent_start"` |
| `sessionId` | `string` | ✅ | `"abc-123"` |
| `model` | `string` | ❓ | `"claude-sonnet-4-20250514"` |
| ... | ... | ... | ... |

**When:** Fires at session creation / first prompt.
**Maps to AgentEvent:** (none — internal lifecycle, not user-facing)

---

#### Event: `message_start`
...

### Step 5 — Verify spec assumptions

Cross-reference each spec assumption against the spike data:

| Spec Assumption (§1.3 / §2.1) | Spike Finding | Status |
|---|---|---|
| `message_end` event has `message.usage.input` and `message.usage.output` | [verified?] | ✅/❌ |
| `message_end` event has `message.role === "assistant"` | [verified?] | ✅/❌ |
| `agent_settled` event fires after prompt() completes | [verified?] | ✅/❌ |
| `tool_execution_start` has tool name | [verified?] | ✅/❌ |
| `tool_execution_update` has streaming progress | [verified?] | ✅/❌ |
| `tool_execution_end` has result/output | [verified?] | ✅/❌ |
| Text deltas come as `message_update` with `delta.text` | [verified?] | ✅/❌ |
| Thinking deltas come as `message_update` with `delta.thinking` | [verified?] | ✅/❌ |
| `model_select` event fires on model change | [verified?] | ✅/❌ |
| `compaction_start` / `compaction_end` events exist | [verified?] | ✅/❌ |
| `getContextUsage()` returns `{ tokens, contextWindow, percent }` | [verified?] | ✅/❌ |
| `isIdle` property reflects turn completion | [verified?] | ✅/❌ |

> **Critical:** If any assumption is ❌, document the actual behavior and note
> the required change to Phase 4's normalizer. This is the whole point of the spike.

### Step 6 — Identify events NOT in the spec

The spec may not cover every event pi emits. Document any "bonus" events:

| Event Type | When | Notes |
|---|---|---|
| `[unknown_type]` | [when] | Not mapped to any AgentEvent — safe to ignore? |

## Code Skeletons

### PiEventNormalizer (Phase 4 preview — informed by spike)

This is what Phase 4 will build. The spike determines the exact switch cases:

```typescript
// packages/print/src/runtimes/pi-event-normalizer.ts (Phase 4 — NOT in this phase)

import type { AgentEvent } from "@my-agent/core";

export class PiEventNormalizer {
  /**
   * Convert a raw pi event to a normalized AgentEvent.
   * Returns null if the event should be ignored (internal lifecycle, noise).
   *
   * MAPPING TABLE (verified by Phase 3 spike):
   *   pi event type              → AgentEvent type
   *   ─────────────────────────────────────────────
   *   message_start              → (ignored or turn_start if not from prompt)
   *   message_update (text)      → { type: "text", delta }
   *   message_update (thinking)  → { type: "thinking", delta }
   *   message_end                → (accumulates usage, doesn't emit)
   *   tool_execution_start       → { type: "tool_call", ... }
   *   tool_execution_end         → { type: "tool_result", ... }
   *   agent_settled              → { type: "turn_end", ... }
   *   model_select               → { type: "model_changed", ... }
   *   compaction_end             → { type: "compaction", ... }
   */
  static toAgentEvent(
    rawEvent: unknown,
    session: { model?: { id: string }; thinkingLevel: string },
    accumulatedUsage: { tokensIn: number; tokensOut: number },
  ): AgentEvent | null {
    const e = rawEvent as { type: string };

    switch (e.type) {
      // ... exact cases determined by spike results ...
      default:
        return null; // unknown event — safe to ignore
    }
  }
}
```

### What to capture for each event type

```
For each pi event, record:
┌──────────────────────────────────────────────────────────────┐
│ type:         "message_update"                               │
│ fields:                                                      │
│   type        string    ✅   "message_update"                │
│   delta       object    ✅   { text?: string, thinking?: ... }│
│   messageId   string    ❓                                    │
│ when:         during text/thinking streaming                 │
│ frequency:    per-token (many per turn)                      │
│ maps to:      AgentEvent "text" or "thinking"                │
│ example:      {"type":"message_update","delta":{"text":"H"}} │
└──────────────────────────────────────────────────────────────┘
```

## Test Plan

- **File:** (none — spike is a diagnostic, not a test)
- **Verification:** The output document `pi-event-map.md` must exist and contain:
  - [ ] At least 8 verified event types
  - [ ] Full payload schema for each
  - [ ] At least one real example payload per type
  - [ ] Spec assumption verification table (all rows filled with ✅ or ❌)
  - [ ] Any discrepancies documented with required Phase 4 changes

> If the spike script cannot run (missing deps, no API key), document the
> blocker in `pi-event-map.md` with:
> - What was attempted
> - What failed
> - What the fallback plan is (read pi source code as secondary evidence)

## Acceptance Criteria

- [ ] `scripts/pi-event-spike.mjs` created and runs (or fails with documented blocker)
- [ ] `docs/option-d-impl/pi-event-map.md` exists
- [ ] Event map covers at minimum: `agent_start`, `agent_settled`, `message_start`, `message_update`, `message_end`, `tool_execution_*`, `model_select`
- [ ] Each event type has: field schema, example, when-it-fires, frequency
- [ ] Spec assumption table is filled (✅/❌ for each row)
- [ ] Any ❌ rows have a documented "required Phase 4 change"
- [ ] Events NOT in spec are listed (even if "safe to ignore")
- [ ] `getContextUsage()` return shape verified (critical for `contextPct` in SessionState)
- [ ] `isIdle` / turn-completion mechanism verified (critical for turn_end safety net)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| No API key / auth configured | Use `MYA_BIN` env or pi's existing auth at `~/.pi/agent/auth.json`. Document blocker if unavailable |
| pi package not importable in node script | Use `tsx` instead of `node` for the spike (handles `.ts` imports). Or import from the built dist |
| Model doesn't support thinking | Test with a model known to support thinking (Claude Sonnet/Opus). Document "thinking events not captured" if unavailable |
| Compaction events not triggerable in short session | Note as "not captured — will verify in Phase 4 integration test." The spec already has a fallback (`?? 0` on `tokensBefore`) |
| Event shapes differ across pi versions | Record the pi version in the event map. Phase 4 should version-gate if needed |
| Spike script is throwaway but someone tries to use it in CI | Add a header comment: "DIAGNOSTIC ONLY — NOT FOR CI. Run manually." |

## Rollback

1. Delete `scripts/pi-event-spike.mjs`
2. Delete `docs/option-d-impl/pi-event-map.md`

No code changes were made to any package. The spike is purely informational.
Rollback has zero impact on existing functionality.
