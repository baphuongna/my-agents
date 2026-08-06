# Hướng ACM: Exact-Count Grep Evidence — dùng `grep -c`/`grep -rnE` lấy số đếm chính xác thay vì ước lượng, mọi verdict gắn evidence tái lập được

> **Nguồn gốc:** pi-crew-distill-v2 (references/apply-plan.md) | **Coupling:** 🟢 — phương pháp evidence, không đụng kiến trúc | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (grep + audit sẵn — cần discipline) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew-distill-v2** dùng phương pháp **PRESENCE** để lấy evidence: **`grep -c` / `grep -rnE`** cho **số đếm chính xác** (106 patterns / 50 files) **thay vì ước lượng**, kèm **V5 citations với line number thật**. Mọi **verdict đều gắn evidence grep có thể tái lập** — ai chạy lại lệnh grep cũng ra cùng kết quả. Điều này chống "agent nói chung chung": verdict không phải ấn tượng của model mà là output deterministic của công cụ. Nguyên tắc: **số liệu phải đến từ lệnh chạy lại được, không phải từ cảm nhận**.

## Mô tả

mya exact-count grep evidence: (1) **grep-first** — trước khi verdict (bao nhiêu site, pattern nào, file nào), chạy `grep -rnE "<pattern>"` thật; (2) **exact count** — `grep -c` cho từng file, tổng từ output, không "khoảng 100"; (3) **citation** — mỗi claim ghi `file:line` thật (V5 citations); (4) **reproducible** — lệnh grep đầy đủ được ghi lại trong plan để tái lập; (5) **verdict gắn evidence** — mọi kết luận (REJECT/APPLY) phải có grep output đính kèm. Nối ACL (error consolidation) — ACM là cách đếm chính xác cho ACL; nối ACN (category partition) — ACM cung cấp danh sách để phân loại.

## Kiến trúc

```
  VERDICT CẦN EVIDENCE
       ▼
  GREP-FIRST (deterministic — chạy lại được)
    grep -rnE "pattern" packages/  → file:line:match
    grep -c  "pattern" file.ts     → count chính xác
       ▼
  EXACT COUNT (không ước lượng)
    106 patterns / 50 files
       ▼
  CITATION (V5 — file:line thật)
    verdict ──▶ evidence grep ──▶ line number thật
       ▼
  REPRODUCIBLE — ai chạy lại lệnh cũng ra cùng số
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools grepTool — builtin grep (nền — grep-first từ agent)
// ✅ packages/tools find.ts — globToRegex (nền — pattern chuyển regex)
// ✅ packages/audit index.ts — AuditLog (nền — lưu verdict + evidence)
// ✅ packages/eval harness.ts — ParityHarness (nền — verify không đổi hành vi)
// ✅ packages/core canonical-json.ts — canonical output (nền — evidence serialize ổn định)

// ❌ THIẾU: grep-evidence helper (chạy grep + parse count + sinh citation)
// ❌ THIẾU: verdict structure gắn bắt buộc evidence
```
## Implementation
```typescript
// packages/tools/src/grep-evidence.ts (MỚI)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
export interface GrepEvidence {
  /** Lệnh đầy đủ — tái lập được. */
  command: string;
  count: number;
  files: Array<{ file: string; lines: number[] }>;
  raw: string;
}
/** Chạy grep -rnE, parse file:line, trả evidence deterministic. */
export async function grepEvidence(
  pattern: string,
  dir: string,
  opts: { glob?: string } = {},
): Promise<GrepEvidence> {
  const args = ["-rnE", "--no-heading"];
  if (opts.glob) args.push("--include", opts.glob);
  args.push(pattern, dir);
  const command = `grep ${args.join(" ")}`;
  let raw = "";
  try {
    const { stdout } = await execFileP("grep", args, { maxBuffer: 16 * 1024 * 1024 });
    raw = stdout;
  } catch {
    raw = ""; // exit code 1 = không match — vẫn là evidence hợp lệ
  }
  const byFile = new Map<string, Set<number>>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const file = line.slice(0, idx);
    const rest = line.slice(idx + 1);
    const lineNo = Number.parseInt(rest, 10);
    if (Number.isFinite(lineNo)) {
      const s = byFile.get(file) ?? new Set<number>();
      s.add(lineNo);
      byFile.set(file, s);
    }
  }
  const files = [...byFile.entries()].map(([file, lines]) => ({ file, lines: [...lines].sort((a, b) => a - b) }));
  const count = files.reduce((n, f) => n + f.lines.length, 0);
  return { command, count, files, raw };
}
/** Sinh citation block — verdict gắn evidence tái lập. */
export function citationBlock(ev: GrepEvidence, verdict: string): string {
  const files = ev.files
    .slice(0, 10)
    .map((f) => `  ${f.file}:${f.lines.join(",")}`)
    .join("\n");
  return [
    `VERDICT: ${verdict}`,
    `EVIDENCE: ${ev.command}`,
    `COUNT: ${ev.count} (${ev.files.length} files)`,
    files,
    ev.files.length > 10 ? `  … +${ev.files.length - 10} files` : "",
  ].join("\n");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Số đếm chính xác — không ước lượng, không "khoảng" | ❌ Grep miss pattern viết cách dòng/nhiều dòng |
| ✅ Evidence tái lập — ai chạy lại cũng ra cùng số | ❌ Grep trên repo lớn chậm — cần giới hạn dir/glob |
| ✅ Verdict gắn file:line thật — audit rõ ràng | ❌ Regex escape phức tạp khi pattern có ký tự đặc biệt |
| ✅ Count trả về cả 0 match (exit 1) — evidence hợp lệ | ❌ Binary files cần --text / exclude node_modules |

## Khác các hướng gần

| | Tool search (tools/tool-search.ts) | ACM: Grep Evidence |
|---|---|---|
| Mục đích | Tìm tool theo query | **Đếm chính xác pattern + citation** |
| Output | ToolDoc[] | **Count + files + line numbers + raw** |
| Tính chất | Ranking/fuzzy | **Deterministic — tái lập được** |
| Dùng khi | Tra cứu | **Verdict cần bằng chứng audit được** |

## Khi nào chọn

- Refactor/audit cần số liệu chính xác (bao nhiêu site, file nào, dòng nào)
- Verdict của agent (REJECT/APPLY) cần bằng chứng tái lập để review
- Kết hợp ACL (consolidation) — đếm đúng trước khi chia batch
- Guard: ghi lệnh grep đầy đủ, count từ output (không ước lượng), exclude binary/node_modules
