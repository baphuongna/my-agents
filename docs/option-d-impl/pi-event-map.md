# Pi Event Map — Verified from Source

> Phase 3 spike output. Verified against `@earendil-works/pi-coding-agent@0.83.0`
> Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`

## Agent Lifecycle Events

| Pi Event | Payload | AgentEvent Mapping |
|---|---|---|
| `agent_start` | (none) | `null` (turn_start emitted by prompt() directly) |
| `agent_settled` | (none) | `{ type: "turn_end", tokensIn, tokensOut }` |
| `agent_end` | `messages: AgentMessage[]`, `willRetry: boolean` | `null` (not in AgentSessionEvent — excluded) |

## Turn Events

| Pi Event | Payload | AgentEvent Mapping |
|---|---|---|
| `turn_start` | `turnIndex: number`, `timestamp: number` | `null` (turn_start emitted by prompt()) |
| `turn_end` | `turnIndex: number`, `message: AgentMessage`, `toolResults: ToolResultMessage[]` | `null` (agent_settled handles this) |

## Message Events

| Pi Event | Payload | AgentEvent Mapping |
|---|---|---|
| `message_start` | `message: AgentMessage` | `null` |
| `message_update` | `message: AgentMessage`, **`assistantMessageEvent: AssistantMessageEvent`** | `{ type: "text"/"thinking", delta }` |
| `message_end` | `message: AgentMessage` (has `.usage` for assistant messages) | `null` (usage accumulated in session) |

### AssistantMessageEvent (inside message_update)

The delta is in `assistantMessageEvent`, NOT directly on the event. Must extract:
```typescript
const delta = (event as any).assistantMessageEvent?.delta;
// delta may be string or object — coerce with typeof check
```

### Message Usage (inside message_end)

```typescript
if (msg?.role === "assistant" && msg?.usage) {
  tokensIn += msg.usage.input ?? 0;
  tokensOut += msg.usage.output ?? 0;
}
```

## Tool Events

| Pi Event | Payload | AgentEvent Mapping |
|---|---|---|
| `tool_execution_start` | **`toolCallId`**, **`toolName`** (NOT `name`), `args: any` | `{ type: "tool_call", toolCallId, name: toolName, args }` |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, **`partialResult: any`** (NOT `output`) | `null` (or partial tool_result) |
| `tool_execution_end` | `toolCallId`, `toolName`, **`result: any`**, **`isError: boolean`** (NOT `output`/`error`) | `{ type: "tool_result", toolCallId, output: JSON.stringify(result), error: isError }` |

**Key field name differences from spec assumptions:**
- `toolName` → maps to AgentEvent `name`
- `partialResult` → NOT `output`
- `result` + `isError` → maps to AgentEvent `output` + `error`

## Model/Thinking Events

| Pi Event | Payload | AgentEvent Mapping |
|---|---|---|
| `model_select` | **`model: Model<any>`** (object, NOT string), `previousModel`, `source` | `{ type: "model_changed", model: event.model.id }` |
| **`thinking_level_select`** (NOT `thinking_level_changed`) | `level: ThinkingLevel`, `previousLevel` | `{ type: "thinking_changed", level }` |

## Compaction Events

| Pi Event | Payload | AgentEvent Mapping |
|---|---|---|
| `compaction_start` | `reason: "overflow" \| "threshold"` | `null` |
| `compaction_end` | `reason`, `result: CompactionResult \| undefined`, `aborted`, `willRetry`, `errorMessage?` | `{ type: "compaction", result: { tokensBefore, tokensAfter, strategy: "native" } }` |

### CompactionResult (from pi source)

```typescript
interface CompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter: number;  // optional in practice
  usage?: Usage;
  details?: unknown;
}
```

## Normalizer Corrections for Phase 4

Based on this spike, the PiEventNormalizer must use these EXACT field names:

```typescript
// CORRECT (verified from source):
case "tool_execution_start":
  return { type: "tool_call", toolCallId: e.toolCallId, name: e.toolName, args: e.args };

case "tool_execution_end":
  return { type: "tool_result", toolCallId: e.toolCallId, output: JSON.stringify(e.result), error: e.isError };

case "model_select":
  return { type: "model_changed", model: e.model?.id ?? "unknown" };

case "thinking_level_select":  // NOT thinking_level_changed!
  return { type: "thinking_changed", level: e.level };

case "compaction_end":
  return { type: "compaction", result: { tokensBefore: e.result?.tokensBefore ?? 0, tokensAfter: e.result?.estimatedTokensAfter ?? 0, strategy: "native" } };
```

## Session API (verified)

| Property/Method | Type | Notes |
|---|---|---|
| `session.model` | `Model<any> \| undefined` (getter) | Use `.id` for string |
| `session.thinkingLevel` | `ThinkingLevel` (getter) | String |
| `session.isIdle` | `boolean` (getter, NOT method) | `session.isIdle` not `session.isIdle()` |
| `session.getContextUsage()` | `ContextUsage \| undefined` (method) | Returns `{ tokens, contextWindow, percent }` |
| `session.prompt(text, opts)` | `Promise<void>` | Blocking — resolves on turn completion |
| `session.sendCustomMessage(text, opts)` | `Promise<void>` | Non-blocking injection |
| `session.setModel(model)` | `Promise<void>` | |
| `session.setThinkingLevel(level)` | `void` | |
| `session.compact()` | `Promise<CompactionResult>` | |
| `session.dispose()` | `void` | |
| `session.subscribe(listener)` | `() => void` | Returns unsubscribe |
