# Hướng AAD: Infrastructure-as-Code Indexing — index Dockerfile/K8s manifests/Kustomize overlays thành graph nodes

> **Nguồn gốc:** codebase-memory-mcp (README.md) | **Coupling:** 🟢 — thêm IaC parser vào codegraph pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codegraph import graph — chưa có IaC resource nodes) | **Effort:** 2 tuần

## Nguồn gốc

**codebase-memory-mcp** index **hạ tầng như code**: Dockerfile, Kubernetes manifests, Kustomize overlays thành **graph nodes** — **Resource nodes** cho K8s kinds (Deployment, Service, ConfigMap…), **Module nodes** với **IMPORTS edges** (base → overlay, image → Dockerfile). Agent truy vấn hạ tầng bằng cùng graph với code: `related("deployment/api")` trả về các manifest/config liên quan. Nguyên tắc: **một graph thống nhất cho code + hạ tầng** — deployment, base overlay, image reference đều là node/edge truy vấn được.

## Mô tả

mya infrastructure-as-code indexing: mở rộng packages/tools codegraph.ts (import graph cho TS/JS/Python/Rust) với **IaC extractor**: parse Dockerfile (`FROM image` → edge `image`), K8s manifests (`kind:` → Resource node, `metadata.name` → id, `spec.template.spec.containers[].image` → edge tới image), Kustomize (`bases:` + `resources:` → IMPORTS edges giữa overlay và base). Output: **IaC graph layer** chung node/edge format với codegraph — `related()` query được cả hai. Agent dùng để trả lời "deployment này dùng image nào / overlay nào override base nào".

## Kiến trúc

```
  IaC FILES
  ├─ Dockerfile          ──► ResourceNode { kind:"image",   id:"nginx:1.25" }
  ├─ deployment.yaml     ──► ResourceNode { kind:"Deployment", id:"api" }
  ├─ configmap.yaml      ──► ResourceNode { kind:"ConfigMap",  id:"api-config" }
  └─ kustomization.yaml  ──► ModuleNode   { kind:"overlay",    id:"prod" }
        │
        ▼
  ┌─── IAC EXTRACTOR ──────────────────────────────────┐
  │  Dockerfile: FROM nginx → edge (api → image nginx)  │
  │  K8s: containers[].image → edge (Deployment → image)│
  │  Kustomize: bases: base/ → IMPORTS (overlay → base) │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── SHARED GRAPH (codegraph node/edge format) ──────┐
  │  related("api") → { configmap, image, overlay }     │
  │  → agent truy vấn hạ tầng như code                  │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codegraph.ts — import graph + related() (nền cho node/edge)
// ✅ packages/tools graph-store.ts — GraphStore (nền cho lưu IaC nodes)
// ✅ packages/tools symbol-extractor.ts — per-language extractor (nền cho IaC parser)
// ✅ packages/tools lsp-cascade.ts — BFS impact (nền cho blast radius hạ tầng)
// ✅ packages/memory code-index.ts — semantic code index (nền cho IaC search)

// ❌ THIẾU: IaC extractor (Dockerfile/K8s/Kustomize → nodes+edges)
// ❌ THIẾU: unified query (related() gộp code + hạ tầng)
```

## Implementation

```typescript
// packages/tools/src/iac-index.ts (NEW)
import { readFile } from "node:fs/promises";
import type { Codegraph } from "./codegraph.js";

export interface IacNode {
  kind: "image" | "Deployment" | "ConfigMap" | "Service" | "overlay" | "base";
  id: string;          // "nginx:1.25" | "api" | "prod"
  file: string;
}

const K8S_KINDS = new Set(["Deployment", "ConfigMap", "Service", "StatefulSet", "DaemonSet", "Secret"]);

/** Parse một manifest YAML-ish (MVP: regex — không kéo dep YAML). */
export function parseK8sManifest(src: string, file: string): IacNode[] {
  const nodes: IacNode[] = [];
  const kind = src.match(/^kind:\s*(\w+)/m)?.[1];
  const name = src.match(/^metadata:[\s\S]*?^\s+name:\s*([\w-]+)/m)?.[1];
  if (kind && K8S_KINDS.has(kind) && name) nodes.push({ kind: kind as IacNode["kind"], id: name, file });
  const image = src.match(/image:\s*([^\s"']+)/);
  if (image) nodes.push({ kind: "image", id: image[1]!, file });
  return nodes;
}

/** Parse Dockerfile: FROM → image node. */
export function parseDockerfile(src: string, file: string): IacNode[] {
  const nodes: IacNode[] = [];
  for (const m of src.matchAll(/^\s*FROM\s+([^\s]+)/gm)) nodes.push({ kind: "image", id: m[1]!, file });
  return nodes;
}

/** Gộp vào graph: node + edge (file → node; K8s → image; overlay → base). */
export async function indexIaC(graph: Codegraph, files: string[]): Promise<number> {
  let added = 0;
  for (const f of files) {
    const src = await readFile(f, "utf8").catch(() => "");
    const nodes = f.endsWith("Dockerfile")
      ? parseDockerfile(src, f)
      : f.endsWith("kustomization.yaml")
        ? [{ kind: "overlay", id: f.split("/").at(-2) ?? "overlay", file: f }]
        : parseK8sManifest(src, f);
    for (const n of nodes) {
      graph.edges.set(f, new Set([...(graph.edges.get(f) ?? []), `${n.kind}:${n.id}`]));
      added++;
    }
  }
  return added;
}
// Usage: related("api") → node Deployment:api + edge tới image — query như code
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một graph cho code + hạ tầng — query thống nhất | ❌ Regex parser thiếu YAML phức tạp (multi-doc, anchors) |
| ✅ Agent truy vấn deployment/image/overlay như code | ❌ Edge semantics khác (image ≠ import) — cần nhãn rõ |
| ✅ Blast radius: đổi image → tìm deployment dùng nó | ❌ Kustomize inheritance (patch/merge) không đầy đủ |
| ✅ Rẻ — không cần cluster/K8s API | ❌ File lớn multi-doc manifest dễ miss node |

## Khác các hướng gần

| | Codegraph (code) | AAD: IaC Indexing |
|---|---|---|
| Input | TS/JS/Python/Rust source | **Dockerfile/K8s/Kustomize** |
| Node | File import | **Resource/Module/Image** |
| Query | related() | **Cùng related() — gộp** |
| Mối quan hệ | Nền | **Layer mở rộng trên cùng graph** |

## Khi nào chọn

- Repo có hạ tầng (Docker/K8s/Kustomize) mà agent cần hiểu deployment
- Đã có codegraph — thêm IaC extractor, giữ cùng format node/edge
- MVP: regex parser; nâng cấp YAML parser khi cần multi-doc
- Guard: nhãn edge rõ (`imports` vs `uses-image` vs `overlays`), đổi image → cascade tìm deployment
