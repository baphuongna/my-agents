# Hướng AKI: Secret-Scan Pre-Commit Hook — Bash hook scan secret + prompt injection trước git commit/push, matcher Bash chặn `git --no-verify` bypass qua block-no-verify hook

> **Nguồn gốc:** vetc-dev-kit (hooks/hooks.json, scripts/hooks/secret-scan.js) | **Coupling:** 🟡 — git hook + scan chặn commit | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có threat-scan + redact + osv; thiếu git hook) | **Effort:** 1 tuần

## Nguồn gốc

**vetc-dev-kit** (hooks/hooks.json, scripts/hooks/secret-scan.js) có **Bash hook scan secret + prompt injection trước git commit/push**: (1) **scan secret** — quét diff sắp commit: API key, token, credential patterns (sk-..., AKIA..., password=...) → chặn commit; (2) **scan prompt injection** — quét pattern injection (lệnh ẩn, prompt-steering) trong nội dung commit — dữ liệu nhạy cảm tài chính của kit; (3) **matcher Bash** — scanner chạy bằng Bash/node script (không phụ thuộc tool ngoài); (4) **chặn `git --no-verify` bypass** — user cố `git commit --no-verify` để lách → **block-no-verify hook** chặn luôn (không cho bypass); (5) **bảo vệ dữ liệu nhạy cảm tài chính** — mục tiêu cuối: secret không bao giờ vào git history (commit xong là vĩnh viễn).

Giá trị: (1) **secret không vào history** — chặn trước commit, không phải xóa sau; (2) **không bypass được** — --no-verify bị chặn; (3) **tự động** — hook chạy mọi commit/push, không phụ thuộc kỷ luật; (4) **prompt injection cũng bị chặn** — nội dung độc hại không vào repo.

## Mô tả

Với mya, pattern = **pre-commit security gate**: (1) **scan engine** — tái dùng `packages/core/src/threat-scan.ts` (đã có: prompt injection patterns + 3-tier scope + Unicode defense) + `redact.ts` (secret patterns) — thêm git-diff scanner: đọc `git diff --cached`, chạy pattern scan trên từng dòng; (2) **git hook** — pre-commit + pre-push hook: chạy scan → có match → exit 1 (chặn) + báo file/dòng; (3) **no-verify blocker** — pre-commit hook đầu tiên kiểm tra `GIT_NO_VERIFY`/argv chứa `--no-verify`? thực ra git không truyền cờ — dùng hook phát hiện qua env/alias — vetc dùng block-no-verify hook riêng; mya: wrapper git hoặc hook kiểm tra (giải pháp thực dụng: `git config alias` + audit log); (4) **secret patterns** — nối `packages/secrets` (fingerprint — biết pattern secret) + core redact; (5) nơi gắn — `packages/tools` (tool `secret_scan` + hook installer), `packages/audit` (ghi log scan). Đây là pattern **shift-left secret prevention**: chặn ở cửa vào git, nơi duy nhất còn sửa được.

## Kiến trúc (ASCII)

```
  git commit / git push
    │
    ▼ PRE-COMMIT HOOK (chạy mọi lần — không phụ thuộc kỷ luật)
  ├─ git diff --cached → từng dòng sắp commit
  ├─ SCAN SECRET (threat-scan + redact patterns)
  │     sk-…, AKIA…, password=…, BEGIN PRIVATE KEY…
  ├─ SCAN PROMPT INJECTION (threat-scan — 3-tier scope + Unicode)
  └─ MATCH? ──► exit 1 CHẶN commit + báo file:dòng
      │
      ▼ BLOCK-NO-VERIFY HOOK
    git commit --no-verify ──► cũng bị chặn (không bypass được)
    ▼ KHÔNG MATCH ──► commit/push tiếp tục
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/threat-scan.ts — ThreatScanner (injection patterns + Unicode)
//   (3-tier scope: all/context/strict — nền cho scan engine)
// ✅ packages/core/src/redact.ts — redact engine (secret patterns — nền)
// ✅ packages/secrets/src/index.ts — fingerprint (SHA-256 12-char — nhận diện secret)
// ✅ packages/tools/src/osv-check.ts — security tool mẫu (nền — security surface)
// ✅ packages/audit/src/index.ts — audit log (nơi ghi scan result)

// ❌ THIẾU: git diff --cached scanner (từng dòng sắp commit)
// ❌ THIẾU: pre-commit/pre-push hook installer
// ❌ THIẾU: block-no-verify (chống git commit --no-verify bypass)
```

