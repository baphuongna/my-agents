# Hướng ABE: Deterministic Security Candidates — security scan là candidate producer deterministic; model verifier sở hữu verdict impact

> **Nguồn gốc:** fallow (docs/security-agent-verification.md) | **Coupling:** 🟡 — thêm candidate/verifier split vào security pipeline | **Agent-agnostic:** ⚠️ (model verifier phụ thuộc LLM) | **Code sẵn:** ⚠️ (có threat-scan + council — chưa có candidate/verifier phân tầng) | **Effort:** 2 tuần

## Nguồn gốc

**fallow** tách **security agent verification** thành hai tầng: (1) **candidate producer deterministic** — scan tĩnh sinh ra candidate với đủ metadata: `source_kind` (dòng code nào), `sink` (điểm nguy hiểm nó chảy tới), `boundary` (trust boundary vượt qua), `severity`, `taint_flow` (chuỗi taint: input → transform → sink). Không có model, không có heuristic mờ — **deterministic**. (2) **model verifier** — LLM **sở hữu verdict impact**: xem candidate (có evidence đầy đủ) rồi quyết **impact thật** (exploitable? severity thật? false positive?). (3) **CLI survivors** — chỉ hiển thị kết quả **đã verify**, **không ghi đè candidate raw** (raw vẫn giữ cho audit/debug). Nguyên tắc: **producer deterministic (không miss), verifier quyết impact (giảm false positive), raw không bị đè**.

## Mô tả

mya deterministic security candidates: pipeline security gồm (1) **deterministic producer** — scan tĩnh sinh candidate với `{ source_kind, sink, boundary, severity, taint_flow }` (thuần, không LLM — không miss); (2) **model verifier** — LLM review candidate theo evidence, ra **verdict impact** (confirm / downgrade / reject); (3) **renderer** — CLI/UI chỉ hiện candidate **đã verify**, raw candidates giữ nguyên (log/audit). mya có packages/core threat-scan.ts (scanner deterministic) + packages/council (LLM review) — ABE thêm **candidate shape** (source_kind/sink/boundary/taint_flow) + **verifier tier** (model quyết impact) + **raw-preserving renderer**.

## Kiến trúc

```
  SOURCE ──► DETERMINISTIC PRODUCER (scan tĩnh, không LLM)
                │
                ▼
        CANDIDATE { source_kind, sink, boundary, severity, taint_flow[] }
                │  (evidence đầy đủ, raw — không ghi đè)
                ▼
        MODEL VERIFIER (LLM, sở hữu verdict impact)
           ├─ confirm   ──► severity giữ / nâng
           ├─ downgrade ──► severity hạ (false positive nhẹ)
           └─ reject    ──► loại khỏi survivors (false positive)
                │
                ▼
        CLI SURVIVORS (chỉ verified)     RAW CANDIDATES (giữ nguyên, audit)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core threat-scan.ts — scanner deterministic (nền — ABE producer analog)
// ✅ packages/council adversarial.ts — LLM review (nền — ABE verifier analog)
// ✅ packages/tools osv-check.ts — vulnerability check (nền — ABE candidate producer)
// ✅ packages/cron scan.ts — cron scan runner (nền — ABE pipeline driver)

// ❌ THIẾU: candidate shape chuẩn (source_kind/sink/boundary/severity/taint_flow)
// ❌ THIẾU: verifier tier (model quyết impact — confirm/downgrade/reject)
// ❌ THIẾU: raw-preserving renderer (survivors ≠ raw, không ghi đè)
```

## Implementation

```typescript
// packages/core/src/security-candidates.ts (MỚI)
type Severity = "critical" | "high" | "medium" | "low";

/** Candidate deterministic — mọi evidence có cấu trúc, không LLM. */
export interface SecurityCandidate {
  id: string;
  sourceKind: "input" | "query" | "file-read" | "env" | "tool-result";
  sink: "exec" | "eval" | "network" | "fs-write" | "shell";
  boundary: "process" | "network" | "user" | "package";
  severity: Severity;
  taintFlow: Array<{ step: string; line: number }>;
}

export type Verdict = "confirm" | "downgrade" | "reject";

export interface VerifiedCandidate extends SecurityCandidate {
  verdict: Verdict;
  verifiedSeverity: Severity;
  rationale: string;
}

/** Producer: scan tĩnh → candidate có đủ evidence (deterministic, không miss). */
export function produceCandidates(source: string, path: string): SecurityCandidate[] {
  const candidates: SecurityCandidate[] = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (/\beval\s*\(/.test(line)) candidates.push({
      id: `${path}:${i + 1}`, sourceKind: "input", sink: "eval",
      boundary: "process", severity: "high",
      taintFlow: [{ step: "untrusted input", line: i + 1 }, { step: "eval call", line: i + 1 }],
    });
    if (/child_process|\bexec\b/.test(line)) candidates.push({
      id: `${path}:${i + 1}`, sourceKind: "query", sink: "exec",
      boundary: "process", severity: "high",
      taintFlow: [{ step: "command string", line: i + 1 }, { step: "exec", line: i + 1 }],
    });
  });
  return candidates;
}

/** Verifier: model sở hữu verdict impact — raw candidate không đổi. */
export async function verifyCandidates(
  candidates: SecurityCandidate[],
  judge: (c: SecurityCandidate) => Promise<Verdict>,
): Promise<VerifiedCandidate[]> {
  const out: VerifiedCandidate[] = [];
  for (const c of candidates) {
    const verdict = await judge(c);
    out.push({ ...c, verdict, verifiedSeverity: verdict === "downgrade" ? "low" : c.severity, rationale: "" });
  }
  return out;
}

// Usage:
// const raw = produceCandidates(source, path);       // deterministic
// const verified = await verifyCandidates(raw, judge); // model quyết impact
// renderSurvivors(verified.filter(v => v.verdict !== "reject")); // raw giữ nguyên
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không miss (producer deterministic, scan tĩnh đủ evidence) | ❌ Verifier cost (mỗi candidate 1 LLM call) |
| ✅ Ít false positive (model quyết impact, không hiện mù) | ❌ Verifier hallucination (model reject nhầm candidate thật) |
| ✅ Raw giữ nguyên (audit/debug được, không mất evidence) | ❌ Candidate shape brittle (thêm sink mới → cập nhật producer) |
| ✅ Verdict có rationale (vì sao confirm/downgrade — review được) | ❌ Boundary classification khó (xác định đúng trust boundary) |

## Khác các hướng gần

| | Raw scan (mọi finding) | LLM-only review | ABE: Deterministic + Verifier |
|---|---|---|---|
| Producer | deterministic | mờ (không cấu trúc) | **deterministic + cấu trúc** |
| Verdict | không | model tự do | **model quyết impact trên candidate** |
| Raw data | hiện hết | mất | **giữ nguyên (audit)** |
| Miss | thấp | cao | **thấp (producer phủ hết)** |

## Khi nào chọn

- Security findings nhiều false positive → cần model lọc nhưng không mất evidence
- Muốn pipeline tách bạch: scan deterministic (không miss) + verify LLM (đúng impact)
- Cần audit (raw candidate giữ nguyên để xem producer đã thấy gì)
- Nối packages/core threat-scan.ts + packages/council + packages/tools osv-check.ts; guard verifier-cadence (không verify lại candidate đã verify), raw-preservation (renderer không bao giờ ghi đè raw), và taint-flow-completeness (producer luôn ghi đủ chuỗi taint — verifier dựa vào đó); ABE = deterministic security candidates, kết hợp 732 ABD (license check = candidate deterministic) + 637 XM (severity gate trước render)
