# Hướng AAY: Deterministic No-AI Analyzer — analyzer Rust-native không chứa AI, sinh deterministic findings, typed output contracts

> **Nguồn gốc:** fallow (README.md) | **Coupling:** 🟢 — analyzer độc lập, output contract cho agent dùng | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có native + canonical-json — chưa có no-AI analyzer pipeline) | **Effort:** 2 tuần

## Nguồn gốc

**fallow** có **analyzer Rust-native không chứa AI bên trong**: sinh **deterministic findings** (cùng input → cùng output, không randomness), **typed output contracts** (schema rõ), **traceable explanations** (mỗi finding kèm lý do/vết). Mục đích: **agent/harness downstream tin tưởng dùng làm evidence thay vì đoán** — kết quả không phải model hallucinate mà là thuật toán chạy được, giải thích được. Nguyên tắc: **determinism + contract + traceability = bằng chứng** — AI dùng để hiểu/hành động, không dùng để sản xuất evidence không kiểm chứng được.

## Mô tả

mya deterministic no-AI analyzer: packages/natives (Rust native) + packages/core canonical-json.ts + packages/tools symbol-extractor (nativeParseTsSymbols) sẵn nền. AAY thêm **analyzer pipeline**: (1) **Rust native analysis** — tree-sitter/regex scan sinh findings (deterministic — không LLM); (2) **typed output** — mỗi finding `{ ruleId, file, range, severity, message, evidence }` — schema versioned; (3) **traceable** — message giải thích quy tắc + vết (dòng/đoạn) chứng minh; (4) **render nhiều format** — json/sarif/markdown (nối AAJ contract). Agent dùng findings như evidence chắc chắn (không phải "model nói"), nối vào reasoning.

## Kiến trúc

```
  SOURCE FILES
        │
        ▼
  ┌─── ANALYZER (Rust native — KHÔNG AI) ────────────┐
  │  tree-sitter/regex scan (deterministic)           │
  │  → Finding { ruleId, file, range, severity,       │
  │             message, evidence }                   │
  │  cùng input → cùng output (không randomness)      │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── OUTPUT LAYER (typed contracts) ───────────────┐
  │  json@1 / sarif / markdown / compact              │
  │  → agent dùng làm EVIDENCE (không đoán)           │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/natives — Rust native bridge (nền analyzer native)
// ✅ packages/tools symbol-extractor.ts — nativeParseTsSymbols (nền scan)
// ✅ packages/core canonical-json.ts — byte-faithful JSON (nền typed contract)
// ✅ packages/tools osv-check.ts — external deterministic check (nền pattern)
// ✅ packages/tools codegraph.ts — deterministic graph (nền evidence graph)

// ❌ THIẾU: finding pipeline (ruleId + evidence + traceability)
// ❌ THIẾU: typed output contracts (json@1/sarif)
```

## Implementation
```typescript
// packages/tools/src/analyzer.ts (NEW)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export type Severity = "error" | "warning" | "info";

/** Typed finding — contract ổn định, downstream parse được. */
export interface Finding {
  ruleId: string;          // "no-bare-require" | "no-console"
  file: string;            // repo-relative
  line: number;
  severity: Severity;
  message: string;         // giải thích quy tắc
  evidence: string;        // đoạn code/dòng chứng minh
}

/** Rule: pure function — deterministic (cùng input → cùng finding). */
export type Rule = (src: string, file: string) => Finding[];

/** Bộ rule không chứa AI — regex/parse thuần. */
export const RULES: Record<string, Rule> = {
  "no-bare-require": (src, file) =>
    [...src.matchAll(/^\s*require\(/gm)].map((m) => ({
      ruleId: "no-bare-require", file, line: src.slice(0, m.index).split("\n").length,
      severity: "warning" as Severity,
      message: "require() ngoài top-level import — ESM chuẩn (CRITICAL-2 pattern).",
      evidence: m[0],
    })),
  "no-console": (src, file) =>
    [...src.matchAll(/\bconsole\.(log|error)\b/g)].map((m) => ({
      ruleId: "no-console", file, line: src.slice(0, m.index).split("\n").length,
      severity: "info" as Severity,
      message: "console.* trong library code — dùng logger module.",
      evidence: m[0],
    })),
};

/** Analyze toàn bộ files — deterministic: không LLM, không randomness. */
export function analyze(files: string[], rules: Rule[] = Object.values(RULES)): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const rule of rules) findings.push(...rule(src, f));
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Typed output contract: json@1 — schema versioned (nối AAJ). */
export function toContract(findings: Finding[]): string {
  return JSON.stringify({ contract: "findings-json", version: 1, count: findings.length, findings });
}

/** Traceability: render markdown kèm evidence cho agent đọc. */
export function toMarkdown(findings: Finding[]): string {
  return findings.map((f) => `- [${f.severity}] ${f.ruleId} ${f.file}:${f.line}\n  ${f.message}\n  \`${f.evidence}\``).join("\n");
}
// Usage: agent gọi analyze() → evidence chắc chắn (không hallucinate)
//   → findings dùng làm input reasoning — nối AAJ render contract
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic — cùng input cùng output, tin được | ❌ Chỉ bắt pattern biết trước — không suy luận ngữ nghĩa |
| ✅ Typed contract — agent/harness parse chắc chắn | ❌ Regex rule false positive/negative |
| ✅ Traceable — evidence + line rõ ràng | ❌ Không phát hiện lỗi logic sâu (cần AI bổ sung) |
| ✅ Rust native — nhanh, hot loop an toàn | ❌ Mỗi rule phải viết + test riêng |

## Khác các hướng gần

| | AI review (AAM persona) | AAY: No-AI Analyzer |
|---|---|---|
| Sinh findings | LLM (có thể hallucinate) | **Thuật toán deterministic** |
| Bằng chứng | Lập luận | **Evidence + line + rule** |
| Chi phí | Token | **Native scan (rẻ)** |
| Mối quan hệ | Bổ sung chiều sâu | **Nền evidence chắc chắn** |

## Khi nào chọn

- Cần evidence chắc chắn cho agent (không chấp nhận hallucinate)
- Scan lặp lại trên nhiều file (hot loop — Rust gate)
- Đã có natives + symbol-extractor + canonical-json — thêm finding pipeline
- Guard: rule pure (deterministic test), contract versioned, kết hợp AI review cho lỗi ngữ nghĩa
