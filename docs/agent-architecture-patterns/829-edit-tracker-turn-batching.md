# Hướng AEW: Edit-Tracker Turn Batching — gom file đã sửa vào Map, snapshot một lần ở turn_end thay vì review từng edit

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟢 — hook layer, không đụng core loop | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn ToolHookSink preTool/postTool) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions** (src/edit-tracker.ts): **pi-code-review** hook `tool_execution_end` **gom file đã sửa vào Map** (dedup theo path — cùng file sửa 5 lần chỉ 1 entry), **snapshot một lần ở `turn_end`** thay vì **review từng edit** — (1) **batching tránh overhead** — không review 5 lần cùng file, không snapshot đĩa nhiều lần; (2) **review theo ngữ cảnh cả turn** — nhìn toàn bộ thay đổi của turn (nhiều edit phối hợp) thay vì từng edit rời rạc (edit 1 có thể "sai" nhưng edit 2 sửa lại — review từng cái tạo false positive).

Giá trị: (1) **hiệu quả** — số lần review/snapshot = số file thay đổi, không = số edit; (2) **ngữ cảnh** — review diff của cả turn đúng nghĩa (nối AEI/AEK diff review); (3) **tách bạch** — hook thu thập (rẻ), turn_end xử lý (một lần) — không chèn công việc nặng vào giữa tool execution.

## Mô tả

Với mya, pattern = **edit tracker trên ToolHookSink**: (1) mya đã có **`ToolHookSink`** (`packages/core/types.ts`: `preTool?(call)` / `postTool?(call, result)`) — hook `postTool` chính là chỗ bắt edit (nối codeexec/hashline-edit tool); (2) **accumulate** — `Map<path, EditInfo>` — mỗi lần postTool thấy tool sửa file: `set(path, {before?, after, tool, ts})` — ghi đè, không tạo entry mới; (3) **turn_end snapshot** — một lần: đọc lại file từ đĩa (hoặc diff qua hashline), lưu snapshot; (4) **review cả turn** — snapshot này chính là nguồn cho review pipeline (nối AEI review window / AET-style verify / AEV gate); (5) **clear** — sau review xong reset Map cho turn sau. Đây là pattern **deferred aggregation**: thu thập rẻ liên tục, xử lý đắt một lần ở ranh giới turn.

## Kiến trúc (ASCII)

```
  TOOL EXECUTION (codeexec / hashline-edit)
    │  postTool hook (ToolHookSink — đã có trong core)
    ▼
  EDIT TRACKER — Map<path, EditInfo>
  ├─ "src/a.ts" → {tool, ts, after}      (sửa lần 1)
  ├─ "src/a.ts" → {tool, ts, after'}     (sửa lần 2 — GHI ĐÈ, dedup)
  └─ "src/b.ts" → {tool, ts, after}      (file khác — entry riêng)
    │
    ▼ TURN_END — snapshot MỘT LẦN (không review từng edit)
  đọc lại từng file đã đổi → diff cả turn (nối AEI/AEK review)
    │
    ▼ REVIEW / VERIFY (ngữ cảnh cả turn — edit 1+2 nhìn chung)
    ▼ CLEAR Map → turn sau bắt đầu trống
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/types.ts — ToolHookSink (preTool/postTool)
//   (điểm hook đã sẵn — pattern chỉ cần bám vào)
// ✅ packages/tools/src/hashline-edit.ts — edit tool (nguồn edit)
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (nguồn edit)
// ✅ packages/core/src/loop.ts — turn boundary (turn_end — điểm snapshot)
// ✅ packages/print — review surface (nối AEI/AEK)

// ❌ THIẾU: EditTracker (Map accumulate + dedup theo path)
// ❌ THIẾU: turn_end snapshot (đọc lại file, diff cả turn)
// ❌ THIẾU: nối review pipeline + clear giữa các turn
```

## Implementation

```typescript
// packages/tools/src/edit-tracker.ts (NEW)
export interface EditInfo {
  path: string;
  tool: string;
  ts: number;
  after: string;          // content sau edit (snapshot tại turn_end mới đọc)
  beforeHash?: string;    // hashline trước khi sửa (nối hashline-edit)
}

export class EditTracker {
  private edits = new Map<string, EditInfo>();

  /** postTool hook: gom vào Map — GHI ĐÈ theo path (dedup, không review từng edit). */
  onToolResult(call: { name: string; args?: Record<string, unknown> }, result: { ok: boolean }): void {
    const path = typeof call.args?.path === "string" ? call.args.path : undefined;
    if (!path || !result.ok) return;
    this.edits.set(path, { path, tool: call.name, ts: Date.now(), after: "" });
  }

  /** turn_end: snapshot MỘT LẦN — đọc lại file đã đổi + diff cả turn. */
  async snapshot(readFile: (p: string) => Promise<string>): Promise<EditInfo[]> {
    const out: EditInfo[] = [];
    for (const e of this.edits.values()) {
      try { e.after = await readFile(e.path); } catch { continue; }   // file bị xóa — bỏ qua
      out.push(e);
    }
    return out;   // → review pipeline (AEI window / verify) với ngữ cảnh cả turn
  }

  clear(): void { this.edits.clear(); }   // sau review — turn sau trống
}
// Wire: loop hook postTool → tracker.onToolResult; turn_end → snapshot → review → clear
// Nối AEK: snapshot compile thành feedback prompt có file:line (nếu có comment)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Số review = số file, không = số edit (hiệu quả) | ❌ Edit + revert trong cùng turn → vẫn snapshot file (noise) |
| ✅ Review ngữ cảnh cả turn — ít false positive | ❌ File sửa rồi xóa → mất dấu (cần policy) |
| ✅ Hook nhẹ (Map set) — không chèn việc nặng giữa tool | ❌ Snapshot đọc lại đĩa — file lớn tốn I/O |
| ✅ ToolHookSink đã có sẵn — chỉ bám vào | ❌ Map phình nếu turn sửa rất nhiều file (cần cap) |

## Khác các hướng gần

| | AEW Edit Tracker | AEK Comment→Prompt | AEV Verification Gates |
|---|---|---|---|
| Trọng tâm | Gom edit theo turn | Feedback thành prompt | Chặn tiến khi gate fail |
| Cơ chế | Map dedup + snapshot | Compiler + rebuilder | Gate check + execSync |
| Quan hệ | Nguồn diff cho AEK | Tiêu thụ snapshot | Verify sau review |

## Khi nào chọn

- Agent sửa nhiều file/turn — review từng edit tốn + sai ngữ cảnh
- Đã có ToolHookSink + hashline-edit — thêm tracker + snapshot
- Muốn review diff cả turn (nhiều edit phối hợp) thay vì rời rạc
- Cần tránh overhead snapshot/review lặp lại