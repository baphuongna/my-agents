# Hướng AKL: Surgical Change Traceability — mỗi dòng thay đổi phải trace trực tiếp về user request, cấm drive-by refactoring, kết hợp Gateguard fact-forcing bắt agent quote chính user instruction

> **Nguồn gốc:** vetc-dev-kit (AGENTS.md, scripts/hooks/gateguard-fact-force.js) | **Coupling:** 🟡 — hook enforce traceability trên diff | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có hashline-edit + audit; thiếu trace hook) | **Effort:** 1-2 tuần

## Nguồn gốc

**vetc-dev-kit** (AGENTS.md, scripts/hooks/gateguard-fact-force.js) có rule **"Surgical Changes"**: (1) **mỗi dòng thay đổi phải trace trực tiếp về user request** — mọi dòng code mới/sửa phải giải thích được "dòng này phục vụ yêu cầu nào của user" — không có dòng "tiện tay"; (2) **cấm drive-by refactoring** — không refactor code không liên quan trong lúc làm feature (đổi tên biến, tách hàm "cho đẹp" — ngoài scope); (3) **kết hợp Gateguard fact-forcing** — hook **bắt agent quote chính user instruction** — agent phải trích dẫn đúng câu user nói làm căn cứ cho thay đổi — không paraphrase, không bịa; (4) **fact check tự động** — hook so quote với instruction thật — lệch → chặn.

Giá trị: (1) **diff sạch** — mọi thay đổi có lý do, review dễ; (2) **chống scope creep** — drive-by refactor bị cấm; (3) **agent không bịa căn cứ** — fact-forcing bắt quote đúng; (4) **audit trace** — mỗi dòng → yêu cầu user nào.

## Mô tả

Với mya, pattern = **surgical-change gate** gắn vào edit/commit: (1) **trace registry** — mỗi change: { file, line, reason: userRequestId } — nối `packages/audit` (đã có audit log) + `packages/tools/src/hashline-edit.ts` (edit tool — nơi ghi trace); (2) **drive-by detector** — phân tích diff: file/dòng không liên quan scope (nối AKE feature branch — so với branch scope) → flag; (3) **fact-forcing** — Gateguard: trước khi chấp nhận change, agent phải quote user instruction (đúng câu) — so với instruction thật (từ session history — `packages/core` session) — lệch → deny; (4) **commit gate** — diff kèm trace: dòng không trace được → chặn commit (nối AKI pre-commit hook); (5) nơi gắn — `packages/tools` (hook preTool/postTool), `packages/audit` (trace log). Đây là pattern **attribution-enforced diffs**: mỗi dòng là "bằng chứng phục vụ yêu cầu", không có thay đổi vô thừa nhận.

## Kiến trúc (ASCII)

```
  USER REQUEST (câu instruction thật — session history)
    │
    ▼ AGENT SỬA CODE (edit tool)
  ├─ GATEGUARD FACT-FORCING ──► agent phải QUOTE chính câu user
  │     quote so với instruction thật → lệch → DENY (không paraphrase/bịa)
  ├─ TRACE REGISTRY ──► mỗi dòng ghi: { file, line, reason: requestId }
  └─ DRIVE-BY DETECTOR ──► file/dòng ngoài scope → FLAG (cấm refactor tiện tay)
    │
    ▼ COMMIT GATE (nối AKI pre-commit)
  ├─ dòng không trace được ──► chặn commit
  └─ dòng trace đủ ──► commit (diff sạch — mọi thay đổi có lý do)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/audit/src/index.ts — audit log (nơi ghi trace per change)
// ✅ packages/tools/src/hashline-edit.ts — hash-anchored edit (nơi gắn trace)
// ✅ packages/core/src/session.ts — Session + history (nơi có instruction thật)
// ✅ packages/core/src/types.ts — ToolHookSink preTool/postTool (hook gate)
// ✅ packages/tools/src/path-safety.ts — path validation (mẫu gate)

// ❌ THIẾU: trace registry (file/line → user request id)
// ❌ THIẾU: fact-forcing (bắt quote chính instruction — so với history)
// ❌ THIẾU: drive-by detector (diff ngoài scope → flag)
```

## Implementation

