# Hướng ABB: Suppression Directive System — suppress tại chỗ bằng directive comment, tách bạch với rules config project-wide

> **Nguồn gốc:** fallow (CONTEXT.md) | **Coupling:** 🟢 — chỉ thêm parser directive + filter khi emit finding | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có threat-scan + cron scan — chưa có directive suppress) | **Effort:** 1 tuần

## Nguồn gốc

**fallow** — một static-analysis agent cho Rust — có **hai hình thức suppress tại chỗ**: (1) `// fallow-ignore-next-line <issue-type>` — bỏ qua đúng **dòng kế tiếp**; (2) `// fallow-ignore-file <issue-type>` — bỏ qua **cả file**. Cả hai đều **tách bạch** với rules config project-wide: một finding bị suppress ở cấp dòng/file **không hạ ngưỡng toàn cục** (threshold, deny-list, allowed patterns vẫn nguyên). Agent muốn loại nhiễu cục bộ (một dòng test dùng `any`, một file generated code) thì ghi directive ngay tại chỗ — người đọc thấy được lý do suppress mà không cần tra config. Nguyên tắc: **suppress có scope hẹp (next-line/file), không đụng policy toàn cục, mỗi directive gắn issue-type**.

## Mô tả

mya suppression directive system: các scanner (threat-scan, cron prompt scan, linter tool) khi emit finding sẽ check **directive map** trước: `// mya-ignore-next-line <issue-type>` → bỏ finding của dòng kế tiếp; `// mya-ignore-file <issue-type>` → bỏ finding của cả file. Directive được parse từ source text trước khi scan; scope chỉ là line/file — **không có** suppress toàn cục (muốn đổi threshold thì sửa config, không dùng directive). Kết quả: agent giảm noise cục bộ mà **không giảm ngưỡng toàn cục** — diff review sạch hơn, findings nghiêm túc hơn.

## Kiến trúc

```
  SOURCE FILE (có directive)
  ┌─────────────────────────────────────────────┐
  │ // mya-ignore-next-line injection-risk      │
  │ const x = eval(userInput);    ← dòng bị bỏ  │
  │                                             │
  │ // mya-ignore-file secrets-scan             │
  │ const key = "sk-...";         ← cả file bỏ  │
  └──────────────────────┬──────────────────────┘
                         │ parse directives (regex dòng comment)
                         ▼
  DIRECTIVE MAP  { "injection-risk": Set<lineNo>, "secrets-scan": "file" }
                         │
                         ▼
  SCANNER EMIT FINDING ──► SUPPRESS FILTER
                         │  finding.type ∈ directive set của line/file ?
                         │  → YES: drop finding (không vào report)
                         │  → NO:  giữ finding (đi qua như bình thường)
                         ▼
                     REPORT (chỉ findings chưa suppress)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core threat-scan.ts — prompt injection scanner (nền — ABB filter findings)
// ✅ packages/cron scan.ts — cron prompt scan (nền — ABB suppress finding nguồn)
// ✅ packages/tools builtin.ts — linter/grep tools (nền — ABB gắn vào emit path)
// ✅ packages/core redact.ts — redaction (liên quan — suppress ≠ redact: suppress bỏ finding, redact che text)

// ❌ THIẾU: directive parser (mya-ignore-next-line / mya-ignore-file)
// ❌ THIẾU: suppress filter (finding × directive map → drop)
// ❌ THIẾU: directive audit (đếm directive dùng, cảnh báo directive thừa)
```

## Implementation

```typescript
// packages/core/src/suppression-directive.ts (MỚI)

export type SuppressScope = "next-line" | "file";

export interface SuppressDirective {
  issueType: string; // "injection-risk" | "secrets-scan" | ...
  scope: SuppressScope;
  line: number; // dòng chứa directive (1-based)
}

const DIRECTIVE_RE = /\/\/\s*mya-ignore-(next-line|file)\s+([\w-]+)/g;

/** Parse mọi directive suppress trong source text. */
export function parseDirectives(source: string): SuppressDirective[] {
  const out: SuppressDirective[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i]!.matchAll(DIRECTIVE_RE)) {
      out.push({ issueType: m[2]!, scope: m[1] === "file" ? "file" : "next-line", line: i + 1 });
    }
  }
  return out;
}

/** Filter findings: bỏ finding trùng issue-type với directive ở line/file tương ứng. */
export function applySuppression<T extends { type: string; line: number }>(
  findings: T[],
  directives: SuppressDirective[],
): T[] {
  const suppressed = new Set<number>(); // line numbers bị next-line suppress
  const suppressedFiles = new Set(directives.filter(d => d.scope === "file").map(d => d.issueType));
  for (const d of directives) if (d.scope === "next-line") suppressed.add(d.line + 1);
  return findings.filter(f =>
    !suppressedFiles.has(f.type) && !(suppressed.has(f.line) && true) && !suppressed.has(f.line),
  );
}

// Usage:
// const dirs = parseDirectives(source);
// const clean = applySuppression(findings, dirs); // findings có type trùng → drop
// → noise cục bộ biến mất, ngưỡng toàn cục không đổi
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Suppress cục bộ (line/file) — không hạ ngưỡng toàn cục | ❌ Directive drift (directive cũ, finding không còn — code rác) |
| ✅ Tự mô tả (người đọc thấy lý do suppress ngay tại chỗ) | ❌ Bỏ sót finding thật (suppress sai dòng → finding ẩn) |
| ✅ Dễ review (diff chỉ thêm 1 comment) | ❌ Regex brittle (directive viết sai format → không match) |
| ✅ Agent-agnostic (pure text parse, không cần LLM) | ❌ Scope giới hạn (không suppress được "mọi nơi pattern này") |

## Khác các hướng gần

| | Config toàn cục (threshold) | Suppress directive (ABB) | Redact (che text) |
|---|---|---|---|
| Scope | project-wide | **line / file** | text content |
| Finding | hạ ngưỡng → bỏ nhiều | **bỏ đúng finding được chỉ định** | giữ finding, che nội dung |
| Audit | config review | **đọc comment trong code** | runtime |

## Khi nào chọn

- Scanner tạo nhiều false-positive cục bộ (test fixture, generated code) mà không muốn hạ ngưỡng chung
- Muốn suppress có thể review được trong code (không phải config ẩn)
- Cần agent-agnostic (pure text — không phụ thuộc runtime của agent)
- Nối packages/core threat-scan.ts + packages/cron scan.ts + packages/tools builtin.ts; guard directive-scope (không cho suppress toàn cục qua directive), issue-type-required (mọi directive phải ghi type — không suppress mù), và stale-directive-audit (đếm directive không còn finding để dọn); ABB = suppression directive system, kết hợp 730-family fallow suppress semantics với 637 XM security-scan-gate (gate severity trước khi suppress)
