# Hướng ACY: Wisdom Accumulation Notepad — Atlas extract learnings từ mỗi subagent response rồi pass forward cho MỌI subagent sau; notepad lưu learnings/decisions/issues/verification

> **Nguồn gốc:** oh-my-openagent (docs/guide/orchestration.md) | **Coupling:** 🟡 — thêm notepad layer vào orchestration | **Agent-agnostic:** ⚠️ (cần extraction model) | **Code sẵn:** ⚠️ (có memory + learning-graph — chưa có notepad pass-forward) | **Effort:** 2 tuần

## Nguồn gốc

**oh-my-openagent** để **Atlas (conductor) extract learnings từ mỗi subagent response** — phân loại thành **Conventions, Successes, Failures, Gotchas, Commands** — rồi **pass forward cho MỌI subagent sau** (không chỉ subagent kế tiếp). Notepad hệ thống **`.sisyphus/notepads/{plan-name}/`** lưu **learnings/decisions/issues/verification/problems** để **tích lũy learning xuyên task** — subagent 5 được hưởng bài học của subagent 1-4. Nguyên tắc: **kinh nghiệm không nằm trong đầu một agent, nó được ghi lại và truyền cho mọi agent sau** — cross-task accumulation.

## Mô tả

mya wisdom accumulation notepad: (1) **extract từ mỗi response** — Atlas đọc subagent output, rút `Conventions/Successes/Failures/Gotchas/Commands`; (2) **notepad store** — thư mục per plan: `learnings/`, `decisions/`, `issues/`, `verification/`, `problems/` (file-backed — packages/memory + file system); (3) **pass-forward** — mỗi subagent spawn kèm context notepad hiện tại (mọi learning trước đó); (4) **cross-task** — notepad theo plan-name — task sau trong cùng plan kế thừa; (5) **feedback loop** — verification ghi lại, lần sau tránh lỗi cũ. Nối memory learning-graph.ts (đã có) — ACY là notepad structured hơn.

## Kiến trúc

```
  SUBAGENT 1 response
       ▼
  ATLAS EXTRACT (conductor)
    Conventions · Successes · Failures · Gotchas · Commands
       ▼
  NOTEPAD (.sisyphus/notepads/{plan-name}/)
    learnings/ · decisions/ · issues/ · verification/ · problems/
       ▼
  PASS FORWARD — MỌI subagent sau nhận context notepad
    subagent 2, 3, 4, … (không chỉ kế tiếp)
       ▼
  CROSS-TASK — task sau trong plan kế thừa (tích lũy)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory learning-graph.ts — deriveLearningGraph (nền — learning từ facts)
// ✅ packages/memory roles.ts — ArchivistRole syncTurn (nền — extract từ turn)
// ✅ packages/memory brain.ts — Brain facts/takes/pages (nền — lưu learning)
// ✅ packages/memory dream-cycle.ts — consolidation (nền — gộp learning khi idle)
// ✅ packages/agent subagent — spawnSubagent (nền — pass context khi spawn)
// ✅ packages/core session-utils.ts — tree JSONL (nền — notepad persist)

// ❌ THIẾU: extract 5 nhóm (Conventions/Successes/Failures/Gotchas/Commands)
// ❌ THIẾU: notepad store per plan (learnings/decisions/issues/verification/problems)
// ❌ THIẾU: pass-forward cho MỌI subagent sau
```
## Implementation
```typescript
// packages/agent/src/notepad.ts (MỚI)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
export type LearningKind = "conventions" | "successes" | "failures" | "gotchas" | "commands";
export interface NotepadEntry {
  kind: LearningKind;
  text: string;
  sourceSubagentId: string;
}
/** Extract learnings từ một subagent response — phân loại 5 nhóm. */
export function extractLearnings(response: string, classify: (text: string) => LearningKind[]): NotepadEntry[] {
  const lines = response.split("\n").filter((l) => l.trim());
  return lines.map((text) => ({ text, sourceSubagentId: "", kind: classify(text)[0] ?? "gotchas" }));
}
/** Notepad store — file-backed per plan. */
export class Notepad {
  private readonly root: string;
  private entries: NotepadEntry[] = [];
  constructor(planName: string, baseDir: string) {
    this.root = join(baseDir, ".sisyphus", "notepads", planName);
  }
  /** Lưu entry vào đúng nhóm (learnings/decisions/issues/verification/problems). */
  record(kind: LearningKind | "decisions" | "issues" | "verification" | "problems", text: string, source = ""): void {
    mkdirSync(join(this.root, kind), { recursive: true });
    const file = join(this.root, kind, `${Date.now()}.md`);
    writeFileSync(file, `- ${text}\n${source ? `(source: ${source})\n` : ""}`, "utf8");
    this.entries.push({ kind: kind as LearningKind, text, sourceSubagentId: source });
  }
  /** Context block cho MỌI subagent spawn sau — pass-forward. */
  contextBlock(): string {
    if (this.entries.length === 0) return "";
    const byKind = new Map<string, string[]>();
    for (const e of this.entries) {
      const list = byKind.get(e.kind) ?? [];
      list.push(e.text);
      byKind.set(e.kind, list);
    }
    const lines = ["## Accumulated learnings (notepad — từ các subagent trước)"];
    for (const [kind, items] of byKind) lines.push(`### ${kind}`, ...items.map((t) => `- ${t}`));
    return lines.join("\n");
  }
  /** Load notepad hiện có — cross-task kế thừa. */
  load(): void {
    if (!existsSync(this.root)) return;
    for (const group of ["learnings", "decisions", "issues", "verification", "problems"]) {
      const dir = join(this.root, group);
      if (!existsSync(dir)) continue;
      for (const f of readdirSafe(dir)) {
        const text = readFileSync(join(dir, f), "utf8").trim();
        if (text) this.entries.push({ kind: group as LearningKind, text, sourceSubagentId: "" });
      }
    }
  }
}

function readdirSafe(dir: string): string[] {
  try { return require("node:fs").readdirSync(dir); } catch { return []; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Learning tích lũy xuyên task — không bắt đầu lại từ đầu | ❌ Context block phình theo số learning — cần tỉa |
| ✅ Pass-forward mọi subagent — bài học lan nhanh | ❌ Extraction phụ thuộc model phân loại đúng |
| ✅ Notepad file-backed — persist + audit được | ❌ Nhiều notepad (per plan) — cần quản lý lifecycle |
| ✅ 5 nhóm + decisions/issues/verification — có cấu trúc | ❌ Learning cũ có thể stale — cần đánh dấu thời gian |

## Khác các hướng gần

| | Learning graph (memory/learning-graph.ts) | ACY: Notepad |
|---|---|---|
| Cấu trúc | Graph (nodes/edges) | **Nhóm văn bản (5 kind + 5 nhóm)** |
| Mục đích | Derive quan hệ khái niệm | **Tích lũy + pass-forward thực dụng** |
| Dùng cho | Memory tổng | **Orchestration subagent (cùng plan)** |
| Persist | Brain facts | **.sisyphus/notepads/{plan-name}/** |

## Khi nào chọn

- Orchestration nhiều subagent — muốn subagent sau học từ subagent trước
- Task lặp lại theo plan — tích lũy learning xuyên task
- Đã có memory + learning-graph + subagent — thêm notepad layer
- Guard: context block có tỉa, learning có timestamp, pass-forward mọi subagent
