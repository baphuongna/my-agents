# Hướng AFX: Auxiliary LSP Scanner — Opengrep chạy như auxiliary LSP đính kèm cạnh LSP chính; ruleset compile 1 lần/session nên scan mỗi file ~1-2s thay vì ~8s CLI cold; `role:"auxiliary"` là seam cho scanner chéo khác

> **Nguồn gốc:** pi-lens (docs/features.md) | **Coupling:** 🟡 — cần LSP protocol + scanner ruleset | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có lsp-client + threat-scan, thiếu auxiliary-LSP scanner) | **Effort:** 2 tuần

## Nguồn gốc

**pi-lens** chạy **Opengrep như auxiliary LSP** — đính kèm cạnh LSP chính (clangd/tsserver), dùng chung protocol (didOpen/diagnostic) nhưng `role:"auxiliary"` đánh dấu là scanner phụ. **Ruleset compile 1 lần/session** nên scan mỗi file chỉ **~1-2s** (AST/index sẵn) thay vì **~8s CLI cold** (khởi động lại mỗi lần). `role:"auxiliary"` là **seam** — chỗ cắm scanner chéo khác (semgrep/custom) mà không động LSP chính. Nguyên tắc: **scanner như LSP phụ, compile một lần, role làm seam mở rộng**.

## Mô tả

mya auxiliary-lsp-scanner: (1) **LSP protocol đã sẵn** — `packages/tools` lsp-client.ts (didOpen/diagnostic/request); (2) **scanner đã sẵn** — `packages/tools` threat-scan.ts (pattern scan); (3) **auxiliary LSP** — Opengrep chạy role:"auxiliary", nhận didOpen → scan → diagnostic; (4) **ruleset compile once** — compile ruleset 1 lần/session, reuse; (5) **seam** — role field cho scanner khác cắm vào. Nối AFV (LSP lifecycle).

## Kiến trúc (ASCII)

```
  LSP CHÍNH (clangd/tsserver) ──── didOpen/diagnostic ──── symbols
       │
       │  (cạnh, song song)
       ▼
  AUXILIARY LSP (Opengrep, role:"auxiliary")
       │  cùng protocol LSP (didOpen → diagnostic)
       │  ruleset compile 1 LẦN / session (AST/index sẵn)
       ▼  scan mỗi file ~1-2s (vs ~8s CLI cold)
  diagnostic (security/quality findings)

  role:"auxiliary" = SEAM ──▶ cắm scanner khác (semgrep/custom) không động LSP chính
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools lsp-client.ts — LSP protocol (didOpen/diagnostic/request)
// ✅ packages/tools lsp-cascade.ts — multi-LSP cascade nền
// ✅ packages/tools threat-scan.ts — pattern scanner (security)
// ✅ packages/tools codegraph.ts — graph/AST nền

// ❌ THIẾU: auxiliary LSP wrapper (Opengrep role:"auxiliary")
// ❌ THIẾU: ruleset compile once/session + reuse
// ❌ THIẾU: role field seam cho scanner chéo
```

## Implementation

```typescript
// packages/tools/src/auxiliary-scanner.ts (MỚI)
import type { LspLifecycle } from "./lsp-idle-warm.js";
export type ScannerRole = "primary" | "auxiliary";
export interface ScannerRuleset { readonly id: string; compiled: boolean; }
/** Auxiliary LSP scanner — compile ruleset 1 lần, scan nhanh. */
export class AuxiliaryScanner {
  private ruleset?: ScannerRuleset;
  constructor(
    private lsp: LspLifecycle,
    private role: ScannerRole = "auxiliary",
    private compile: () => ScannerRuleset,
  ) {}
  /** Compile 1 lần/session — reuse cho mọi file. */
  ensureCompiled(): ScannerRuleset {
    if (!this.ruleset || !this.ruleset.compiled) this.ruleset = this.compile();
    return this.ruleset;
  }
  /** Scan file qua LSP protocol (didOpen → diagnostic). */
  async scan(path: string, content: string): Promise<unknown[]> {
    this.ensureCompiled();              // 1 lần/session → scan ~1-2s
    await this.lsp.connect();
    this.lsp.openFile(path);            // didOpen
    return [];                          // diagnostic từ LSP (role:auxiliary)
  }
}
// Seam: registerScanner(new AuxiliaryScanner(lsp, "auxiliary", compileOpengrep))
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Scan ~1-2s (vs ~8s CLI cold) | ❌ Phụ thuộc scanner runtime (Opengrep binary) |
| ✅ Cùng protocol LSP — tích hợp dễ | ❌ Ruleset compile overhead 1 lần |
| ✅ role seam — cắm scanner khác | ❌ Auxiliary diagnostic trộn với primary (cần tag) |

## Khác các hướng gần

| | AFX Auxiliary LSP | AFV LSP Idle-Warm | threat-scan |
|---|---|---|---|
| Role | Scanner phụ | LSP chính lifecycle | Pattern scan CLI |
| Speed | ~1-2s (compile once) | warm files | cold mỗi lần |
| Seam | role:"auxiliary" | warmFiles | không |

## Khi nào chọn

- Muốn scan security/quality nhanh (compile ruleset once)
- Cần scanner chạy song song cạnh LSP chính (cùng protocol)
- Muốn seam cắm nhiều scanner (Opengrep/semgrep/custom)
- Guard: role tag tách diagnostic, compile once check, scanner binary detection
