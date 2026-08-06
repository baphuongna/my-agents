# Hướng TN: Run Summary Observability — emit run-summary.json sau mỗi run để debug regression

> **Nguồn gốc:** ClaudeSkills `scripts/emit_run_summary.py` (`run-summary.json` output); "emit run summary after each run"; "orchestration mode, search count, citation count, eval verdict"; "debug regression by comparing run summaries" | **Coupling:** 🟢 — thêm run-summary emitter vào agent loop post-run hook | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (telemetry + audit log sẵn — chưa có run-summary structured emitter) | **Effort:** 1 tuần

## Nguồn gốc

**ClaudeSkills** sau mỗi **run** (agent hoàn thành 1 task) emit **run-summary.json** — structured file chứa: (1) **orchestration mode** (skill nào active, mode brief/full/delta). (2) **search count** (bao nhiêu retrieval/search call). (3) **citation count** (bao nhiêu citation/source reference). (4) **eval verdict** (pass/fail routing eval, mode eval). Mục đích: **debug regression** — khi run sau cho kết quả khác run trước, **compare run-summary** → thấy khác nhau ở đâu (mode đổi? search nhiều hơn? citation thiếu?). Nguyên tắc: **mỗi run có fingerprint** — structured, comparable, queryable.

## Mô tả

mya run summary observability: (1) **Collect**: trong run, track metrics (orchestration mode, tool calls, search count, citations, eval results). (2) **Emit post-run**: sau khi run kết thúc → write `run-summary.json` (durable). (3) **Compare**: run mới vs run cũ → diff (mode đổi? search count tăng? citation giảm?). (4) **Regression debug**: diff chạy → thấy nguyên nhân regression. mya có telemetry + audit log — TN thêm **structured run-summary emitter** + **diff comparator**.

## Kiến trúc

```
  RUN #42 (agent hoàn thành task)
        │
        │  collect metrics trong run
        ▼
  ┌─── EMIT run-summary.json (post-run) ──────────────────┐
  │  {                                                      │
  │    runId: "42",                                         │
  │    orchestrationMode: "research-deep",                  │
  │    skillTriggered: ["search-skill", "cite-skill"],      │
  │    artifactMode: "full",                                 │
  │    searchCount: 12,                                      │
  │    citationCount: 8,                                     │
  │    evalVerdict: { routing: "pass", mode: "pass" },      │
  │    toolCalls: 24,                                        │
  │    duration: 45000,                                      │
  │    ts: 2026-08-06                                        │
  │  }                                                      │
  └───────────┬───────────────────────────────────────────┘
              │ (compare run #42 vs run #41)
              ▼
  ┌─── DIFF (regression debug) ───────────────────────────┐
  │  #42 vs #41:                                            │
  │    orchestrationMode: research-deep → research-deep ✅  │
  │    searchCount: 12 → 8 (↑4 — search nhiều hơn)         │
  │    citationCount: 8 → 5 (↓3 — citation giảm ⚠)         │
  │    evalVerdict.routing: pass → pass ✅                   │
  │  → citation giảm = regression hint                      │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core telemetry — telemetry tracking (nền — TN collect metrics)
// ✅ packages/audit AuditLog — audit trail (nền — TN run events)
// ✅ packages/core cost — cost tracking (nền — TN cost in summary)
// ✅ packages/core budget — budget usage (nền — TN budget in summary)

// ❌ THIẾU: structured run-summary emitter (write run-summary.json post-run)
// ❌ THIẾU: metric collector (search count, citation count, eval verdict)
// ❌ THIẾU: diff comparator (run vs run → regression hint)
```

## Implementation

```typescript
// packages/agent/src/run-summary.ts (MỚI)
interface RunSummary {
  runId: string;
  orchestrationMode: string;
  skillTriggered: string[];
  artifactMode: string;
  searchCount: number;
  citationCount: number;
  evalVerdict: { routing?: string; mode?: string };
  toolCalls: number;
  durationMs: number;
  ts: number;
}

class RunSummaryEmitter {
  private metrics = { searchCount: 0, citationCount: 0, toolCalls: 0, skills: new Set<string>(), mode: "" };
  private startTime: number;

  constructor(private now: () => number) { this.startTime = now(); }

  // track during run
  recordSearch(): void { this.metrics.searchCount++; }
  recordCitation(): void { this.metrics.citationCount++; }
  recordToolCall(): void { this.metrics.toolCalls++; }
  recordSkill(name: string): void { this.metrics.skills.add(name); }
  setMode(mode: string): void { this.metrics.mode = mode; }

  // emit post-run
  emit(runId: string, evalVerdict: RunSummary["evalVerdict"]): RunSummary {
    return {
      runId,
      orchestrationMode: this.metrics.mode,
      skillTriggered: [...this.metrics.skills],
      artifactMode: this.metrics.mode,
      searchCount: this.metrics.searchCount,
      citationCount: this.metrics.citationCount,
      evalVerdict,
      toolCalls: this.metrics.toolCalls,
      durationMs: this.now() - this.startTime,
      ts: this.now(),
    };
  }
}

// diff two summaries → regression hints
function diffSummaries(a: RunSummary, b: RunSummary): string[] {
  const hints: string[] = [];
  if (a.searchCount !== b.searchCount) hints.push(`searchCount: ${a.searchCount} → ${b.searchCount}`);
  if (a.citationCount !== b.citationCount) hints.push(`citationCount: ${a.citationCount} → ${b.citationCount} ⚠`);
  if (a.orchestrationMode !== b.orchestrationMode) hints.push(`mode changed: ${a.orchestrationMode} → ${b.orchestrationMode}`);
  return hints;
}

// Usage:
// const emitter = new RunSummaryEmitter(nowWallclock);
// ... during run: emitter.recordSearch(), recordCitation(), etc.
// post-run: const summary = emitter.emit("run-42", { routing: "pass" });
// writeFileSync(`run-summary-${summary.runId}.json`, JSON.stringify(summary));
```

## Được

- ✅ Regression debug (compare run-summary → thấy khác nhau ở đâu)
- ✅ Structured (JSON — queryable, comparable, không parse free-text log)
- ✅ Observability (metric per run: search, citation, eval, duration)
- ✅ Trend tracking (nhiều run → trend: citation giảm dần? search tăng?)

## Mất

- ❌ I/O overhead (write JSON mỗi run)
- ❌ Metric collection coupling (emitter hook vào nhiều place — search, cite, tool)
- ❌ Storage growth (nhiều run-summary file → cần cleanup/rotate)
- ❌ Metric noise (quá nhiều metric → khó diff có ý nghĩa)

## Khác

Khác **telemetry** (real-time event stream) — TN là **structured post-run summary** (snapshot). Khác **audit log** (event trail) — TN là **aggregated metrics**. Khác **TH retrieval-trajectory-inspection** (per-query retrieval steps) — TN là **per-run aggregate**.

## Khi nào chọn

- Cần debug regression (run sau khác run trước → tìm nguyên nhân)
- Muốn observability per-run (structured, comparable)
- Agent phức tạp (nhiều skill, search, citation → khó debug free-text log)
- Nối packages/core telemetry + packages/audit AuditLog + cost + budget; guard metric relevance (chỉ track metric có ý nghĩa regression), storage cleanup (rotate/gc old summaries), và diff noise filter (highlight metric thay đổi đáng kể); TN = run summary observability, kết hợp TL routing-eval-cases (eval verdict in summary) + TM brief-full-delta-modes (mode in summary)
