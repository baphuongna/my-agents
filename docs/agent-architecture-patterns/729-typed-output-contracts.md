# Hướng ABA: Typed Output Contracts — output layer sinh JSON schema + TS contract từ Rust types, render đa format

> **Nguồn gốc:** fallow (crates/output/, crates/cli/src/report/) | **Coupling:** 🟢 — output layer độc lập, contract sinh từ types | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có canonical-json + structured-result — chưa có schema generation từ types) | **Effort:** 2 tuần

## Nguồn gốc

**fallow** có **output layer sinh JSON schema + TS contract generation từ Rust types**: khai báo type một lần (Rust struct), output layer tự sinh schema (validation) + TS types (cho client). **Cùng dữ liệu render ra nhiều format** — human, json, sarif, codeclimate, compact, markdown, badge — phục vụ **CI và agent** (agent parse json/sarif, người đọc human/markdown, CI dùng badge/codeclimate). Nguyên tắc: **type là nguồn sự thật duy nhất** — schema, contract, renderer đều sinh từ đó, không duplicate khai báo.

## Mô tả

mya typed output contracts: packages/core canonical-json.ts (byte-faithful) + packages/print structured-result.ts (DONE parse) + packages/tools analyzer.ts (AAY findings) sẵn nền. ABA thêm **contract layer**: (1) **schema from types** — khai báo TS interface một lần, sinh JSON Schema (mapper thủ công cho type đơn giản); (2) **TS contract generation** — từ schema sinh `*.d.ts` cho client; (3) **format registry** — cùng `Finding[]` render human/json/sarif/codeclimate/compact/markdown/badge; (4) **validation** — parse input theo schema trước khi render (fail nhanh). Nối AAJ (CLI contract) — format versioned.

## Kiến trúc

```
  TYPE (khai báo một lần — Finding[])
        │
        ▼
  ┌─── CONTRACT GENERATION ──────────────────────────┐
  │  JSON Schema (validate input) · TS contract      │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── FORMAT REGISTRY (cùng data → nhiều format) ──┐
  │  human / json@1 / sarif / codeclimate / compact   │
  │  markdown / badge                                │
  │  CI dùng badge/codeclimate · agent dùng json/sarif│
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core canonical-json.ts — byte-faithful JSON (nền contract)
// ✅ packages/print structured-result.ts — DONE structured parse (nền parse)
// ✅ packages/tools analyzer.ts (AAY) — Finding[] typed (nền nguồn type)
// ✅ packages/tools output-compress.ts — output pipeline (nền renderer)

// ❌ THIẾU: JSON Schema generation từ types
// ❌ THIẾU: TS contract generation (client d.ts)
// ❌ THIẾU: format registry (sarif/codeclimate/badge…)
```

## Implementation

```typescript
// packages/tools/src/contracts.ts (NEW)
import { canonicalJson } from "@my-agent/core";
import type { Finding } from "./analyzer.js";

/** JSON Schema từ TS interface (mapper thủ công — type đơn giản). */
export function findingSchema(): Record<string, unknown> {
  return {
    title: "Finding", type: "object", additionalProperties: false,
    required: ["ruleId", "file", "line", "severity", "message", "evidence"],
    properties: {
      ruleId: { type: "string" }, file: { type: "string" },
      line: { type: "integer", minimum: 1 },
      severity: { enum: ["error", "warning", "info"] },
      message: { type: "string" }, evidence: { type: "string" },
    },
  };
}

/** Validate findings theo schema — fail nhanh trước khi render. */
export function validateFindings(findings: unknown): Finding[] {
  const list = findings as Finding[];
  if (!Array.isArray(list)) throw new Error("findings phải là array");
  for (const f of list) {
    if (typeof f.ruleId !== "string" || typeof f.file !== "string" || typeof f.line !== "number") throw new Error(`finding invalid: ${canonicalJson(f)}`);
    if (!["error", "warning", "info"].includes(f.severity)) throw new Error(`severity invalid: ${f.severity}`);
  }
  return list;
}

export type OutputFormat = "human" | "json" | "sarif" | "codeclimate" | "compact" | "markdown" | "badge";

/** Format registry — cùng data, render đa format. */
export function render(findings: Finding[], format: OutputFormat): string {
  switch (format) {
    case "json":      return canonicalJson({ contract: "findings-json", version: 1, count: findings.length, findings });
    case "sarif":
      return canonicalJson({ $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "mya-analyzer" } }, results: findings.map((f) => ({ ruleId: f.ruleId, message: { text: f.message }, locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }] })) }] });
    case "codeclimate":
      return canonicalJson(findings.map((f) => ({ type: "issue", check_name: f.ruleId, description: f.message, severity: f.severity === "error" ? "critical" : f.severity, location: { path: f.file, lines: { begin: f.line } } })));
    case "compact":
      return findings.map((f) => `${f.file}:${f.line}: ${f.severity}: ${f.ruleId} (${f.evidence})`).join("\n");
    case "markdown":
      return findings.map((f) => `- [${f.severity}] ${f.ruleId} ${f.file}:${f.line} — ${f.message}`).join("\n");
    case "badge": {
      const errors = findings.filter((f) => f.severity === "error").length;
      return canonicalJson({ label: "analyze", message: `${errors} errors`, color: errors ? "red" : "brightgreen" });
    }
    default: // human
      return findings.map((f) => `${f.file}:${f.line} [${f.severity}] ${f.ruleId}\n  ${f.message}\n  ${f.evidence}`).join("\n");
  }
}

/** TS contract generation (client) — sinh d.ts text từ schema. */
export function generateTsContract(): string {
  return [
    "export type Severity = 'error' | 'warning' | 'info';",
    "export interface Finding { ruleId: string; file: string; line: number; severity: Severity; message: string; evidence: string }",
    "export interface FindingsReport { contract: 'findings-json'; version: 1; count: number; findings: Finding[] }",
  ].join("\n");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Type là nguồn sự thật — không duplicate khai báo | ❌ Schema mapper thủ công — type phức cần generator thật |
| ✅ Đa format từ một data — CI + agent + người | ❌ Mỗi format thêm = thêm renderer + test |
| ✅ Validate trước render — fail nhanh | ❌ Sarif/codeclimate schema phải bám spec bên ngoài |
| ✅ Canonical JSON — ổn định cho signing/audit | ❌ TS contract generation cross-language cần thêm tầng |

## Khác các hướng gần

| | CLI contract (AAJ) | ABA: Typed Output |
|---|---|---|
| Nguồn | Format name + renderer | **Type → schema → renderer** |
| Contract | Versioned format | **JSON Schema + TS types** |
| Phạm vi | CLI status | **Mọi output (findings, eval…)** |
| Mối quan hệ | Nền | **Tổng quát hóa + sinh từ types** |

## Khi nào chọn

- Nhiều consumer của cùng output (CI/agent/UI/badge)
- Muốn contract sinh từ type (không duplicate), validate trước render
- Đã có canonical-json + analyzer (AAY) — thêm schema + format registry
- Guard: schema validate mọi format, canonical JSON ổn định, test từng format với fixture