# Hướng AGK: Report-Repair Before Confirm — trước phase confirm, orchestrator chạy `report-repair` deterministic: finding nào có `draft.md` mà thiếu `report.md` (≤500 bytes) thì spawn `finding-reporter` viết lại; candidate không sửa được ghi `repair-summary.json` nhưng **không abort run**

> **Nguồn gốc:** piolium (docs/phase-reference.md) | **Coupling:** 🟡 — orchestrator + finding-reporter spawn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có repair tool + subagent, thiếu report-repair deterministic gate) | **Effort:** 1 tuần

## Nguồn gốc

**piolium** trước **phase confirm** (final) chạy **`report-repair` deterministic**: scan findings — finding nào có `draft.md` (bản nháp) mà **thiếu `report.md`** hoặc `report.md` ≤500 bytes (quá ngắn/rỗng) thì **spawn `finding-reporter`** viết lại report đầy đủ. Candidate **không sửa được** (draft rác/không đủ info) ghi **`repair-summary.json`** (lý do fail) nhưng **KHÔNG abort run** — run tiếp tục với findings hợp lệ, chỉ đánh dấu cái hỏng. Nguyên tắc: **auto-repair report trước confirm, fail graceful không abort**.

## Mô tả

mya report-repair-before-confirm: (1) **repair tool đã sẵn** — `packages/tools` repair.ts; (2) **subagent spawn đã sẵn** — `packages/agent` spawnSubagent; (3) **draft/report detect** — check file tồn tại + size; (4) **finding-reporter** — specialist viết report từ draft; (5) **repair-summary.json** — log fail không abort (nối audit graceful). Nối AGF (phases) — report-repair là phase trước confirm.

## Kiến trúc (ASCII)

```
  BEFORE phase CONFIRM ──▶ REPORT-REPAIR (deterministic)
       │
       ▼  scan findings:
   finding có draft.md?
   ├─ KHÔNG ──▶ skip (không có gì sửa)
   └─ CÓ:
        report.md tồn tại VÀ > 500 bytes?
        ├─ CÓ  ──▶ ok (report đầy đủ)
        └─ KHÔNG (thiếu/rỗng) ──▶ SPAWN finding-reporter
              │  viết lại report từ draft.md
              ├─ thành công ──▶ report.md đầy đủ ✓
              └─ KHÔNG sửa được ──▶ ghi repair-summary.json
                                     ⚠️ KHÔNG ABORT RUN
                                     (run tiếp tục, đánh dấu hỏng)
       │
       ▼  phase CONFIRM (chỉ findings hợp lệ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools repair.ts — repair tool (nền fix)
// ✅ packages/agent index.ts — spawnSubagent (finding-reporter)
// ✅ packages/audit recovery.ts — graceful recovery (fail không crash)
// ✅ packages/core exit.ts — clean exit (nền graceful)

// ❌ THIẾU: report-repair deterministic gate (draft/report size check)
// ❌ THIẾU: finding-reporter specialist spawn
// ❌ THIẾU: repair-summary.json (fail log, không abort)
```

## Implementation

```typescript
// packages/agent/src/report-repair.ts (MỚI)
import { existsSync, statSync, writeFileSync, readFileSync } from "node:fs";
import type { Agent } from "./index.js";
const MIN_REPORT_BYTES = 500;
export interface FindingDir { readonly id: string; readonly dir: string; }
export interface RepairResult { readonly id: string; readonly repaired: boolean; readonly reason: string; }
/** Cần repair? draft.md có mà report.md thiếu/quá ngắn. */
export function needsRepair(dir: string): boolean {
  if (!existsSync(`${dir}/draft.md`)) return false;
  if (!existsSync(`${dir}/report.md`)) return true;
  return statSync(`${dir}/report.md`).size <= MIN_REPORT_BYTES;
}
/** Spawn finding-reporter viết lại report; fail → summary, KHÔNG abort. */
export async function repairReport(agent: Agent, finding: FindingDir): Promise<RepairResult> {
  if (!needsRepair(finding.dir)) return { id: finding.id, repaired: false, reason: "ok" };
  try {
    const draft = readFileSync(`${finding.dir}/draft.md`, "utf8");
    const handle = agent.spawnSubagent(`Write a full security report from this draft:\n\n${draft}`);
    const report = await handle.wait();
    writeFileSync(`${finding.dir}/report.md`, report);
    return { id: finding.id, repaired: true, reason: "rewritten" };
  } catch (e) {
    writeFileSync(`${finding.dir}/repair-summary.json`, JSON.stringify({ id: finding.id, error: String(e) }));
    return { id: finding.id, repaired: false, reason: "unrepairable (logged, not aborted)" };
  }
}
// Orchestrator: for each finding → repairReport(agent, f) — collect results, never throw.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Auto-repair report trước confirm — không báo cáo rỗng | ❌ finding-reporter thêm latency |
| ✅ Fail graceful — không abort run khi 1 report hỏng | ❌ Silent fail nếu không đọc repair-summary |
| ✅ Deterministic gate (size check) — không tốn LLM mù | ❌ 500 bytes threshold tùy loại finding |

## Khác các hướng gần

| | AGK Report-Repair | repair tool | AFS Autofix |
|---|---|---|---|
| Trigger | trước phase confirm | agent gọi | turn_end delta |
| Mục đích | Viết lại report thiếu/rỗng | Fix code | Apply edit warning |
| Fail | graceful (summary, không abort) | throw | skip stale |

## Khi nào chọn

- Phase final cần report đầy đủ (không rỗng/thiếu)
- Muốn auto-repair trước confirm mà không abort khi 1 cái hỏng
- Cần deterministic gate (size check) trước khi tốn LLM
- Guard: size threshold tuning, fail luôn log repair-summary, run tiếp tục với findings hợp lệ
