# Hướng ADV: OPSX Artifact-Guided Workflow — actions tự do thay phase cứng, workflow là file user-edit được

> **Nguồn gốc:** OpenSpec | **Coupling:** 🟢 — workflow định nghĩa bằng file, không hardcode | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn workflows runner; thiếu OPSX actions) | **Effort:** 2 tuần

## Nguồn gốc

**OpenSpec** có **docs/opsx.md** mô tả **OPSX workflow**: thay **phase cứng** (propose → implement → review — bắt buộc tuần tự) bằng **actions tự do** — **propose, explore, apply, sync, archive**. Action có thể chạy theo thứ tự bất kỳ, lặp lại, bỏ qua — agent chọn đường phù hợp với task.

Quan điểm quan trọng: **dependencies là enablers chứ không bắt buộc** — propose không bắt buộc đi trước apply; nếu task rõ thì apply thẳng. Và **workflow/schema/templates là file user-edit được** (`schema.yaml` + `templates/*.md`) thay vì hardcoded TypeScript — "**ai cũng experiment được**": thay đổi quy trình không cần sửa code, chỉ sửa file YAML/MD.

## Mô tả

Với mya, `packages/workflows` hiện có `WorkflowContext` + runner + rhai-runner (script workflow). Pattern OPSX thêm: workflow **khai báo bằng file** (YAML actions + templates MD) thay vì code; runner **không ép thứ tự** — actions là graph tự do; propose/explore/apply/sync/archive là action nguyên thủy. `packages/memory` lưu state; templates user-edit được qua `packages/skills` (skill như template). Cần tránh: file-driven làm workflow khó debug — cần validate schema khi load (nối ADR parser tiers — degrade visible).

## Kiến trúc (ASCII)

```
  WORKFLOW = FILE (schema.yaml + templates/*.md — user-edit được)
    actions: [propose, explore, apply, sync, archive]
    thứ tự: TỰ DO — không phase cứng
            │
            ▼
  OPSX RUNNER (mya)
    ├─ propose  — đề xuất thay đổi (spec)
    ├─ explore  — khảo sát hiện trạng
    ├─ apply    — thực thi (có thể không cần propose trước)
    ├─ sync     — đồng bộ spec ↔ code
    └─ archive  — đóng change
            │
            ▼
  STATE (memory): change objects, sync status
  ⚠️ dependencies là enablers, không bắt buộc
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows — WorkflowContext + runner + rhai-runner
//   (nền OPSX runner — actions scripting đã có)
// ✅ packages/workflows/src/worker.ts — worker chạy workflow
// ✅ packages/memory — Brain SQLite (state change objects)
// ✅ packages/skills — SkillStore (templates dạng skill/file)
// ✅ packages/prompts — schema/assembler (nền file-driven config)

// ❌ THIẾU: action model tự do (propose/explore/apply/sync/archive)
// ❌ THIẾU: file-based workflow (schema.yaml + templates/*.md)
// ❌ THIẾU: validate schema khi load — degrade visible thay vì chạy sai
```

## Implementation

```typescript
// packages/workflows/src/opsx.ts (NEW)
export type OpsxAction = "propose" | "explore" | "apply" | "sync" | "archive";

export interface OpsxWorkflow {
  name: string;
  schema: Record<string, unknown>;   // từ schema.yaml (user-edit)
  templates: Map<string, string>;    // từ templates/*.md
  steps: OpsxAction[];               // thứ tự KHÔNG bắt buộc tuần tự
}

export async function loadWorkflow(dir: string): Promise<OpsxWorkflow> {
  const raw = readFileSync(join(dir, "schema.yaml"), "utf8");
  const { tier, warning } = parseWorkflowYaml(raw);   // nối ADR parser tiers
  if (tier === "passthrough") throw new Error(`workflow unparsed: ${warning}`);
  const templates = new Map<string, string>();
  for (const f of readdirSync(join(dir, "templates"))) {
    if (f.endsWith(".md")) templates.set(f, readFileSync(join(dir, "templates", f), "utf8"));
  }
  return { name: dir, schema: parse(raw), templates, steps: inferSteps(raw) };
}

export async function runOpsx(wf: OpsxWorkflow, ctx: WorkflowContext): Promise<void> {
  // actions tự do — dependencies là enablers, không bắt buộc
  for (const action of wf.steps) {
    if (action === "propose") await ctx.run("propose", proposeChange(wf.schema));
    if (action === "explore") await ctx.run("explore", exploreRepo);
    if (action === "apply")   await ctx.run("apply", applyChange);
    if (action === "sync")    await ctx.run("sync", syncSpecCode);
    if (action === "archive") await ctx.run("archive", archiveChange);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ai cũng experiment được — đổi workflow không sửa code | ❌ File-driven khó debug hơn code |
| ✅ Actions tự do — không kẹt phase cứng | ❌ Schema sai → chạy sai (cần validate) |
| ✅ Templates user-edit — quy trình tùy biến | ❌ Tự do quá → thiếu consistency giữa team |
| ✅ Dependencies là enablers — đường ngắn cho task rõ | ❌ Action mới phải thêm vào runner code |

## Khác các hướng gần

| | ADV OPSX Actions | ADF Workflow Stages | ADI Intake Lanes |
|---|---|---|---|
| Thứ tự | Tự do (enablers) | Stage có trạng thái | Lane bắt buộc |
| Định nghĩa | File (YAML + MD) | Code/state machine | Checklist + template |
| Độ cứng | Mềm | Vừa | Cứng (gate) |

## Khi nào chọn

- Quy trình thay đổi thường xuyên — không muốn sửa code mỗi lần
- Task đa dạng — phase cứng gây lãng phí
- Đã có workflows runner — thêm file-based actions
- Team muốn experiment quy trình nhanh