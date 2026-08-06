# Hướng PQ: Agent Branch Summarization Backfill — chuyển nhánh: thu entries sửa/đọc, sinh branch_summary

> **Nguồn gốc:** pi (session branch_summary entry type, compaction firstKeptEntryId); pi-session-manager (inspect.ts — branch_summary parsing, trace.ts events); pi-vcc (summarize.ts — section-merge, Files And Changes); "branch summarization backfill"; "conversation fork summarization"; "branch context carryover"
> **Coupling:** 🟢 — thêm branch_summary generation vào session branch/fork logic
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (branch_summary entry type + pi-vcc summarize sẵn — chưa có auto-backfill trong mya)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**pi** session format có entry type **`branch_summary`** — khi user rẽ nhánh (fork conversation), nhánh cũ được **tóm tắt** thành branch_summary entry: chứa `summary` (text tóm tắt hoạt động nhánh cũ), đánh dấu điểm fork. `pi-session-manager/inspect.ts` parse branch_summary → extract summary text. `pi-vcc/summarize.ts` xây section-merge (Files And Changes: modified/created/read, Session Goal, Commits, Outstanding Context) — deterministic summarize. Nguyên tắc **backfill**: khi rẽ nhánh → (1) **thu thập** entries sửa/đọc từ nhánh cũ (edit, write, read, bash commands). (2) **Sinh branch_summary** deterministic (section-merge: Files Modified, Files Created, Files Read, Commands Run). (3) **Ghim** branch_summary vào điểm fork — nhánh mới bắt đầu sau summary. Agent chuyển nhánh mà **không mất context** — nhánh mới biết nhánh cũ đã làm gì (qua summary). Khác **422 PF deterministic-compactor** (nén context hiện tại) — PQ là **summarize nhánh cũ khi fork**.

## Mô tả

mya agent branch summarization backfill: khi user rẽ nhánh → **backfill branch_summary** — (1) **Detect fork**: user tạo nhánh mới (branch from current position). (2) **Collect entries**: từ fork point backwards, thu entries sửa/đọc (edit/write/read/bash) của nhánh sắp rời. (3) **Generate summary**: deterministic section-merge (Files Modified, Files Created, Files Read, Commands Run, Session Goal) — không LLM. (4) **Write branch_summary**: entry type `branch_summary` với summary text, parentId = fork point. (5) **New branch starts**: nhánh mới bắt đầu sau branch_summary — mang theo context tóm tắt. Agent chuyển nhánh mà **không mất context** — nhánh mới đọc branch_summary biết nhánh cũ đã làm gì. mya có branch logic — PQ thêm **auto-backfill** (collect + summarize + write branch_summary on fork).

## Kiến trúc

```
  BEFORE FORK (single branch):
  root → m1 → m2 → m3(edit file X) → m4(read file Y) → m5(bash: npm test) → [HERE]

  USER FORKS: "thử cách khác" (branch from current position)
        │
        ▼
  ┌─── BACKFILL BRANCH SUMMARY ─────────────────────────┐
  │                                                       │
  │  1. COLLECT entries (fork point backwards):            │
  │     m3: edit file X                                    │
  │     m4: read file Y                                    │
  │     m5: bash: npm test                                 │
  │                                                       │
  │  2. GENERATE summary (deterministic section-merge):    │
  │     [Files And Changes]                                │
  │     - Modified: file X                                 │
  │     - Read: file Y                                     │
  │     [Commands Run]                                     │
  │     - npm test (passed)                                │
  │     [Session Goal]                                     │
  │     - implement feature Z                              │
  │                                                       │
  │  3. WRITE branch_summary entry:                        │
  │     { type: "branch_summary",                          │
  │       parentId: "m5",  ← fork point                    │
  │       summary: "[Files And Changes]\n- Modified:..."   │
  │     }                                                  │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  AFTER FORK (two branches):
  root → m1 → m2 → m3 → m4 → m5 → [branch_summary] ──→ m6(new branch start)
                                                   │
                                                   └──→ old branch continues

  NEW BRANCH reads branch_summary → knows what old branch did
  (no context loss on fork)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session branch/fork logic (packages/core) — branch creation (nền — PQ = auto-backfill)
// ✅ 422 PF deterministic-compactor — section-merge summarize (nền — PQ = apply on fork)
// ✅ 425 PI branch-tree-reconstruction — tree building (nền — PQ = write branch_summary node)
// ✅ pi-session-manager branch_summary parsing (source/ — reference impl)

// ❌ THIẾU: fork detection (user creates new branch → trigger backfill)
// ❌ THIẾU: entry collection (collect edit/write/read/bash from fork point)
// ❌ THIẾU: branch_summary generation (deterministic section-merge)
// ❌ THIẾU: branch_summary write (entry type, parentId = fork point)
```

