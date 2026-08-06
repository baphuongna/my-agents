# Hướng VZ: Warp New Session Transfer — thay thế compaction: warp rút context cần thiết để tạo session mới với phases/parallel-groups/depends_on/produces

> **Nguồn gốc:** pi-agent-flow (warp new session transfer); "replace compaction with warp"; "extract needed context to create new session"; "structured transfer: phases, parallel-groups, depends_on, produces"; "context projection into fresh session" | **Coupling:** 🔴 — thay compaction bằng warp session-transfer (thay đổi core flow) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (cần warp extractor + session-builder mới) | **Effort:** 3-4 tuần

## Nguồn gốc

**pi-agent-flow** chê **compaction** (tóm tắt cắt token) vì **mất thông tin** + **context vẫn nặng**. Thay vào đó, **warp**: khi context đầy, **không compact** — mà **rút ra đúng context cần thiết** (structured: phases đã xong, parallel-groups cần chạy, depends_on, produces) rồi **tạo session mới** với context được chiếu (projected) đó. Session mới **sạch + structured** — không phải summary mờ, mà **plan gốc được cập nhật** (phases done → đánh dấu, next phases → carry over). Nguyên tắc: **fresh session with structured handoff, not lossy summary**. Khác compaction (summarize trong cùng session) — VZ **new session with structured projection**; khác 591 VS rehydration (đọc lại sau compact) — VZ **không compact, warp thay thế**.

## Mô tả

mya warp new session transfer: (1) **Warp trigger**: context đầy (thay vì compaction). (2) **Extract structured context**: rút phases (done/pending), parallel-groups (cần chạy song song), depends_on (dependency graph), produces (artifact đã tạo). (3) **Build new session**: tạo session mới với structured plan (không phải prose summary). (4) **Continue**: session mới tiếp tục từ structured handoff — agent biết phases done, next là gì, dependency thế nào. mya có workflows (phases/depends_on) + session — VZ thêm **warp extractor** + **session-builder** thay compaction.

## Kiến trúc

```
  CONTEXT FULL (thay vì COMPACT)
        │
        ▼ (warp — rút structured context, KHÔNG summarize)
  ┌─── EXTRACT STRUCTURED PLAN ────────────────────────────┐
  │  phases:                                                  │
  │    - {name:'research', status:'done', produces:['notes']}│
  │    - {name:'implement', status:'pending'}                │
  │    - {name:'test', status:'pending', depends_on:['impl']}│
  │  parallel-groups:                                         │
  │    - {group:'test-suite', tasks:['unit','e2e','lint']}   │
  │  produces: ['src/auth.ts', 'src/token.ts']               │
  │  depends_on: {test: [implement]}                          │
  └───────────────┬─────────────────────────────────────────┘
                  ▼ (build fresh session with structured plan)
  ┌─── NEW SESSION (clean, structured) ─────────────────────┐
  │  session context = structured plan (không prose summary) │
  │  agent biết: research done, implement next, test depends │
  │  → tiếp tục chính xác (không lossy summary)              │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows orchestration.ts — phases/depends_on (nền — VZ structured plan)
// ✅ packages/workflows runner.ts — workflow runner (nền — VZ carry over)
// ✅ packages/core session.ts — session (nền — VZ new session)
// ✅ packages/core spill.ts — compaction (nền — VZ THAY THẾ cái này)

// ❌ THIẾU: warp extractor (rút phases/groups/depends/produces từ context)
// ❌ THIẾU: session-builder (tạo session mới từ structured plan)
// ❌ THIẾU: warp-trigger (thay compaction trigger bằng warp)
```

## Implementation

```typescript
// packages/workflows/src/warp-session-transfer.ts (MỚI)

interface Phase { name: string; status: 'done' | 'pending'; produces?: string[]; depends_on?: string[] }
interface ParallelGroup { group: string; tasks: string[] }
interface WarpPlan {
  phases: Phase[];
  parallelGroups: ParallelGroup[];
  produces: string[];
  dependsOn: Record<string, string[]>;
}
class WarpSessionTransfer {
  // extract: rút structured plan từ session hiện tại (thay compaction)
  extractPlan(
    phases: Phase[],
    parallelGroups: ParallelGroup[],
    artifacts: string[],
  ): WarpPlan {
    const dependsOn: Record<string, string[]> = {};
    for (const p of phases) {
      if (p.depends_on) dependsOn[p.name] = p.depends_on;
    }
    return {
      phases,                        // done/pending status carry over
      parallelGroups,                // groups cần chạy song song
      produces: artifacts,           // artifact đã tạo
      dependsOn,                     // dependency graph
    };
  }
  // build new session: structured plan → fresh session (không prose summary)
  buildSession(plan: WarpPlan): { systemPrompt: string; phases: Phase[]; fresh: boolean } {
    const donePhases = plan.phases.filter(p => p.status === 'done').map(p => p.name);
    const pendingPhases = plan.phases.filter(p => p.status === 'pending');
    const systemPrompt = [
      '# Session Warped from Previous Context',
      `## Completed phases: ${donePhases.join(', ')}`,
      `## Artifacts produced: ${plan.produces.join(', ')}`,
      '## Next phases:',
      ...pendingPhases.map(p => `- ${p.name}${p.depends_on ? ` (depends: ${p.depends_on.join(',')})` : ''}`),
      '## Parallel groups:',
      ...plan.parallelGroups.map(g => `- ${g.group}: ${g.tasks.join(', ')}`),
    ].join('\n');
    return { systemPrompt, phases: plan.phases, fresh: true };
  }
  // warp: trigger (thay compaction) → extract → build new session
  warp(phases: Phase[], groups: ParallelGroup[], artifacts: string[]) {
    const plan = this.extractPlan(phases, groups, artifacts);
    return this.buildSession(plan);
  }
}
// Usage:
// const warp = new WarpSessionTransfer();
// const newSession = warp.warp(phases, parallelGroups, artifacts);
// // → fresh session với structured plan (không lossy summary)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No lossy summary (structured plan, không prose) | ❌ Big change (thay compaction core flow) |
| ✅ Fresh session (clean context, không nặng) | ❌ Plan extraction complexity (rút đúng phases) |
| ✅ Structured handoff (phases/depends/groups rõ) | ❌ Artifact tracking (phải biết produces gì) |
| ✅ Dependency-aware (depends_on carry over) | ❌ Session overhead (tạo session mới tốn init) |

## Khác các hướng gần

| | Compaction (summarize) | 591 VS rehydration | VZ: Warp-Session-Transfer |
|---|---|---|---|
| Cơ chế | Summarize trong session | Đọc lại sau compact | **New session + structured plan** |
| Loss | ✅ (mất chi tiết) | ⚠ (re-derive) | **❌ (structured, không summarize)** |
| Context | Vẫn nặng (summary + cũ) | Rehydrate extra | **Fresh (clean)** |

## Khi nào chọn

- Compaction mất thông tin → muốn structured handoff thay prose summary
- Workflow có phases/parallel-groups/depends_on (structured natural)
- Muốn fresh session sạch (không context nặng tích lũy)
- Nối packages/workflows orchestration.ts + runner.ts + packages/core session.ts + spill.ts; guard plan-extraction-accuracy (rút đúng phases done/pending), artifact-consistency (produces khớp thực tế), và warp-trigger-threshold (khi nào warp vs tiếp tục); VZ = warp new session transfer, kết hợp 591 VS (rehydration — VZ thay thế luôn, không cần rehydrate) + packages/workflows (phases/depends_on — structured plan source) + 600 WB structured-json-flow-report (structured output relate)
