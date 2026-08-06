# Hướng QN: LSP Wired Edits — LSP đan sửa: willRenameFiles cập re-export/barrel trước move

> **Nguồn gốc:** oh-my-pi (LSP wired edits); "LSP willRenameFiles hook"; "refactor-aware file operations"; "barrel/re-export auto-update on move"; "language-server-driven edit orchestration"
> **Coupling:** 🟡 — cần LSP integration + edit orchestration + pre-move hook
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (edit tool + file ops sẵn — chưa có LSP integration + willRenameFiles hook)
> **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** tích hợp **LSP** (Language Server Protocol) vào edit pipeline. Khi agent move/rename file, LSP hook **willRenameFiles** kích hoạt **trước** thao tác → tự động cập nhật **re-exports**, **barrel files** (`index.ts`), và **imports** tham chiếu file đó. Giống **IDE refactor** (VS Code rename symbol → update all references) nhưng **wired vào agent edit tool**. Nguyên tắc: **file operation = code-aware** — không chỉ move file vật lý, còn sửa tất cả reference. LSP biết semantic (ai import file này, barrel nào re-export). Khác edit tool (naive write) — QN là **LSP-aware refactor**; khác **396 repo-graph** (static analysis) — QN là **dynamic edit with LSP**.

## Mô tả

mya LSP wired edits: agent gọi `move(oldPath, newPath)` → **pre-move hook** triggers LSP `willRenameFiles` → LSP compute **text edits** (update imports, barrel re-exports, references) → apply edits → **then** move file. Sequence: (1) LSP compute affected files, (2) generate edit operations, (3) apply edits (update imports), (4) move/rename file, (5) LSP `didRenameFiles` (post-move cleanup). Nối edit tool + file ops + 396 repository-graph-planning.

## Kiến trúc

```
  AGENT: move("src/old/auth.ts", "src/new/auth.ts")
        │
        ▼
  ┌─── PRE-MOVE HOOK (LSP willRenameFiles) ───────────────┐
  │                                                        │
  │  LSP receives: oldPath → newPath                       │
  │  LSP computes affected references:                     │
  │                                                        │
  │  ① src/index.ts (barrel):                              │
  │     - export { auth } from './old/auth'                │
  │     + export { auth } from './new/auth'                │
  │                                                        │
  │  ② src/api/login.ts (importer):                        │
  │     - import { auth } from '../old/auth'               │
  │     + import { auth } from '../new/auth'               │
  │                                                        │
  │  ③ src/old/auth.test.ts (co-located test):             │
  │     (LSP may suggest moving test too)                  │
  │                                                        │
  │  → GENERATE edit operations (text edits per file)      │
  │  → APPLY edits (update imports + barrel BEFORE move)   │
  │                                                        │
  └────────────────────────┬───────────────────────────────┘
                           │ (all references updated)
                           ▼
  ┌─── FILE MOVE ──────────────────────────────────────────┐
  │  git mv src/old/auth.ts src/new/auth.ts                │
  │  (file physically moved, references already updated)   │
  └────────────────────────┬───────────────────────────────┘
                           │
                           ▼
  ┌─── POST-MOVE HOOK (LSP didRenameFiles) ────────────────┐
  │  LSP cleanup: reindex, validate no broken imports      │
  │  → if broken import found → report to agent            │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ edit tool — file write/edit (nền — QN = LSP-aware version)
// ✅ file ops — move/rename/delete (nền — QN = LSP pre-hook)
// ✅ 396 repository-graph-planning — repo analysis (relate — QN = dynamic edit)
// ✅ 97 tool-schema-drift — schema validation (relate)

// ❌ THIẾU: LSP integration (connect to language server)
// ❌ THIẾU: willRenameFiles hook (pre-move: compute + apply reference edits)
// ❌ THIẾU: barrel/re-export detection (find index.ts that re-exports)
// ❌ THIếU: edit orchestration (sequence: LSP edits → move → LSP cleanup)
```

## Implementation

```typescript
// packages/agent/src/lsp-wired-edits.ts (NEW)
import { execSync } from 'node:child_process';

interface TextEdit {
  file: string;
  range: { startLine: number; endLine: number };
  newText: string;
}
interface RenameEdit {
  oldPath: string;
  newPath: string;
  edits: TextEdit[];   // reference updates
}

class LspWiredEditor {
  constructor(private lsp: {
    willRenameFiles: (oldPath: string, newPath: string) => Promise<TextEdit[]>;
    didRenameFiles: (oldPath: string, newPath: string) => Promise<string[]>;
  }) {}

  // LSP-aware move: update references BEFORE moving file
  async move(oldPath: string, newPath: string): Promise<{ moved: boolean; editsApplied: number; errors: string[] }> {
    // 1. PRE-MOVE: LSP computes reference edits (imports, barrels, re-exports)
    const edits = await this.lsp.willRenameFiles(oldPath, newPath);

    // 2. APPLY edits (update all references before physical move)
    let applied = 0;
    for (const edit of edits) {
      const success = await this.applyTextEdit(edit);
      if (success) applied++;
    }

    // 3. PHYSICAL MOVE (references already updated)
    execSync(`git mv ${oldPath} ${newPath}`);

    // 4. POST-MOVE: LSP cleanup (reindex, validate)
    const errors = await this.lsp.didRenameFiles(oldPath, newPath);

    return { moved: true, editsApplied: applied, errors };
  }

  // LSP-aware rename symbol (not just file, but exported name)
  async renameSymbol(file: string, oldName: string, newName: string): Promise<number> {
    // LSP rename: update all references to symbol across codebase
    // (delegates to LSP textDocument/rename)
    return 0;
  }

  private async applyTextEdit(edit: TextEdit): Promise<boolean> {
    // Read file → apply range replacement → write back
    return true;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Code-aware refactor (LSP update imports + barrel + re-export) | ❌ LSP dependency (cần language server running) |
| ✅ No broken imports (references updated trước khi move) | ❌ Latency (LSP round-trip per edit) |
| ✅ Barrel auto-update (index.ts re-export tự sửa) | ❌ Language-specific (TS/Python LSP khác nhau) |
| ✅ Atomic (edit → move → validate, rollback nếu lỗi) | ❌ LSP false edits (compute sai → corrupt code) |

## Khác các hướng gần

| | edit tool | 396 Repo-Graph | 97 Schema-Drift | QN: LSP-Wired-Edits |
|---|---|---|---|---|
| Trọng tâm | Write file | Static analysis | Schema validate | **Code-aware refactor** |
| LSP? | ❌ | ❌ | ❌ | **✅ (willRenameFiles)** |
| Barrel? | ❌ | Detect | ❌ | **✅ (auto-update)** |

## Khi nào chọn

- Agent move/rename file thường (cần update imports + barrel)
- Muốn code-aware refactor (không break imports)
- Có LSP available (TS, Python, Rust language server)
- Cần atomic edit (LSP edit → move → validate, rollback if lỗi)
- Nối edit tool + file ops + 396 repository-graph-planning + 97 tool-schema-drift
