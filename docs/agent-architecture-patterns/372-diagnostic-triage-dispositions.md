# Hướng NH: Diagnostic Triage Dispositions — mark false-positive/suppress/defer/flag, content-anchored

> **Nguồn gốc:** pi-lens (lens_diagnostic_mark); "diagnostic suppression" (eslint-disable, `// @ts-ignore`); "issue triage" (Jira labels); "content-addressable annotations"; "lint baseline" / "known issues"; "false positive registry"; code review "won't fix"
> **Coupling:** 🟢 — thêm triage layer trên diagnostic pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (diagnostics sẵn — chưa có disposition triage)
> **Effort:** 2 tuần

## Nguồn gốc

**Issue triage**: trong bug tracking, mỗi issue có trạng thái (confirmed / false-positive / won't-fix / deferred). pi-lens áp dụng cho **diagnostics**: agent (hoặc user) mark mỗi finding một disposition — `false-positive`, `suppress`, `defer`, `flagged`. Dispositions **content-anchored** (gắn vào nội dung dòng, không phải số dòng) → survive edits. Giống **eslint-disable** / **@ts-ignore**: suppress inline. Khác ở chỗ: pi-lens lưu disposition trong **store** (persistent) + ghi comment vào source (`pi-lens-ignore`) → dual enforcement. Nguyên lý: **không có "fixed" disposition thủ công** — fix phải được **observe** (finding biến mất từ fresh scan).

## Mô tả

mya diagnostic triage: agent dùng `lens_diagnostic_mark` để mark findings. Bốn disposition: (1) **false-positive** — rule misfired, project-persistent, strict anchor (rule + message + line hash); (2) **suppress** — real but won't fix, git-visible inline comment; (3) **defer** — not now, session-only; (4) **flagged** — should fix, persistent until observed fix. Mỗi mark content-anchored → survive edits (weak anchor cho suppress/defer/flagged, strict cho false-positive). Nối 371 impact-cascade (findings từ cascade) + 118 error-analysis (triage errors).

## Kiến trúc

```
  DIAGNOSTIC from LSP/cascade/scanner:
    file: src/api.ts  line: 42  rule: no-floating-promises
    severity: warning  message: "Promises must be awaited"
        │
        ▼
  ┌─── DISPOSITION TRIAGE ─────────────────────────────┐
  │                                                     │
  │  Agent (or user) marks:                             │
  │                                                     │
  │  ┌─────────────────┬──────────┬─────────┬─────────┐ │
  │  │ false-positive  │ suppress │ defer   │ flagged │ │
  │  │ "rule misfired" │ "won't   │ "later" │ "fix    │ │
  │  │                 │  fix"    │         │  this"  │ │
  │  ├─────────────────┼──────────┼─────────┼─────────┤ │
  │  │ ANCHOR: strict  │ weak     │ weak    │ weak    │ │
  │  │ (rule+msg+hash) │(rule+msg)│(rule+msg)│(rule+msg)│ │
  │  ├─────────────────┼──────────┼─────────┼─────────┤ │
  │  │ LIFE: persistent│ persist+ │ session │ persist │ │
  │  │                 │ git-comm │ only    │ until   │ │
  │  │                 │ ent      │         │ fix obs │ │
  │  └─────────────────┴──────────┴─────────┴─────────┘ │
  │                                                     │
  │  ⚠️ NO manual "fixed" — fix must be OBSERVED        │
  │     (finding disappears from fresh scan)            │
  └──────────────────────┬──────────────────────────────┘
                         │
                         ▼
  STORE (diagnostic-dispositions.json) + SOURCE COMMENT (pi-lens-ignore)
  → honored by ALL surfaces (per-edit, lens_diagnostics, widget)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 371 impact-cascade-diagnostics — findings (nền — NH triage cascade results)
// ✅ 118 error-analysis — error triage (nền)
// ✅ 119 bounded-self-correction — fix loop (nền — NH "flagged" triggers fix)
// ✅ diagnostics pipeline — LSP/linter output (sẵn)

// ❌ THIẾU: disposition tool (lens_diagnostic_mark)
// ❌ THIẾU: content-anchored store (survive edits)
// ❌ THIẾU: suppress comment writer (pi-lens-ignore inline)
// ❌ THIẾU: observed-fix detection (finding disappears → auto-resolve)
```

## Implementation

```typescript
// packages/agent/src/diagnostic-triage.ts (NEW)
type Disposition = 'false-positive' | 'suppress' | 'defer' | 'flagged';

interface DiagnosticMark {
  filePath: string;
  line: number;
  message: string;
  rule: string;
  disposition: Disposition;
  reason?: string;
  timestamp: number;
}

interface AnchoredMark extends DiagnosticMark {
  anchorStrength: 'strict' | 'weak';
  lineContentHash?: string; // strict anchor only
}

class DiagnosticTriage {
  private persistentMarks: AnchoredMark[] = []; // diagnostic-dispositions.json
  private sessionMarks: Map<string, AnchoredMark> = new Map(); // defer only

  // Mark a diagnostic with a disposition
  mark(mark: DiagnosticMark): void {
    const anchored: AnchoredMark = {
      ...mark,
      anchorStrength: mark.disposition === 'false-positive' ? 'strict' : 'weak',
      lineContentHash: mark.disposition === 'false-positive' ? this.hashLine(mark.line) : undefined,
    };

    if (mark.disposition === 'defer') {
      this.sessionMarks.set(this.key(mark), anchored); // session-only
    } else {
      this.persistentMarks.push(anchored);
      this.persist(); // write to JSON store
      if (mark.disposition === 'suppress') this.writeSuppressComment(mark); // inline source
    }
  }

  // Check if a diagnostic is suppressed/marked — used by all surfaces
  isSuppressed(diag: { filePath: string; line: number; message: string; rule: string; lineContent: string }): Disposition | null {
    // strict anchor: rule + message + line hash
    const strict = this.persistentMarks.find(m =>
      m.anchorStrength === 'strict' &&
      m.rule === diag.rule &&
      this.normalize(m.message) === this.normalize(diag.message) &&
      m.lineContentHash === this.hashLineFromContent(diag.lineContent)
    );
    if (strict) return strict.disposition;

    // weak anchor: rule + message only
    const weak = [...this.persistentMarks, ...this.sessionMarks.values()].find(m =>
      m.anchorStrength === 'weak' &&
      m.rule === diag.rule &&
      this.normalize(m.message) === this.normalize(diag.message)
    );
    return weak ? weak.disposition : null;
  }

  // Observe fix: if finding disappears from fresh scan → auto-resolve flagged
  reconcileWithFreshScan(freshDiags: Diagnostic[]): void {
    // flagged marks whose finding no longer appears → resolved
    // (no manual "fixed" — fix is observed, never asserted)
  }

  private writeSuppressComment(m: DiagnosticMark): void {
    // write `// pi-lens-ignore: <rule>` above the flagged line
  }
  private hashLine(line: number): string { return ''; }
  private hashLineFromContent(content: string): string { return ''; }
  private normalize(msg: string): string { return msg.trim().toLowerCase(); }
  private key(m: DiagnosticMark): string { return `${m.filePath}:${m.rule}:${m.message}`; }
  private persist(): void { /* write JSON store */ }
}

