# Hướng VR: Resumable Dual Session Files — .auto/ 2 file: log.jsonl append-only đầy đủ + prompt.md live-doc; agent no-memory tiếp tục được chỉ nhờ 2 file

> **Nguồn gốc:** pi-autoresearch (resumable dual session files); "log.jsonl append-only full history"; "prompt.md live-document instructions"; "agent with no memory resumes from 2 files alone"; "externalized state, not in-memory" | **Coupling:** 🟢 — thêm dual-file session persistence vào agent resume | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session + log sẵn — chưa có dual-file resume contract) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-autoresearch** giải bài toán **resume** bằng cách **externalize toàn bộ state ra 2 file** trong `.auto/`: (1) **`log.jsonl`** — append-only, ghi đầy đủ mọi experiment/action/decision theo thời gian (source of truth). (2) **`prompt.md`** — live-document, chứa mục tiêu + hướng dẫn + quy tắc hiện tại (agent đọc mỗi turn). Triết lý: agent **không giữ state trong memory** — mọi thứ nằm trên đĩa. Khi session bị kill / compaction / restart, agent **stateless** chỉ cần đọc lại 2 file này để tiếp tục chính xác chỗ dừng. Khách rely-on-memory (context window) — VR **rely-on-disk**; khác full checkpoint blob — VR **2 file tối giản**.

## Mô tả

mya resumable dual session files: (1) **`.auto/log.jsonl`**: append-only, mỗi dòng 1 event (experiment, metric, decision) — đọc đuôi để biết progress gần nhất. (2) **`.auto/prompt.md`**: live-doc, mục tiêu + rule + progress summary — agent đọc đầu mỗi turn (không tin memory). (3) **Resume protocol**: agent mới (no memory) → đọc prompt.md + tail log.jsonl → biết phải làm gì + đã đến đâu. (4) **Live update**: prompt.md cập nhật khi mục tiêu/rule thay đổi; log.jsonl chỉ append (không sửa/xóa). mya có session + log — VR thêm **dual-file resume contract** + **prompt.md live-doc**.

## Kiến trúc

```
  .auto/ (externalized state — agent no-memory)
  ┌─ prompt.md (live-document, mutable) ─────────────────────┐
  │  # Goal: improve benchmark by 10%                         │
  │  # Rules: keep if better, revert if worse                 │
  │  # Progress: baseline 120ms, current 108ms                │
  └───────────────────────────────────────────────────────────┘
  ┌─ log.jsonl (append-only, immutable history) ──────────────┐
  │  {"ts":1,"sha":"abc","metric":120,"decision":"baseline"}  │
  │  {"ts":2,"sha":"def","metric":115,"decision":"keep"}      │
  │  {"ts":3,"sha":"ghi","metric":118,"decision":"revert"}    │
  │  {"ts":4,"sha":"jkl","metric":108,"decision":"keep"}      │
  └───────────────────────────────────────────────────────────┘

  RESUME (session killed / compaction):
  ┌─── NEW AGENT (no memory) ─────────────────────────────────┐
  │  1. read .auto/prompt.md → biết goal + rules + progress    │
  │  2. tail .auto/log.jsonl → biết decision gần nhất (108ms)  │
  │  3. tiếp tục từ đó → edit → commit → bench → ...           │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core session.ts — session persistence (nền — VR file = session surface)
// ✅ packages/core spill.ts — context spill (nền — VR log.jsonl relate)
// ✅ packages/memory brain-store.ts — durable store (nền — VR externalized)
// ✅ packages/agent sdk.ts — agent SDK (nền — VR resume ở đây)

// ❌ THIẾU: dual-file resume contract (prompt.md + log.jsonl)
// ❌ THIẾU: prompt.md live-doc (read mỗi turn, mutable goal/rules)
// ❌ THIẾU: log.jsonl append-only reader (tail cho resume)
// ❌ THIẾU: resume protocol (read 2 file → reconstruct state)
```

## Implementation

```typescript
// packages/agent/src/dual-session-files.ts (MỚI)
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';

interface LogEntry { ts: number; sha: string; metric: number; decision: string; description: string }

class DualSessionFiles {
  constructor(
    private dir: string,                    // .auto/
    private logPath = '.auto/log.jsonl',
    private promptPath = '.auto/prompt.md',
  ) {}

  // READ: agent (no memory) resume — đọc 2 file
  resume(): { goal: string; rules: string[]; lastEntry: LogEntry | null } {
    const prompt = existsSync(this.promptPath) ? readFileSync(this.promptPath, 'utf8') : '';
    const log = existsSync(this.logPath) ? readFileSync(this.logPath, 'utf8').trim().split('\n') : [];
    const lastLine = log[log.length - 1];
    const lastEntry = lastLine ? JSON.parse(lastLine) as LogEntry : null;
    const goal = this.extractSection(prompt, 'Goal');
    const rules = this.extractSection(prompt, 'Rules').split('\n').filter(Boolean);
    return { goal, rules, lastEntry };
  }

  // WRITE: append log (append-only, không sửa/xóa)
  appendLog(entry: LogEntry): void {
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
  }

  // WRITE: update prompt.md (live-doc, mutable — goal/rules/progress)
  updatePrompt(goal: string, rules: string[], progress: string): void {
    const content = `# Goal: ${goal}\n# Rules:\n${rules.map(r => `- ${r}`).join('\n')}\n# Progress: ${progress}\n`;
    writeFileSync(this.promptPath, content);
  }

  private extractSection(md: string, section: string): string {
    const re = new RegExp(`# ${section}:?\\s*(.+?)(?=\\n# |$)`, 's');
    const m = md.match(re);
    return m ? m[1].trim() : '';
  }
}

// Usage:
// const files = new DualSessionFiles('.auto');
// const state = files.resume();  // agent no-memory → biết phải làm gì
// files.appendLog({ts:5, sha:'mno', metric:105, decision:'keep', description:'cache'});
// files.updatePrompt('improve 10%', [...], 'baseline 120ms, current 105ms');
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Stateless resume (agent no-memory tiếp tục từ 2 file) | ❌ File coupling (hỏng 1 file → resume fail) |
| ✅ Full history (log.jsonl append-only, không mất) | ❌ I/O mỗi turn (đọc prompt.md + append log) |
| ✅ Live instructions (prompt.md cập nhật linh hoạt) | ❌ File bloat (log.jsonl phình theo thời gian) |
| ✅ Tối giản (chỉ 2 file, không blob phức tạp) | ❌ No concurrent write guard (2 agent ghi đè) |

## Khác các hướng gần

| | In-memory state | Full checkpoint | VR: Dual-Session-Files |
|---|---|---|---|
| Resume | ❌ (mất memory) | Blob lớn | **✅ 2 file (prompt + log)** |
| History | Context window | Snapshot | **log.jsonl append-only** |
| Instructions | System prompt cứng | Embedded | **prompt.md live-doc** |

## Khi nào chọn

- Agent cần resume stateless (kill/compaction/restart → tiếp tục chính xác)
- Muốn externalize state ra đĩa (không tin context window)
- Cần instructions sống (mục tiêu/rule thay đổi runtime)
- Nối packages/core session.ts + spill.ts + packages/memory brain-store.ts; guard file-integrity (backup/recover nếu corrupt), write-concurrency (lock khi nhiều agent ghi), và log-rotation (truncate log.jsonl khi phình — giữ prompt.md làm summary); VR = resumable dual session files, kết hợp 591 VS compaction-rehydration (sau compaction đọc lại 2 file) + 589 VQ autonomous-experiment-loop (log.jsonl nguồn sự thật cho experiment)
