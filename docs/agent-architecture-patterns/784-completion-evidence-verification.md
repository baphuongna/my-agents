# Hướng ADD: Completion Evidence Verification — trước khi claim completion: sizing guidance, loop "identify what proves the claim → run verification → read output → report with evidence"

> **Nguồn gốc:** oh-my-claudecode (AGENTS.md) | **Coupling:** 🟢 — verification stage, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có eval harness + lsp-cascade — chưa có evidence contract) | **Effort:** 1-2 tuần

## Nguồn gốc

**oh-my-claudecode** quy định **verification trước khi claim completion**: (1) **sizing guidance** — task nhỏ (<5 files) verify lightweight, task lớn/security (>20 files) verify **thorough**; (2) **loop chuẩn** — **"identify what proves the claim → run verification → read output → report with evidence"** — không claim suông; (3) **fail thì iterate tiếp chứ không báo incomplete work** — verify fail → sửa → verify lại, không đổ lỗi. Nguyên tắc: **completion claim phải kèm bằng chứng verify, độ sâu verify theo kích thước task, fail là tín hiệu iterate không phải bỏ cuộc**.

## Mô tả

mya completion evidence verification: (1) **sizing guidance** — đếm files thay đổi: <5 → `lightweight` (typecheck + test target), 5-20 → `standard` (thêm test suite), >20 hoặc security → `thorough` (thêm review + audit + cross-check); (2) **claim → proof mapping** — mỗi claim ("đã sửa bug X", "đã thêm feature Y") phải chỉ ra cái gì chứng minh (test pass, output tool, diff); (3) **run verification** — chạy thật (packages/eval harness.ts, packages/tools lsp-cascade.ts diagnostics); (4) **read output + report evidence** — báo cáo gắn output thật, không paraphrase; (5) **fail → iterate** — verify fail quay lại sửa, không báo "incomplete work". Nối ADC (Ralph loop) — ADD là verification contract ADC dùng.

## Kiến trúc

```
  CLAIM COMPLETION ("đã sửa X")
       ▼
  SIZING GUIDANCE
    <5 files  ──▶ lightweight (typecheck + test target)
    5-20      ──▶ standard (test suite)
    >20/sec   ──▶ thorough (review + audit + cross-check)
       ▼
  LOOP: identify proof → run verification → read output → report
       ├─ verify pass ──▶ completion + EVIDENCE (output thật)
       └─ verify fail ──▶ iterate (sửa → verify lại)
                          KHÔNG báo "incomplete work" như lý do bỏ cuộc
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval harness.ts — ParityHarness + scenarios (nền — chạy verify)
// ✅ packages/tools lsp-cascade.ts — runCascade + computeImpact (nền — diagnostics)
// ✅ packages/tools lsp-client.ts — LspClient diagnostics (nền — typecheck evidence)
// ✅ packages/audit index.ts — AuditLog (nền — ghi evidence)
// ✅ packages/core canonical-json.ts — canonicalJson (nền — serialize evidence ổn định)
// ✅ packages/print mya-bridge.ts — parseDoneResult (nền — completion report)

// ❌ THIẾU: sizing guidance (lightweight/standard/thorough)
// ❌ THIẾU: claim → proof mapping contract
// ❌ THIẾU: verification loop chuẩn (identify → run → read → report)
```
## Implementation
```typescript
// packages/eval/src/completion-evidence.ts (MỚI)
export type VerifyDepth = "lightweight" | "standard" | "thorough";
export interface CompletionClaim {
  text: string;
  /** Điều gì chứng minh claim — identify what proves it. */
  proof: string[];
}
export interface VerificationReport {
  claim: CompletionClaim;
  depth: VerifyDepth;
  /** Evidence thật — output từ verification runs. */
  evidence: Array<{ name: string; passed: boolean; output: string }>;
  overall: boolean;
}
/** Sizing guidance — depth theo số files + độ nhạy cảm. */
export function sizingGuidance(fileCount: number, securitySensitive: boolean): VerifyDepth {
  if (securitySensitive || fileCount > 20) return "thorough";
  if (fileCount >= 5) return "standard";
  return "lightweight";
}
/** Claims phải khai báo proof — không claim trần. */
export function validateClaims(claims: CompletionClaim[]): string[] {
  return claims
    .filter((c) => c.proof.length === 0)
    .map((c) => `claim "${c.text}" thiếu proof — identify what proves the claim`);
}
/** Verification loop — identify → run → read → report. */
export async function runVerificationLoop(
  claims: CompletionClaim[],
  depth: VerifyDepth,
  runCheck: (claim: CompletionClaim, depth: VerifyDepth) => Promise<{ passed: boolean; output: string }>,
): Promise<VerificationReport[]> {
  const reports: VerificationReport[] = [];
  for (const claim of claims) {
    const evidence: VerificationReport["evidence"] = [];
    for (const proof of claim.proof) {
      // run verification cho từng proof — đọc output thật, không paraphrase.
      const r = await runCheck({ text: `${claim.text} — ${proof}`, proof: [proof] }, depth);
      evidence.push({ name: proof, passed: r.passed, output: r.output });
    }
    reports.push({
      claim,
      depth,
      evidence,
      overall: evidence.length > 0 && evidence.every((e) => e.passed),
    });
  }
  return reports;
}
/** Gate completion — chỉ cho phép claim khi overall pass. */
export function completionGate(reports: VerificationReport[]): { ok: boolean; blockers: string[] } {
  const blockers = reports
    .filter((r) => !r.overall)
    .map((r) => `claim "${r.claim.text}" chưa có evidence pass — iterate tiếp (KHÔNG báo incomplete work như bỏ cuộc)`);
  return { ok: blockers.length === 0, blockers };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Completion có bằng chứng — không claim suông | ❌ Verify tốn thời gian — task nhỏ vẫn phải chạy |
| ✅ Sizing guidance — depth theo rủi ro | ❌ Proof mapping phụ thuộc agent khai báo đúng |
| ✅ Fail → iterate — chất lượng cuối cao | ❌ Loop verify có thể kéo dài (cần budget) |
| ✅ Report gắn output thật — audit được | ❌ Depth threshold cần calibrate |

## Khác các hướng gần

| | Eval harness (eval/harness.ts) | ADD: Completion Evidence |
|---|---|---|
| Mục đích | So sánh parity giữa provider | **Chứng minh claim completion** |
| Depth | Cố định scenario | **Sizing guidance (lightweight/standard/thorough)** |
| Output | ScenarioResult | **Evidence per claim + completion gate** |
| Quan hệ | Nền verify | **Contract + loop quanh verification** |

## Khi nào chọn

- Agent hay claim "xong" mà không có bằng chứng — cần gate
- Task nhiều cấp độ rủi ro — verify depth theo size/security
- Đã có eval + lsp-cascade + audit — thêm evidence contract
- Guard: claim phải khai proof, report gắn output thật, fail iterate không bỏ cuộc
