# Hướng ZJ: Process Library Composable — thư viện 2239 process file (149 methodology, 2038 specialization) tự động chọn process theo mô tả tự nhiên; mỗi process khai inputs/outputs/quality checks/approval points
> **Nguồn gốc:** babysitter (docs/user-guide/features/process-library.md) | **Coupling:** 🟡 — process registry + auto-select trong workflows | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflows runner + skills curator — chưa có process registry lớn) | **Effort:** 3 tuần

## Nguồn gốc

**babysitter** có **process library** khổng lồ: **2239 process file** — **149 methodology** (cách làm chung) + **2038 specialization** (chuyên sâu theo lĩnh vực). Mỗi process là **composable unit**: khai báo **inputs** (cần gì), **outputs** (trả gì), **quality checks** (điều kiện đạt), **approval points** (điểm cần human). Khi user mô tả task bằng **ngôn ngữ tự nhiên**, hệ thống **tự chọn process** phù hợp (retrieval/matching) → chạy. Process không phải script cứng — là **thư viện chọn được, ghép được** (process A gọi process B). Nguyên tắc: **process library = searchable + composable + self-describing**.

## Mô tả

mya process library composable: (1) **Process manifest** — mỗi process khai inputs/outputs/qualityChecks/approvalPoints (frontmatter hoặc meta). (2) **Registry** — index process theo keywords/domain (mya có skills curator + tool-search analog). (3) **Auto-select** — mô tả tự nhiên → match process (score theo keyword/meta). (4) **Composition** — process A khai `uses: [processB]` → runner chạy tuần tự/lồng. mya có workflows/runner.ts + skills/skill.ts + tool-search.ts — ZJ thêm **process manifest schema** + **registry index** + **auto-select matcher** + **composition runner**.

## Kiến trúc

```
  ┌─── PROCESS LIBRARY (registry) ──────────────────────┐
  │  149 methodology   +   2038 specialization           │
  │  mỗi process: { inputs, outputs, qualityChecks,       │
  │                 approvalPoints, keywords, uses[] }    │
  └────────────────────┬──────────────────────────────────┘
                       ▼  "tôi muốn refactor module X an toàn"
  ┌─── AUTO-SELECT (matcher) ──────────────────────────┐
  │  score = keyword match (refactor, safe, module)      │
  │  → pick process "safe-refactor" (specialization)     │
  └────────────────────┬──────────────────────────────────┘
                       ▼
  ┌─── COMPOSITION RUNNER ─────────────────────────────┐
  │  safe-refactor  ─uses──▶  code-analyze              │
  │                    └────▶  test-run                  │
  │  inputs → outputs → quality check → approval point   │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — chạy process JS (nền — ZJ runner)
// ✅ packages/skills skill.ts — Skill + parseSkillMarkdown (nền — ZJ manifest analog)
// ✅ packages/skills curator.ts — curation (nền — ZJ registry curation)
// ✅ packages/tools tool-search.ts — ToolSearch (nền — ZJ auto-select matcher)
// ✅ packages/prompts assembler.ts — prompt assembly (nền — ZJ inject process)

// ❌ THIẾU: process manifest schema (inputs/outputs/qualityChecks/approvalPoints)
// ❌ THIẾU: registry + auto-select (mô tả tự nhiên → process)
// ❌ THIẾU: composition runner (process uses process)
```

## Implementation

```typescript
// packages/workflows/src/process-library.ts (MỚI)

interface ProcessManifest {
  id: string;
  keywords: string[];
  inputs: string[];                 // tên input cần
  outputs: string[];                // artifact trả về
  qualityChecks: string[];          // evidence cần đạt
  approvalPoints: string[];         // điểm cần human
  uses?: string[];                  // composition: process con
}

type ProcessRunner = (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;

class ProcessLibrary {
  constructor(private registry: Map<string, ProcessManifest>, private runners: Map<string, ProcessRunner>) {}

  // Auto-select: mô tả tự nhiên → process có keyword score cao nhất
  select(naturalDescription: string): ProcessManifest | null {
    const words = naturalDescription.toLowerCase().split(/\W+/);
    let best: ProcessManifest | null = null;
    let bestScore = 0;
    for (const p of this.registry.values()) {
      const score = p.keywords.reduce((n, kw) => n + (words.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore > 0 ? best : null;
  }

  // Composition: chạy process + process con (uses) — inputs chảy qua
  async execute(id: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const manifest = this.registry.get(id);
    if (!manifest) throw new Error(`process ${id} not found`);
    let current = inputs;
    for (const subId of manifest.uses ?? []) {          // chạy process con trước
      current = await this.execute(subId, current);
    }
    const runner = this.runners.get(id);
    if (!runner) throw new Error(`runner ${id} not found`);
    return runner(current);                              // process chính
  }
}
// Usage:
// const lib = new ProcessLibrary(registry, runners);
// const p = lib.select("refactor module X an toàn");     // → safe-refactor
// const out = await lib.execute(p.id, { module: "X" });   // chạy + process con
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thư viện lớn → chọn đúng process theo mô tả | ❌ Registry lớn → matcher phải tốt (keyword dễ trùng) |
| ✅ Self-describing (inputs/outputs/quality/approval) | ❌ Manifest khai thiếu → chạy sai context |
| ✅ Composable (process dùng process) | ❌ Composition sâu → lỗi khó truy vết |
| ✅ Curation có khung (methodology/specialization) | ❌ Duy trì 2239 file = chi phí lớn |

## Khác các hướng gần

| | Prompt-based process | Script cố định | ZJ: Process Library |
|---|---|---|---|
| Chọn process | LLM tự nghĩ | Cố định | **Tự động match** |
| Tái sử dụng | Không | Không | **Composable** |
| Scale | 1 | 1 | **2239 file** |

## Khi nào chọn

- Nhiều loại task lặp lại, mỗi loại có process riêng
- Muốn chọn process bằng mô tả tự nhiên (không phải tên file)
- Process cần ghép từ process con (composition)
- Nối packages/workflows runner.ts + skills curator.ts + skill.ts + tools tool-search.ts + prompts assembler.ts; guard manifest-completeness (inputs/outputs/quality khai đủ), matcher-precision (keyword riêng biệt), và composition-acyclic (uses không vòng lặp); ZJ = process library composable, kết hợp 683 ZG process-as-code (process = code) + 684 ZH quality-convergence (qualityChecks chạy loop)
