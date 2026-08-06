# Hướng AIJ: Flat-Domain-DAG-Architecture — codebase tổ chức theo Flat Domain DAG: import local phải là directed acyclic graph, domain file cohesive, cấm shared `constants.ts`/`types.ts` bucket; invariant tests bảo vệ acyclic imports, Pi SDK imports tập trung ở adapter `lib/pi.ts`, `index.ts` chỉ là composition root

> **Nguồn gốc:** pi-telegram | **Coupling:** 🟢 — codebase architecture | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có modular packages; chưa có DAG invariant test + ban bucket files) | **Effort:** 1 tuần (invariant tests)

## Nguồn gốc

**pi-telegram** codebase tổ chức theo **Flat Domain DAG**: import local phải là **directed acyclic graph**, domain file cohesive, **cấm shared `constants.ts`/`types.ts` bucket**; **invariant tests** bảo vệ acyclic imports, **Pi SDK imports tập trung ở adapter `lib/pi.ts`**, **`index.ts` chỉ là composition root**. Nguyên tắc: **DAG imports** — không cycle (compile-time safety); **domain cohesion** — mỗi file một domain, không bucket god-file; **adapter isolation** — SDK dependency cô đặc 1 chỗ (`lib/pi.ts`); **composition root** — `index.ts` chỉ wire, không logic.

## Mô tả

Với mya, pattern = **flat domain DAG với invariant tests**: (1) mya đã có **modular packages** (packages/*) — mỗi package cohesive; (2) mya có base-adapter extraction note "break the circular dependency" (channels) — đã ý thức cycle; (3) AIJ thêm **DAG invariant test** — parse imports, detect cycle, fail build; (4) **ban bucket files** — lint cấm `constants.ts`/`types.ts` catch-all (epicenter rot); (5) **adapter concentration** — external SDK import chỉ ở adapter file; (6) **composition root** — index.ts chỉ re-export/wire.

## Kiến trúc (ASCII)

```
  FLAT DOMAIN DAG (imports = directed edges, KHÔNG cycle)
    queue.ts ──► turn.ts ──► loop.ts        (DAG — compile-safe)
       ▲           │
       │           ▼
       └──── (cycle = FAIL invariant test)

  ❌ BUCKET FILES (cấm):
     constants.ts  ← mọi thứ đổ vào = god-file rot
     types.ts      ← catch-all = cohesion mất

  ✅ ADAPTER ISOLATION:
     lib/pi.ts  ← duy nhất import @pi/sdk (cô đặc external dep)
     domain/*.ts ← KHÔNG import sdk trực tiếp (qua adapter)

  index.ts = COMPOSITION ROOT (chỉ wire, không logic)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/* — modular packages (mỗi package cohesive)
// ✅ packages/channels base-adapter.ts — "Extracted to break circular dependency"
//   (đã ý thức cycle — DAG mindset có sẵn)
// ✅ packages/gateway channel-bridge.ts — adapter pattern (isolation)
// ✅ packages/core — composition (barrel-smoke.test.ts check barrel)

// ❌ THIẾU: DAG invariant test (detect import cycle auto)
// ❌ THIẾU: lint ban bucket files (constants.ts/types.ts catch-all)
// ❌ THIẾU: adapter concentration rule (sdk import chỉ 1 file)
```

## Implementation

```typescript
// scripts/check-dag.mjs (NEW — invariant test)
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

/** Parse local imports, detect cycle (DFS) — fail build if cyclic. */
function localImports(file, srcDir) {
  const src = readFileSync(file, "utf8");
  const out = [];
  for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    out.push(m[1]); // relative import
  }
  return out;
}
export function assertAcyclic(srcDir) {
  const files = readdirSync(srcDir).filter((f) => extname(f) === ".ts" && !f.endsWith(".test.ts"));
  const adj = new Map(files.map((f) => [f, localImports(join(srcDir, f), srcDir)]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(files.map((f) => [f, WHITE]));
  function dfs(node, path) {
    if (color.get(node) === GRAY) throw new Error(`CYCLE: ${[...path, node].join(" → ")}`);
    if (color.get(node) === BLACK) return;
    color.set(node, GRAY);
    for (const next of adj.get(node) ?? []) if (files.includes(next)) dfs(next, [...path, node]);
    color.set(node, BLACK);
  }
  for (const f of files) dfs(f, []);
}
// Ban bucket: lint rule flag files named constants.ts/types.ts with >N exports.
// vitest: it("imports are acyclic", () => assertAcyclic("src"));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Compile-time safety — không cycle | ❌ Invariant test thêm build time |
| ✅ Domain cohesion — không bucket rot | ❌ Ban bucket tằn tiện — đôi khi types.ts hợp lý |
| ✅ Adapter isolation — SDK dep cô đặc | ❌ Adapter concentration cứng — đôi khi verbose |
| ✅ Composition root rõ | ❌ Refactor breaking cycle tốn công |

## Khác các hướng gần

| | AIJ Flat-Domain-DAG-Architecture | AIH Singleton-Lock-Registry | AIL Demand-Driven-Thread-Reconciler |
|---|---|---|---|
| Trọng tâm | Codebase structure (DAG) | Singleton lock | Thread lifecycle |
| Cơ chế | Invariant test + ban bucket + adapter | Shared registry + identity | State machine + proof |
| Quan hệ | Architectural constraint | Runtime lock | Runtime reconcile |

## Khi nào chọn

- Codebase lớn → cần compile-time safety (no cycle)
- Tránh bucket god-file rot (constants.ts/types.ts)
- Muốn SDK dependency cô đặc (adapter isolation)
- Guard: DAG invariant test auto, ban bucket lint, adapter concentration rule, composition root discipline