// Stub
interface Diagnostic { filePath: string; line: number; message: string; rule: string; }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự triage (không fix mọi warning) | ❌ False-positive abuse (agent mark all as FP) |
| ✅ Content-anchored (survive edits, not line numbers) | ❌ Store maintenance (clear stale marks) |
| ✅ Git-visible suppress (inline comment, reviewable) | ❌ Strict anchor breaks on line rewrite |
| ✅ Observed-fix (không tự báo "fixed") | ❌ Session-only defer lost on restart |

## Khác các hướng gần

| | 118 Error-Analysis | 119 Bounded-Self-Correction | 371 Impact-Cascade | NH: Triage |
|---|---|---|---|---|
| Mục | Phân tích error | Fix loop | Diagnose dependents | **Mark disposition per finding** |
| Action | Diagnose | Fix | Fan-out | **false-positive/suppress/defer/flag** |
| Anchor | ❌ | ❌ | ❌ | **Content-anchored** |

## Khi nào chọn

- Nhiều diagnostic noise (agent cần triage, không fix hết)
- Muốn suppress persistent + git-visible (reviewable)
- Cần distinguish "won't fix" vs "fix later" vs "rule misfired"
- Nối 371 impact-cascade (triage cascade findings) + 119 self-correction (flagged → fix loop)
