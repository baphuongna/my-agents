# Hướng AGG: Deterministic Candidate-Scan — trước phase model-heavy, `candidate-scan` deterministic (regex pattern + risk score + sha256) quét toàn bộ file ghi `candidates.jsonl` và `file-records`, giúp agent sau tập trung attention vào file rủi ro cao

> **Nguồn gốc:** piolium (extensions/piolium/candidate-scan.ts) | **Coupling:** 🟢 — scan thuần, deterministic | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có threat-scan + find/symbol, thiếu candidate-scan risk-score) | **Effort:** 1-2 tuần

## Nguồn gốc

**piolium** chạy **candidate-scan deterministic TRƯỚC** các phase model-heavy (agent reasoning tốn token). Scan dùng **regex pattern + risk score + sha256** (không LLM): quét toàn bộ file, ghi **`candidates.jsonl`** (file rủi ro + lý do) và **`file-records`** (hash/metadata). Nhờ đó agent phase sau **tập trung attention vào file rủi ro cao** thay vì đọc mù toàn repo — tiết kiệm token, deterministic, reproducible. Nguyên tắc: **cheap deterministic pre-filter trước expensive model reasoning**.

## Mô tả

mya deterministic-candidate-scan: (1) **threat-scan đã sẵn** — `packages/tools` threat-scan.ts (pattern scan); (2) **find/symbol đã sẵn** — find.ts (file-walk), symbol-extractor.ts; (3) **regex pattern + risk score** — match pattern nguy hiểm (eval, exec, unsafe...), score theo severity; (4) **sha256** — hash file để dedupe/track change; (5) **candidates.jsonl + file-records** — output cho phase sau. Nối AGF (phases) — candidate-scan là phase đầu.

## Kiến trúc (ASCII)

```
  REPO (toàn bộ file)
       │
       ▼  CANDIDATE-SCAN (deterministic, KHÔNG LLM)
   for each file:
     ├─ regex pattern match (eval/exec/unsafe/secret...)
     ├─ risk score (theo severity pattern)
     └─ sha256 hash (dedupe/track)
       │
       ▼  ghi output:
   candidates.jsonl  ◀── file rủi ro + lý do + score
   file-records      ◀── hash/metadata mọi file
       │
       ▼  phase SAU (model-heavy) đọc candidates
   AGENT tập trung attention file rủi ro CAO
   (không đọc mù toàn repo — tiết kiệm token)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools threat-scan.ts — pattern scanner (security, regex)
// ✅ packages/tools find.ts — file-walk (file discovery)
// ✅ packages/tools symbol-extractor.ts — symbol extraction (context cho risk)
// ✅ packages/tools hashline.ts/hashline-edit.ts — hash foundation (sha256)

// ❌ THIẾU: candidate-scan risk-score (severity → score)
// ❌ THIẾU: candidates.jsonl + file-records output format
```

## Implementation

```typescript
// packages/tools/src/candidate-scan.ts (MỚI)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { walkFiles } from "./find.js";
export interface RiskPattern { readonly regex: RegExp; readonly severity: number; readonly label: string; }
export interface Candidate { readonly path: string; readonly sha256: string; readonly score: number; readonly hits: { label: string; line: number }[]; }
const PATTERNS: RiskPattern[] = [
  { regex: /\beval\s*\(/g, severity: 8, label: "eval" },
  { regex: /\bexec(Sync)?\s*\(/g, severity: 7, label: "exec" },
  { regex: /(?:password|secret|token)\s*[:=]/gi, severity: 6, label: "secret" },
];
/** Scan deterministic toàn file → candidates rủi ro + file-records. */
export function candidateScan(root: string): { candidates: Candidate[]; fileRecords: { path: string; sha256: string }[] } {
  const candidates: Candidate[] = [];
  const fileRecords: { path: string; sha256: string }[] = [];
  for (const path of walkFiles(root)) {
    const src = readFileSync(path, "utf8");
    const sha256 = createHash("sha256").update(src).digest("hex");
    fileRecords.push({ path, sha256 });
    const hits: { label: string; line: number }[] = [];
    let score = 0;
    for (const p of PATTERNS) {
      for (const m of src.matchAll(p.regex)) { hits.push({ label: p.label, line: lineOf(src, m.index ?? 0) }); score += p.severity; }
    }
    if (score > 0) candidates.push({ path, sha256, score, hits });
  }
  candidates.sort((a, b) => b.score - a.score);   // rủi ro cao trước
  return { candidates, fileRecords };
}
function lineOf(src: string, idx: number): number { return src.slice(0, idx).split("\n").length; }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cheap deterministic — không tốn LLM token | ❌ Regex miss pattern phức tạp (cần update list) |
| ✅ Agent tập trung file rủi ro cao | ❌ False positive (pattern vô hại match) |
| ✅ Reproducible (sha256, no model) | ❌ Risk score heuristic — không hoàn toàn chính xác |

## Khác các hướng gần

| | AGG Candidate-Scan | threat-scan | AGF Specialist Phases |
|---|---|---|---|
| Cơ chế | regex + risk score deterministic | pattern scan | 17 phase model-heavy |
| Khi | TRƯỚC model reasoning | on-demand | SAU candidate-scan |
| Output | candidates.jsonl + file-records | findings | artifacts |

## Khi nào chọn

- Cần pre-filter repo lớn trước khi agent reasoning (tiết kiệm token)
- Muốn deterministic/reproducible (regex + sha256)
- Cần tập trung attention agent vào file rủi ro cao
- Guard: pattern list đầy đủ + update, false-positive review, risk-score tuning, sha256 dedupe
