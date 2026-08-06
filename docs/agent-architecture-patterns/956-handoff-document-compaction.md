# Hướng AJT: Handoff Document Compaction — `/handoff` nén conversation thành handoff doc cho agent khác, lưu vào mktemp path, tham chiếu artifact bằng path thay vì duplicate

> **Nguồn gốc:** skills (skills/productivity/handoff/SKILL.md) | **Coupling:** 🟢 — artifact tham chiếu, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có exporters + compaction; thiếu handoff doc generator) | **Effort:** 1-2 tuần

## Nguồn gốc

**skills** (skills/productivity/handoff/SKILL.md) có **`/handoff`** — nén conversation thành **handoff doc cho agent khác**: (1) **lưu vào `mktemp` path** — doc tạm ngoài repo, không làm bẩn project; (2) **tham chiếu artifact đã có (PRD/plan/ADR/commit) bằng path thay vì duplicate** — handoff doc không copy nội dung, chỉ trỏ đường dẫn (nội dung thay đổi thì handoff không lỗi thời); (3) **gợi ý skill cho session sau** — doc kết thúc bằng danh sách skill nên dùng; (4) **transfer context giữa session không kéo theo noise** — chỉ chuyển cái cần: state, quyết định, artifact paths, việc còn dang dở.

Giá trị: (1) **context sạch** — session sau chỉ đọc doc ngắn + các artifact path, không phải đọc lại toàn bộ conversation; (2) **không stale** — artifact tham chiếu bằng path, PRD sửa thì handoff vẫn đúng; (3) **không làm bẩn repo** — mktemp path, doc là transient; (4) **rẻ** — nén bằng template + path references, không cần LLM heavy.

## Mô tả

Với mya, pattern = **handoff doc generator** gắn vào session lifecycle: (1) **nén conversation** — lấy history (đã có `packages/core/src/session.ts` + ArrayHistory), trích state/quyết định/việc dang dở (không copy toàn bộ transcript); (2) **artifact path references** — mọi PRD/plan/ADR/commit được nhắc tên → ghi path (không paste nội dung) — mya đã có `packages/memory` + audit để tra cứu; (3) **mktemp output** — doc ghi vào `os.tmpdir()` (hoặc `~/.my-agent/handoffs/`), trả path cho user; (4) **skill suggestion** — cuối doc gợi ý skill cho session sau (đọc từ `packages/skills` index); (5) **nối exporters** — `packages/agent/src/exporters.ts` (NoopExporter/factory) làm nơi gắn handoff export. Đây là pattern **lossy-but-sufficient context transfer**: không giữ mọi thứ, chỉ giữ cái đủ để session sau tiếp tục mà không lệch.

## Kiến trúc (ASCII)

```
  CONVERSATION (history — session.ts / ArrayHistory)
    │
    ▼ /handoff — NÉN (không duplicate, chỉ tham chiếu)
  ├─ state hiện tại (đang làm gì, đến đâu)
  ├─ quyết định đã chốt (kèm artifact path: PRD/plan/ADR)
  ├─ việc còn dang dở + bước kế tiếp
  └─ gợi ý skill cho session sau (từ skills index)
    │
    ▼ GHI RA mktemp path (os.tmpdir() — ngoài repo)
    ▼ HANDOFF DOC (ngắn — agent khác đọc là tiếp tục được)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/session.ts — Session + history (nền — nguồn conversation)
// ✅ packages/agent/src/exporters.ts — createExporter factory (nơi gắn handoff export)
// ✅ packages/skills/src/curator.ts — SkillStore index (gợi ý skill)
// ✅ packages/prompts/src/compressors.ts — compressors (mẫu nén nội dung)
// ✅ packages/memory/src/sqlite-consolidate.ts — consolidation (mẫu tóm tắt)
// ❌ THIẾU: handoff doc generator (nén → state/decisions/TODO)
// ❌ THIẾU: artifact path reference convention (không duplicate nội dung)
// ❌ THIẾU: mktemp output + skill suggestion block
```

