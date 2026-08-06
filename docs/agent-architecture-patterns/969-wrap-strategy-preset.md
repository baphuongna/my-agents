# Hướng AKG: Wrap Strategy Preset — preset dùng `strategy: wrap` (pre/post logic quanh core template) để override command hành vi theo preset, preset composition cho phép test/lean/scaffold biến thể

> **Nguồn gốc:** spec-kit (presets/self-test/commands/speckit.wrap-test.md) | **Coupling:** 🟢 — preset layer quanh command | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có pkg extensions + registry; thiếu wrap strategy) | **Effort:** 2 tuần

## Nguồn gốc

**spec-kit** có preset dùng **`strategy: wrap`**: (1) **pre/post logic quanh core template** — wrap = bọc: chạy logic trước (pre) + core command + logic sau (post) — preset không sửa core; (2) **override command hành vi theo preset** — cùng command, preset khác nhau → hành vi khác (test preset thêm verify, lean preset bỏ bớt); (3) **self-test preset wrap `speckit.specify` mà không sửa core** — minh chứng: preset tự test được command mà không đụng implementation gốc; (4) **preset composition** — kết hợp preset (test + lean + scaffold) tạo biến thể của cùng command — composition thay vì copy-paste command.

Giá trị: (1) **core ổn định** — wrap không sửa core, preset là lớp ngoài — upgrade core không vỡ preset; (2) **biến thể rẻ** — test/lean/scaffold chỉ là pre/post khác nhau quanh cùng core; (3) **self-test** — preset wrap chứng minh core hoạt động mà không cần sửa; (4) **composition** — preset ghép được, không nhân bản code.

## Mô tả

Với mya, pattern = **wrap strategy cho command preset**: (1) **preset registry** — `packages/pkg` (extension host — PackageKind đã có extensions) thêm preset: `{ name, strategy: "wrap", pre: string[], post: string[], commands: string[] }`; (2) **wrap executor** — chạy command: pre hooks → core command → post hooks — core là `ToolImpl` trong `packages/tools/src/registry.ts` (đã có alias map — nơi gắn wrap); (3) **composition** — preset list chạy theo thứ tự (pre ghép trước, post ghép sau) — test+lean = pre(test) + pre(lean) + core + post(lean) + post(test); (4) **self-test preset** — preset wrap bọc chính command để test mà không sửa core (mẫu eval harness — `packages/eval`); (5) nơi gắn — `packages/pkg` (preset load + verify apiVersion) + `packages/tools` (dispatch — `dispatch.ts` gọi wrap executor). Đây là pattern **decoration over composition**: hành vi mới là lớp bọc quanh core, không phải fork core.

## Kiến trúc (ASCII)

```
  PRESET REGISTRY (packages/pkg — extensions)
  ├─ preset "test"   : strategy=wrap  pre=[verify-env]        post=[run-tests]
  ├─ preset "lean"   : strategy=wrap  pre=[strip-verbose]     post=[]
  └─ preset "scaffold": strategy=wrap pre=[mkdir-structure]   post=[write-readme]
    │
    ▼ WRAP EXECUTOR (dispatch — không sửa core)
  command X = pre(A) → pre(B) → CORE X → post(B) → post(A)
    │
    ▼ COMPOSITION — preset ghép theo thứ tự
  "test" + "lean" quanh speckit.specify
  = pre(test) → pre(lean) → CORE specify → post(lean) → post(test)
    │
    ▼ SELF-TEST PRESET — wrap chính command để test, không sửa core
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg/src/index.ts — PackageKind extensions + manifest verify (nơi thêm preset)
// ✅ packages/tools/src/registry.ts — ToolRegistry + declareAlias (nơi gắn wrap dispatch)
// ✅ packages/tools/src/dispatch.ts — runTool path (nơi chèn pre/post)
// ✅ packages/tools/src/registry-resolve.ts — resolve tool name (nền — preset resolution)
// ✅ packages/eval/src/harness.ts — harness (nền — self-test preset)

// ❌ THIẾU: preset model (strategy: "wrap" + pre/post lists)
// ❌ THIẾU: wrap executor (pre → core → post — không sửa core)
// ❌ THIẾU: preset composition (ghép theo thứ tự, không copy-paste)
```

