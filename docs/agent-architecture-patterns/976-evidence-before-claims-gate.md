# Hướng AKN: Evidence-Before-Claims Gate — `vetc-verify` enforce "EVIDENCE BEFORE CLAIMS": cấm claim PASS cho bất kỳ gate nào mà không RUN→READ→VERIFY, bảng rationalization prevention liệt kê câu biện hộ sai

> **Nguồn gốc:** vetc-dev-kit (skills/vetc-verify/SKILL.md) | **Coupling:** 🟡 — verify gate trong completion path | **Agent-agnostic:** ⚠️ (phụ thuộc model tuân thủ) | **Code sẵn:** ⚠️ (có eval + lsp-cascade; thiếu evidence gate skill) | **Effort:** 1 tuần

## Nguồn gốc

**vetc-dev-kit** có **`vetc-verify`** enforce **"EVIDENCE BEFORE CLAIMS"**: (1) **cấm claim PASS cho bất kỳ gate nào** (build/test/coverage/security/API contract) mà **không RUN→READ→VERIFY** — chạy lệnh thật, đọc output, đối chiếu với claim — rồi mới được nói PASS; (2) **bảng rationalization prevention** — liệt kê **các câu biện hộ** ("build was fine yesterday", "CI will catch it", "trust me, it works") và **lý do chúng sai** — agent gặp đúng câu này thì biết là đang tự biện hộ; (3) **gate áp dụng cho mọi gate** — không chỉ test — coverage, security scan, API contract đều phải evidence.

Giá trị: (1) **PASS có bằng chứng** — không "tôi nghĩ nó pass"; (2) **chống rationalization** — bảng liệt kê sẵn câu biện hộ + lý do sai — agent tự nhận ra; (3) **mọi gate như nhau** — build/test/coverage/security/API — không gate nào được đặc cách; (4) **deterministic** — RUN→READ→VERIFY là chuỗi cố định.

## Mô tả

Với mya, pattern = **evidence gate cho mọi PASS claim**: (1) **gate registry** — danh sách gate: build (lệnh `npm run build`), test (`npx vitest run`), coverage, security (`osv_check` — đã có `packages/tools/src/osv-check.ts`), API contract (mẫu eval harness) — mỗi gate kèm lệnh chứng minh; (2) **RUN→READ→VERIFY procedure** — skill body yêu cầu: RUN lệnh fresh → READ output/exit → VERIFY khớp claim → ONLY THEN nói PASS (nối AJZ verification-before-completion — cùng procedure); (3) **rationalization table** — câu biện hộ → lý do sai — check agent output (mẫu `rationalizationCheck` từ AJZ); (4) **gate enforcement** — trước khi agent claim "PASS", skill gate: có evidence kèm? không → nhắc lại procedure; (5) nơi gắn — `packages/skills` (skill body) + `packages/eval` (verify loop — nối 783 Ralph: verify trước completion). Đây là pattern **evidence-attached PASS**: PASS và evidence là một gói — tách rời là claim vô hiệu.

## Kiến trúc (ASCII)

```
  CLAIM: "gate X PASS" (build / test / coverage / security / API contract)
    │
    ▼ EVIDENCE BEFORE CLAIMS — RUN → READ → VERIFY (bắt buộc)
  ├─ 1. RUN lệnh fresh (build: npm run build · test: vitest run · security: osv_check)
  ├─ 2. READ output + exit code thật
  ├─ 3. VERIFY khớp claim (output có "0 failed"? exit 0?)
  └─ ONLY THEN: "PASS" được phép nói
    │
    ▼ RATIONALIZATION PREVENTION (bảng câu biện hộ sai)
  ├─ "build was fine yesterday" ──► không fresh — chạy lại
  ├─ "CI will catch it" ──► không phải bằng chứng local
  └─ "trust me, it works" ──► không có output — không phải evidence
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/osv-check.ts — osv_check tool (nền — security gate)
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (RUN lệnh)
// ✅ packages/tools/src/lsp-cascade.ts — runCascade diagnostics (READ output)
// ✅ packages/eval/src/harness.ts + tiers.ts — eval (verify claims)
// ✅ packages/core/src/budget.ts — budget gate (mẫu gate trong loop)
// ✅ packages/skills/src/skill.ts — Skill body (nơi chứa vetc-verify skill)
// ❌ THIẾU: gate registry (mọi gate → lệnh chứng minh tương ứng)
// ❌ THIẾU: RUN→READ→VERIFY procedure skill (evidence trước PASS)
// ❌ THIẾU: rationalization prevention (bảng biện hộ + lý do sai)
```

## Implementation

