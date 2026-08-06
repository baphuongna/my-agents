# Hướng AIZ: ADR-First Feature Development — mỗi feature bắt đầu bằng ADR → research spikes → synthesis → spec → preflight → implementation trên disjoint file sets → adversarial self-review → fix pass

> **Nguồn gốc:** plannotator | **Coupling:** 🟡 — quy trình phát triển (process pattern) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có workflows + council; chưa có ADR pipeline) | **Effort:** 2 tuần

## Nguồn gốc

**plannotator** bắt đầu **mỗi feature bằng ADR** rồi chạy quy trình đầy đủ: **ADR → research spikes (subagent map-reduce) → synthesis → spec → preflight (verify từng seam, sửa claim sai) → implementation phases trên disjoint file sets → adversarial self-review → fix pass** — toàn bộ ghi lại trong `adr/` + recap docs. Đây là **process pattern**: không phải tính năng runtime, mà là cách tổ chức feature development có kiểm chứng ở mỗi bước.

Nguyên tắc: **quyết định trước code (ADR)** — design decision ghi lại trước khi implement, review được; **spike trước spec** — research (map-reduce subagent) để spec dựa trên sự thật không phải giả định; **preflight verify từng seam** — trước khi code, verify giả định kỹ thuật (API tồn tại? pattern chạy được?); **disjoint file sets** — các phase implement song song không đụng file nhau (tránh conflict); **adversarial self-review** — phản biện chính mình (nối council) rồi fix.

## Mô tả

Với mya, pattern = **workflow ADR-first trên `packages/workflows`**: (1) **ADR template** — quyết định + context + alternatives + consequences (ghi vào `docs/adr/`); (2) **research spikes** — subagent map-reduce (nối `agent/src/index.ts spawnSubagent` — fan-out research + reduce synthesis); (3) **spec** — từ synthesis, spec feature (nối eval ParityHarness cho acceptance); (4) **preflight** — verify từng seam: import chạy, tool tồn tại, pattern đúng (chạy typecheck + smoke — nối `packages/eval`); sửa claim sai trước khi code; (5) **implementation phases trên disjoint file sets** — mỗi phase chỉ đụng file set riêng (tránh conflict — đúng constraint của mya về overlapping edits); (6) **adversarial self-review** — `packages/council/src/adversarial.ts` (đã có `adversarialReview` + `extractFindings` trong mya-bridge) → findings; (7) **fix pass** — fix theo findings, re-review. Recap doc ghi lại toàn bộ (adr/ + recap).

## Kiến trúc (ASCII)

```
  FEATURE
    │
    ▼ 1. ADR (quyết định + context + alternatives + consequences) ──► docs/adr/
    ▼ 2. RESEARCH SPIKES (subagent map-reduce — spawnSubagent fan-out + reduce)
    ▼ 3. SYNTHESIS (gộp spike → spec dựa trên sự thật)
    ▼ 4. SPEC (feature spec — nối eval acceptance)
    ▼ 5. PREFLIGHT (verify từng seam — typecheck/smoke; SỬA CLAIM SAI)
    ▼ 6. IMPLEMENTATION PHASES (disjoint file sets — không đụng file nhau)
    ▼ 7. ADVERSARIAL SELF-REVIEW (council adversarialReview → findings)
    ▼ 8. FIX PASS (fix theo findings → re-review)
    ▼
  RECAP DOC (adr/ + recap — toàn bộ quy trình ghi lại)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent index.ts — spawnSubagent (research spikes map-reduce)
// ✅ packages/council adversarial.ts — adversarialReview + FindingVote (self-review)
// ✅ packages/print mya-bridge.ts — extractFindings + adversarial review wiring
// ✅ packages/workflows runner.ts — workflow stages (nền phases)
// ✅ packages/eval harness.ts — ParityHarness (nền preflight/acceptance)
// ✅ packages/audit — AuditLog (nền ghi recap/audit)

// ❌ THIẾU: ADR template + writer (docs/adr/)
// ❌ THIẾU: preflight step (verify seams + sửa claim sai trước code)
// ❌ THIẾU: disjoint file set planner (phase → file set mapping)
```

## Implementation

```typescript
// packages/workflows/src/adr-first.ts (NEW)
export interface Adr {
  id: string;
  title: string;
  status: "proposed" | "accepted" | "superseded";
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string[];
}

/** Bước 1: ghi ADR trước code — quyết định có hồ sơ, review được. */
export function writeAdr(adr: Adr): string {
  return [
    `# ADR-${adr.id}: ${adr.title}`,
    `Status: ${adr.status}`,
    "",
    "## Context",
    adr.context,
    "",
    "## Decision",
    adr.decision,
    "",
    "## Alternatives",
    ...adr.alternatives.map((a) => `- ${a}`),
    "",
    "## Consequences",
    ...adr.consequences.map((c) => `- ${c}`),
    "",
  ].join("\n");
}

/** Bước 5: preflight — verify từng seam, trả claim sai cần sửa. */
export async function preflight(
  seams: Array<{ name: string; verify(): Promise<boolean>; claim: string }>,
): Promise<Array<{ seam: string; claim: string; ok: boolean }>> {
  const results = [];
  for (const s of seams) {
    let ok = false;
    try { ok = await s.verify(); } catch { ok = false; }
    results.push({ seam: s.name, claim: s.claim, ok });
  }
  return results;   // !ok → sửa claim trước khi vào implementation
}

/** Bước 6: disjoint file sets — mỗi phase chỉ đụng file set riêng. */
export function planDisjointPhases(files: string[], phaseCount: number): string[][] {
  const phases: string[][] = Array.from({ length: phaseCount }, () => []);
  files.forEach((f, i) => phases[i % phaseCount]!.push(f));   // round-robin disjoint
  return phases;
}
// Orchestrator: writeAdr → spawnSubagent spikes → synthesis → spec →
// preflight (thất bại → sửa claim) → planDisjointPhases → implement →
// adversarialReview → fix pass → recap doc.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Quyết định có hồ sơ — review/rollback được (ADR) | ❌ Quy trình nặng — feature nhỏ bị over-process |
| ✅ Spec dựa trên spike thật — không giả định | ❌ Research spikes tốn token + thời gian |
| ✅ Preflight bắt claim sai trước khi code | ❌ Disjoint file sets không phải lúc nào cũng khả thi (shared module) |
| ✅ Self-review phản biện — ít bug lọt | ❌ Adversarial review có thể false-positive findings |

## Khác các hướng gần

| | AIZ ADR-First | AJQ Grilling Interview | AIP Allowed-Env |
|---|---|---|---|
| Trọng tâm | Quy trình phát triển feature | Align trước code | Ranh giới runtime |
| Cơ chế | ADR→spike→spec→preflight→review | Interview loop | Env + registry filter |
| Quan hệ | Process tổng thể | Phase plan trong quy trình | Nền tảng an toàn |

## Khi nào chọn

- Feature lớn/phức tạp — quyết định cần hồ sơ, spec cần kiểm chứng
- Nhiều worker/subagent cùng implement — disjoint file sets tránh conflict
- Đã có council adversarial + workflows runner — thêm ADR-first orchestration
- Guard: preflight sửa claim sai trước code; disjoint phases; self-review trước fix pass