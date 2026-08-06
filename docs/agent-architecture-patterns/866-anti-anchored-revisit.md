# Hướng AGH: Anti-Anchored Revisit — `/piolium-revisit` dùng findings cũ làm **negative list** để tránh anchoring: fresh probe + review chambers tìm issue missed/adjacent thay vì lặp lại kết luận cũ

> **Nguồn gốc:** piolium (docs/phase-reference.md) | **Coupling:** 🟢 — revisit workflow + findings store | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có memory store + audit, thiếu anti-anchor revisit) | **Effort:** 1 tuần

## Nguồn gốc

**piolium** `/piolium-revisit` tránh **anchoring bias** — khi audit lại, dùng findings cũ làm **negative list** (đừng lặp lại cái đã tìm). Thay vì xác nhận kết luận cũ, chạy **fresh probe** (thăm dò mới) + **review chambers** (góc nhìn khác) tìm **issue missed** (bỏ sót) hoặc **adjacent** (liền kề cái đã tìm). Nguyên tắc: **findings cũ là thứ phải TRÁNH lặp, không phải thứ phải xác nhận** — chống confirmation bias.

## Mô tả

mya anti-anchored-revisit: (1) **findings store đã sẵn** — `packages/memory` store.ts + `packages/audit` (findings RuntimeEvent); (2) **negative list** — load findings cũ, truyền cho agent là "đã biết, tìm khác"; (3) **fresh probe** — agent thăm dò mới (không dựa kết luận cũ); (4) **review chambers** — đa góc nhìn (nối council adversarial — `packages/council` adversarial.ts); (5) **missed/adjacent** — output là issue mới. Nối AGF (phases) — revisit là phase riêng.

## Kiến trúc (ASCII)

```
  /piolium-revisit
       │
       ▼  load FINDINGS CŨ → NEGATIVE LIST
   "đã biết issue A, B, C — ĐỪNG lặp lại"
       │
       ▼  FRESH PROBE (thăm dò mới, không xác nhận cũ)
   agent/expert với instruction "tìm issue MỚI/missed/adjacent"
       │
       ▼  REVIEW CHAMBERS (đa góc nhìn)
   ├─ backward-reasoner (suy luận ngược khác)
   ├─ contradiction-reasoner (thách thức)
   └─ ...
       │
       ▼  output: issue MISSED (bỏ sót) hoặc ADJACENT (liền kề)
   (không lặp kết luận cũ — tránh anchoring)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory store.ts/brain-store.ts — findings persistence (negative list source)
// ✅ packages/audit index.ts — RuntimeEvent findings pipeline
// ✅ packages/council adversarial.ts — adversarial multi-perspective review (chambers)
// ✅ packages/council hindsight.ts — hindsight review (nền missed-detection)

// ❌ THIẾU: /piolium-revisit workflow (load cũ → negative list → fresh probe)
// ❌ THIẾU: anti-anchor instruction (findings cũ = tránh, không xác nhận)
```

## Implementation

```typescript
// packages/agent/src/anti-anchored-revisit.ts (MỚI)
import type { Agent } from "./index.js";
export interface OldFinding { readonly id: string; readonly title: string; readonly path: string; }
/** Load findings cũ làm negative list — tránh anchoring. */
export function buildNegativeList(findings: OldFinding[]): string {
  return "ALREADY-KNOWN findings (do NOT re-confirm, find NEW/missed/adjacent):\n" +
    findings.map((f) => `- [${f.id}] ${f.title} @ ${f.path}`).join("\n");
}
/** Fresh probe — agent tìm issue mới, không lặp cũ. */
export async function revisit(
  agent: Agent,
  oldFindings: OldFinding[],
  target: string,
): Promise<string> {
  const negative = buildNegativeList(oldFindings);
  const handle = agent.spawnSubagent(
    `Revisit audit of ${target}.\n\n${negative}\n\n` +
    `Run FRESH probe. Find issues MISSED or ADJACENT to known ones. ` +
    `Do NOT re-state or re-confirm known findings. Report only NEW issues.`,
  );
  return handle.wait();
}
// Review chambers: spawn council adversarial perspectives on fresh findings.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tránh anchoring/confirmation bias | ❌ Agent vẫn có thể bị cuốn vào findings cũ |
| ✅ Tìm issue missed/adjacent (giá trị mới) | ❌ Negative list dài → mất focus |
| ✅ Đa góc nhìn (review chambers) | ❌ Risk: bỏ qua valid confirmation khi cần |

## Khác các hướng gần

| | AGH Anti-Anchored Revisit | council adversarial | AGF Specialist Phases |
|---|---|---|---|
| Mục đích | Tránh anchoring, tìm mới | Đa góc nhìn adversarial | 17 phase audit |
| Findings cũ | NEGATIVE list (tránh) | không | artifact input |
| Output | missed/adjacent issues | consensus/divergence | phase artifacts |

## Khi nào chọn

- Audit lại vùng đã scan — muốn tìm issue mới (không lặp cũ)
- Cần chống confirmation/anchoring bias
- Muốn đa góc nhìn (review chambers)
- Guard: negative list rõ ràng, instruction chống re-confirm, dedupe vs old findings, valid confirmation vẫn cho phép khi cần