```typescript
// packages/skills/src/evidence-gate.ts (NEW)
export type GateKind = "build" | "test" | "coverage" | "security" | "api-contract";
export interface GateSpec {
  kind: GateKind;
  command: string;             // lệnh chứng minh PASS
  passWhen: (output: string, exitCode: number | null) => boolean;
}

/** Gate registry — mọi gate phải có lệnh chứng minh (không gate nào đặc cách). */
const GATES: Record<GateKind, GateSpec> = {
  build: { kind: "build", command: "npm run build", passWhen: (o, c) => c === 0 && !/error/i.test(o) },
  test: { kind: "test", command: "npx vitest run", passWhen: (o, c) => c === 0 && /0 failed|passed/i.test(o) },
  coverage: { kind: "coverage", command: "npx vitest run --coverage", passWhen: (o) => /% (Statements|Lines).*100/.test(o) || !/below threshold/i.test(o) },
  security: { kind: "security", command: "osv_check", passWhen: (o, c) => c === 0 && !/VULNERABILITY/i.test(o) },
  "api-contract": { kind: "api-contract", command: "npx vitest run test/features/22-p0-spec", passWhen: (o, c) => c === 0 },
};

/** Rationalization prevention — câu biện hộ → lý do sai. */
const RATIONALIZATIONS: Array<[RegExp, string]> = [
  [/was fine yesterday/i, "không fresh — evidence phải từ lệnh chạy hôm nay"],
  [/ci will catch/i, "CI không phải bằng chứng local — chạy ở đây, đọc output ở đây"],
  [/trust me|i think it works|should be fine/i, "không có output — không phải evidence"],
  [/coverage is fine|tests probably pass/i, "PASS phải từ RUN→READ→VERIFY, không phải ước lượng"],
];

/** Evidence gate — RUN → READ → VERIFY → only then PASS. */
export async function evidenceGate(kind: GateKind, run: (cmd: string) => Promise<{ stdout: string; exitCode: number | null }>): Promise<{ pass: boolean; evidence: string; reason: string }> {
  const gate = GATES[kind];
  if (!gate) return { pass: false, evidence: "", reason: `không có gate "${kind}" — thêm vào registry trước` };
  const { stdout, exitCode } = await run(gate.command);       // RUN fresh
  const pass = gate.passWhen(stdout, exitCode);               // READ + VERIFY
  return {
    pass,
    evidence: stdout.slice(0, 400),
    reason: pass ? "" : `output không đạt passWhen (exit ${exitCode})`,
  };
}

/** Chặn rationalization — output agent có câu biện hộ → deny claim. */
export function preventRationalization(agentOutput: string): string | null {
  for (const [re, why] of RATIONALIZATIONS) {
    if (re.test(agentOutput)) return `biện hộ bị chặn: ${why}`;
  }
  return null;
}

/** PASS claim cuối — chỉ hợp lệ khi có evidence + không rationalization. */
export function finalizePass(claim: string, result: { pass: boolean; evidence: string }, agentOutput: string): { ok: boolean; reason: string } {
  const excuse = preventRationalization(agentOutput);
  if (excuse) return { ok: false, reason: excuse };
  if (!result.pass) return { ok: false, reason: `claim "${claim}" không có evidence PASS — chạy evidenceGate trước` };
  if (!result.evidence.trim()) return { ok: false, reason: "evidence rỗng — không phải PASS hợp lệ" };
  return { ok: true, reason: "" };
}
// Nối AJZ: cùng procedure RUN→READ→VERIFY — evidenceGate là bản gate registry cụ thể
// Nối Ralph (783): verify trước completion dùng evidenceGate — PASS phải kèm evidence
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ PASS có bằng chứng — không "tôi nghĩ nó pass" | ❌ Chạy lại mọi gate tốn thời gian |
| ✅ Mọi gate như nhau — build/test/coverage/security/API | ❌ passWhen heuristic — output lệch format bị hiểu sai |
| ✅ Rationalization bị chặn — bảng liệt kê sẵn | ❌ Model có thể bỏ qua skill — cần eval (AJV) |
| ✅ Deterministic — RUN→READ→VERIFY cố định | ❌ Gate registry thiếu lệnh — phải bổ sung |

## Khác các hướng gần

| | AKN Evidence Gate | AJZ Verification Gate | 783 Ralph Loop |
|---|---|---|---|
| Trọng tâm | Mọi gate phải evidence | Claim phải có bằng chứng | Loop tới verified |
| Cơ chế | RUN→READ→VERIFY + registry | IDENTIFY→RUN→READ→VERIFY | Snapshot + retry + verify |
| Quan hệ | Tổng quát hơn AJZ (mọi gate) | Procedure cốt lõi | Tiêu thụ AKN gate |

## Khi nào chọn

- Agent hay claim PASS mà không chạy lệnh — cần gate cứng
- Nhiều gate (build/test/coverage/security/API) — muốn một quy trình chung
- Completion quan trọng — PASS phải kèm evidence thật
- Guard: gate registry đủ, RUN fresh, READ output, VERIFY khớp, rationalization bị chặn