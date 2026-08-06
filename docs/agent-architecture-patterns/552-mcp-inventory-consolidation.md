# Hướng UF: MCP Inventory Consolidation — gom config MCP các harness thành một v1, detect fragmentation/drift + redact secret

> **Nguồn gốc:** ECC `mcp-inventory.js` (MCP config consolidation, `ecc.mcp.v1` schema, fragmentation detection, secret redaction); "consolidate MCP configs across harnesses", "detect fragmentation/drift", "redact secrets in inventory", "single source of truth ecc.mcp.v1" | **Coupling:** 🟡 — thêm MCP-inventory + schema consolidation | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (MCP tool + composio sẵn — chưa có inventory consolidation + drift detect + secret redact) | **Effort:** 2-3 tuần

## Nguồn gốc

**ECC** `mcp-inventory.js` giải quyết **MCP config bùng nổ**: mỗi harness (Claude/Codex/Cursor/Zed) có file MCP config riêng (`claude_desktop_config.json`, `.codex/mcp.json`, ...) với định dạng khác nhau. Khi thêm MCP server (vd filesystem, github), phải cập nhật **n file** thủ công → **fragmentation** (config lệch nhau) và **drift** (một harness có server, cái khác không). `mcp-inventory.js` **gom tất cả** về **một schema v1 duy nhất** (`ecc.mcp.v1`): normalize định dạng, detect fragmentation (cùng server định nghĩa khác nhau) và drift (server có ở harness A, thiếu ở B). Quan trọng: **redact secret** — MCP config chứa API key/env, inventory **che secret** trước khi report (không lộ key trong log/report). Nguyên tắc: **single source of truth**, **detect lệch**, **bảo mật secret**.

## Mô tả

mya MCP inventory consolidation: (1) **Collect**: đọc MCP config từ mọi harness source. (2) **Normalize**: về schema `ecc.mcp.v1` (server name, command, args, env). (3) **Fragmentation detect**: cùng server → định nghĩa khác nhau (args/env lệch). (4) **Drift detect**: server có ở harness A, thiếu B. (5) **Secret redact**: che API key/env trước report. mya có MCP tool (composio) — UF thêm **config-collector** + **normalizer** + **drift-detector** + **secret-redactor**.

## Kiến trúc

```
  HARNESS MCP CONFIGS (fragmented)
  ┌─ claude_config.json  ── {filesystem: {cmd, args}}
  ├─ .codex/mcp.json     ── {github: {cmd, env: {KEY}}}
  └─ cursor/mcp.json     ── (thiếu github)
        │ (collect + normalize)
        ▼
  ┌─── ecc.mcp.v1 (single source of truth) ──────────────────┐
  │  servers:                                                  │
  │    filesystem: {cmd:'npx', args:[...]}                     │
  │    github:     {cmd:'npx', env:{KEY:'***REDACTED***'}}     │
  └───────────────────────┬─────────────────────────────────┘
                          │ (analyze)
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  ┌─── FRAGMENTATION ┐ ┌─── DRIFT ───┐ ┌─── SECRET ──────────┐
  │ filesystem:      │ │ github:     │ │ KEY → ***REDACTED***│
  │ args lệch giữa   │ │ có ở codex  │ │ (không lộ trong     │
  │ claude vs codex  │ │ thiếu cursor│ │  report/log)        │
  └──────────────────┘ └─────────────┘ └─────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools composio.ts — MCP/composio tool (nền — UF inventory config cái này)
// ✅ packages/secrets — secret management (nền — UF redact dùng)
// ✅ packages/core redact.ts — redaction utility (nền — UF redact)
// ✅ packages/tools registry.ts — tool registry (nền — UF consolidate ở đây)

// ❌ THIẾU: config-collector (đọc MCP config multi-source)
// ❌ THIẾU: normalizer (→ ecc.mcp.v1 schema)
// ❌ THIẾU: drift-detector (fragmentation + missing-across-harness)
// ❌ THIẾU: secret-redactor (che KEY/env trước report)
```

## Implementation

```typescript
// packages/tools/src/mcp-inventory.ts (MỚI)
import { redact } from '@my-agent/core';

interface McpServerV1 { name: string; command: string; args: string[]; env: Record<string, string> }
interface HarnessConfig { harness: string; servers: McpServerV1[] }

class McpInventory {
  // consolidate → ecc.mcp.v1 + detect issues
  consolidate(configs: HarnessConfig[]): {
    v1: Map<string, McpServerV1>;
    fragmentation: string[];
    drift: { server: string; missingIn: string[] }[];
  } {
    const all = new Map<string, { def: McpServerV1; harness: string }[]>();
    for (const c of configs) {
      for (const s of c.servers) {
        const list = all.get(s.name) ?? [];
        list.push({ def: s, harness: c.harness });
        all.set(s.name, list);
      }
    }
    // fragmentation: cùng server, def khác nhau
    const fragmentation: string[] = [];
    for (const [name, defs] of all) {
      const sigs = new Set(defs.map(d => JSON.stringify({ c: d.def.command, a: d.def.args })));
      if (sigs.size > 1) fragmentation.push(name);
    }
    // drift: server không có ở mọi harness
    const drift: { server: string; missingIn: string[] }[] = [];
    const allHarnesses = configs.map(c => c.harness);
    for (const [name, defs] of all) {
      const present = new Set(defs.map(d => d.harness));
      const missing = allHarnesses.filter(h => !present.has(h));
      if (missing.length > 0) drift.push({ server: name, missingIn: missing });
    }
    // v1: pick representative (first), redact env
    const v1 = new Map<string, McpServerV1>();
    for (const [name, defs] of all) {
      const rep = { ...defs[0].def, env: redact(defs[0].def.env) }; // che secret
      v1.set(name, rep);
    }
    return { v1, fragmentation, drift };
  }
}

// Usage:
// const { v1, fragmentation, drift } = inventory.consolidate(configs);
// fragmentation → ["filesystem"] (args lệch)
// drift → [{server:"github", missingIn:["cursor"]}]
// v1.get("github").env.KEY → "***REDACTED***"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Single source of truth (ecc.mcp.v1, không N file lệch) | ❌ Harness format variance (mỗi harness schema khác) |
| ✅ Detect fragmentation/drift (lech visible) | ❌ Normalization lossy (format riêng bị bỏ) |
| ✅ Secret redact (không lộ key trong report) | ❌ False fragmentation (cosmetic diff ≠ thật lệch) |
| ✅ Inventory report (status MCP toàn hệ thống) | ❌ Collect cost (đọc N config file) |

## Khác các hướng gần

| | Manual per-harness | Composio registry | UF: Inventory-Consolidation |
|---|---|---|---|
| Cái gì | Quản từng file riêng | Registry MCP tool | **Gom multi-harness → v1 + drift detect** |
| Drift detect | ❌ | ❌ | **✅ missing/fragmentation** |
| Secret | ⚠ (lộ trong config) | ✅ | **✅ redact trước report** |

## Khi nào chọn

- Đa harness (Claude/Codex/Cursor/Zed) mỗi cái MCP config riêng
- MCP server hay lệch giữa harness → muốn detect drift
- Cần inventory report (status MCP, không lộ secret)
- Nối packages/tools composio.ts + registry.ts + packages/secrets + packages/core redact.ts; guard normalization fidelity (giữ info quan trọng, không lossy quá), fragmentation-precision (cosmetic diff không flag nhầm), và secret-completeness (redact mọi key pattern, không lọt); UF = MCP inventory consolidation, kết hợp 553 UG harness-adapter-matrix (cross-harness compliance) + 546 TZ harness-import-firewall (harness boundary)
