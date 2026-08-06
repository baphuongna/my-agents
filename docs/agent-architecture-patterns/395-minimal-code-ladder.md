# Hướng OE: Minimal Code Ladder — thang 7 bậc reuse-before-write; -54% LOC

> **Nguồn gốc:** ponytail (minimal-code philosophy); "reuse before write"; "don't reinvent"; "search-then-create"; "progressive escalation: reuse > wrap > compose > generate"; DRY; "code economy ladder"
> **Coupling:** 🟢 — thêm pre-generation check ladder vào tool/codegen layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (codebase search + tool registry sẵn — chưa có 7-bậc escalation ladder)
> **Effort:** 1-2 tuần

## Nguồn gốc

**ponytail** minimal-code philosophy: trước khi viết code mới, agent đi lên **thang 7 bậc** — từ rẻ nhất (reuse) đến đắt nhất (generate from scratch). Bước thấp hơn luôn ưu tiên: (1) **reuse** — hàm/lib có sẵn? (2) **wrap** — wrap function có sẵn thành API cần? (3) **compose** — kết hợp nhiều hàm có sẵn? (4) **configure** — thay config thay vì code? (5) **patch** — sửa nhỏ code có sẵn? (6) **template** — instantiate template? (7) **generate** — viết hoàn toàn mới (đắt nhất, last resort). Kết quả: **-54% LOC** — agent không tái chế bánh xe, tận dụng tối đa code sẵn. Nguyên tắc: **đừng viết nếu có thể reuse** — mỗi bậc thang giảm effort/risk. Khác **101 dynamic-tool-selection** (chọn tool) — OE là **code creation escalation**.

## Mô tả

mya minimal code ladder: trước khi agent generate code/tool mới, đi qua **7 bậc thang** — check từ rẻ → đắt. (1) **Reuse**: search codebase có function/lib tương đương? (2) **Wrap**: wrap function có sẵn thành interface cần? (3) **Compose**: kết hợp functions có sẵn? (4) **Configure**: đổi config (không cần code)? (5) **Patch**: sửa nhỏ code có sẵn? (6) **Template**: instantiate template có sẵn? (7) **Generate**: viết mới (chỉ khi 6 bậc đầu fail). Mỗi bậc: nếu pass → dừng (không lên bậc cao hơn). Ladder **giảm LOC** (reuse thay vì viết mới) + **giảm risk** (code đã test). mya có codebase search + tool registry — OE thêm **7-bậc ladder check** + **escalation gate**.

## Kiến trúc

```
  AGENT wants to ADD CODE / CREATE TOOL:
        │
        ▼
  ┌─── MINIMAL CODE LADDER (7 bậc: rẻ → đắt) ─────────┐
  │                                                     │
  │  ① REUSE — search codebase có sẵn?                  │
  │     grep / symbol search → found? → USE IT (stop)   │
  │                                                     │
  │  ② WRAP — wrap function có sẵn thành API cần?       │
  │     adapter around existing → ok? → WRAP (stop)     │
  │                                                     │
  │  ③ COMPOSE — kết hợp nhiều function có sẵn?         │
  │     pipeline of existing → ok? → COMPOSE (stop)     │
  │                                                     │
  │  ④ CONFIGURE — đổi config thay vì code?             │
  │     setting/flag thay đổi behavior → ok? → CONFIG   │
  │                                                     │
  │  ⑤ PATCH — sửa nhỏ code có sẵn (< 10 lines)?        │
  │     minimal diff → ok? → PATCH (stop)               │
  │                                                     │
  │  ⑥ TEMPLATE — instantiate template có sẵn?          │
  │     scaffold/template fill → ok? → TEMPLATE (stop)  │
  │                                                     │
  │  ⑦ GENERATE — viết hoàn toàn mới (LAST RESORT)      │
  │     none of above worked → write from scratch       │
  │                                                     │
  │  Each step: PASS → stop (don't escalate higher)     │
  │            FAIL → next step (escalate)               │
  └─────────────────────────────────────────────────────┘
        │
        ▼
  RESULT: -54% LOC (reuse/wrap/compose thay vì generate)
          less risk (code đã test), less maintenance
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ codebase search (grep/find) — symbol/function search (nền — bậc ①)
// ✅ tool registry — registered tools (nền — bậc ①②)
// ✅ 101 dynamic-tool-selection — chọn tool có sẵn (nền — bậc ①)
// ✅ 104 task-decomposition — chia task (nền — bậc ③ compose)
// ✅ templates / scaffolds — code templates (nền — bậc ⑥)

// ❌ THIẾU: 7-bậc ladder check (reuse → wrap → compose → configure → patch → template → generate)
// ❌ THIẾU: escalation gate (check từng bậc, pass → stop)
// ❌ THIẾU: wrap/compose builder (auto-generate adapter/pipeline)
// ❌ THIẾU: LOC tracking (measure reduction vs baseline)
```

