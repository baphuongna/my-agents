# Hướng AJZ: Verification-Before-Completion Skill — skill định nghĩa gate function: IDENTIFY → RUN → READ → VERIFY, bảng "Claim requires / Not sufficient" liệt kê lối tắt sai

> **Nguồn gốc:** superpowers (skills/verification-before-completion/SKILL.md) | **Coupling:** 🟢 — skill procedure, không đụng core | **Agent-agnostic:** ⚠️ (phụ thuộc model tuân thủ) | **Code sẵn:** ⚠️ (có eval + codeexec; thiếu gate function skill) | **Effort:** 1 tuần

## Nguồn gốc

**superpowers** (skills/verification-before-completion/SKILL.md) định nghĩa **gate function** cho mọi claim: (1) **IDENTIFY command** — xác định lệnh nào chứng minh claim (chạy cái gì thì mới có bằng chứng); (2) **RUN full command fresh** — chạy lại lệnh đầy đủ, mới (không dùng kết quả cũ); (3) **READ output/exit code** — đọc kết quả thật; (4) **VERIFY khớp claim** — đối chiếu output với claim; (5) **ONLY THEN claim** — chỉ sau 4 bước mới được nói "xong". Kèm **bảng "Claim requires / Not sufficient"** liệt kê các lối tắt sai: "build was fine yesterday" (không đủ — cần chạy lại hôm nay), "CI will catch it" (không đủ — cần bằng chứng local), "I've done this before" (không đủ — mỗi lần là mỗi lần).

Giá trị: (1) **claim có bằng chứng** — mọi "xong/pass/hoạt động" đều kèm output lệnh chạy thật; (2) **chống rationalization** — bảng Not sufficient liệt kê sẵn câu biện hộ để agent nhận ra và không dùng; (3) **deterministic gate** — 4 bước cố định, không phải cảm giác; (4) **freshness** — lệnh chạy mới, không dùng kết quả stale.

## Mô tả

Với mya, pattern = **verification gate function** gắn vào completion path: (1) **skill body** — Verification-Before-Completion: gate function 4 bước (IDENTIFY → RUN → READ → VERIFY → claim); (2) **claim registry** — loại claim thường gặp (build pass, test pass, feature works, no regression) kèm lệnh chứng minh tương ứng — mya có `packages/tools/src/codeexec.ts` (chạy lệnh), `lsp-cascade.ts` (diagnostics), eval harness (test); (3) **Not-sufficient table** — câu biện hộ → lý do sai: "was fine yesterday" → không fresh; "CI will catch" → không phải bằng chứng local; "trust me" → không có output; (4) **completion gate** — trước khi agent nói "xong", skill yêu cầu đính kèm output lệnh verify — nối `packages/core` budget/loop (completion path); (5) nơi gắn — `packages/skills` skill + eval case (AJV-style: corpus kiểm tra agent đưa claim kèm bằng chứng). Đây là pattern **evidence-attached claims**: claim và bằng chứng là một gói, không tách rời.

## Kiến trúc (ASCII)

```
  CLAIM: "feature X đã xong"
    │
    ▼ GATE FUNCTION (4 bước bắt buộc)
  ├─ 1. IDENTIFY ──► lệnh nào chứng minh? (build? test? demo?)
  ├─ 2. RUN fresh ──► chạy lại lệnh đầy đủ (không dùng kết quả cũ)
  ├─ 3. READ ──► output + exit code thật
  ├─ 4. VERIFY ──► output khớp claim?
  └─ ONLY THEN: claim được phép nói
    │
    ▼ BẢNG NOT SUFFICIENT (câu biện hộ sai — cấm dùng)
  ├─ "build was fine yesterday"   ──► không fresh — chạy lại hôm nay
  ├─ "CI will catch it"           ──► không phải bằng chứng local
  └─ "I've done this before"      ──► mỗi lần là mỗi lần — chạy lại
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (RUN fresh command)
// ✅ packages/tools/src/lsp-cascade.ts — runCascade + diagnostics (READ output)
// ✅ packages/eval/src/harness.ts + tiers.ts — eval harness (verify claims)
// ✅ packages/skills/src/skill.ts — Skill body (nơi chứa verification skill)
// ✅ packages/core/src/loop.ts + budget.ts — loop/budget (completion path)
// ❌ THIẾU: gate function skill (IDENTIFY→RUN→READ→VERIFY)
// ❌ THIẾU: claim registry (claim → lệnh chứng minh tương ứng)
// ❌ THIẾU: Not-sufficient table (câu biện hộ sai → lý do)
```

## Implementation

