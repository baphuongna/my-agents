# Hướng TQ: Handoff Session Reset — handoff-format.md nối session: câu hỏi gốc verbatim, artifact paths chính xác, acceptance status + fallback khi không có FS

> **Nguồn gốc:** ClaudeSkills `docs/handoff-format.md` (handoff file schema); "handoff connects sessions — original question verbatim, artifact paths exact, acceptance status"; "fallback block when no filesystem"; "structured handoff for session continuity" | **Coupling:** 🟢 — định nghĩa schema handoff file + reader/writer | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có handoff-format schema + writer/reader) | **Effort:** 1-2 tuần

## Nguồn gốc

**ClaudeSkills** định nghĩa **handoff-format.md** — schema cho file handoff **nối các session**. Mỗi handoff file có: (1) **Câu hỏi gốc verbatim** (nguyên văn — không paraphrase, để session mới biết chính xác user hỏi gì). (2) **Artifact paths chính xác** (file nào đã tạo/sửa — path tuyệt đối, không tương đối). (3) **Acceptance status** (task hoàn thành? partial? blocked? — rõ ràng). (4) **Fallback block** — khi **không có filesystem** (sandbox read-only, ephemeral) → handoff inline trong message (không ghi file, embed trong chat). Nguyên tắc: **handoff là contract** — session mới đọc handoff → pickup chính xác, không guess.

## Mô tả

mya handoff session reset: (1) **Schema**: handoff file có fixed schema (`originalQuestion`, `artifactPaths`, `acceptanceStatus`, `nextSteps`, `fallbackInline`). (2) **Writer**: session cũ ghi handoff file trước khi kết thúc (hoặc inline fallback khi no FS). (3) **Reader**: session mới đọc handoff → restore context (câu hỏi gốc, artifacts, status). (4) **Verbatim**: câu hỏi gốc **nguyên văn** — không paraphrase (paraphrase mất nuance). (5) **Fallback**: no FS → handoff embed trong last message (user copy-paste sang session mới). mya có session + memory — TQ thêm **handoff schema** + **writer/reader** + **fallback**.

## Kiến trúc

```
  SESSION A (sắp kết thúc — context cạn)
        │
        │  write handoff file
        ▼
  ┌─── HANDOFF FILE (handoff-format.md schema) ───────────┐
  │  originalQuestion: "Refactor parser module to support  │
  │    TypeScript 5.x decorators"  (VERBATIM — nguyên văn) │
  │  artifactPaths:                                         │
  │    - /abs/path/parser.ts (modified)                     │
  │    - /abs/path/decorator-transform.ts (created)         │
  │  acceptanceStatus: "partial"                            │
  │    (parser refactored, decorator-transform WIP)         │
  │  nextSteps:                                             │
  │    - "finish decorator-transform error handling"        │
  │    - "add tests for edge cases"                         │
  │  fallbackInline: null  (FS available)                   │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── SESSION B (mới — đọc handoff) ─────────────────────┐
  │  read handoff → restore context                         │
  │  originalQuestion: verbatim (không guess)               │
  │  artifacts: paths chính xác (mở đúng file)              │
  │  status: partial → continue from where A left off       │
  │  → pickup mượt, không lặp work                           │
  └─────────────────────────────────────────────────────┘

  FALLBACK (no FS — sandbox read-only):
  ┌─── INLINE HANDOFF (embed trong last message) ─────────┐
  │  fallbackInline:                                        │
  │    "HANDOFF: original=..., artifacts=..., status=..."   │
  │    (user copy-paste sang session mới)                   │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session — session lifecycle (nền — TQ handoff giữa session)
// ✅ packages/core spill — artifact spill (nền — TQ artifact paths)
// ✅ packages/memory Brain — durable store (nền — TQ handoff persist)
// ✅ packages/skills SkillStore — skill body (nền — TQ handoff có thể là skill)

// ❌ THIẾU: handoff schema (originalQuestion/artifactPaths/acceptanceStatus/nextSteps)
// ❌ THIẾU: handoff writer (session cũ ghi handoff file)
// ❌ THIẾU: handoff reader (session mới đọc → restore)
// ❌ THIẾU: fallback inline (no FS → embed trong message)
```

## Implementation

```typescript
// packages/agent/src/handoff-format.ts (MỚI)
interface HandoffDoc {
  originalQuestion: string;   // VERBATIM — nguyên văn, không paraphrase
  artifactPaths: { path: string; action: "created" | "modified" | "deleted" }[];
  acceptanceStatus: "done" | "partial" | "blocked";
  nextSteps: string[];
  fallbackInline: string | null; // non-null khi no FS → embed
}

class HandoffFormat {
  // write handoff file (session cũ)
  async write(doc: HandoffDoc, fsWrite: boolean): Promise<string> {
    if (!fsWrite) {
      // FALLBACK: no FS → inline embed
      return this.toInline(doc);
    }
    const content = this.serialize(doc);
    // writeFileSync handoff.md
    return content;
  }

  // read handoff (session mới → restore)
  parse(content: string): HandoffDoc {
    const parsed = JSON.parse(content); // hoặc parse markdown frontmatter
    // validate: originalQuestion required (verbatim)
    if (!parsed.originalQuestion) throw new Error("handoff: missing originalQuestion (verbatim required)");
    return parsed as HandoffDoc;
  }

  // inline fallback (no FS)
  private toInline(doc: HandoffDoc): string {
    return `HANDOFF: question="${doc.originalQuestion}" status=${doc.acceptanceStatus} next=${doc.nextSteps.join(";")}`;
  }
}

// Usage:
// // session A (ending):
// const handoff = new HandoffFormat();
// const content = await handoff.write({ originalQuestion, artifactPaths, acceptanceStatus: "partial", nextSteps, fallbackInline: null }, hasFS);
// // session B (new):
// const doc = handoff.parse(content);  // restore: verbatim question + exact paths + status
```

## Được

- ✅ Session continuity (session mới pickup chính xác — không guess)
- ✅ Verbatim question (nguyên văn — không mất nuance)
- ✅ Exact artifact paths (absolute, action-labeled — mở đúng file)
- ✅ Fallback (no FS → inline embed — vẫn handoff được)

## Mất

- ❌ Schema rigidity (handoff phải theo schema — deviation → parse fail)
- ❌ Verbatim cost (câu hỏi gốc có thể dài — tốn token)
- ❌ Fallback fragility (inline embed → user copy-paste manual — error-prone)
- ❌ Handoff staleness (artifacts đổi sau handoff → paths stale)

## Khác

Khác **TJ clean-handoff-ritual** (ritual/process khi nào handoff) — TQ là **format/schema** (handoff file cấu trúc gì). Khác **TW durable-context-projection** (tái chiếu context sau compaction) — TQ **khởi động session mới** hoàn toàn. Khác **session checkpoint** (save/restore session state) — TQ là **human-readable handoff contract**.

## Khi nào chọn

- Session dài vượt context window → cần bridge session mới
- Muốn handoff structured (không free-text — schema enforce completeness)
- Môi trường đôi khi không có FS (sandbox → cần inline fallback)
- Nối packages/core session + spill + packages/memory Brain; guard schema validation (parse fail → rõ error), verbatim integrity (câu hỏi gốc KHÔNG paraphrase), và fallback completeness (inline embed đủ info pickup); TQ = handoff session reset, kết hợp TJ clean-handoff-ritual (process) + TW durable-context-projection (preserve context)