## Implementation

```typescript
// packages/agent/src/branch-summarization.ts (MỚI)
import { compileRanked } from './deterministic-compactor'; // 422 PF

interface SessionEntry {
  id: string;
  parentId?: string;
  type: 'header' | 'message' | 'compaction' | 'branch_summary' | 'custom';
  timestamp: string;
  message?: { role: string; content: unknown };
}

// Collect entries from fork point backwards (until previous branch_summary or root)
function collectBranchEntries(entries: SessionEntry[], forkPointId: string): SessionEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const collected: SessionEntry[] = [];
  let current = byId.get(forkPointId);
  while (current) {
    if (current.type === 'branch_summary' || current.type === 'header') break; // stop at previous fork/root
    collected.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return collected;
}

// Extract file operations from entries (for Files And Changes section)
function extractFileOps(entries: SessionEntry[]): { modified: string[]; created: string[]; read: string[] } {
  const modified = new Set<string>();
  const created = new Set<string>();
  const read = new Set<string>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'toolCall') {
        const name = block.name?.toLowerCase();
        const path = block.arguments?.path;
        if (typeof path === 'string') {
          if (name === 'edit' || name === 'multiedit') modified.add(path);
          else if (name === 'write') created.add(path);
          else if (name === 'read') read.add(path);
        }
      }
    }
  }
  return {
    modified: [...modified], created: [...created], read: [...read],
  };
}

// Generate branch_summary (deterministic, no LLM)
function generateBranchSummary(entries: SessionEntry[], forkPointId: string): string {
  const branchEntries = collectBranchEntries(entries, forkPointId);
  const ops = extractFileOps(branchEntries);

  const lines: string[] = ['[Files And Changes]'];
  if (ops.modified.length > 0) lines.push(`- Modified: ${ops.modified.join(', ')}`);
  if (ops.created.length > 0) lines.push(`- Created: ${ops.created.join(', ')}`);
  if (ops.read.length > 0) lines.push(`- Read: ${ops.read.join(', ')}`);
  // Could also extract: Commands Run, Session Goal, etc.

  return lines.join('\n');
}

// Backfill: on fork, generate + write branch_summary
function backfillBranchSummary(
  entries: SessionEntry[],
  forkPointId: string,
): SessionEntry {
  const summary = generateBranchSummary(entries, forkPointId);
  return {
    id: `branch_summary_${Date.now()}`,
    parentId: forkPointId,
    type: 'branch_summary',
    timestamp: new Date().toISOString(),
    // Store summary in a way that inspect.ts can parse
  } as SessionEntry;
}

// Usage:
// // User forks conversation at entry "m5"
// const summary = backfillBranchSummary(entries, 'm5');
// entries.push(summary); // branch_summary at fork point
// // New branch starts after summary — reads it for context carryover
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No context loss on fork (nhánh mới biết nhánh cũ làm gì) | ❌ Summary overhead (generate on every fork) |
| ✅ Deterministic (section-merge — không LLM cost) | ❌ Information loss (summary ≠ full entries — chi tiết mất) |
| ✅ Files tracking (Modified/Created/Read — biết file nào touched) | ❌ Backfill scope (fork point → root: có thể rất dài) |
| ✅ Branch inspection (xem branch_summary → biết nhánh cũ) | ❌ Stale summary (nhánh cũ tiếp tục → summary không update) |

## Khác các hướng gần

| | 422 PF Deterministic-Compactor | 425 PI Branch-Tree-Reconstruction | PQ: Branch-Summary-Backfill |
|---|---|---|---|
| Cái gì | Nén context hiện tại | Build cây từ JSONL | **Summarize nhánh cũ khi fork** |
| Khi | Context quá budget | Load session | **On fork/branch** |
| Output | Compacted context | Tree structure | **branch_summary entry** |
| Trigger | Token budget | Manual/view | **Fork event** |

## Khi nào chọn

- Session có branch/fork (user rẽ nhánh — cần context carryover)
- Muốn no context loss (nhánh mới biết nhánh cũ)
- Muốn deterministic summary (section-merge — không LLM)
- Nối 422 PF deterministic-compactor (PQ = apply section-merge on fork) + 425 PI branch-tree (PQ = write branch_summary node in tree); guard stale summary (nhánh cũ tiếp tục sau fork → summary chỉ snapshot tại fork point)
