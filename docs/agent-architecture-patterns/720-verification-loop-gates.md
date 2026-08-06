# Hướng AAR: Verification Loop Gates — pipeline verify theo pha có stop-and-fix: build → type check → lint → test

> **Nguồn gốc:** everything-claude-code (.agents/skills/verification-loop/SKILL.md) | **Coupling:** 🟢 — thêm verify pipeline, chạy tool có sẵn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có typecheck/lint scripts — chưa có pha gate có thứ tự) | **Effort:** 1 tuần

## Nguồn gốc

**everything-claude-code** dùng pipeline verify **theo pha có stop-and-fix**: **build → type check → lint → test suite** — mỗi gate lỗi thì **DỪNG sửa trước khi sang pha sau**. Không nhảy cóc: type error phải sửa xong mới lint, lint sạch mới chạy test. Nguyên tắc: **quality gate có thứ tự** — pha trước là precondition của pha sau; sửa theo thứ tự giảm "nông" (build/type) tới "sâu" (test logic) — mỗi pha chỉ làm một việc, dễ debug.

## Mô tả

mya verification loop gates: scripts/typecheck.mjs + lint.mjs + vitest có sẵn. AAR thêm **phased gate runner**: chạy lần lượt `build → typecheck → lint → test`; mỗi pha nếu fail → **dừng**, gọi agent sửa (bounded — iteration budget), rồi **chạy lại từ pha đó** (không phải từ đầu — pha trước đã pass). Kết quả mỗi pha ghi vào audit + RuntimeEvent để telemetry. Pha test dùng vitest config hiện có (pool forks, testTimeout 5000). Guard: max repair rounds per pha (tránh loop sửa mãi), skip build nếu repo không build-step.

## Kiến trúc

```
  VERIFY PIPELINE (có thứ tự — stop-and-fix)
        │
        ▼
  ┌─── PHASE 1: build ────────────────────────────────┐
  │  fail → repair (≤ N rounds) → chạy lại phase 1     │
  │  pass → phase 2                                    │
  ├─── PHASE 2: typecheck (scripts/typecheck.mjs) ────┤
  │  fail → repair → chạy lại phase 2                  │
  ├─── PHASE 3: lint (scripts/lint.mjs) ──────────────┤
  │  fail → repair → chạy lại phase 3                  │
  └─── PHASE 4: test (vitest run) ────────────────────┘
       fail → repair → chạy lại phase 4 → pass = DONE
       mỗi pha: audit + RuntimeEvent
```

## mya ĐÃ CÓ

```typescript
// ✅ scripts/typecheck.mjs — type check (nền phase 2)
// ✅ scripts/lint.mjs — lint (nền phase 3)
// ✅ vitest.config.ts — test runner (nền phase 4)
// ✅ packages/core iteration-budget.ts — bounded repair (nền max rounds)
// ✅ packages/audit — audit log (nơi ghi kết quả pha)
// ✅ packages/core telemetry.ts — RuntimeEvent (nơi emit pha)

// ❌ THIẾU: phased gate runner (order + stop-and-fix)
```

## Implementation

```typescript
// scripts/verify-gates.mjs (NEW)
import { execFileSync } from "node:child_process";

const PHASES = [
  { name: "build", cmd: "npm", args: ["run", "build"], skipIfMissing: true },
  { name: "typecheck", cmd: "node", args: ["scripts/typecheck.mjs"] },
  { name: "lint", cmd: "node", args: ["scripts/lint.mjs"] },
  { name: "test", cmd: "npx", args: ["vitest", "run", "--testTimeout=5000"] },
];

/**
 * Chạy pipeline có thứ tự. Mỗi pha fail → gọi repair (bounded) → chạy LẠI pha đó.
 * Không bao giờ sang pha sau khi pha trước còn đỏ.
 */
export async function runVerifyGates(
  repair: (phase: string, output: string) => Promise<void>,
  opts: { maxRepairRounds?: number; emit?: (phase: string, ok: boolean) => void } = {},
): Promise<{ ok: boolean; failedPhase?: string }> {
  const maxRounds = opts.maxRepairRounds ?? 3;
  for (const phase of PHASES) {
    if (phase.skipIfMissing) {
      try { execFileSync(phase.cmd, phase.args, { stdio: "pipe" }); }
      catch { continue; } // không có build step — skip
    }
    let rounds = 0;
    for (;;) {
      try {
        execFileSync(phase.cmd, phase.args, { stdio: "pipe" });
        opts.emit?.(phase.name, true);
        break; // pass → sang pha sau
      } catch (e) {
        rounds++;
        opts.emit?.(phase.name, false);
        if (rounds > maxRounds) return { ok: false, failedPhase: phase.name };
        const output = String((e as { stdout?: string }).stdout ?? e);
        await repair(phase.name, output); // agent sửa — bounded bởi rounds
      }
    }
  }
  return { ok: true };
}

// Usage: runVerifyGates(async (phase, out) => { await agentFix(phase, out); })
//   → build fail: sửa xong mới lint; lint fail: sửa xong mới test
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sửa theo thứ tự — build/type trước, logic sau | ❌ Nhiều vòng exec — chậm hơn chạy một lượt |
| ✅ Mỗi pha chỉ một việc — dễ debug | ❌ Skip-build heuristic có thể bỏ qua bước cần |
| ✅ Bounded repair — không loop sửa mãi | ❌ Repair phụ thuộc agent sửa đúng phạm vi pha |
| ✅ Audit + telemetry từng pha | ❌ Test phase chạy lâu — phải có timeout |

## Khác các hướng gần

| | Chạy all-at-once | AAR: Phased Gates |
|---|---|---|
| Fail | Thấy hết lỗi một lần | **Dừng ở pha đầu tiên** |
| Sửa | Dồn dập | **Từng pha, có thứ tự** |
| Debug | Khó (lỗi trộn) | **Rõ pha nào đỏ** |
| Mối quan hệ | Ad-hoc | **Pipeline chuẩn hóa** |

## Khi nào chọn

- Agent sửa code tự động — cần gate có thứ tự trước khi báo done
- Đã có typecheck/lint/vitest scripts — thêm runner có stop-and-fix
- Guard: maxRepairRounds, repair theo pha (không sửa lung tung), skip-build detect, mỗi pha emit event