## Implementation

```typescript
// packages/agent/src/minimal-code-ladder.ts (MỚI)
interface LadderResult {
  step: number;
  method: 'reuse' | 'wrap' | 'compose' | 'configure' | 'patch' | 'template' | 'generate';
  description: string;
  locAdded: number;  // lines added (reuse = 0, generate = many)
  reused: boolean;
}

class MinimalCodeLadder {
  constructor(
    private search: (query: string) => Symbol[] | null,        // codebase symbol search
    private configKeys: () => string[],                         // available config keys
    private templates: () => string[],                          // available templates
  ) {}

  // 7-bậc ladder — check từ rẻ → đắt, pass → stop
  async escalate(requirement: {
    description: string;
    signature: string;  // e.g. "(data: T[]) => GroupedResult"
  }): Promise<LadderResult> {
    // ① REUSE — search codebase có sẵn?
    const found = this.search(requirement.signature);
    if (found && found.length > 0) {
      return { step: 1, method: 'reuse', description: `Found: ${found[0]?.name}`, locAdded: 0, reused: true };
    }

    // ② WRAP — wrap function có sẵn?
    const wrappable = this.search(this.toWrapperPattern(requirement.signature));
    if (wrappable && wrappable.length > 0) {
      return { step: 2, method: 'wrap', description: `Wrap: ${wrappable[0]?.name}`, locAdded: 5, reused: true };
    }

    // ③ COMPOSE — kết hợp nhiều function?
    const parts = this.findComposableParts(requirement.description);
    if (parts.length >= 2) {
      return { step: 3, method: 'compose', description: `Compose: ${parts.join(' → ')}`, locAdded: 8, reused: true };
    }

    // ④ CONFIGURE — đổi config thay vì code?
    if (this.canConfigure(requirement.description)) {
      return { step: 4, method: 'configure', description: `Config: ${requirement.description}`, locAdded: 1, reused: true };
    }

    // ⑤ PATCH — sửa nhỏ code có sẵn?
    const patchable = this.findPatchable(requirement.signature);
    if (patchable) {
      return { step: 5, method: 'patch', description: `Patch: ${patchable}`, locAdded: 4, reused: true };
    }

    // ⑥ TEMPLATE — instantiate template?
    if (this.templates().includes(requirement.signature)) {
      return { step: 6, method: 'template', description: `Template: ${requirement.signature}`, locAdded: 20, reused: true };
    }

    // ⑦ GENERATE — last resort
    return { step: 7, method: 'generate', description: 'Write from scratch', locAdded: 50, reused: false };
  }

  private toWrapperPattern(sig: string): string { return sig; }
  private findComposableParts(desc: string): string[] { return []; }
  private canConfigure(desc: string): boolean { return false; }
  private findPatchable(sig: string): string | null { return null; }
}

// VD: agent cần "groupBy" function
// ① search → found lodash.groupBy → REUSE (0 LOC, done)
// Không generate mới → -54% LOC
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ -54% LOC (reuse/wrap thay vì generate) | ❌ Ladder check overhead (mỗi create +7 steps) |
| ✅ Code đã test (reuse = ít bug) | ❌ False match (reuse function sai ngữ nghĩa) |
| ✅ Ít maintenance (code có sẵn không cần maintain thêm) | ❌ Bậc thấp sai → bậc cao (escalate nhiều lần) |
| ✅ Config thay code (bậc ④ — linh hoạt) | ❌ Search dependency (codebase lớn → chậm) |

## Khác các hướng gần

| | 101 Dynamic-Tool-Selection | 104 Task-Decomposition | DRY | OE: Minimal-Code-Ladder |
|---|---|---|---|---|
| Cái gì | Chọn tool có sẵn | Chia task | Don't repeat | **7-bậc reuse-before-write** |
| Ladder | ❌ | ❌ | ❌ | ✅ 7 bậc |
| LOC | — | — | — | ✅ -54% |
| Generate | — | — | — | ✅ last resort |

## Khi nào chọn

- Agent hay generate code/tool mới (muốn giảm LOC / tăng reuse)
- Codebase lớn (nhiều function có sẵn để reuse/wrap/compose)
- Muốn ít bug/maintenance (reuse code đã test)
- Nối 101 dynamic-tool-selection (① reuse) + 104 task-decomposition (③ compose) + codebase search; mỗi create đi qua ladder — chỉ generate khi 6 bậc đầu fail; track LOC reduction để measure effectiveness
