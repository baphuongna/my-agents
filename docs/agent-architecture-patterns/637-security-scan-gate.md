# Hướng XM: Security Scan Gate — scan_skills.py quét định kỳ mọi skill bằng cisco skill-scanner (Behavioral/Trigger/LLM analyzer) xuất SECURITY.md theo severity

> **Nguồn gốc:** scientific-agent-skills (`scan_skills.py` + cisco skill-scanner) | **Coupling:** 🟡 — thêm scanner runner + SECURITY.md reporter vào CI/curator | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có cron scan + audit — chưa có 3-analyzer skill scanner) | **Effort:** 2-3 tuần

## Nguồn gốc

**scientific-agent-skills** chạy `scan_skills.py` **định kỳ** quét mọi SKILL.md bằng **cisco skill-scanner** — một bộ 3 analyzer: (1) **Behavioral analyzer** — kiểm pattern hành vi nguy hiểm (xóa file, gọi network không cần, escalate privilege). (2) **Trigger analyzer** — kiểm trigger conditions có thể bị prompt-inject (trigger quá rộng → kẻ gian kích hoạt skill bằng user input). (3) **LLM analyzer** — dùng LLM đánh giá intent skill (skill "có vẻ" an toàn nhưng body instructions đẩy data ra external). Kết quả xuất **SECURITY.md** theo **severity** (critical/high/medium/low) — report version-controlled, review được. Nguyên tắc: **scan trước load, report theo severity, không tin skill tự khai**.

## Mô tả

mya security scan gate: một scanner chạy định kỳ (cron hoặc curator trigger) → quét mọi SKILL.md bằng 3 analyzer (behavioral pattern match + trigger-width check + LLM intent review) → tổng hợp finding → xuất report theo severity. Skill có finding **critical** → gate block load (không nạp vào prompt index). mya có packages/cron (scan runner) + packages/audit (trust/recovery) + packages/cron scan.ts (cron prompt scan) — XM thêm **skill scanner** (3 analyzer) + **SECURITY.md reporter** + **severity-gate** trong curator.

## Kiến trúc

```
  ┌─── CRON / CURATOR TRIGGER ─────────────────────────────┐
  │  scan_skills (định kỳ hoặc trên skill add/update)       │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── 3 ANALYZER (mỗi SKILL.md) ──────────────────────────┐
  │                                                          │
  │  1. BEHAVIORAL  — regex/AST pattern: rm -rf, curl exfil, │
  │     eval(untrusted), chmod 777 → finding[]               │
  │  2. TRIGGER     — trigger width quá rộng? (".*" / "any") │
  │     → prompt-injectable → finding[]                      │
  │  3. LLM         — LLM review body: intent push data out? │
  │     → finding[] (slower, deep)                           │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── SEVERITY ROLLUP + SECURITY.md ──────────────────────┐
  │  CRITICAL: skill-X exfil pattern     → BLOCK load       │
  │  HIGH:     skill-Y trigger quá rộng  → warn, load gated  │
  │  MEDIUM:   skill-Z network call      → log              │
  │  LOW:      skill-W verbose logging   → note             │
  │  → ghi SECURITY.md (version-controlled report)          │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron scan.ts — cron prompt scan (nền — XM pattern source)
// ✅ packages/audit trust.ts — trust/recovery (nền — XM severity gate analog)
// ✅ packages/skills curator.ts — skill load/index (nền — XM gate trước load)
// ✅ packages/cron — cron runner (nền — XM scan định kỳ)

// ❌ THIẾU: behavioral analyzer (pattern match hành vi nguy hiểm)
// ❌ THIẾU: trigger analyzer (trigger width / prompt-injectable)
// ❌ THIẾU: LLM intent analyzer (deep review body)
// ❌ THIẾU: SECURITY.md reporter (severity rollup version-controlled)
```

## Implementation