## Implementation

```typescript
// packages/pkg/src/wrap-preset.ts (NEW)
export type WrapPreset = {
  name: string;
  strategy: "wrap";            // wrap = lớp bọc — không sửa core
  pre: string[];               // logic chạy trước core (command names)
  post: string[];              // logic chạy sau core
  commands: string[];          // core commands preset này áp dụng lên
};

export interface WrapContext {
  command: string;
  args: unknown;
  runStep: (step: string, args: unknown) => Promise<{ ok: boolean; output: string }>;
}

/** Wrap executor — pre → CORE → post; core KHÔNG bị sửa. */
export async function executeWithWrap(
  preset: WrapPreset,
  ctx: WrapContext,
  core: () => Promise<{ ok: boolean; output: string }>,
): Promise<{ ok: boolean; output: string; steps: string[] }> {
  const steps: string[] = [];
  // PRE — logic trước core.
  for (const step of preset.pre) {
    const r = await ctx.runStep(step, ctx.args);
    steps.push(`pre:${step}`);
    if (!r.ok) return { ok: false, output: r.output, steps };
  }
  // CORE — command gốc, nguyên vẹn.
  const coreResult = await core();
  steps.push(`core:${ctx.command}`);
  if (!coreResult.ok) return { ok: false, output: coreResult.output, steps };
  // POST — logic sau core (verify, report…).
  for (const step of preset.post) {
    const r = await ctx.runStep(step, { ...ctx.args, coreOutput: coreResult.output });
    steps.push(`post:${step}`);
    if (!r.ok) return { ok: false, output: r.output, steps };
  }
  return { ok: true, output: coreResult.output, steps };
}

/** Preset composition — ghép theo thứ tự: pre nối trước, post nối sau. */
export function composePresets(presets: WrapPreset[]): { pre: string[]; post: string[] } {
  return {
    pre: presets.flatMap((p) => p.pre),
    post: [...presets].reverse().flatMap((p) => p.post),   // post chạy ngược thứ tự
  };
}

/** Self-test preset — wrap chính command để test mà không sửa core. */
export function makeSelfTestPreset(name: string, command: string, verify: string): WrapPreset {
  return { name, strategy: "wrap", pre: [], post: [verify], commands: [command] };
}
// Nối registry: dispatch resolve preset → executeWithWrap quanh ToolImpl core
// Nối pkg: preset load qua manifest (apiVersion verify như extension)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Core ổn định — wrap không sửa core, upgrade an toàn | ❌ Nhiều lớp wrap — stack trace sâu, debug khó hơn |
| ✅ Biến thể rẻ — test/lean/scaffold chỉ là pre/post | ❌ Pre/post step lỗi — phải biết là lớp nào fail |
| ✅ Composition — ghép preset, không nhân bản | ❌ Thứ tự post đảo — dễ nhầm nếu không ghi rõ |
| ✅ Self-test — wrap command để test, không fork | ❌ Preset phụ thuộc core command tồn tại |

## Khác các hướng gần

| | AKG Wrap Preset | 377 Execution Order | 592 Hook Steer Contract |
|---|---|---|---|
| Trọng tâm | Lớp bọc quanh core command | Giữ thứ tự tool calls | Hooks steer agent |
| Cơ chế | pre → core → post | Persist theo thứ tự gọi | JSON trên stdin |
| Quan hệ | Biến thể command | Đảm bảo thứ tự khi wrap | Điều khiển hành vi ngoài |

## Khi nào chọn

- Nhiều biến thể cùng command (test/lean/scaffold) — không muốn fork core
- Muốn preset composition — ghép thay vì copy-paste
- Cần self-test command không sửa core
- Guard: core nguyên vẹn, pre/post rõ ràng, composition theo thứ tự, self-test preset