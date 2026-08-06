# Hướng ADQ: Command Rewrite Registry — single source of truth cho quyết định rewrite command

> **Nguồn gốc:** Hypa | **Coupling:** 🟡 — registry giữa CLI output và hiển thị | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn tools render; thiếu registry + reducers) | **Effort:** 2 tuần

## Nguồn gốc

**Hypa** (tool wrapper) có **ADRs/0005-command-rewrite-registry.md**: mọi quyết định **rewrite command output** phải qua một **registry** — single source of truth. Registry định nghĩa 3 đường: (1) **rewrite sang first-class command module** khi có reducer chuyên biệt (hiểu rõ format output); (2) **generic compression wrapper** khi an toàn (chỉ gọn lại, không hiểu sâu); (3) **passthrough** khi unsafe/interactive/streaming/unsupported — không đụng vào.

Điểm cốt lõi: **agent hooks, shell hooks, plugins đều phải delegate về registry** — không ai tự ý rewrite. Tránh tình trạng nhiều lớp rewrite chồng nhau, mỗi lớp hỏng theo cách riêng, và output bị méo mà không ai biết lớp nào gây ra.

## Mô tả

Với mya, registry nằm trong **`packages/tools`**: khi agent chạy lệnh (bash tool), output đi qua **RewriteRegistry** trước khi vào context. Registry lookup theo command name: có reducer module → dùng reducer; an toàn nén → generic wrapper; interactive/streaming → passthrough. Mỗi rewrite ghi audit (nối `packages/audit`) — biết output đã bị đổi bởi lớp nào. `packages/print` đã có skill-search render; registry là lớp quyết định trước khi render. Cần **marker** cho output đã rewrite (nối ADR filter-dsl tiers — degrade visible).

## Kiến trúc (ASCII)

```
  AGENT CHẠY LỆNH (bash tool)
    │  stdout/stderr
    ▼
  COMMAND REWRITE REGISTRY (single source of truth)
    ├─ có reducer module? ──► first-class rewrite (hiểu format)
    ├─ an toàn nén?      ──► generic compression wrapper
    └─ unsafe/interactive/streaming ──► PASSTHROUGH (không đụng)
            │
            ▼
  AUDIT: ghi lớp nào đã rewrite + marker trên output
            │
            ▼
  CONTEXT/PRINT (nối packages/print render)
  ⚠️ agent hooks · shell hooks · plugins ĐỀU phải delegate về registry
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools — ToolRegistry + dispatch + runToolBatch
//   (nơi chèn RewriteRegistry)
// ✅ packages/print — skill-search (render layer — sau registry)
// ✅ packages/audit — AuditLog (ghi lớp rewrite nào đã chạy)
// ✅ packages/core — ToolResult + DegradedResult (marker cho output đổi)
// ✅ packages/prompts — drift.ts (nền kiểm tra chất lượng sau rewrite)

// ❌ THIẾU: registry với 3 đường quyết định (module/compress/passthrough)
// ❌ THIẾU: reducer modules cho command phổ biến (git log, npm ls...)
// ❌ THIẾU: enforcement — hooks/plugins phải delegate, không tự rewrite
```

## Implementation

```typescript
// packages/tools/src/rewrite-registry.ts (NEW)
export type RewriteMode = "module" | "compress" | "passthrough";

export interface CommandRewriter {
  match: RegExp;                       // command name/pattern
  mode: RewriteMode;
  rewrite: (out: string, ctx: ExecCtx) => string;
  isUnsafe?: (args: string[]) => boolean; // interactive/streaming...
}

export class RewriteRegistry {
  private reducers = new Map<string, CommandRewriter>();

  register(r: CommandRewriter): void { this.reducers.set(r.match.source, r); }

  rewrite(cmd: string, args: string[], out: string, ctx: ExecCtx): string {
    // 1. tìm reducer chuyên biệt — first-class rewrite
    for (const r of this.reducers.values()) {
      if (r.match.test(cmd) && !(r.isUnsafe?.(args) ?? false)) {
        audit.log("tool", { rewrite: r.mode, cmd });   // audit lớp đã chạy
        return r.rewrite(out, ctx);
      }
    }
    // 2. an toàn? generic compression (chỉ gọn lại)
    if (out.length > 8_000 && !isStreaming(cmd, args)) {
      audit.log("tool", { rewrite: "compress", cmd });
      return compress(out) + `\n<!-- [rewritten by registry] -->`;
    }
    // 3. unsafe/interactive/streaming → passthrough
    return out;
  }
}

export const registry = new RewriteRegistry(); // hooks/plugins delegate về đây
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nơi quyết định — hết rewrite chồng lớp | ❌ Reducer viết riêng cho từng command |
| ✅ Passthrough cho unsafe — không hỏng output | ❌ Enforcement khó — plugin vẫn có thể tự ý |
| ✅ Audit lớp nào đổi output | ❌ Generic compress có thể cắt ý |
| ✅ Marker trên output đã rewrite | ❌ Registry phải cập nhật khi command đổi format |

## Khác các hướng gần

| | ADQ Rewrite Registry | ADR Filter DSL | AEF Cascade Replace |
|---|---|---|---|
| Đổi gì | Output command | Dòng output (ANSI/regex) | Source code |
| Quyết định | module/compress/passthrough | 3 tier parse | 5 chiến lược khớp |
| An toàn | Passthrough khi unsafe | Degrade có marker | Reject khi nhiều candidate |

## Khi nào chọn

- Nhiều lớp (hooks/plugins) cùng rewrite output — cần một nơi quyết định
- Command output dài tốn context — cần nén có kiểm soát
- Đã có tools registry + audit — thêm rewrite registry
- Interactive/streaming command phải chạy nguyên vẹn