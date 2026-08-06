# Hướng PF: Deterministic Context Compactor — nén deterministic: giữ bucket lớn, ghép cặp, sổ vết tái sinh

> **Nguồn gốc:** pi-vcc (summarize.ts, rank.ts, build-sections.ts, compact-args.ts); "deterministic compaction"; "section-merge compaction"; "regeneration-safe summarization"; "ranked block selection"
> **Coupling:** 🟢 — thay/đắp context compaction layer bằng deterministic rank+merge
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (summarize + rank + merge sẵn trong pi-vcc — chưa port vào mya core compaction)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**pi-vcc** (`summarize.ts`, `rank.ts`) nén context hội thoại theo nguyên tắc **deterministic** — không phải LLM summarize mù quáng. (1) **Normalize** messages thành blocks (user/assistant/tool_call/tool_result/bash). (2) **Rank** mỗi block theo score: edit-tool (+34), test-command (+26), user-turn (+18), recency, adjacency boost (block gần edit/test quan trọng được +bonus). (3) **Select** theo budget: giữ `preserveRecentBlocks` (mới nhất) + fill theo score đến `maxBlocks`/`maxBriefChars`. (4) **Merge** với summary cũ: header sections (Session Goal, Files And Changes, Commits…) merge deterministic (dedup path, merge category), brief transcript ghép cặp. (5) **Regeneration trace**: mỗi compaction ghi RECALL_NOTE — biết block nào bị bỏ, tái sinh được. Nguyên tắc: **nén không mất thông tin quan trọng** — edit/test/user-turn giữ, scaffolding/tool-result dài bỏ. Khác **100 prompt-compression** (LLM compress chung) — PF là **ranked + section-merge deterministic**.

## Mô tả

mya deterministic context compactor: khi context vượt budget → **compaction pipeline** deterministic: (1) **Normalize**: messages → blocks (user, assistant, tool_call, tool_result, bash). (2) **Rank**: score mỗi block (edit +34, test +26, user +18, recency ×index, adjacency boost, trivial-bash penalty). (3) **Select**: giữ N mới nhất (preserveRecent) + fill theo score đến maxBlocks/maxBriefChars (size-relative budget — transcript lớn hơn = budget lớn hơn, nhưng có ceiling). (4) **Merge với summary cũ**: header sections merge (Files And Changes: dedup path, merge Modified/Created/Read; Session Goal: line-dedup cap 8; Outstanding Context: fresh only); brief transcript ghép cặp với budget. (5) **Trace**: RECALL_NOTE ghi sổ vết — tái sinh block bị bỏ nếu cần. Kết quả: **deterministic** (cùng input → cùng output, không LLM), **information-preserving** (edit/test/user ưu tiên), **merge-safe** (compaction lần N merge với lần N-1). mya có compaction layer — PF thay bằng **ranked block selection + section-merge**.

## Kiến trúc

```
  CONVERSATION (messages → context budget exceeded)
        │
        ▼
  ┌─── NORMALIZE ──────────────────────────────────┐
  │  messages → blocks:                             │
  │    [user] [assistant] [tool_call:edit]          │
  │    [tool_result] [bash:test] [assistant] ...    │
  └───────────────────────┬─────────────────────────┘
                          │
                          ▼
  ┌─── RANK (scoreBlock) ──────────────────────────┐
  │                                                  │
  │  edit-tool:      +34 ████████████████████        │
  │  test-command:   +26 ████████████████            │
  │  user-turn:      +18 ████████████                │
  │  nonzero-exit:   +24 ███████████████             │
  │  recency:        +0..12 ████ (index/total × 12)  │
  │  adjacency:      +5..10 (near edit/test)         │
  │  trivial-bash:   -16 ███ (penalty)               │
  │  long-tool-result: -8 ██ (penalty)               │
  │                                                  │
  │  → each block gets deterministic score           │
  └───────────────────────┬──────────────────────────┘
                          │
                          ▼
  ┌─── SELECT (budget-aware) ──────────────────────┐
  │                                                  │
  │  1. Keep newest preserveRecentBlocks (16)        │
  │  2. Fill by score until maxBlocks (80) /          │
  │     maxBriefChars (size-relative, capped)         │
  │  3. Dedup (same bash command → keep 1)            │
  │  → selected blocks (information-preserving)       │
  └───────────────────────┬──────────────────────────┘
                          │
                          ▼
  ┌─── MERGE (with previous summary) ──────────────┐
  │                                                  │
  │  Header sections (deterministic merge):          │
  │    [Session Goal]     line-dedup, cap 8          │
  │    [Files And Changes] dedup path, merge cat.    │
  │    [Commits]          line-dedup, cap 8          │
  │    [Outstanding Context] fresh only (volatile)   │
  │    [User Preferences] line-dedup, cap 15         │
  │  Brief transcript: ghép cặp (prev tail + fresh)  │
  │  + RECALL_NOTE (regeneration trace)              │
  └───────────────────────┬──────────────────────────┘
                          │
                          ▼
  COMPACTED CONTEXT (deterministic, merge-safe, traceable)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ compaction layer (packages/core) — context compaction (nền — PF = deterministic replacement)
// ✅ 100 prompt-compression — compress (nền — PF = ranked + section-merge)
// ✅ pi-vcc summarize + rank + build-sections (source/ — reference implementation)

// ❌ THIẾU: ranked block selection (scoreBlock + selectRankedBriefBlocks)
// ❌ THIẾU: section-merge compaction (mergeHeaderSection per section type)
// ❌ THIẾU: size-relative budget (floor + slope + ceiling — transcript lớn = budget lớn)
// ❌ THIẾU: regeneration trace (RECALL_NOTE — tái sinh block bị bỏ)
```

