# Hướng ACI: Heuristic Directory Suggestion — engine gợi ý directory dựa trên workspace members, local deps, git submodules, build context

> **Nguồn gốc:** pi-add-dir (autoresearch.md) | **Coupling:** 🟢 — module gợi ý độc lập, chỉ đọc workspace | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có auto-discover tools — chưa có heuristic workspace analysis) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-add-dir** gợi ý directory cần thêm dựa trên **nhiều heuristics**: (1) **workspace members** — npm/pnpm/Cargo/Go/uv workspaces (package.json workspaces, Cargo.toml members, go.work, uv workspace); (2) **local deps** — `file:`/`link:`/`portal:` trong package.json (dependency trỏ vào directory local); (3) **git submodules**; (4) **Docker Compose build context** (services build từ dir khác); (5) **TS project references**; (6) **Gradle multi-project**. Engine được **benchmark F1 trên 39 scenario** và có **git-root caching + depth limit** để chống false-positive. Nguyên tắc: **gợi ý từ tín hiệu project thật, không hardcode path, đo bằng F1**.

## Mô tả

mya heuristic directory suggestion: (1) **signal collectors** — mỗi heuristic là một collector trả về `{ path, signal, confidence }` (đọc package.json / Cargo.toml / .gitmodules / docker-compose.yml / tsconfig.json / settings.gradle); (2) **fusion + dedupe** — gộp các collector, loại trùng path, ưu tiên confidence; (3) **git-root caching** — cache root workspace theo git root để không quét lại; (4) **depth limit** — không đệ quy vô hạn (tránh false-positive từ node_modules/deep dir); (5) **F1 benchmark** — 39 scenario đã biết, đo precision/recall. Nối ACH (external-dir-context-loading) — ACI sinh danh sách gợi ý, ACH load chúng.

## Kiến trúc

```
  WORKSPACE (cwd + git root)
       ▼
  SIGNAL COLLECTORS
    ├─ workspace members  (npm/pnpm/Cargo/Go/uv)
    ├─ local deps         (file:/link:/portal:)
    ├─ git submodules     (.gitmodules)
    ├─ Docker build ctx   (docker-compose.yml)
    ├─ TS project refs    (tsconfig.json references)
    └─ Gradle multi-proj  (settings.gradle)
       │  { path, signal, confidence }
       ▼
  FUSION + DEDUPE (git-root caching · depth limit)
       ▼
  SUGGESTIONS (ranked — genuine project signals, không hardcode)
       ▼  (nối ACH: /add-dir từ suggestion)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools auto-discover.ts — autoDiscoverTools(dir) (nền — pattern discover)
// ✅ packages/tools find.ts — globToRegex (nền — tìm manifest files)
// ✅ packages/tools lsp-client.ts — TS project refs qua LSP (nền — TS heuristic)
// ✅ packages/tools codegraph.ts — project structure analysis (nền — workspace hiểu)
// ✅ packages/gateway provider-registry.ts — registry pattern (nền — collector registry)

// ❌ THIẾU: signal collectors (workspace members / local deps / submodules / docker)
// ❌ THIẾU: fusion + dedupe + confidence ranking
// ❌ THIẾU: git-root caching + depth limit
// ❌ THIẾU: F1 benchmark suite (39 scenario)
```
## Implementation
```typescript
// packages/tools/src/dir-suggest.ts (MỚI)
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
export interface DirSignal {
  path: string;
  signal: "workspace-member" | "local-dep" | "git-submodule" | "docker-context" | "ts-ref" | "gradle";
  confidence: number;
}
const MAX_DEPTH = 4; // depth limit — chống false-positive
/** Collect npm workspace members + local deps (file:/link:/portal:). */
async function npmSignals(root: string): Promise<DirSignal[]> {
  const out: DirSignal[] = [];
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      workspaces?: string[]; dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    for (const w of pkg.workspaces ?? []) {
      if (w.includes("*")) continue; // glob workspace — quá rộng
      out.push({ path: resolve(root, w), signal: "workspace-member", confidence: 0.9 });
    }
    for (const [name, spec] of { ...pkg.dependencies, ...pkg.devDependencies }) {
      if (spec.startsWith("file:") || spec.startsWith("link:") || spec.startsWith("portal:")) {
        out.push({ path: resolve(root, spec.slice(spec.indexOf(":") + 1)), signal: "local-dep", confidence: 0.85 });
      }
    }
  } catch { /* không phải npm project */ }
  return out;
}
/** Collect git submodules. */
async function gitSubmoduleSignals(root: string): Promise<DirSignal[]> {
  try {
    const text = await readFile(join(root, ".gitmodules"), "utf8");
    return [...text.matchAll(/path\s*=\s*(\S+)/g)].map((m) => ({
      path: resolve(root, m[1]!),
      signal: "git-submodule" as const,
      confidence: 0.95,
    }));
  } catch {
    return [];
  }
}
/** Fusion + dedupe — gộp collector, loại trùng, ưu tiên confidence. */
export async function suggestDirs(root: string): Promise<DirSignal[]> {
  const all = [
    ...(await npmSignals(root)),
    ...(await gitSubmoduleSignals(root)),
  ];
  const byPath = new Map<string, DirSignal>();
  for (const s of all) {
    const prev = byPath.get(s.path);
    if (!prev || s.confidence > prev.confidence) byPath.set(s.path, s);
  }
  return [...byPath.values()].sort((a, b) => b.confidence - a.confidence);
}
//        depth ≤ MAX_DEPTH, git-root cache: Map<gitRoot, signals[]>
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Gợi ý từ tín hiệu project thật — không hardcode path | ❌ Collector phải bám format từng toolchain (npm/Cargo/Go…) |
| ✅ F1 benchmark — precision/recall đo được | ❌ False-positive vẫn có (glob workspace, nested deps) |
| ✅ Git-root caching — không quét lại mỗi lần | ❌ Depth limit có thể bỏ sót dir sâu hợp lệ |
| ✅ Nhiều signal nguồn — phủ rộng | ❌ Confidence thủ công — cần calibrate theo scenario |

## Khác các hướng gần

| | autoDiscoverTools (tools) | ACI: Dir Suggestion |
|---|---|---|
| Đối tượng | Tool files (export const xxxTool) | **Directory cần thêm context** |
| Tín hiệu | Code pattern | **Workspace/deps/submodule/build config** |
| Output | Tên tool | **Đường dẫn + signal + confidence** |
| Đo lường | Không benchmark | **F1 trên 39 scenario** |

## Khi nào chọn

- Agent hay cần reference shared library / project khác — gợi ý giảm thao tác tay
- Muốn /add-dir (ACH) có danh sách thông minh thay vì gõ path
- Workspace phức tạp (monorepo, submodules, docker multi-context)
- Guard: benchmark F1 bắt buộc, depth limit, git-root cache, không hardcode
