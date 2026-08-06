# Hướng AHP: Two-Level-UI-Collapse — UI subagent hai cấp bật/tắt bằng `ctrl+o`: collapsed (1 dòng preview 60 ký tự + tool log + context-window gauge) và expanded (full task body đang stream + full final output); subagent con render inline thụt lề dưới row đã dispatch

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟡 — TUI rendering | **Agent-agnostic:** ❌ (TUI-specific) | **Code sẵn:** ❌ | **Effort:** 2 tuần

## Nguồn gốc

**pi-subagents** UI subagent có **hai cấp** bật/tắt bằng `ctrl+o`: **collapsed** hiển thị một dòng preview 60 ký tự + tool log + context-window gauge; **expanded** hiển thị full task body đang stream và full final output. Subagent con render **inline, thụt lề** dưới row đã dispatch chúng (visual tree). Nguyên tắc: **progressive disclosure** — collapsed cho overview (nhiều subagent song song), expanded cho detail; **context-window gauge** luôn nhìn thấy (cảnh báo sắp đầy); **tree rendering** — quan hệ parent↔child hiển thị bằng indentation.

## Mô tả

Với mya, pattern = **TUI subagent viewer 2 cấp**: (1) mya chưa có subagent TUI viewer riêng (packages/agent là headless — handle + output text); (2) AHP thêm **rendering layer**: mỗi subagent là một row có toggle state; (3) **collapsed row**: `<spinner> <goal:60chars>… <ctx:42%> <tools:3>` — 1 dòng; (4) **expanded**: full streaming task body + final output; (5) **context-window gauge** color-coded (nối AHZ); (6) **tree indentation** — subagent con thụt lề dưới row parent; (7) subscribe pool events (pool.ts AgentSessionEntry + subscribe) để update row real-time.

## Kiến trúc (ASCII)

```
  ctrl+o toggle per row
  ┌─────────────────────────────────────────────────────────┐
  │ ⠙ review code…        ctx:42% 🟢  tools:2  [collapsed]  │ ← 1 dòng preview
  │   └─ ⠹ scout: read X… ctx:18% 🟢  tools:1  [child]      │ ← thụt lề (con)
  │ ⠼ refactor api…       ctx:85% 🔴  tools:5  [collapsed]  │
  └─────────────────────────────────────────────────────────┘
       ▼ ctrl+o trên row 1
  ┌─────────────────────────────────────────────────────────┐
  │ ⠙ review code…        ctx:42% 🟢  tools:2  [EXPANDED]   │
  │ │ "Phân tích module auth, tìm bug..."  (full task body) │
  │ │ read src/auth.ts ✓                                    │
  │ │ grep "token" ✓                                        │
  │ │ <streaming output...>                                 │
  │   └─ ⠹ scout: read X… ctx:18% 🟢  tools:1  [child]      │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — AgentSessionEntry { sessionId, session, busy,
//   lastActivity, messageCount }; AgentSession.subscribe(listener) (event feed)
// ✅ packages/agent — spawnSubagent handle { id, status, goal, output }
// ✅ packages/agent — killSubagent (action từ UI)
// ✅ natives/print — ink/TUI rendering foundation

// ❌ THIẾU: subagent viewer component (collapsed/expanded rows)
// ❌ THIẾU: context-window gauge (cần token count từ stream events)
// ❌ THIẾU: tree indentation rendering (parent↔child visual)
```

## Implementation

```tsx
// packages/print/src/subagent-viewer.tsx (NEW — ink component)
import { useState } from "react";
import type { AgentSessionEntry } from "@my-agent/agent";

interface RowProps { entry: AgentSessionEntry; depth: number; gauge: number; }

function SubagentRow({ entry, depth, gauge }: RowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const indent = "  ".repeat(depth);
  const preview = entry.goal?.slice(0, 60).padEnd(60) ?? "";
  const ctxColor = gauge < 70 ? "🟢" : gauge < 85 ? "🟡" : "🔴";
  return (
    <Box flexDirection="column">
      <Text onClick={() => setExpanded(!expanded)}>
        {indent}⠙ {preview} ctx:{gauge}%{ctxColor} [{expanded ? "EXPANDED" : "collapsed"}]
      </Text>
      {expanded && (
        <Box marginLeft={depth * 2 + 2}>
          <Text color="gray">{entry.output}</Text>
        </Box>
      )}
    </Box>
  );
}
// Viewer subscribe pool events → re-render rows; ctrl+o handler toggle row.
// gauge = tokenCount / modelCtxWindow (lấy từ stream done.usage + model config).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Progressive disclosure — overview + detail | ❌ TUI-specific (không agent-agnostic) |
| ✅ Context-window gauge cảnh báo sắp đầy | ❌ Phức tạp rendering (tree + toggle + stream) |
| ✅ Tree visual — quan hệ parent↔child rõ | ❌ Cần token count real-time (overhead) |
| ✅ Nhiều subagent song song nhìn được cùng lúc | ❌ Terminal width giới hạn preview |

## Khác các hướng gần

| | AHP Two-Level-UI-Collapse | AHZ Live-Widget-Fleetview | AIA Group-Join-Consolidated-Notify |
|---|---|---|---|
| Trọng tâm | UI viewer 2 cấp | Persistent widget + FleetView | Notify gộp nhóm |
| Cơ chế | Toggle + tree indentation | Spinner + gauge + composer | Batch 30s + straggler |
| Quan hệ | Rendering chi tiết | Rendering tổng quan (widget) | Notify (không render) |

## Khi nào chọn

- Có nhiều subagent chạy song song cần theo dõi trong TUI
- Muốn progressive disclosure — collapsed overview, expanded detail
- Cảnh báo context-window sắp đầy (gauge color)
- Guard: tree indentation đúng quan hệ, gauge từ token count thật, terminal-width safe, toggle không block stream
