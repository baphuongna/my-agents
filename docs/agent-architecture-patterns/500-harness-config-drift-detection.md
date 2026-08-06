# Hướng SF: Harness Config Drift Detection — meta-skill audit: đối chiếu agent/skill hiện có vs CLAUDE.md

> **Nguồn gốc:** harness (meta-skill audit); "config drift detection"; "compare installed skills vs manifest CLAUDE.md"; "agent capability drift from spec"; "meta-skill self-audit"
> **Coupling:** 🟢 — thêm audit job đối chiếu skill registry vs CLAUDE.md manifest (read-only, không đổi core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (skill registry + AGENTS.md sẵn — chưa có drift comparator + audit report)
> **Effort:** 1-2 tuần

## Nguồn gốc

**harness** meta-skill: agent tự **audit** xem **skill/agent hiện có** có khớp **manifest spec** (CLAUDE.md / AGENTS.md) không. **Config drift** xảy ra khi: skill được thêm/bớt nhưng manifest không cập nhật; hoặc manifest ghi skill X nhưng thực tế không tồn tại/đổi tên. Hậu quả: agent tưởng có skill (như manifest nói) nhưng chạy lỗi (skill thiếu), hoặc có skill ẩn (tồn tại nhưng manifest không ghi → không được dùng/phê duyệt). Nguyên tắc: **manifest = source of truth** cho capability → audit định kỳ đối chiếu manifest ↔ thực tế → báo drift (missing/extra/renamed). Khác version-check — SF là **capability-set reconciliation**.

## Mô tả

mya harness config drift detection: (1) **Manifest parse**: đọc `CLAUDE.md`/`AGENTS.md` → extract declared skills (tên + mô tả + khi nào dùng). (2) **Registry scan**: scan skill registry (thực tế load được) → actual skills (tên + meta). (3) **Diff**: so declared vs actual → 3 loại drift: **missing** (manifest ghi nhưng registry không có), **extra** (registry có nhưng manifest không ghi — ẩn), **renamed** (declared "foo" nhưng actual "foo-v2"). (4) **Audit report**: `{ missing: [], extra: [], renamed: [] }` + severity (missing=high, extra=medium). (5) **Alert**: drift non-empty → warn operator (cần sync manifest hoặc xóa skill ẩn). mya có skill registry + AGENTS.md — SF thêm **manifest parser** + **diff comparator** + **audit report**.

## Kiến trúc

```
  MANIFEST (CLAUDE.md / AGENTS.md)          SKILL REGISTRY (thực tế)
  ┌──────────────────────────────┐          ┌──────────────────────────┐
  │  declared skills:             │          │  actual skills:           │
  │  - read                       │          │  - read     ✓             │
  │  - edit                       │          │  - edit     ✓             │
  │  - fuzzy-finder (465)         │          │  - fff-finder (renamed!)  │
  │  - debug-dap (457)            │          │  - export-html (508, ẩn!) │
  │  - legacy-tool                │          │  (legacy-tool MISSING)     │
  └──────────────┬───────────────┘          └─────────────┬────────────┘
                 │                                        │
                 └────────────────┬───────────────────────┘
                                  ▼
  ┌─── DIFF (reconciliation) ───────────────────────────┐
  │  MISSING:  [legacy-tool]      (manifest ghi, ko có)  │ → HIGH
  │  EXTRA:    [export-html]      (có, manifest ko ghi)   │ → MEDIUM
  │  RENAMED:  fuzzy-finder → fff-finder                  │ → MEDIUM
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── AUDIT REPORT ────────────────────────────────────┐
  │  drift detected → WARN operator:                      │
  │  "sync manifest (add export-html) hoặc xóa skill ẩn"  │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ skill registry — actual skills loaded (nền — SF scan nó)
// ✅ AGENTS.md / CLAUDE.md — manifest spec (nền — SF parse nó)
// ✅ tool registry — tool.meta.name (nền — SF đối chiếu)

// ❌ THIẾU: manifest parser (extract declared skills từ markdown)
// ❌ THIẾU: diff comparator (declared vs actual → missing/extra/renamed)
// ❌ THIẾU: audit report (drift + severity + remediation hint)
```

## Implementation

```typescript
// packages/agent/src/config-drift-audit.ts (MỚI)
interface DeclaredSkill { name: string; aliases?: string[] }
interface ActualSkill { name: string }

interface DriftReport {
  missing: string[];   // declared but not in registry
  extra: string[];     // in registry but not declared (hidden)
  renamed: { declared: string; actual: string }[];
}

class ConfigDriftAudit {
  // parse manifest (extract skill names from markdown bullets/sections)
  parseManifest(md: string): DeclaredSkill[] {
    const skills: DeclaredSkill[] = [];
    for (const line of md.split('\n')) {
      const m = line.match(/^\s*[-*]\s*\*?\*?([a-z][\w-]+)\*?\*?/i);
      if (m) skills.push({ name: m[1]!.toLowerCase() });
    }
    return skills;
  }

  // diff declared vs actual
  diff(declared: DeclaredSkill[], actual: ActualSkill[]): DriftReport {
    const declaredNames = new Set(declared.map(d => d.name));
    const aliasMap = new Map<string, string>(); // alias → declared name
    for (const d of declared) for (const a of d.aliases ?? []) aliasMap.set(a, d.name);
    const actualNames = new Set(actual.map(a => a.name));

    const missing = [...declaredNames].filter(n => !actualNames.has(n) && !aliasMapHas(actualNames, n));
    const extra = [...actualNames].filter(n => !declaredNames.has(n) && ![...aliasMap.keys()].includes(n));
    // renamed: declared fuzzy-finder, actual fff-finder (fuzzy hoặc 465-tag match)
    const renamed: { declared: string; actual: string }[] = [];
    for (const n of missing) {
      const candidate = fuzzyMatch(n, [...actualNames]);
      if (candidate) renamed.push({ declared: n, actual: candidate });
    }
    return {
      missing: missing.filter(n => !renamed.some(r => r.declared === n)),
      extra: extra.filter(n => !renamed.some(r => r.actual === n)),
      renamed,
    };
  }

  report(d: DriftReport): string {
    if (d.missing.length + d.extra.length + d.renamed.length === 0) return '✅ no drift — manifest in sync';
    const lines = ['⚠️ config drift detected:'];
    if (d.missing.length) lines.push(`  MISSING (high): ${d.missing.join(', ')} — manifest ghi nhưng registry không có`);
    if (d.extra.length) lines.push(`  EXTRA (medium): ${d.extra.join(', ')} — registry có nhưng manifest không ghi (ẩn)`);
    if (d.renamed.length) lines.push(`  RENAMED (medium): ${d.renamed.map(r => `${r.declared}→${r.actual}`).join(', ')}`);
    return lines.join('\n');
  }
}

function aliasMapHas(actual: Set<string>, name: string): boolean { return actual.has(name); }
function fuzzyMatch(name: string, candidates: string[]): string | null {
  return candidates.find(c => c.includes(name.slice(0, 4)) || name.includes(c.slice(0, 4))) ?? null;
}

// Usage:
// const declared = audit.parseManifest(readFileSync('AGENTS.md','utf8'));
// const actual = registry.list().map(s => ({ name: s.meta.name }));
// const drift = audit.diff(declared, actual);
// console.log(audit.report(drift));  // WARN nếu drift
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện drift (missing/extra/renamed) | ❌ Parser markdown brittle (format manifest đa dạng) |
| ✅ Skill ẩn lộ (extra — không lọt qua audit) | ❌ Fuzzy match false-positive (renamed đo nhầm) |
| ✅ Manifest = truth (sync định kỳ) | ❌ Audit overhead (chạy định kỳ) |
| ✅ Meta-skill (agent tự audit capability) | ❌ Severity heuristic (cần tune) |

## Khác các hướng gần

| | Version-Check | Health-Check | SF: Config-Drift |
|---|---|---|---|
| So cái gì | Phiên bản | Liveness | **Capability set (manifest vs actual)** |
| Drift | ❌ | ❌ | **missing/extra/renamed** |
| Mục đích | Update | Sống/chết | **Reconciliation** |

## Khi nào chọn

- Nhiều skill (registry lớn, dễ lệch manifest)
- Muốn manifest = source of truth (audit định kỳ sync)
- Phát hiện skill ẩn (extra — không phê duyệt nhưng tồn tại)
- Nối skill registry + AGENTS.md (manifest); guard parser robustness (markdown đa dạng — fallback section/bullet) + fuzzy threshold (renamed không false-positive) + audit cadence (định kỳ hoặc trên load); phối 47 anti-patterns (drift = anti-pattern khi không sync)