```typescript
// packages/skills/src/verification-gate.ts (NEW)
export interface VerifyClaim {
  claim: string;               // "build pass" | "test pass" | "feature works"
  command: string;             // lệnh chứng minh — IDENTIFY
  expectation: string;         // output/exit code mong đợi — VERIFY chuẩn
}
export interface VerifyResult {
  ok: boolean;
  evidence: string;            // output thật đã READ
  exitCode: number | null;
}
/** Claim registry — claim thường gặp → lệnh chứng minh tương ứng. */
const CLAIM_REGISTRY: Record<string, VerifyClaim> = {
  "build pass": { claim: "build pass", command: "npm run build", expectation: "exit 0, không error" },
  "test pass": { claim: "test pass", command: "npx vitest run", expectation: "0 failed" },
  "feature works": { claim: "feature works", command: "node scripts/demo.mjs", expectation: "output mong đợi" },
};
/** Gate function — 4 bước: IDENTIFY → RUN fresh → READ → VERIFY → only then claim. */
export async function verifyBeforeClaim(
  claim: string,
  run: (cmd: string) => Promise<{ stdout: string; exitCode: number | null }>,
  opts: { command?: string; expectation?: string } = {},
): Promise<{ ok: boolean; result: VerifyResult; reason: string }> {
  // 1. IDENTIFY — lệnh chứng minh (từ registry hoặc caller cung cấp).
  const spec = opts.command
    ? { claim, command: opts.command, expectation: opts.expectation ?? "" }
    : CLAIM_REGISTRY[claim];
  if (!spec) return { ok: false, result: { ok: false, evidence: "", exitCode: null }, reason: `không biết lệnh chứng minh cho claim "${claim}" — IDENTIFY trước` };
  // 2. RUN full command FRESH — không dùng kết quả cũ.
  const { stdout, exitCode } = await run(spec.command);
  // 3. READ output/exit code — 4. VERIFY khớp claim.
  const ok = exitCode === 0 && (spec.expectation === "" || stdout.includes(spec.expectation));
  return {
    ok,
    result: { ok, evidence: stdout.slice(0, 500), exitCode },
    reason: ok ? "" : `output không khớp expectation "${spec.expectation}" (exit ${exitCode})`,
  };
}
/** Not-sufficient table — câu biện hộ sai → lý do không đủ. */
const NOT_SUFFICIENT: Array<[string, string]> = [
  ["build was fine yesterday", "không fresh — chạy lại lệnh hôm nay"],
  ["CI will catch it", "CI không phải bằng chứng local — chạy ở đây"],
  ["I've done this before", "mỗi lần là mỗi lần — chạy lại, đừng tin ký ức"],
  ["it's a tiny change", "kích thước không phải bằng chứng — vẫn phải RUN"],
];
export function rationalizationCheck(agentQuote: string): string | null {
  const q = agentQuote.toLowerCase();
  for (const [excuse, why] of NOT_SUFFICIENT) {
    if (q.includes(excuse.toLowerCase())) return why;
  }
  return null;
}
// Nối completion: trước claim "xong" → verifyBeforeClaim + đính kèm evidence vào kết quả
// Nối eval: case kiểm tra agent claim kèm output thật (không dùng biện hộ)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mọi claim kèm bằng chứng — không nói "xong" suông | ❌ Chạy lại lệnh tốn thời gian cho claim nhỏ |
| ✅ Chống rationalization — bảng biện hộ sai liệt kê sẵn | ❌ Model có thể tự chế bằng chứng — cần đọc output thật |
| ✅ Freshness — không dùng kết quả stale | ❌ Claim registry thiếu lệnh — phải bổ sung |
| ✅ Gate deterministic — 4 bước cố định | ❌ Output dài → evidence cắt 500 chars có thể mất ý |

## Khác các hướng gần

| | AJZ Verification Gate | 783 Ralph Loop | 671 Triple Verification |
|---|---|---|---|
| Trọng tâm | Claim phải có bằng chứng | Loop tới verified | Xác nhận mental model |
| Cơ chế | IDENTIFY→RUN→READ→VERIFY | Snapshot + retry + verify | Cross-domain recurrence |
| Quan hệ | Gate cuối của Ralph | Tiêu thụ AJZ gate | Khác miền (epistemic) |

## Khi nào chọn

- Agent hay claim "xong" mà không có bằng chứng — cần gate cứng
- Completion quan trọng (release, merge) — claim phải kèm output thật
- Muốn chống câu biện hộ ("was fine yesterday") bằng bảng rõ ràng
- Guard: 4 bước bắt buộc, lệnh chạy fresh, đọc output thật, biện hộ bị chặn