# Hướng PS: Session Log Config Entry Scope — entry header là root node, toolCall.id link toolResult

> **Nguồn gốc:** pi (session JSONL entry structure — header root, toolCallId linking); pi-session-manager (inspect.ts — findToolResultReference, toolCallId; trace.ts — toolResults Map, toolCall→result linking); "session log entry structure"; "toolCall.id ↔ toolResult linking"; "entry header as root node"
> **Coupling:** 🟢 — chuẩn hóa session log entry format (header root + toolCallId link)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (JSONL entry format + toolCallId link sẵn — chưa có formal spec trong mya core)
> **Effort:** 0.5-1 tuần

## Nguồn gốc

**pi** session log (JSONL) có cấu trúc **entry-scoped** — mỗi dòng là 1 entry, entry đầu là **header (root node)**. `pi-session-manager/inspect.ts` parse: entry[0] = header (`{ version, parentSession }`), entry[1..N] = content (message, compaction, custom, branch_summary). Mỗi entry có `id` (unique) + `parentId` (link tới entry cha → tree structure). **toolCall ↔ toolResult linking**: assistant message có `toolCall` block với `id` (toolCall.id), toolResult message có `toolCallId` field matching → `findToolResultReference()` extract `message.toolCallId` hoặc `content[].id` → link result back to call. `trace.ts` builds `toolResults: Map<toolCallId, { isError, preview }>` — rồi match `event.tool_calls[].id` → enrich with result status (running/completed/error) + preview. Nguyên tắc: **entry = node, toolCall.id = edge** — session log là graph, không phải flat list. Khác **425 PI branch-tree** (build tree) — PS là **entry format spec** (header root + linking contract).

## Mô tả

mya session log config entry scope: session JSONL có cấu trúc **entry-scoped** — (1) **Header = root node**: entry[0] là header (`{ id, version, parentSession, cwd, timestamp }`) — root của entry tree. (2) **Content entries**: entry[1..N] — message (user/assistant/toolResult), compaction, branch_summary, custom — mỗi entry có `id` + `parentId` (link tới parent → tree). (3) **toolCall ↔ toolResult link**: assistant message có `toolCall` block (`{ id, name, arguments }`), toolResult message có `toolCallId` field → link result to call via matching id. (4) **Entry scope**: mỗi entry là self-contained node — header định nghĩa root, parentId định nghĩa tree edges, toolCallId định nghĩa tool edges. Agent inspect session → reconstruct graph (tree + tool links). mya có session store — PS **formalize entry format** (header root + toolCallId link contract).

## Kiến trúc

```
  SESSION JSONL (entry-scoped):

  LINE 0 (HEADER = ROOT NODE):
  {
    "type": "header",
    "id": "h1",
    "version": 2,
    "parentSession": null,       ← null = root session
    "cwd": "/home/user/project",
    "timestamp": "2024-01-01T..."
  }

  LINE 1 (MESSAGE — user):
  {
    "type": "message",
    "id": "m1",
    "parentId": "h1",            ← link to header (root)
    "timestamp": "...",
    "message": { "role": "user", "content": "fix the bug" }
  }

  LINE 2 (MESSAGE — assistant with toolCall):
  {
    "type": "message",
    "id": "m2",
    "parentId": "m1",
    "message": {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "Let me check..." },
        { "type": "toolCall", "id": "tc_001",      ← toolCall.id
          "name": "read", "arguments": { "path": "bug.ts" } }
      ]
    }
  }

  LINE 3 (MESSAGE — toolResult):
  {
    "type": "message",
    "id": "m3",
    "parentId": "m2",
    "message": {
      "role": "toolResult",
      "toolCallId": "tc_001",     ← LINKS to toolCall.id above
      "toolName": "read",
      "content": "file contents...",
      "isError": false
    }
  }

  ENTRY TREE (parentId edges):
  h1 (header/root) → m1 (user) → m2 (assistant+toolCall) → m3 (toolResult)

  TOOL LINK (toolCallId edge):
  m2.content[toolCall].id "tc_001" ←→ m3.message.toolCallId "tc_001"
  → toolResult linked to toolCall (status: completed/error)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session store (packages/core) — JSONL persistence (nền — PS = format spec)
// ✅ 425 PI branch-tree-reconstruction — tree build (nền — PS = entry format for tree)
// ✅ pi-session-manager inspect.ts + trace.ts (source/ — reference impl)

// ❌ THIẾU: formal entry format spec (header root + parentId tree + toolCallId link)
// ❌ THIẾU: toolCall ↔ toolResult linking contract (toolCall.id ↔ toolResult.toolCallId)
// ❌ THIẾU: entry type taxonomy (header, message, compaction, branch_summary, custom)
```

