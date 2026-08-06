# Hướng ZL: Compaction Survival Notes — format note chuẩn COMPLETED / IN PROGRESS / NEXT / KEY DECISIONS ghi vào persistent store sau mỗi milestone — 4 câu trả lời agent cần khi resume
> **Nguồn gốc:** beads (RESUMABILITY.md qua research.md) | **Coupling:** 🟡 — note format + persistent write sau milestone | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (prompts/compress + core/session-branch — chưa có 4-section resume note) | **Effort:** 1-2 tuần

## Nguồn gốc

**beads** đối mặt: agent chạy dài, **compaction / session restart / handoff** làm mất ngữ cảnh — resume tốn token, sai hướng. Giải pháp: sau **mỗi milestone**, ghi **resume note** với **format chuẩn 4 phần** vào **persistent store**: (1) **COMPLETED** — đã làm gì (đủ để không làm lại); (2) **IN PROGRESS** — đang dở đâu (đủ để tiếp tục); (3) **NEXT** — bước kế tiếp là gì; (4) **KEY DECISIONS** — quyết định quan trọng + lý do (đủ để không đảo quyết định). Khi resume, agent chỉ cần đọc note → **4 câu trả lời** để nối lại công việc mà không cần replay toàn bộ history. Nguyên tắc: **resume bằng note chuẩn, không replay history**.

## Mô tả

mya compaction survival notes: (1) **4-section schema** — COMPLETED / IN PROGRESS / NEXT / KEY DECISIONS (mỗi phần list ngắn). (2) **Milestone trigger** — sau mỗi milestone (phase xong, task xong, compaction) ghi note vào persistent store (sqlite/jsonl). (3) **Resume read** — sau restart/compaction, đọc note mới nhất → nối lại. (4) **Append-only** — note cũ giữ (audit), note mới thêm. mya có prompts/compress.ts (compaction) + memory/sqlite-store.ts + core/session.ts — ZL thêm **note schema** + **milestone writer** + **resume reader**.

## Kiến trúc

```
  MILESTONE (phase xong / compaction)
  ┌─────────────────────────────────────────────────┐
  │  ghi RESUME NOTE (persistent store)               │
  │  ┌────────────────────────────────────────────┐  │
  │  │ COMPLETED:     [list ngắn đã xong]          │  │
  │  │ IN PROGRESS:   [đang dở đâu]                │  │
  │  │ NEXT:          [bước kế tiếp]               │  │
  │  │ KEY DECISIONS: [quyết định + lý do]         │  │
  │  └────────────────────────────────────────────┘  │
  └────────────────────┬────────────────────────────┘
                       ▼ (compaction / restart / handoff)
  ┌─── RESUME ──────────────────────────────────────┐
  │  đọc note mới nhất → 4 câu trả lời               │
  │  "đã xong gì, đang dở đâu, làm gì tiếp,           │
  │   quyết định nào không được đảo"                  │
  │  → nối lại KHÔNG replay history                  │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts compress.ts — compaction + summary (nền — ZL trigger)
// ✅ packages/core session-branch.ts — findCompressionTip (nền — ZL nơi ghi note)
// ✅ packages/memory sqlite-store.ts — persistent store (nền — ZL note store)
// ✅ packages/memory brain-store.ts — memory store (nền — ZL lưu note)
// ✅ packages/core session.ts — createSession (nền — ZL gắn note vào session)

// ❌ THIẾU: 4-section resume note schema (COMPLETED/IN PROGRESS/NEXT/KEY DECISIONS)
// ❌ THIẾU: milestone writer (ghi sau milestone/compaction)
// ❌ THIẾU: resume reader (đọc note → nối lại)
```

## Implementation

```typescript
// packages/core/src/resume-note.ts (MỚI)

interface ResumeNote {
  id: string;
  createdAt: number;
  milestone: string;                 // phase/task/compaction nào
  completed: string[];
  inProgress: string[];
  next: string[];
  keyDecisions: Array<{ decision: string; reason: string }>;
}

class CompactionSurvivalNotes {
  constructor(private store: { save(n: ResumeNote): Promise<void>; latest(): Promise<ResumeNote | null> }) {}

  // Milestone writer: ghi note chuẩn sau mỗi milestone
  async writeNote(milestone: string, parts: Omit<ResumeNote, "id" | "createdAt" | "milestone">): Promise<void> {
    const note: ResumeNote = {
      id: `note-${Date.now()}`,
      createdAt: Date.now(),
      milestone,
      ...parts,
    };
    await this.store.save(note);     // persistent — sống qua compaction/restart
  }

  // Resume reader: 4 câu trả lời cho agent sau restart/compaction
  async resume(): Promise<string> {
    const n = await this.store.latest();
    if (!n) return "No resume note — bắt đầu từ đầu (không có trạng thái trước).";
    return [
      `COMPLETED: ${n.completed.join("; ") || "(không có)"}`,
      `IN PROGRESS: ${n.inProgress.join("; ") || "(không có)"}`,
      `NEXT: ${n.next.join("; ") || "(không có)"}`,
      `KEY DECISIONS: ${n.keyDecisions.map(d => `${d.decision} (vì ${d.reason})`).join("; ") || "(không có)"}`,
    ].join("\n");
  }
}
// Usage (trong compress.ts sau compaction / session-branch sau milestone):
// const notes = new CompactionSurvivalNotes(sqliteStore);
// await notes.writeNote("phase-verify", {
//   completed: ["scan src/", "fix lint"],
//   inProgress: ["review security"],
//   next: ["chạy test full"],
//   keyDecisions: [{ decision: "giữ graph-store", reason: "đã có test phủ" }],
// });
// // restart → const context = await notes.resume(); → agent nối lại không replay history
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Resume không replay history (tiết kiệm token lớn) | ❌ Note viết thiếu → resume lệch hướng |
| ✅ Format chuẩn (4 phần — agent parse dễ) | ❌ Milestone writer phải được gọi đúng chỗ (sót → không có note) |
| ✅ Persistent (sống qua compaction/restart) | ❌ KEY DECISIONS thiếu lý do → agent đảo quyết định |
| ✅ Append-only (audit được) | ❌ Note nhiều → phải chọn latest đúng (mới nhất chưa chắc đúng nhất) |

## Khác các hướng gần

| | Replay history | Summary prompt | ZL: Resume Note |
|---|---|---|---|
| Resume | Tốn token | 1 lần (mất sau compact) | **✅ mọi lúc** |
| Format | Không | Tự do | **4 phần chuẩn** |
| Persistent | Không | Không | **✅ store** |

## Khi nào chọn

- Session dài, compaction/restart thường xuyên — resume tốn token
- Handoff giữa agent cần nối lại công việc chuẩn
- Muốn quyết định quan trọng không bị đảo sau compact
- Nối packages/prompts compress.ts + core session-branch.ts + memory sqlite-store.ts + brain-store.ts + core session.ts; guard note-quality (đủ 4 phần, ngắn gọn), writer-reliability (ghi sau milestone chắc chắn), và latest-correctness (chọn note đúng nhất khi resume); ZL = compaction survival notes, kết hợp 681 ZE durable-breakpoint-adapter (trạng thái sống lâu) + 687 ZK graph-task-dependencies (note gắn task graph)
