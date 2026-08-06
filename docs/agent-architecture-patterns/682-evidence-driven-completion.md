# Hướng ZF: Evidence-Driven Completion — mỗi phase phải kèm Artifact + Evidence (logs, test output) — "If you don't have evidence, you don't have completion"; gate chặn khi thiếu proof
> **Nguồn gốc:** babysitter (two-loops-architecture.md) | **Coupling:** 🟡 — evidence gate vào turn loop + phase machine | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval harness + audit có — chưa có evidence contract per phase) | **Effort:** 2 tuần

## Nguồn gốc

**babysitter** enforce nguyên tắc: **"If you don't have evidence, you don't have completion"** — agent nói "xong phase X" là chưa đủ; mỗi phase phải trả về **Artifact** (sản phẩm cụ thể: file, PR, doc) + **Evidence** (bằng chứng: log chạy, test output, lint result, build log). Gate giữa phase chặn nếu thiếu proof: phase plan phải có plan artifact; phase implement phải có test output pass. Evidence không phải lời khẳng định — là **output machine-readable** lưu được, đối chiếu được. Nguyên tắc: **completion = artifact + evidence, không phải lời nói**.

## Mô tả

mya evidence-driven completion: (1) **Phase contract** — mỗi phase khai báo expected artifact + evidence type. (2) **Evidence collection** — runner thu log/test output/build log từ phase thực thi. (3) **Evidence gate** — trước khi chuyển phase: kiểm tra artifact tồn tại + evidence đủ (test pass, log có kết quả). (4) **Block** — thiếu proof → chặn, phase không được đánh dấu done. mya có workflows/runner.ts (chạy phase) + eval harness.ts (test output) + audit — ZF thêm **phase evidence contract** + **evidence gate**.

## Kiến trúc

```
  PHASE: implement
  ┌───────────────────────────────────────────────────┐
  │  agent làm việc → output:                           │
  │   artifact: src/foo.ts (file thay đổi)              │
  │   evidence:  npm test output (PASS), lint log        │
  └────────────────────┬──────────────────────────────┘
                       ▼
  ┌─── EVIDENCE GATE (trước next phase) ─────────────┐
  │  artifact exists?      (fs check)                  │
  │  evidence non-empty?   (log có kết quả)            │
  │  evidence pass?        (test output PASS)          │
  │  └─ đủ   → next phase                              │
  │  └─ thiếu → BLOCK: "no evidence, no completion"    │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — chạy workflow/phase (nền — ZF phase contract ở đây)
// ✅ packages/eval harness.ts — ParityHarness (nền — ZF evidence chuẩn)
// ✅ packages/eval tiers.ts — integration/credentialed tiers (nền — ZF evidence mức)
// ✅ packages/audit index.ts — AuditLog (nền — ZF lưu evidence)
// ✅ packages/core budget.ts — budget (relate — ZF gate cùng chỗ)

// ❌ THIẾU: phase evidence contract (artifact + evidence type khai báo)
// ❌ THIẾU: evidence gate (kiểm tra proof trước next phase)
// ❌ THIẾU: evidence capture (thu log/test output khi phase chạy)
```

## Implementation

```typescript
// packages/workflows/src/evidence-gate.ts (MỚI)

interface Evidence { kind: string; content: string }        // log/test output/build log
interface PhaseOutput { artifactPaths: string[]; evidence: Evidence[] }
interface PhaseContract { artifact?: string[]; evidenceKinds: string[]; requirePass?: boolean }

class EvidenceGate {
  constructor(private fs: { exists(p: string): Promise<boolean> }) {}

  // Gate: kiểm tra artifact + evidence trước khi phase được công nhận done
  async check(output: PhaseOutput, contract: PhaseContract): Promise<{ pass: boolean; missing: string[] }> {
    const missing: string[] = [];
    for (const a of contract.artifact ?? []) {
      if (!output.artifactPaths.includes(a) || !(await this.fs.exists(a))) missing.push(`artifact:${a}`);
    }
    const kinds = new Set(output.evidence.map(e => e.kind));
    for (const k of contract.evidenceKinds) {
      if (!kinds.has(k)) missing.push(`evidence:${k}`);
    }
    if (contract.requirePass) {
      const pass = output.evidence.some(e => /pass|ok|success/i.test(e.content));
      if (!pass) missing.push("evidence:test-pass");
    }
    return { pass: missing.length === 0, missing };
  }

  // Capture: thu evidence từ phase execution (log + test output)
  capture(logs: string[], testOutput: string): Evidence[] {
    return [
      { kind: "log", content: logs.join("\n") },
      { kind: "test", content: testOutput },
    ];
  }
}
// Usage (trong runner.ts giữa phase):
// const gate = new EvidenceGate({ exists: async (p) => !!(await stat(p).catch(() => null)) });
// const phase = await runPhase("implement");
// const v = await gate.check(phase.output, { artifact: ["src/foo.ts"], evidenceKinds: ["log", "test"], requirePass: true });
// if (!v.pass) throw new Error(`no evidence, no completion: ${v.missing.join(", ")}`);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Completion có proof (không tin lời agent) | ❌ Evidence phải capture đúng (sai kind → gate sai) |
| ✅ Gate chặn phase "nói xong nhưng chưa xong" | ❌ Artifact check phụ thuộc fs (path lệch → false negative) |
| ✅ Audit được (evidence lưu log) | ❌ Test-output pass pattern dễ false positive |
| ✅ Chuẩn cho handoff (evidence đi cùng phase) | ❌ Contract khai báo tốn công cho phase mới |

## Khác các hướng gần

| | Self-report (LLM nói done) | Checklist prompt | ZF: Evidence Gate |
|---|---|---|---|
| Proof | ❌ lời nói | ⚠️ | **✅ artifact + log** |
| Block | Không | Nhắc | **Code chặn** |
| Audit | Không | Một phần | **✅ lưu evidence** |

## Khi nào chọn

- Process nhiều phase, cần chắc chắn phase trước xong thật
- Muốn completion có proof (test/log) thay vì tin lời agent
- Handoff/CI cần evidence đi kèm artifact
- Nối packages/workflows runner.ts + eval harness.ts + tiers.ts + audit index.ts + core budget.ts; guard evidence-authenticity (log từ process thật, không do agent tự ghi), artifact-existence (fs check trước gate), và pattern-precision (pass pattern đủ chặt); ZF = evidence-driven completion, kết hợp 679 ZC two-loops-control-plane (gate trong control loop) + 680 ZD mandatory-stop-enforcement (block khi thiếu proof)
