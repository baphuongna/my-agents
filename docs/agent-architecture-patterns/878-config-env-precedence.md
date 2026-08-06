# Hướng AGT: Config Env Precedence — file config (pi-pretty.json) ưu tiên hơn theme-provided; env override (PRETTY_*); PRETTY_DISABLE_TOOLS bỏ tool khi extension khác đã sở hữu tên

> **Nguồn gốc:** pi-pretty | **Coupling:** 🟢 — config precedence thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có cli.ts env override + intercom config env, nhưng KHÔNG có theme-vs-file precedence + disable-tools escape hatch) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-pretty** có thứ tự precedence rõ ràng: **theme-provided config** (mặc định theo theme) < **file config** (`pi-pretty.json`, `background.tool`/`error`) < **env override** (`PRETTY_CONFIG_DIR`/`PRETTY_THEME`/`PRETTY_MAX_PREVIEW_LINES`). File thắng theme (user explicit > theme default), env thắng tất cả (CI/automation). Ngoài ra `PRETTY_DISABLE_TOOLS` cho phép **bỏ tool** khi **extension khác đã sở hữu tên tool** đó — tránh xung đột tên (hai extension cùng đăng ký `find`).

Nguyên tắc: **precedence tường minh** (theme < file < env); **env cho automation/CI** (override tất cả); **escape hatch disable** (tránh tên tool conflict giữa extension); **user explicit > default**.

## Mô tả

Với mya, packages/print `cli.ts` đã có env override (`env wins`, line 45 — env preset không bị ghi đè) và packages/intercom `config.ts` có `PI_INTERCOM_*` env. Nhưng mya **chưa có** rõ: (1) **theme-vs-file precedence** (default từ theme, user file thắng), (2) **escape hatch disable tool** khi tên conflict giữa extension (PRETTY_DISABLE_TOOLS pattern). Pattern này quan trọng khi nhiều extension cùng muốn đăng ký `find`/`grep` — cần cách tắt một bên sạch sẽ.

## Kiến trúc (ASCII)

```
  precedence:  theme default  <  file (pi-pretty.json)  <  env (PRETTY_*)
       │              │                  │                      │
       └──────────────┴──────────────────┴──────────────────────┘
                                ▼
                       final config (env thắng)
  ── PRETTY_DISABLE_TOOLS=find,grep → bỏ tool khi extension khác sở hữu tên
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/cli.ts — env override (env wins, không ghi đè preset, line 45)
// ✅ packages/intercom/src/config.ts — PI_INTERCOM_* env override
// ✅ packages/tools/src/registry.ts — tool registry
// ⚠️ KHÔNG có theme-vs-file precedence (theme default < user file)
// ❌ KHÔNG có escape hatch disable tool khi tên conflict giữa extension
```

## Implementation

```typescript
// packages/core/src/config-precedence.ts (NEW)
import { existsSync, readFileSync } from "node:fs";

export interface ToolConfig { tool: string; error: string; maxPreviewLines: number; }

const DEFAULTS: ToolConfig = { tool: "spinner", error: "red", maxPreviewLines: 50 };

export function loadConfig(opts: {
  theme: Partial<ToolConfig>;
  filePath?: string;       // pi-pretty.json
}): ToolConfig {
  // theme default < file < env
  const fromFile = opts.filePath && existsSync(opts.filePath)
    ? JSON.parse(readFileSync(opts.filePath, "utf8")) as Partial<ToolConfig>
    : {};

  const cfg: ToolConfig = {
    ...DEFAULTS,
    ...opts.theme,          // theme default (thấp nhất)
    ...fromFile,            // file (user explicit thắng theme)
    // env thắng tất cả (automation/CI)
    ...(process.env.PRETTY_MAX_PREVIEW_LINES
      ? { maxPreviewLines: Number(process.env.PRETTY_MAX_PREVIEW_LINES) } : {}),
  };
  return cfg;
}

/** Escape hatch: bỏ tool khi extension khác đã sở hữu tên. */
export function shouldDisableTool(name: string): boolean {
  const disabled = (process.env.PRETTY_DISABLE_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return disabled.includes(name);
}

// Đăng ký tool: if (shouldDisableTool("find")) skip; tránh conflict tên với extension khác.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Precedence tường minh (theme < file < env) | ❌ Nguồn config nhiều → khó trace giá trị cuối |
| ✅ Env cho CI/automation (override tất cả) | ❌ Disable-tool silent → user không biết tool bị tắt |
| ✅ Escape hatch tránh tên tool conflict | ❌ Theme provider phải expose partial config đúng shape |

## Khác các hướng gần

| | AGT Env-Precedence | AGN Write-Target | AGM Conflict-Autoresolve |
|---|---|---|---|
| Trọng tâm | Thứ tự ưu tiên đọc config | Chọn nơi ghi | Giải trùng keybinding |
| Cơ chế | theme < file < env; disable-tool | Key-sống-ở-đâu | Reserved + replacement |
| Quan hệ | Nối precedence | Nối persistence | Nối keybinding layer |

## Khi nào chọn

- Config có nhiều nguồn (theme default, user file, env) — cần precedence rõ
- Nhiều extension cùng tên tool → cần escape hatch disable
- Env cho CI/automation override tất cả
- Guard: precedence theme<file<env, disable-tool tường minh, trace giá trị cuối