```typescript
// packages/skills/src/security-scan.ts (MỚI)
type Severity = "critical" | "high" | "medium" | "low";

interface Finding {
  skill: string;
  analyzer: "behavioral" | "trigger" | "llm";
  severity: Severity;
  detail: string;
  location?: string;
}

// 1. BEHAVIORAL — pattern match
const BEHAVIORAL_PATTERNS: { re: RegExp; severity: Severity; msg: string }[] = [
  { re: /rm\s+-rf?\s+\//, severity: "critical", msg: "destructive rm -rf" },
  { re: /curl\s+.*\|\s*sh/, severity: "critical", msg: "pipe-to-shell exfil" },
  { re: /eval\s*\(/, severity: "high", msg: "eval untrusted" },
  { re: /chmod\s+777/, severity: "medium", msg: "world-writable" },
];

function behavioralScan(name: string, body: string): Finding[] {
  return BEHAVIORAL_PATTERNS.filter((p) => p.re.test(body))
    .map((p) => ({ skill: name, analyzer: "behavioral", severity: p.severity, detail: p.msg }));
}

// 2. TRIGGER — width check
function triggerScan(name: string, triggers: string[]): Finding[] {
  const tooWide = triggers.filter((t) => /^(.*|\*|any)$/i.test(t));
  return tooWide.map((t) => ({ skill: name, analyzer: "trigger", severity: "high", detail: `trigger quá rộng: ${t}` }));
}

// 3. LLM — intent review (delegate)
async function llmScan(name: string, body: string, review: (b: string) => Promise<Severity | null>): Promise<Finding[]> {
  const sev = await review(body);
  return sev ? [{ skill: name, analyzer: "llm", severity: sev, detail: "LLM flagged intent" }] : [];
}

function renderSecurityMd(findings: Finding[]): string {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  const lines = ["# SECURITY.md", "", "| Severity | Skill | Analyzer | Detail |", "|---|---|---|---|"];
  for (const sev of order)
    for (const f of findings.filter((x) => x.severity === sev))
      lines.push(`| ${sev} | ${f.skill} | ${f.analyzer} | ${f.detail} |`);
  return lines.join("\n");
}

// Usage:
// const findings = [...behavioralScan(n, body), ...triggerScan(n, triggers), ...await llmScan(n, body, review)];
// await writeFile("SECURITY.md", renderSecurityMd(allFindings));
// skill có critical → curator block load
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Defense-in-depth (3 lớp: pattern + trigger + LLM) | ❌ LLM analyzer cost (chậm + token) |
| ✅ Report version-controlled (SECURITY.md review được) | ❌ False positive (pattern match quá rộng) |
| ✅ Severity gate (critical → block load tự động) | ❌ Report noise (nhiều low finding giấu critical) |
| ✅ Định kỳ (cron catch skill mới add) | ❌ Stale report (scan cũ → skill mới chưa check) |

## Khác các hướng gần

| | Manual review | Cron prompt scan | XM: 3-Analyzer Scanner |
|---|---|---|---|
| Phạm vi | 1-by-1 | cron prompt | **mọi SKILL.md** |
| Lớp phân tích | human | regex | **behavioral + trigger + LLM** |
| Output | verbal | reject log | **SECURITY.md (severity)** |
| Auto-gate | ❌ | partial | **✅ critical → block** |

## Khi nào chọn

- Chấp nhận skill từ nguồn ngoài (third-party, community) → cần scan trước load
- Muốn report version-controlled (SECURITY.md review được trong PR)
- Muốn gate tự động (critical finding → block skill nạp vào prompt)
- Nối packages/cron scan.ts + packages/audit trust.ts + packages/skills curator.ts; guard false-positive-tuning (calibrate pattern, review LLM flag), report-freshness (scan chạy trước load, không dùng stale report), và llm-analyzer-sandbox (LLM analyzer không thực thi skill — chỉ review text); XM = security scan gate, kết hợp 636 XL skill-frontmatter-portability (gate kiểm allowedTools trước load) + 634 XJ what-if-oracle (wild-card branch = security failure scenario)
