# Hướng AKH: Adaptive Stack Detection — hooks yêu cầu detect version stack từ pom.xml/package.json trước khi viết code, mirror style từ 1-2 file cùng package, "không giả định version"

> **Nguồn gốc:** vetc-dev-kit (hooks/hooks.json, rules/common.md) | **Coupling:** 🟢 — pre-write detection, gắn qua hook | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có registry + codegraph; thiếu stack detector) | **Effort:** 1 tuần

## Nguồn gốc

**vetc-dev-kit** (hooks/hooks.json, rules/common.md) có hooks yêu cầu **detect version stack trước khi viết code**: (1) **detect version stack từ pom.xml/package.json** — đọc manifest của project để biết framework/version thật đang dùng (Java: pom.xml — Spring Boot 3? Java 17?; TS: package.json — React 18? Next 14?); (2) **mirror style từ 1-2 file cùng package** — trước khi viết file mới, đọc 1-2 file cùng package để bắt chước style (import pattern, error handling, naming); (3) **"không giả định version"** — rule cứng: không đoán version, không viết code theo version "mình nghĩ" — version phải đọc từ manifest; (4) **chống code không khớp phiên bản framework** — code viết theo version cũ/mới hơn thực tế → fail build/runtime — detect trước chặn từ gốc.

Giá trị: (1) **code khớp stack thật** — không viết API không tồn tại ở version project; (2) **style nhất quán** — file mới trông như file cũ trong package; (3) **deterministic** — đọc manifest + file thật, không đoán; (4) **chống lỗi version** — phiền nhất khi migrate framework — bắt trước khi code.

## Mô tả

Với mya, pattern = **pre-write stack detection**: (1) **stack detector** — đọc manifest: package.json (deps + devDeps versions), pom.xml (parent + dependencies), Cargo.toml, go.mod — trả `StackInfo { language, framework, versions: Map }`; (2) **style mirror** — trước khi write: chọn 1-2 file cùng thư mục/package → đọc → extract style (import style, quotes, error handling) → dùng làm reference; (3) **hook gate** — gắn pre-write hook (mya có ToolHookSink preTool trong core types): khi tool `write` được gọi → chạy detect → kết quả nhúng vào context (hoặc chặn nếu không detect được — cấm viết mù); (4) **no-assumption rule** — không có manifest → nêu rõ "chưa biết stack" chứ không đoán; (5) nơi gắn — `packages/tools` (write tool + hooks — `packages/core/src/types.ts` ToolHookSink preTool), `packages/tools/src/codegraph.ts` (file cùng package). Đây là pattern **environment-derived coding standards**: style và version lấy từ project thật, không từ giả định.

## Kiến trúc (ASCII)

```
  WRITE FILE MỚI (tool write được gọi)
    │
    ▼ PRE-WRITE HOOK (ToolHookSink preTool — core types)
  ├─ 1. DETECT STACK từ manifest
  │      package.json → React 18, TS 5.4 · pom.xml → Spring Boot 3, Java 17
  │      ("không giả định version" — phải đọc manifest)
  ├─ 2. MIRROR STYLE — đọc 1-2 file cùng package
  │      import pattern, naming, error handling → reference
  └─ 3. KHÔNG CÓ MANIFEST ──► nêu rõ "chưa biết stack" — CẤM viết mù
    │
    ▼ WRITE (code khớp version thật + style package)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/types.ts — ToolHookSink preTool (nơi gắn detect hook) · registry.ts (write tool)
// ✅ packages/tools/src/codegraph.ts — code graph · lsp-cascade.ts — runCascade (nền)
// ❌ THIẾU: stack detector (manifest parser) · style mirror (1-2 file cùng package) · no-assumption gate
```

## Implementation