## Implementation

```typescript
// packages/agent/src/deterministic-compactor.ts (MỚI — port từ pi-vcc)
interface NormalizedBlock {
  kind: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'bash';
  text: string;
  name?: string;        // tool name
  args?: Record<string, unknown>;
  command?: string;     // bash command
  exitCode?: number | null;
}

interface RankedBlock {
  block: NormalizedBlock;
  index: number;
  score: number;
  reasons: string[];
}

const EDIT_TOOL_RE = /^(edit|write|multiedit|apply_patch)$/i;
const TEST_CMD_RE = /\b(?:npm|bun|cargo|pytest|go)\b.*(?:test|spec|check)/i;

function scoreBlock(block: NormalizedBlock, index: number, total: number): RankedBlock {
  const r: RankedBlock = { block, index, score: 0, reasons: [] };
  const add = (pts: number, reason: string) => { r.score += pts; r.reasons.push(reason); };

  // Recency: newer = higher (0..12)
  add(Math.round((index / Math.max(1, total - 1)) * 12), 'recency');

  if (block.kind === 'user') add(18, 'user-turn');
  if (block.kind === 'assistant') add(10, 'assistant-context');

  if (block.kind === 'tool_call') {
    if (EDIT_TOOL_RE.test(block.name ?? '')) add(34, 'edit-tool');
    else if (block.command && TEST_CMD_RE.test(block.command)) add(26, 'test-command');
    else add(12, 'tool-call');
  }

  if (block.kind === 'bash') {
    add(8, 'bash');
    if (block.exitCode != null && block.exitCode !== 0) add(24, 'nonzero-exit');
    if (TEST_CMD_RE.test(block.command ?? '')) add(22, 'test-command');
  }

  return r;
}

function selectRanked(blocks: NormalizedBlock[], maxBlocks = 80, preserveRecent = 16): NormalizedBlock[] {
  if (blocks.length <= maxBlocks) return blocks;
  const ranked = blocks.map((b, i) => scoreBlock(b, i, blocks.length));
  const selected = new Set<number>();

  // 1. Keep newest N blocks (local continuity)
  for (let i = blocks.length - 1; i >= Math.max(0, blocks.length - preserveRecent); i--) {
    if (blocks[i].kind !== 'tool_result') selected.add(i);
  }
  // 2. Fill by score
  const byScore = [...ranked].sort((a, b) => b.score - a.score);
  for (const item of byScore) {
    if (selected.size >= maxBlocks) break;
    if (item.block.kind === 'tool_result') continue;
    selected.add(item.index);
  }
  return [...selected].sort((a, b) => a - b).map((i) => blocks[i]);
}

// Merge with previous summary (section-level deterministic merge)
function mergeSection(header: string, prev: string, fresh: string): string {
  if (header === 'Outstanding Context') return fresh; // volatile — fresh only
  if (!prev) return fresh;
  // Line-level dedup + cap
  const lines = [...new Set([...prev.split('\n'), ...fresh.split('\n')])];
  return `[${header}]\n${lines.slice(-15).join('\n')}`;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic (cùng input → cùng output, không LLM cost) | ❌ Không semantic (không hiểu "ý nghĩa" — chỉ rank theo pattern) |
| ✅ Information-preserving (edit/test/user ưu tiên) | ❌ Rank heuristic (có thể miss block quan trọng không match pattern) |
| ✅ Merge-safe (compaction N merge N-1 — không stack) | ❌ Budget tuning (maxBlocks/maxBriefChars — domain-dependent) |
| ✅ Regeneration trace (RECALL_NOTE — tái sinh block bị bỏ) | ❌ Section-merge phức tạp (Files And Changes dedup path phức tạp) |

## Khác các hướng gần

| | 100 Prompt-Compression | PF: Deterministic-Compactor |
|---|---|---|
| Phương pháp | LLM compress | **Ranked block + section-merge** |
| Deterministic | ❌ (LLM output biến thiên) | ✅ (cùng input → cùng output) |
| Merge-safe | ❌ (re-compress mất thông tin) | ✅ (section-level merge) |
| Regeneration | ❌ | ✅ (RECALL_NOTE trace) |

## Khi nào chọn

- Context compaction cần deterministic (reproducible, testable — không LLM variance)
- Muốn information-preserving (edit/test/user ưu tiên, scaffolding bỏ)
- Muốn merge-safe (compaction lần N merge N-1 — không stack/truncate)
- Nối 100 prompt-compression (PF = deterministic alternative khi LLM compress quá biến thiên) + pi-vcc rank (reference impl); guard rank heuristic miss (block quan trọng không match pattern → thêm rule hoặc fallback LLM)
