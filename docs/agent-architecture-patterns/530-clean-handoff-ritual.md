# Hướng TJ: Clean Handoff Ritual — khi context cạn: lưu durable artifacts trước, compact hội thoại, rồi báo user start session mới

> **Nguồn gốc:** 9arm-skills `skills/clean-handoff/` (`SKILL.md` ritual, handoff checklist); "when context runs low: save durable artifacts first, compact conversation, then tell user to start fresh session"; "never lose work at context boundary"; "handoff ritual — artifacts → compact → new session" | **Coupling:** 🟢 — dùng session + memory + spill sẵn, thêm handoff ritual orchestration | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session + spill + memory sẵn — chưa có handoff ritual + context-budget detect) | **Effort:** 1-2 tuần

## Nguồn gốc

**9arm-skills** khi agent **gần hết context** (token budget cạn) không đợi crash/truncate — mà chủ động thực hiện **handoff ritual**: (1) **lưu durable artifacts** (tất cả file đã edit, draft, todo-list, decision log → ghi xuống disk trước). (2) **compact hội thoại** (summarize key context — câu hỏi gốc, progress, next steps → handoff doc). (3) **báo user start session mới** (agent không thể tiếp tục an toàn → session mới pickup từ handoff doc). Nguyên tắc: **không mất work tại context boundary** — artifacts tồn tại trên disk (không trong context), handoff doc bridge session. Khác auto-compaction (LLM summarize inline) — TJ là **ritual có thứ tự** + **artifacts-first**.

## Mô tả

mya clean handoff ritual: (1) **Context-budget detect**: monitor token usage — khi gần threshold (ví dụ 80% budget) → trigger ritual. (2) **Artifacts-first**: flush tất cả pending writes (file edit, draft, notes) xuống disk — **trước** compact (nếu compact fail → artifacts vẫn an toàn). (3) **Handoff doc**: summarize context (câu hỏi gốc, progress, next steps, artifact paths) → handoff file durable. (4) **Notify user**: báo "context sắp cạn, đã lưu artifacts + handoff doc — start session mới". (5) **New session pickup**: session mới đọc handoff doc → tiếp tục. mya có spill (large-value spill) + memory — TJ thêm **budget detector** + **artifact flush** + **handoff doc writer**.

## Kiến trúc

```
  AGENT (context 78% — sắp cạn)
        │
        │  trigger: context-budget >= threshold (80%)
        ▼
  ┌─── STEP 1: ARTIFACTS-FIRST (flush xuống disk) ───────┐
  │  pending file edits → WRITE (flush)                    │
  │  draft / notes → WRITE (flush)                          │
  │  todo-list / decision-log → WRITE (flush)               │
  │  → artifacts AN TOÀN trên disk (compact fail không mất) │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── STEP 2: HANDOFF DOC (compact context) ────────────┐
  │  summarize:                                            │
  │    - câu hỏi gốc (verbatim)                             │
  │    - progress đến đâu                                   │
  │    - next steps (còn gì chưa làm)                       │
  │    - artifact paths (file nào đã lưu)                   │
  │  → handoff.md (durable)                                │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── STEP 3: NOTIFY USER ──────────────────────────────┐
  │  "Context sắp cạn. Đã lưu artifacts + handoff doc."     │
  │  "Start session mới — đọc handoff.md để tiếp tục."      │
  │  → session mới: pickup từ handoff.md                    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core spill (maybeSpill) — large-value spill to disk (nền — TJ flush artifacts)
// ✅ packages/core budget — token budget tracking (nền — TJ detect context cạn)
// ✅ packages/memory Brain — durable store (nền — TJ handoff doc persist)
// ✅ packages/core session-branch — session branching (nền — TJ new session pickup)

// ❌ THIẾU: budget threshold detector (trigger ritual khi context >= 80%)
// ❌ THIẾU: artifact flusher (flush pending writes BEFORE compact)
// ❌ THIẾU: handoff doc writer (summarize → durable handoff.md)
// ❌ THIẾU: new-session pickup (session mới đọc handoff doc)
```

## Implementation

```typescript
// packages/agent/src/handoff-ritual.ts (MỚI)
interface HandoffDoc {
  originalQuestion: string;  // verbatim
  progress: string;          // đến đâu
  nextSteps: string[];       // còn gì chưa làm
  artifactPaths: string[];   // file nào đã lưu
  createdAt: number;
}

class CleanHandoffRitual {
  constructor(
    private now: () => number,
    private flushArtifacts: () => Promise<string[]>,  // flush pending writes → paths
    private summarize: () => Promise<HandoffDoc>,     // LLM summarize context
    private writeHandoff: (doc: HandoffDoc) => Promise<string>, // write handoff.md
  ) {}

  // ritual: artifacts-first → compact → notify
  async run(): Promise<{ handoffPath: string; artifacts: string[] }> {
    // STEP 1: ARTIFACTS-FIRST — flush xuống disk TRƯỚC
    const artifacts = await this.flushArtifacts();

    // STEP 2: HANDOFF DOC — compact context
    const doc = await this.summarize();

    // STEP 3: WRITE — handoff doc durable
    const handoffPath = await this.writeHandoff(doc);

    return { handoffPath, artifacts };
  }
}

// Usage:
// if (budget.used >= threshold) {
//   const { handoffPath, artifacts } = await ritual.run();
//   console.log(`Context cạn. Artifacts: ${artifacts}. Handoff: ${handoffPath}`);
//   console.log("Start session mới, đọc handoff.md để tiếp tục.");
// }
```

## Được

- ✅ Không mất work tại context boundary (artifacts tồn tại trên disk)
- ✅ Artifacts-first (compact fail → artifacts vẫn an toàn)
- ✅ Handoff doc bridge session (session mới pickup mượt)
- ✅ Proactive (không đợi crash/truncate)

## Mất

- ❌ Ritual overhead (flush + summarize tốn token cuối phiên)
- ❌ Handoff doc quality (summarize sai → session mới lạc hướng)
- ❌ Threshold tuning (quá sớm → lãngng phí, quá muộn → crash trước ritual)
- ❌ User friction (phải start session mới — gián đoạn)

## Khác

Khác **auto-compaction** (LLM summarize inline, không artifacts-first) — TJ là **ritual có thứ tự** (artifacts → compact → notify). Khác **TQ handoff-session-reset** (định nghĩa format file handoff) — TJ là **ritual/process** (khi nào, thứ tự gì). Khác **TW durable-context-projection** (tái chiếu context sau compaction) — TJ **khởi động session mới** hoàn toàn.

## Khi nào chọn

- Session dài, context budget có giới hạn cứng (model context window)
- Agent edit nhiều file (artifacts cần flush trước khi context hết)
- Muốn bridge session mượt (handoff doc → session mới pickup)
- Nối packages/core spill + budget + packages/memory Brain + session-branch; guard threshold (trigger sớm đủ — không đợi crash), artifact flush completeness (flush hết pending, không bỏ), và handoff doc quality (summarize đầy đủ — câu hỏi gốc verbatim, next steps rõ); TJ = clean handoff ritual, kết hợp TQ handoff-session-reset (format) + TW durable-context-projection (preserve context qua compaction)
