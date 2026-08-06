# Hướng WL: Directory Trust Gate — project có resources thì confirm trust lần đầu; trust.json apply theo nearest ancestor dir

> **Nguồn gốc:** pi `project trust` (project có `resources` → confirm trust lần đầu; `trust.json` apply theo nearest ancestor directory); "project trust confirmation", "trust.json nearest ancestor", "scoped trust by directory" | **Coupling:** 🟡 — thêm trust-gate + nearest-ancestor lookup vào permission/trust layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (permission + trust sẵn — chưa có resource-trust confirm + nearest-ancestor trust.json) | **Effort:** 2 tuần

## Nguồn gốc

**pi** khi project có **resources** (file/script cần quyền truy cập) → **confirm trust lần đầu**: hỏi user "trust this project?" → nếu yes → ghi `trust.json`. Điểm quan trọng: `trust.json` **apply theo nearest ancestor dir** — trust scope theo thư mục. Khi agent truy cập path `/a/b/c/file`, hệ thống tìm `trust.json` **gần nhất** đi lên cây thư mục (`/a/b/trust.json` → `/a/trust.json` → `/trust.json`) → trust đó apply cho `/a/b/c/file`. Nguyên tắc: **trust first-use + nearest-ancestor scope** — không trust global, trust theo directory hierarchy.

## Mô tả

mya directory trust gate: (1) **Resource detection**: project có resources (tools, scripts, file access) → flag cần trust. (2) **First-use confirm**: agent lần đầu truy cập → confirm user "trust this directory?" → yes → ghi `trust.json` ở dir đó. (3) **Nearest-ancestor lookup**: truy cập path → đi lên cây dir tìm `trust.json` gần nhất → trust đó apply. (4) **Scoped**: trust dir A không tự nhiên trust dir B (con của A thì inherit). mya có permission + trust — WL thêm **resource-trust confirm** + **nearest-ancestor trust.json lookup**.

## Kiến trúc

```
  DIRECTORY TREE:
  /project/
  ├── trust.json          ← trust: { tools: ["read","write"] }
  ├── src/
  │   ├── trust.json      ← trust: { tools: ["read"] } (override parent)
  │   └── index.ts
  └── secret/
      └── key.pem         ← KHÔNG có trust.json → inherit /project/trust.json

  AGENT TRUY CẬP: /project/src/index.ts
        │
        ▼
  ┌─── NEAREST-ANCESTOR LOOKUP ──────────────────────────┐
  │  1. /project/src/ → trust.json? ✅ FOUND              │
  │     → trust = { tools: ["read"] } (nearest)           │
  │     → STOP (nearest wins)                              │
  │  (không cần xem /project/trust.json — nearest override)│
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── TRUST CHECK ──────────────────────────────────────┐
  │  action: write /project/src/index.ts                  │
  │  trust (nearest /project/src): tools = ["read"]       │
  │  → write KHÔNG trong ["read"] → DENY (need trust)     │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── FIRST-USE CONFIRM (nếu chưa trust) ───────────────┐
  │  "Trust /project/src/ for write? [y/N]"               │
  │  yes → ghi /project/src/trust.json { tools:["read","write"] }│
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools permission.ts — permission check (nền — WL trust gate ở đây)
// ✅ packages/secrets — trust/secret (nền — WL trust.json analog)
// ✅ packages/core threat-scan.ts — threat scan (nền — WL resource detection)
// ✅ packages/555 UI permission-mode — permission mode (nền — WL first-use confirm)

// ❌ THIẾU: resource-trust confirm (first-use → confirm → trust.json)
// ❌ THIẾU: nearest-ancestor trust.json lookup (đi lên cây dir)
// ❌ THIẾU: scoped trust inheritance (child inherit nearest parent)
```

## Implementation

```typescript
// packages/tools/src/directory-trust-gate.ts (MỚI)
import { dirname, join } from "node:path";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";

interface TrustEntry { tools: string[] }

// nearest-ancestor lookup: đi lên cây dir tìm trust.json gần nhất
function findNearestTrust(filePath: string, root = "/"): TrustEntry | null {
  let dir = dirname(filePath);
  while (dir !== root) {
    const trustPath = join(dir, "trust.json");
    if (existsSync(trustPath)) {
      return JSON.parse(readFileSync(trustPath, "utf8")) as TrustEntry; // nearest wins
    }
    dir = dirname(dir);
  }
  return null; // không trust → need confirm
}

class DirectoryTrustGate {
  // check trust for action on path → deny if not trusted
  check(path: string, tool: string): { trusted: boolean; needsConfirm: boolean } {
    const trust = findNearestTrust(path);
    if (!trust) return { trusted: false, needsConfirm: true }; // no trust.json → confirm
    if (!trust.tools.includes(tool)) return { trusted: false, needsConfirm: true }; // tool not trusted
    return { trusted: true, needsConfirm: false };
  }

  // first-use confirm → ghi trust.json tại directory gần nhất
  confirm(path: string, tool: string): void {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const trustPath = join(dir, "trust.json");
    const existing = existsSync(trustPath) ? JSON.parse(readFileSync(trustPath, "utf8")) as TrustEntry : { tools: [] };
    if (!existing.tools.includes(tool)) existing.tools.push(tool);
    writeFileSync(trustPath, JSON.stringify(existing, null, 2));
  }
}

// Usage:
// const gate = new DirectoryTrustGate();
// const { trusted, needsConfirm } = gate.check("/project/src/index.ts", "write");
// if (!trusted && needsConfirm) { /* confirm user */ gate.confirm(path, "write"); }
```

## Được

- ✅ Scoped trust (trust dir A không tự nhiên trust toàn disk — least privilege)
- ✅ Nearest-ancestor override (sub-dir trust override parent — flexible)
- ✅ First-use safety (chưa trust → confirm — không auto-trust)
- ✅ Inheritance (child inherit nearest parent trust — tiện)

## Mất

- ❌ Lookup cost (mỗi access → đi lên cây dir đọc trust.json — I/O)
- ❌ Trust sprawl (nhiều dir → nhiều trust.json — khó quản lý)
- ❌ Override confusion (child override parent → user không nhớ đâu apply)
- ❌ Confirm fatigue (nhiều first-use → nhiều prompt → user accept mù)

## Khác

Khác **global trust** (trust toàn workspace) — WL **directory-scoped** (nearest ancestor). Khác **124 dynamic-permissions** (per-tool dynamic) — WL **directory-based** (trust theo path). Khác **133 agent-sandbox** (isolate agent) — WL **scoped grant** (trust specific dir, không isolate).

## Khi nào chọn

- Project có resources nhạy cảm (script, file) → cần trust gate first-use
- Muốn scoped trust (dir A trust, dir B không — least privilege)
- Cần hierarchical override (sub-dir trust riêng, override parent)
- Nối packages/tools permission.ts + packages/secrets + packages/core threat-scan.ts + 555 UI; guard nearest-ancestor-cache (cache lookup — không đọc disk mỗi access), confirm-fatigue-reduction (batch confirm — không prompt từng tool), và trust-audit (log trust.json change — traceable); WL = directory trust gate, kết hợp 124 dynamic-permissions (per-tool) + 133 agent-sandbox (isolate alternative)