## Implementation

```typescript
// packages/tools/src/secret-scan-hook.ts (NEW)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { threatScan } from "@my-agent/core";        // đã có — injection + scope
const exec = promisify(execFile);

/** Pattern secret — nối core/redact + secrets fingerprint. */
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["openai-key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["generic-password", /\b(password|passwd|secret|token)\s*[=:]\s*['"]?[A-Za-z0-9_\-./+]{12,}/i],
];

/** Scan git diff --cached — từng dòng sắp commit, trả match kèm file:dòng. */
export async function scanStagedDiff(cwd: string): Promise<Array<{ file: string; line: number; pattern: string; snippet: string }>> {
  const { stdout } = await exec("git", ["diff", "--cached", "--unified=0"], { cwd, maxBuffer: 16 * 1024 * 1024 });
  const matches: Array<{ file: string; line: number; pattern: string; snippet: string }> = [];
  let file = "";
  let line = 0;
  for (const raw of stdout.split("\n")) {
    const fileM = /^\+\+\+\s+b\/(.+)$/.exec(raw);
    if (fileM) { file = fileM[1]!; continue; }
    const lineM = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (lineM) { line = Number(lineM[1]); continue; }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      const content = raw.slice(1);
      for (const [pattern, re] of SECRET_PATTERNS) {
        if (re.test(content)) matches.push({ file, line, pattern, snippet: content.slice(0, 80) });
      }
      const inject = threatScan(content, "strict");       // prompt injection — core
      if (!inject.safe) {
        matches.push({ file, line, pattern: "prompt-injection", snippet: inject.matches[0]?.snippet ?? content.slice(0, 80) });
      }
      line += 1;
    }
  }
  return matches;
}

/** Pre-commit gate — có match → chặn commit (exit 1) + báo cáo. */
export async function preCommitGate(cwd: string): Promise<{ ok: boolean; blocked: Array<{ file: string; line: number; pattern: string }> }> {
  const matches = await scanStagedDiff(cwd);
  return matches.length === 0
    ? { ok: true, blocked: [] }
    : { ok: false, blocked: matches.map((m) => ({ file: m.file, line: m.line, pattern: m.pattern })) };
}

/** Block no-verify — phát hiện cố lách `git commit --no-verify`. */
export function detectNoVerifyBypass(argv: readonly string[]): boolean {
  return argv.some((a) => a === "--no-verify" || a === "-n");
}
// Nối audit: scan result ghi vào audit log (packages/audit) — ai commit gì
// Nối secrets: fingerprint nối nhận diện secret dạng keyring/ref
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Secret không vào history — chặn trước commit | ❌ False positive (mã giống secret) — cần allowlist |
| ✅ Không bypass được — block-no-verify | ❌ Hook có thể bị gỡ tay — không phải boundary cứng |
| ✅ Tự động — mọi commit/push, không cần kỷ luật | ❌ Scan diff lớn tốn thời gian — cần tối ưu |
| ✅ Injection cũng bị chặn | ❌ Pattern thiếu (secret mới) — phải cập nhật |

## Khác các hướng gần

| | AKI Secret-Scan Hook | 835 Injection Scanner | 106 RAG Poisoning Defense |
|---|---|---|---|
| Trọng tâm | Chặn secret/injection vào git | Quét memory write | Chống đầu độc RAG |
| Cơ chế | Pre-commit hook + diff scan | Scanner trên write path | Defense layered |
| Quan hệ | Cổng vào repo | Bảo vệ memory | Bảo vệ retrieval |

## Khi nào chọn

- Repo nhạy cảm (tài chính, credential) — secret không được vào history
- Team hay commit nhầm key/token — cần gate tự động
- Muốn chặn luôn `--no-verify` bypass
- Guard: scan mọi commit, block-no-verify, báo file:dòng, injection scan kèm secret