## Implementation

```typescript
// packages/agent/src/session-entry-spec.ts (MỚI — formalize existing format)

// Entry type taxonomy
type EntryType = 'header' | 'message' | 'compaction' | 'branch_summary' | 'custom';

// Base entry (all entries share these)
interface BaseEntry {
  id: string;                 // unique entry ID
  parentId?: string;          // link to parent → tree structure
  type: EntryType;
  timestamp: string;
}

// Header entry = ROOT NODE (always entry[0])
interface HeaderEntry extends BaseEntry {
  type: 'header';
  version: number;
  parentSession: string | null;  // null = root session; string = forked from
  cwd: string;
}

// Message entry (user / assistant / toolResult)
interface MessageEntry extends BaseEntry {
  type: 'message';
  message: {
    role: 'user' | 'assistant' | 'toolResult';
    content?: unknown;
    // toolResult-specific: link back to toolCall
    toolCallId?: string;       // ← matches assistant's toolCall.id
    toolName?: string;
    isError?: boolean;
  };
}

// Compaction entry
interface CompactionEntry extends BaseEntry {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string;    // entries before this are compressed
}

// Link toolResult to toolCall (findToolResultReference pattern)
function findToolCallLink(entry: MessageEntry): string | null {
  // Direct field
  const direct = entry.message.toolCallId;
  if (typeof direct === 'string' && direct.trim()) return direct;
  // Content block ID fallback
  const content = entry.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block?.id === 'string' && block.id.trim()) return block.id;
    }
  }
  return null;
}

// Build tool result map (toolCallId → result info)
function buildToolResultMap(entries: MessageEntry[]): Map<string, { isError: boolean; preview: string }> {
  const results = new Map<string, { isError: boolean; preview: string }>();
  for (const entry of entries) {
    if (entry.message.role !== 'toolResult') continue;
    const toolCallId = findToolCallLink(entry);
    if (toolCallId) {
      const preview = extractPreview(entry.message.content);
      results.set(toolCallId, { isError: entry.message.isError ?? false, preview });
    }
  }
  return results;
}

// Enrich tool calls with their results
function linkToolCalls(
  entries: MessageEntry[],
  results: Map<string, { isError: boolean; preview: string }>,
): void {
  for (const entry of entries) {
    if (entry.message.role !== 'assistant') continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'toolCall' && block.id) {
        const result = results.get(block.id);
        if (result) {
          block._resultStatus = result.isError ? 'error' : 'completed';
          block._resultPreview = result.preview;
        } else {
          block._resultStatus = 'running';
        }
      }
    }
  }
}

function extractPreview(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 200);
  return 'result';
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tree structure (parentId → reconstruct conversation tree) | ❌ Format contract (mọi writer phải tuân — break = parse fail) |
| ✅ Tool linking (toolCall.id ↔ toolResult — enrich calls with results) | ❌ toolCallId required (nếu thiếu → orphan result, không link) |
| ✅ Header root (entry[0] = root — clear session start) | ❌ Version migration (version field — format change cần migration) |
| ✅ Self-contained entries (mỗi entry = node, parse độc lập) | ❌ Entry type taxonomy (mỗi type cần handler riêng) |

## Khác các hướng gần

| | 425 PI Branch-Tree | PS: Session-Log-Entry-Scope |
|---|---|---|
| Cái gì | Build tree từ entries | **Formalize entry format spec** |
| Mục đích | Tree reconstruction | **Format contract + linking** |
| Header | Parse from data | **Spec: header = root** |
| Tool link | ❌ | ✅ toolCall.id ↔ toolResult |

## Khi nào chọn

- Session log cần formal format (entry structure contract — every writer must comply)
- Muốn tool linking (toolCall.id ↔ toolResult — enrich tool calls with status/preview)
- Muốn tree structure (parentId → reconstruct conversation graph)
- Nối 425 PI branch-tree (PS = format spec, PI = tree consumer) + 433 PQ branch-summary (PS = branch_summary entry type); guard format migration (version field — old format → new format needs migration path)
