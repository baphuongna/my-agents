# Hướng AGF: Specialist-Subagent Phases — audit chia 17 phase (P1-P17) với specialist agents (backward-reasoner, contradiction-reasoner, evidence-harvester...); mỗi phase ghi artifact riêng vào `piolium/attack-surface/` để phase sau đọc từ disk

> **Nguồn gốc:** piolium (docs/phase-reference.md) | **Coupling:** 🟡 — orchestrator + disk artifact handoff | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có subagent pool + audit pipeline, thiếu 17-phase orchestrator) | **Effort:** 2-3 tuần

## Nguồn gốc

**piolium** (security audit) chia workflow thành **17 phase (P1-P17)**, mỗi phase chạy **specialist agent riêng**: backward-reasoner (suy luận ngược từ exploit), contradiction-reasoner (tìm mâu thuẫn trong claim), evidence-harvester (gom bằng chứng)... Mỗi phase **ghi artifact riêng** vào `piolium/attack-surface/` (JSON/markdown), phase sau **đọc artifact từ disk** (không truyền in-memory — tách rời, replayable). Nguyên tắc: **phase = specialist + artifact on disk, handoff qua file không qua memory**.

## Mô tả

mya specialist-subagent-phases: (1) **subagent pool đã sẵn** — `packages/agent` spawnSubagent (specialist agent isolated); (2) **audit pipeline đã sẵn** — `packages/audit` index.ts (RuntimeEvent pipeline); (3) **17-phase orchestrator** — tuần tự P1→P17, mỗi phase spawn specialist; (4) **disk artifact handoff** — phase ghi file, phase sau đọc file (replayable, tách rời); (5) **specialist roles** — backward-reasoner/contradiction-reasoner/evidence-harvester (nối AFO role-set). Nối AGJ (heartbeat) và AGI (runtime header injection).

## Kiến trúc (ASCII)

```
  ORCHESTRATOR (17 phase tuần tự)
   │
   P1 ──▶ specialist agent ──▶ artifact ──▶ disk: attack-surface/P1.json
   P2 ──▶ đọc P1.json ──▶ specialist ──▶ P2.json
   P3 ──▶ đọc P2.json ──▶ specialist ──▶ P3.json
   ...
   P17──▶ đọc P16.json ──▶ final report

  specialist agents (role riêng):
   backward-reasoner / contradiction-reasoner / evidence-harvester / ...
   
  HANDOFF QUA DISK (không in-memory):
   ✅ replayable (chạy lại phase)  ✅ tách rời  ✅ inspect artifact
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent index.ts — spawnSubagent (specialist agent isolated session)
// ✅ packages/agent pool.ts — subagent pool (track active/completed)
// ✅ packages/audit index.ts — RuntimeEvent pipeline (tool/approval/repair/channel)
// ✅ packages/core session-branch.ts — Delegate child (specialist = delegate)

// ❌ THIẾU: 17-phase orchestrator (P1→P17 tuần tự)
// ❌ THIẾU: disk artifact handoff (phase ghi/đọc file)
// ❌ THIẾU: specialist role set (backward/contradiction/evidence...)
```

## Implementation

```typescript
// packages/agent/src/specialist-phases.ts (MỚI)
import { spawnSubagent, type Agent } from "./index.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
export interface Phase {
  readonly id: string;            // "P1".."P17"
  readonly specialist: string;    // "backward-reasoner" | "contradiction-reasoner" | ...
  readonly goal: string;
  readonly outPath: string;       // attack-surface/P{id}.json
}
/** Chạy phase: đọc artifact trước, spawn specialist, ghi artifact sau. */
export async function runPhase(agent: Agent, phase: Phase, baseDir: string, prevId?: string): Promise<string> {
  const prev = prevId && existsSync(join(baseDir, `attack-surface/${prevId}.json`))
    ? readFileSync(join(baseDir, `attack-surface/${prevId}.json`), "utf8") : "";
  const handle = agent.spawnSubagent(`${phase.goal}\n\nPrev artifact:\n${prev}`);
  const output = await handle.wait();
  writeFileSync(join(baseDir, phase.outPath), output);   // disk handoff
  return output;
}
/** Orchestrator 17 phase tuần tự. */
export async function runPhases(agent: Agent, phases: Phase[], baseDir: string): Promise<void> {
  let prev: string | undefined;
  for (const p of phases) { await runPhase(agent, p, baseDir, prev); prev = p.id; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Replayable (chạy lại phase từ disk) | ❌ 17 phase tuần tự = chậm |
| ✅ Tách rời (phase không phụ thuộc runtime state) | ❌ Disk I/O overhead |
| ✅ Specialist chuyên môn sâu mỗi phase | ❌ Artifact schema phải ổn định giữa phase |

## Khác các hướng gần

| | AGF Specialist Phases | AFO Role-Set | audit pipeline |
|---|---|---|---|
| Cấu trúc | 17 phase tuần tự + disk handoff | 5 role pipeline | RuntimeEvent stream |
| Handoff | Disk artifact (file) | In-memory output | Event |
| Replay | ✅ từ disk | ❌ | ❌ |

## Khi nào chọn

- Workflow audit/security phức tạp cần chia phase chuyên môn
- Muốn replayable (chạy lại phase, inspect artifact)
- Cần tách rời phase (disk handoff, không in-memory coupling)
- Guard: artifact schema ổn định, phase idempotent khi re-run, specialist output validated
