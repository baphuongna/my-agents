# Hướng AFV: LSP Idle-Warm Files — LSP server shutdown sau 240s inactive để giải phóng tài nguyên; `warmFiles` cho phép mở entry-point file lúc session_start để clangd-style server có AST/index sẵn trước query đầu tiên

> **Nguồn gốc:** pi-lens (docs/features.md) | **Coupling:** 🟡 — cần LSP lifecycle + warm-up hook | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có lsp-client/lsp-cascade, thiếu idle-shutdown + warmFiles) | **Effort:** 1 tuần

## Nguồn gốc

**pi-lens** quản lý LSP server lifecycle tiết kiệm: sau **240s inactive** (không query), LSP server **shutdown** để giải phóng tài nguyên (clangd/rust-analyzer tốn RAM GB). Ngược lại, **`warmFiles`** mở **entry-point file lúc session_start** — clangd-style server parse/index file trước query đầu tiên, nên khi agent hỏi symbol lần đầu, đáp án có sẵn (không cold-start). Nguyên tắc: **idle shutdown tiết kiệm + warm files giảm cold-start latency**.

## Mô tả

mya lsp-idle-warm: (1) **LSP client đã sẵn** — `packages/tools` lsp-client.ts, lsp-cascade.ts (symbols land Tier 3); (2) **idle timer** — track last-query, shutdown sau 240s; (3) **warmFiles** — list file mở ở session_start (entry-point như main.ts/index.ts); (4) **lifecycle** — connect lazy, shutdown idle, restart khi cần; (5) **AST/index sẵn** — warm file parse trước. Nối AFW (startup-scan) và AFX (auxiliary LSP).

## Kiến trúc (ASCII)

```
  SESSION START
   │
   ├─ warmFiles: ["src/index.ts", "src/main.rs"]  ◀── mở entry-point
   │      ▼ LSP server parse/index ngay (AST sẵn)
   │
   ▼  agent query symbol đầu tiên → đáp án CÓ SẴN (không cold-start)
   │
   │  ... không query nào trong 240s ...
   │
   ▼  IDLE SHUTDOWN (giải phóng RAM GB)
   │
   ▼  query mới → restart LSP (cold-start lại, nhưng hiếm)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools lsp-client.ts — LSP client (connect/notify/request)
// ✅ packages/tools lsp-cascade.ts — symbols land Tier 3 (lazy populate)
// ✅ packages/tools symbol-extractor.ts — symbol extraction nền

// ❌ THIẾU: idle timer shutdown sau 240s
// ❌ THIẾU: warmFiles open lúc session_start
// ❌ THIẾU: lifecycle restart-on-demand
```

## Implementation

```typescript
// packages/tools/src/lsp-idle-warm.ts (MỚI)
const IDLE_SHUTDOWN_MS = 240_000;
export interface LspLifecycle {
  connect(): Promise<void>;
  shutdown(): Promise<void>;
  openFile(path: string): void;
}
/** Quản lý LSP: warm files lúc start + shutdown sau 240s idle. */
export class LspIdleWarm {
  private lastQuery = Date.now();
  private idleTimer?: ReturnType<typeof setInterval>;
  constructor(private lsp: LspLifecycle, private warmFiles: string[]) {}
  async start(): Promise<void> {
    await this.lsp.connect();
    for (const f of this.warmFiles) this.lsp.openFile(f);   // warm AST/index
    this.idleTimer = setInterval(() => this.checkIdle(), 10_000);
  }
  /** Đánh dấu query mới — reset idle clock. */
  touch(): void { this.lastQuery = Date.now(); }
  private async checkIdle(): Promise<void> {
    if (Date.now() - this.lastQuery > IDLE_SHUTDOWN_MS) {
      await this.lsp.shutdown();          // giải phóng RAM
      clearInterval(this.idleTimer!);
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Idle shutdown tiết kiệm RAM GB | ❌ Restart cold-start khi query lại sau idle |
| ✅ warmFiles giảm latency query đầu | ❌ warmFiles sai → lãng phí parse file không dùng |
| ✅ Cân bằng tài nguyên vs responsiveness | ❌ 240s tuning tùy workload |

## Khác các hướng gần

| | AFV LSP Idle-Warm | AFW Startup-Scan | AFX Auxiliary LSP |
|---|---|---|---|
| Trọng tâm | LSP lifecycle tiết kiệm | Gate quét root | Scanner phụ cạnh LSP |
| Idle | shutdown 240s | n/a | n/a |
| Warm | entry-point files | root markers | ruleset compile |

## Khi nào chọn

- LSP server nặng RAM, không dùng liên tục
- Muốn giảm cold-start latency (warm entry-point files)
- Cần cân bằng tài nguyên vs responsiveness
- Guard: idle threshold tuning, warmFiles configurable, restart-on-demand