```typescript
// packages/tools/src/stack-detect.ts (NEW)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface StackInfo {
  language: "typescript" | "java" | "rust" | "go" | "unknown";
  framework: string;                    // "react" | "spring-boot" | "axum"…
  versions: Map<string, string>;        // dep → version thật (từ manifest)
  manifest: string | null;              // file manifest đã đọc
}

/** Detect stack từ manifest — KHÔNG giả định version. */
export function detectStack(dir: string): StackInfo {
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const versions = new Map<string, string>();
    for (const [name, ver] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      versions.set(name, String(ver).replace(/^[\^~]/, ""));   // "^18.2.0" → "18.2.0"
    }
    return {
      language: "typescript",
      framework: versions.get("react") ? "react" : versions.get("next") ? "next" : "node",
      versions,
      manifest: pkgPath,
    };
  }
  const pomPath = join(dir, "pom.xml");
  if (existsSync(pomPath)) {
    const pom = readFileSync(pomPath, "utf8");
    const spring = /spring-boot/i.test(pom);
    return {
      language: "java",
      framework: spring ? "spring-boot" : "java",
      versions: new Map([["java", /<java.version>([^<]+)/.exec(pom)?.[1] ?? "unknown"]]),
      manifest: pomPath,
    };
  }
  return { language: "unknown", framework: "unknown", versions: new Map(), manifest: null };   // Cargo.toml/go.mod tương tự
}

/** Style mirror — đọc 1-2 file cùng package trước khi viết. */
export function mirrorStyle(targetFile: string, siblingFiles: string[], read: (f: string) => string): { reference: string; style: string } {
  const reference = siblingFiles[0] ?? targetFile;
  const style = read(reference);
  return { reference, style: style.slice(0, 1200) };   // extract mẫu style
}

/** No-assumption gate — không có manifest → cấm viết mù (nêu rõ, không đoán). */
export function assertStackKnown(stack: StackInfo): { ok: boolean; reason: string } {
  return stack.language !== "unknown"
    ? { ok: true, reason: "" }
    : { ok: false, reason: "chưa có manifest (package.json/pom.xml/...) — không giả định version stack, detect trước" };
}

/** Pre-write hook — detect + mirror rồi mới cho write. */
export function preWriteGate(dir: string, targetFile: string, siblings: string[], read: (f: string) => string): { allowed: boolean; stack: StackInfo; styleNote?: string } {
  const stack = detectStack(dir);
  const gate = assertStackKnown(stack);
  if (!gate.ok) return { allowed: false, stack };
  const { style } = mirrorStyle(targetFile, siblings, read);
  return { allowed: true, stack, styleNote: `style mirror từ ${siblings[0] ?? targetFile}` };
}
// Nối hooks: preTool hook gọi preWriteGate cho tool write — chặn viết mù
// Nối lsp-cascade: sau write, validate diagnostics theo stack version thật
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Code khớp stack thật — không gọi API version khác | ❌ Manifest đọc thiếu (workspace multi-package) — cần scan |
| ✅ Style nhất quán — file mới như file cũ trong package | ❌ Style mirror chỉ 1-2 file — có thể lệch chuẩn chung |
| ✅ Deterministic — đọc manifest, không đoán | ❌ Framework mới chưa có detector — thêm parser |
| ✅ Chống lỗi version khi migrate | ❌ Chặn write khi không có manifest — có thể phiền (dự án sạch) |

## Khác các hướng gần

| | AKH Stack Detection | 728 Framework Detection | 719 Platform Portability |
|---|---|---|---|
| Trọng tâm | Version stack trước write | Plugin detect framework | Rule xuyên máy |
| Cơ chế | Đọc manifest + mirror style | 123 plugins declarative | Relative path + rules |
| Quan hệ | Version cụ thể | Nhận diện stack tổng quát | Ràng buộc di động |

## Khi nào chọn

- Project đa framework/version — code dễ viết sai API version
- Muốn file mới nhất quán style với package hiện có
- Migrate framework — detect version thật trước khi viết
- Guard: đọc manifest, không giả định version, mirror style, không manifest → nêu rõ/cấm viết mù