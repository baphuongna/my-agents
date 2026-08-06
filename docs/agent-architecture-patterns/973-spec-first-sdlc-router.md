# Hướng AKK: Spec-First SDLC Router — `/vetc-feature` là SDLC router với 3 path (BA pipeline 13 bước, spec-driven quick, consensus Planner+Architect+Critic), cùng entry point routing theo độ phức tạp

> **Nguồn gốc:** vetc-dev-kit (README.md, skills/vetc-sdlc/SKILL.md) | **Coupling:** 🟡 — router quyết định pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có workflows + council; thiếu SDLC router) | **Effort:** 2 tuần

## Nguồn gốc

**vetc-dev-kit** có **`/vetc-feature`** — **SDLC router** với **3 path**: (1) **Path A — BA pipeline 13 bước** — yêu cầu phức tạp/mơ hồ: Business Analyst pipeline đầy đủ (thu thập, phân tích, spec, review… 13 bước); (2) **Path B — spec-driven quick** — yêu cầu rõ, vừa: pipeline ngắn (spec → plan → code — nối AKD); (3) **Path C — consensus: Planner+Architect+Critic** — yêu cầu thiết kế quan trọng: ba vai (Planner lập kế hoạch, Architect thiết kế, Critic phản biện) đạt consensus trước khi code; (4) **cùng entry point routing theo độ phức tạp** — user chỉ gọi `/vetc-feature`, router đo độ phức tạp → chọn path.

Giá trị: (1) **một cửa vào** — user không cần biết chọn pipeline nào; (2) **đúng độ sâu** — phức tạp dùng pipeline đầy đủ, đơn giản không lãng phí; (3) **consensus cho thiết kế quan trọng** — không để một agent tự quyết; (4) **scale theo nhu cầu** — thêm path không đổi entry point.

## Mô tả

Với mya, pattern = **complexity-routed SDLC**: (1) **complexity scorer** — đo yêu cầu: số acceptance criteria, số module đụng, từ khóa rủi ro (migration, security, API change) → điểm → path; (2) **Path A** — BA pipeline (13 bước — workflow script trong `packages/workflows` runner); (3) **Path B** — spec-driven quick (nối AKD: spec → plan → code); (4) **Path C** — consensus: 3 subagent (Planner/Architect/Critic — `spawnSubagent` đã có) chạy song song rồi vote đạt consensus (mẫu `packages/council` — adversarial threshold); (5) **router** — entry point duy nhất: `/vetc-feature` → score → path; (6) nơi gắn — `packages/workflows` (runner + orchestration), `packages/council` (consensus). Đây là pattern **progressive process depth**: process scale theo độ phức tạp, entry point ổn định.

## Kiến trúc (ASCII)

```
  /vetc-feature "<yêu cầu>"
    │
    ▼ COMPLEXITY SCORER (điểm: criteria + modules + risk keywords)
  ├─ điểm THẤP ──► PATH B: spec-driven quick
  │                 spec → plan → code (nối AKD — nhanh, ít ceremony)
  ├─ điểm VỪA ──► PATH A: BA pipeline 13 bước
  │                 BA thu thập → phân tích → spec → review → …
  └─ điểm CAO (thiết kế quan trọng) ──► PATH C: CONSENSUS
                    Planner ─┐
                    Architect─┼─► vote consensus (council threshold)
                    Critic  ─┘    → đạt → code · không đạt → vòng lại
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — runWorkflowSource (nền — pipeline stages)
// ✅ packages/agent/src/subagent.test.ts — spawnSubagent (nền — Path C roles)
// ✅ packages/council/src/adversarial.ts — AdversarialReview (vote + threshold — mẫu consensus)
// ✅ packages/prompts/src/assembler.ts — assemblePrompt (BA/spec prompt)
// ✅ packages/eval/src/harness.ts — harness (nền — verify sau path)
// ❌ THIẾU: complexity scorer (criteria + modules + risk keywords → điểm)
// ❌ THIẾU: SDLC router (entry point → path theo điểm)
// ❌ THIẾU: consensus flow (Planner/Architect/Critic → vote → gate)
```

## Implementation