```typescript
// packages/tools/src/surgical-trace.ts (NEW)
export interface TraceEntry {
  file: string;
  line: number;
  requestId: string;         // user request mà dòng này phục vụ
  quote: string;             // chính câu user instruction (fact-forcing)
}

export interface ChangeRequest {
  file: string;
  lines: Array<{ from: number; to: number }>;
  scope: string[];           // files trong scope của request
  instruction: string;       // câu user instruction thật (từ session)
}

/** Fact-forcing — quote phải khớp instruction thật (không paraphrase/bịa). */
export function verifyQuote(quote: string, instruction: string): { ok: boolean; reason: string } {
  const q = quote.trim().toLowerCase();
  const ins = instruction.trim().toLowerCase();
  if (ins.includes(q)) return { ok: true, reason: "" };          // quote là chuỗi con
  const qWords = new Set(q.split(/\s+/).filter((w) => w.length > 3));
  const overlap = [...qWords].filter((w) => ins.includes(w)).length;
  return overlap / Math.max(qWords.size, 1) >= 0.7
    ? { ok: true, reason: "" }                                    // 70% từ khóa trùng — chấp nhận
    : { ok: false, reason: `quote "${quote}" không khớp instruction — paraphrase/bịa — deny` };
}

/** Drive-by detector — file ngoài scope → flag (cấm refactor tiện tay). */
export function detectDriveBy(change: ChangeRequest): string[] {
  return change.lines
    .filter(() => !change.scope.some((s) => change.file.includes(s)))
    .map((l) => `dòng ${l.from}-${l.to} ngoài scope — drive-by refactoring bị cấm`);
}

/** Trace gate — mọi dòng phải có trace entry hợp lệ trước khi cho edit. */
export function requireTrace(
  change: ChangeRequest,
  entries: TraceEntry[],
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const inScope = change.scope.some((s) => change.file.includes(s));
  if (!inScope) reasons.push(`file "${change.file}" ngoài scope — surgical change yêu cầu trace rõ`);
  for (const l of change.lines) {
    const traced = entries.some((e) => e.file === change.file && e.line >= l.from && e.line <= l.to);
    if (!traced) reasons.push(`dòng ${l.from}-${l.to} không có trace — thêm reason trước khi sửa`);
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Commit gate — dòng không trace → chặn (nối AKI pre-commit hook). */
export function assertAllTraced(
  diffLines: Array<{ file: string; line: number }>,
  entries: TraceEntry[],
): { ok: boolean; untraced: Array<{ file: string; line: number }> } {
  const untraced = diffLines.filter((d) => !entries.some((e) => e.file === d.file && e.line === d.line));
  return { ok: untraced.length === 0, untraced };
}
// Nối audit: TraceEntry ghi vào audit log — ai sửa dòng nào vì yêu cầu nào
// Nối hashline-edit: edit tool tự ghi trace entry khi sửa (quote từ session)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Diff sạch — mọi dòng có lý do, review dễ | ❌ Ghi trace từng dòng tốn overhead cho change lớn |
| ✅ Chống scope creep — drive-by bị chặn | ❌ Scope detector heuristic — file dùng chung dễ flag nhầm |
| ✅ Không bịa căn cứ — fact-forcing quote đúng | ❌ Quote chuẩn so instruction — agent paraphrase bị deny (đúng ý) |
| ✅ Audit trace — dòng → yêu cầu nào | ❌ Nhiều request đan xen một file — trace phức tạp |

## Khác các hướng gần

| | AKL Surgical Trace | 809 Apply Log Table | 646 Assumption Surfacing |
|---|---|---|---|
| Trọng tâm | Dòng → user request | Audit từng thay đổi | Giả định trước code |
| Cơ chế | Trace registry + fact-force | Log verification table | 4-phase gated |
| Quan hệ | Ghi nguồn thay đổi | Ghi hành động thay đổi | Giả định của thay đổi |

## Khi nào chọn

- Diff hay bị phình (refactor tiện tay, code ngoài scope) — cần kỷ luật
- Agent hay "giải thích" thay đổi bằng lý do bịa — cần fact-forcing
- Audit quan trọng — mỗi dòng phải trace về yêu cầu
- Guard: quote khớp instruction, dòng có trace, drive-by bị chặn, commit gate