## Implementation

```typescript
// packages/agent/src/handoff.ts (NEW)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { History } from "@my-agent/core";
export interface ArtifactRef { kind: "PRD" | "PLAN" | "ADR" | "COMMIT"; path: string }
export interface HandoffDoc {
  state: string;                       // đang làm gì, đến đâu
  decisions: ArtifactRef[];            // quyết định đã chốt — path, không copy
  todo: string[];                      // việc còn dang dở
  skillHints: string[];                // gợi ý skill session sau
  outputPath: string;
}
/** Nén conversation → handoff doc. Artifact chỉ tham chiếu path, không duplicate. */
export function buildHandoff(
  history: History,
  opts: { state: string; decisions: ArtifactRef[]; todo: string[]; skillHints: string[]; outDir?: string },
): HandoffDoc {
  const dir = mkdtempSync(join(opts.outDir ?? tmpdir(), "handoff-"));
  const outputPath = join(dir, "HANDOFF.md");
  const decisionsMd = opts.decisions
    .map((d) => `- [${d.kind}] ${d.path}`)      // path reference — không paste nội dung
    .join("\n");
  const skillsMd = opts.skillHints.length
    ? `\n## Skills đề xuất\n${opts.skillHints.map((s) => `- ${s}`).join("\n")}\n`
    : "";
  const todoMd = opts.todo.map((t) => `- [ ] ${t}`).join("\n");
  const doc = [
    "# Handoff",
    "",
    "## State",
    opts.state,
    "",
    "## Quyết định đã chốt (tham chiếu path — đọc artifact để biết chi tiết)",
    decisionsMd || "- (chưa có)",
    "",
    "## Còn dang dở",
    todoMd || "- (không có)",
    skillsMd,
    "",
    `> Tổng số turn trong conversation: ${history.length}`,
  ].join("\n");
  writeFileSync(outputPath, doc, "utf8");
  return { ...opts, outputPath };
}
/** Gợi ý skill từ history — quét trigger phrases trong conversation. */
export function suggestSkills(history: History, skills: Array<{ name: string; triggers: string[] }>): string[] {
  const text = history
    .map((h) => ("content" in h ? String(h.content) : ""))
    .join("\n")
    .toLowerCase();
  return skills
    .filter((s) => s.triggers.some((t) => text.includes(t.toLowerCase())))
    .map((s) => s.name);
}
// Nối exporters: thêm handoff mode vào createExporter — session kết thúc → export HANDOFF.md
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context sạch — session sau không đọc lại transcript | ❌ Nén mất chi tiết — cần state/decisions đủ tốt |
| ✅ Không stale — artifact tham chiếu path, sửa vẫn đúng | ❌ Artifact path chết (file bị xóa) — không có guard |
| ✅ Không làm bẩn repo — mktemp path | ❌ Doc ngoài repo dễ mất — cần lưu chỗ bền hơn khi cần |
| ✅ Rẻ — template + path refs, không LLM heavy | ❌ Skill suggestion heuristic — trigger phrase lệch thì gợi ý sai |

## Khác các hướng gần

| | AJT Handoff Compaction | 498 Compression Footer | 807 Context Save Restore |
|---|---|---|---|
| Trọng tâm | Chuyển context giữa session | Footer cho biết reducer chạy | Checkpoint/resume |
| Cơ chế | Nén → doc + path refs | Footer ghi giảm token | Git state + decisions |
| Quan hệ | Đầu ra của session | Ghi chú nén | Khôi phục session |

## Khi nào chọn

- Chuyển việc giữa nhiều agent/session — muốn context sạch, không noise
- Artifact (PRD/plan/ADR) đã có sẵn — handoff chỉ cần trỏ path
- Muốn session sau tự biết nên dùng skill nào
- Guard: state + decisions + TODO đủ để tiếp tục, path refs không duplicate, output ngoài repo