```typescript
// packages/workflows/src/sdlc-router.ts (NEW)
export type SdlcPath = "quick" | "ba-pipeline" | "consensus";
export interface FeatureRequest {
  title: string;
  acceptanceCriteria: string[];
  touchedModules: string[];
  riskKeywords: string[];          // "migration", "security", "api-change"…
}
const RISK_WEIGHT: Record<string, number> = {
  migration: 3, security: 3, "api-change": 2, "data-loss": 4, "breaking": 2,
};

/** Complexity scorer — criteria + modules + risk keywords → điểm. */
export function scoreComplexity(req: FeatureRequest): number {
  let score = req.acceptanceCriteria.length;            // criteria nhiều = phức tạp
  score += Math.min(req.touchedModules.length, 5);      // đụng nhiều module
  for (const kw of req.riskKeywords) score += RISK_WEIGHT[kw.toLowerCase()] ?? 1;
  return score;
}

/** Router — cùng entry point, path theo điểm. */
export function routeSdlc(req: FeatureRequest): SdlcPath {
  const score = scoreComplexity(req);
  if (score >= 10) return "consensus";       // thiết kế quan trọng — 3 vai
  if (score >= 5) return "ba-pipeline";      // vừa — BA 13 bước
  return "quick";                            // nhỏ, rõ — spec-driven quick
}

/** Consensus flow — Planner/Architect/Critic vote (mẫu adversarial threshold). */
export async function consensusGate(roles: Array<{ name: string; proposal: string }>, threshold = 0.5): Promise<{ approved: boolean; agreeing: string[]; disagreeing: string[] }> {
  const votes: Array<{ voter: string; target: string; approve: boolean }> = [];   // cross-check chéo
  for (const voter of roles) {
    for (const target of roles) {
      if (voter.name === target.name) continue;
      votes.push({ voter: voter.name, target: target.name, approve: target.proposal.trim().length > 20 });
    }
  }
  const perTarget = new Map<string, boolean[]>();
  for (const v of votes) {
    const arr = perTarget.get(v.target) ?? [];
    arr.push(v.approve);
    perTarget.set(v.target, arr);
  }
  const approved = [...perTarget.entries()].every(([, arr]) => arr.filter(Boolean).length / arr.length >= threshold);
  return {
    approved,
    agreeing: [...perTarget.keys()].filter((t) => (perTarget.get(t)!.filter(Boolean).length / perTarget.get(t)!.length) >= threshold),
    disagreeing: [...perTarget.keys()].filter((t) => (perTarget.get(t)!.filter(Boolean).length / perTarget.get(t)!.length) < threshold),
  };
}

/** Exec path — route xong chạy pipeline tương ứng. */
export async function runSdlcPath(path: SdlcPath, req: FeatureRequest, pipelines: Record<SdlcPath, () => Promise<string>>): Promise<string> {
  return pipelines[path]();        // quick / ba-pipeline / consensus pipeline
}
// Nối workflows: pipelines là workflow scripts (runner) — router chọn script
// Nối council: consensusGate dùng chung threshold logic với adversarial.ts
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một cửa vào — user không cần chọn pipeline | ❌ Complexity scorer heuristic — có thể route sai độ sâu |
| ✅ Đúng độ sâu — đơn giản không lãng phí | ❌ Path A 13 bước nặng — cần đúng lúc mới đáng |
| ✅ Consensus cho thiết kế quan trọng | ❌ 3 vai tốn token + latency |
| ✅ Thêm path không đổi entry point | ❌ Consensus vote đơn giản (độ dài proposal) — cần rubric tốt hơn |

## Khác các hướng gần

| | AKK SDLC Router | 694 Adaptive Complexity | 132 Human-in-the-Loop |
|---|---|---|---|
| Trọng tâm | 3 path theo complexity | Độ sâu theo quy mô | Người duyệt quyết định |
| Cơ chế | Scorer + router + consensus | Cùng workflow, độ sâu khác | Approval channel |
| Quan hệ | Router chọn pipeline | Nguyên tắc scale độ sâu | Gate trong path |

## Khi nào chọn

- Nhiều loại yêu cầu (nhỏ/vừa/quan trọng) — muốn một entry point tự chọn pipeline
- Thiết kế quan trọng cần consensus — không để một agent tự quyết
- Đã có workflows + council + subagent — thêm scorer + router là rẻ
- Guard: score thật (criteria/modules/risk), route đúng path, consensus gate trước code