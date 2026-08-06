# Hướng NG: Impact Cascade Diagnostics — sau edit chạy LSP/linters trên dependents qua reverse-deps graph

> **Nguồn gốc:** pi-lens (impact cascade); "incremental compilation"; "reverse dependency graph"; "LSP pull diagnostics"; "blast radius analysis" (257); "affect analysis" / "change impact"; TypeScript project references; "what depends on what"
> **Coupling:** 🟡 — cần reverse-deps graph + LSP integration
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (edit + diagnostics sẵn — chưa có reverse-deps cascade)
> **Effort:** 3-4 tuần

## Nguồn gốc

**Incremental compilation** (TypeScript `--incremental`): chỉ build lại những gì bị ảnh hưởng. pi-lens đảo nguyên lý: khi file A được edit, tìm **ai import A** (reverse-dependency graph) → chạy LSP diagnostics trên những file dependent đó. VD: sửa `export function foo()` → file B/C/D import `foo` có thể break → cascade diagnostics trên B/C/D. Giống **blast radius** (257): tính toán vùng ảnh hưởng của 1 thay đổi. Giống **affect analysis** (IDE "Find Usages" + "Show Impact"). Khác **339 agent-middleware** (middleware chạy trước/sau tool) — NG là **fan-out diagnostics theo dependency graph**.

## Mô tả

mya impact cascade diagnostics: sau khi agent edit file A, runtime: (1) tìm reverse-deps (files import/use A) qua tree-sitter review-graph; (2) chạy LSP diagnostics trên A + tất cả dependents; (3) tổng hợp kết quả → hiển thị blockers/advisories. VD: đổi type signature → cascade phát hiện 5 file break. pi-lens surface kết quả tại turn-end (batched, filtered). Nối 257 blast-radius (giới hạn phạm vi) + 117 toolchain-feedback (LSP as feedback).

## Kiến trúc

```
  AGENT edits src/types.ts (changed export type User)
        │
        ▼
  ┌─── REVERSE-DEPS GRAPH (tree-sitter review-graph) ───┐
  │                                                      │
  │  Who imports src/types.ts?                           │
  │   ├── src/api/handler.ts     (import { User })       │
  │   ├── src/components/UserProfile.tsx (import { User })│
  │   ├── src/utils/format.ts    (import { User })       │
  │   └── src/db/schema.ts       (import { User })       │
  │                                                      │
  │  blast radius = 1 edited + 4 dependents              │
  └──────────────────────┬───────────────────────────────┘
                         │
                         ▼
  ┌─── CASCADE LSP DIAGNOSTICS ──────────────────────────┐
  │                                                       │
  │  src/types.ts              → 0 errors ✅              │
  │  src/api/handler.ts        → 2 errors ❌ (type mismatch)│
  │  src/components/UserProfile→ 1 error ❌ (missing prop) │
  │  src/utils/format.ts       → 0 errors ✅              │
  │  src/db/schema.ts          → 0 errors ✅              │
  │                                                       │
  │  result: 2 dependents broken by this edit             │
  └──────────────────────┬────────────────────────────────┘
                         │ batched at turn-end
                         ▼
  AGENT sees: 🔴 blocking: handler.ts L23 — Type 'string' is not assignable to 'number'
                       UserProfile.tsx L45 — Property 'email' is missing
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 117 toolchain-feedback-loop — LSP feedback (nền — NG dùng LSP)
// ✅ 257 blast-radius-containment — scope impact (nền — NG = blast radius cho diagnostics)
// ✅ 236 conformant-planning — plan-aware (nền)
// ✅ tree-sitter — parsing (sẵn trong pi-lens)

// ❌ THIẾU: reverse-dependency graph (who imports/uses file X)
// ❌ THIẾU: cascade fan-out (run LSP on dependents after edit)
// ❌ THIẾU: diagnostic aggregation (merge results across cascade files)
// ❌ THIẾU: review-graph index (tree-sitter import/usage extraction)
```

## Implementation

```typescript
// packages/agent/src/impact-cascade.ts (NEW)
interface DepEdge {
  source: string; // file that imports
  target: string; // file being imported
  symbols: string[]; // imported names
}

interface Diagnostic {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
  blocking: boolean;
}

class ImpactCascadeDiagnostics {
  constructor(
    private reverseDeps: Map<string, DepEdge[]>, // target → who imports it
    private lsp: LspClient,
  ) {}

  // After edit: find dependents → run LSP → aggregate diagnostics
  async afterEdit(editedFile: string, maxDepth: number = 1): Promise<Diagnostic[]> {
    // 1. Find reverse deps (files that import editedFile)
    const dependents = this.findDependents(editedFile, maxDepth);
    const allFiles = [editedFile, ...dependents];

    // 2. Run LSP diagnostics on all affected files
    const diagnostics: Diagnostic[] = [];
    for (const file of allFiles) {
      const diags = await this.lsp.getDiagnostics(file);
      diagnostics.push(...diags.map((d) => ({ file, ...d })));
    }

    // 3. Aggregate: deduplicate, filter to new errors this turn
    return this.aggregate(diagnostics);
  }

  private findDependents(file: string, maxDepth: number): string[] {
    const visited = new Set<string>([file]);
    const queue = [{ file, depth: 0 }];
    const result: string[] = [];

    while (queue.length > 0) {
      const { file: f, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      const edges = this.reverseDeps.get(f) ?? [];
      for (const edge of edges) {
        if (!visited.has(edge.source)) {
          visited.add(edge.source);
          result.push(edge.source);
          queue.push({ file: edge.source, depth: depth + 1 });
        }
      }
    }
    return result;
  }

  private aggregate(diags: Diagnostic[]): Diagnostic[] {
    // Deduplicate by file+line+message, sort by severity
    const seen = new Set<string>();
    return diags
      .filter((d) => {
        const key = `${d.file}:${d.line}:${d.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.blocking === b.blocking ? 0 : a.blocking ? -1 : 1));
  }
}

// Stub
interface LspClient { getDiagnostics(file: string): Promise<Omit<Diagnostic, 'file'>[]>; }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện break ở dependent (không chỉ file edit) | ❌ LSP warm-up cost (language server start) |
| ✅ Blast radius visibility (biết edit ảnh hưởng bao nhiêu file) | ❌ Large monorepo → cascade rất rộng |
| ✅ Turn-end batched (không spam mỗi edit) | ❌ False positives từ stale deps graph |
| ✅ Nối 257 blast-radius + 117 feedback | ❌ Tree-sitter review-graph build overhead |

## Khác các hướng gần

| | 117 Toolchain-Feedback | 257 Blast-Radius | 340 Event-Schema | NG: Impact-Cascade |
|---|---|---|---|---|
| Mục | LSP trên file edit | Giới hạn phạm vi | Schema validation | **LSP trên dependents** |
| Khi | Sau edit | Containment | Runtime | **Sau edit, turn-end** |
| Graph | ❌ (single file) | Radius | ❌ | **Reverse-deps graph** |

## Khi nào chọn

- Monorepo / large codebase (edit 1 file → break nhiều)
- Muốn agent biết tác động edit (không chỉ file trực tiếp)
- Có LSP / language server (TypeScript, Rust, Python)
- Nối 370 read-guard (read before edit) + 372 diagnostic-triage (mark findings) + 257 blast-radius
