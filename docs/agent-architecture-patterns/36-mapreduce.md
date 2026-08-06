# Hướng AJ: MapReduce — chia task, xử lý song song, gộp kết quả

> **Nguồn gốc:** Google MapReduce (Dean & Ghemawat, 2004)
> **Coupling:** 🟡 Map/Reduce functions
> **Agent-agnostic:** ✅ — bất kỳ agent map/reduce
> **Effort:** 1-2 tuần

## Nguồn gốc

Google MapReduce (Dean & Ghemawat, 2004): xử lý dataset khổng lồ bằng cách chia thành chunks, xử lý song song (map), gộp kết quả (reduce). Foundation cho Hadoop. Paradigm: divide-and-conquer + parallel processing + aggregation.

## Mô tả

Task chia thành nhiều subtasks (map phase — agents xử lý song song). Kết quả gộp lại (reduce phase — 1 agent tổng hợp). Lý tưởng cho: phân tích nhiều file, review nhiều modules, tổng hợp research từ nhiều nguồn.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                    MAPREDUCE AGENT                           │
│                                                              │
│  TASK: "Review all files in src/ for security issues"       │
│                                                              │
│  ┌──────────────┐                                            │
│  │   SPLIT      │  Chia 50 files → 5 chunks (10 files each) │
│  └──────┬───────┘                                            │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │               MAP PHASE (parallel)                   │    │
│  │                                                     │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────┐ │    │
│  │  │ Agent 1  │  │ Agent 2  │  │ Agent 3  │  │ ... │ │    │
│  │  │ review   │  │ review   │  │ review   │  │     │ │    │
│  │  │ chunk 1  │  │ chunk 2  │  │ chunk 3  │  │     │ │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┘ │    │
│  │       │             │             │                 │    │
│  │       ▼             ▼             ▼                 │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐              │    │
│  │  │ findings│  │ findings│  │ findings│              │    │
│  │  │ chunk 1 │  │ chunk 2 │  │ chunk 3 │              │    │
│  │  └─────────┘  └─────────┘  └─────────┘              │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                    │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              REDUCE PHASE (aggregate)                │    │
│  │                                                     │    │
│  │  ┌──────────┐                                       │    │
│  │  │ Agent 4  │  collects all findings:               │    │
│  │  │ (reduce) │  · deduplicate                       │    │
│  │  │          │  · categorize (security/perf/bug)     │    │
│  │  │          │  · prioritize (critical/high/low)     │    │
│  │  │          │  · write summary report               │    │
│  │  └──────────┘                                       │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                    │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  FINAL OUTPUT:                                      │    │
│  │  "Security review of src/ (50 files):               │    │
│  │    3 critical issues (chunk 1: SQL injection,       │    │
│  │    chunk 2: XSS, chunk 3: hardcoded secret)         │    │
│  │    7 high issues, 12 low issues"                   │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/mapreduce/src/index.ts
interface MapInput {
  key: string;
  value: string;
}

interface MapOutput {
  key: string;
  findings: unknown[];
}

interface ReduceInput {
  key: string;
  allFindings: unknown[];
}

class MapReduceAgent {
  constructor(
    private mapFn: (chunk: MapInput) => Promise<MapOutput>,    // Agent per chunk
    private reduceFn: (reduced: ReduceInput) => Promise<string>, // Aggregate agent
    private maxParallel: number,
  ) {}

  async execute(inputs: MapInput[]): Promise<string> {
    // 1. Split into chunks (or use provided inputs)
    // 2. Map phase — parallel with concurrency limit
    const mapped: MapOutput[] = [];
    for (let i = 0; i < inputs.length; i += this.maxParallel) {
      const batch = inputs.slice(i, i + this.maxParallel);
      const results = await Promise.all(batch.map(this.mapFn));
      mapped.push(...results);
    }

    // 3. Shuffle (group by key)
    const grouped = new Map<string, unknown[]>();
    for (const m of mapped) {
      const existing = grouped.get(m.key) ?? [];
      grouped.set(m.key, [...existing, ...m.findings]);
    }

    // 4. Reduce phase
    const output: string[] = [];
    for (const [key, findings] of grouped) {
      output.push(await this.reduceFn({ key, allFindings: findings }));
    }
    return output.join("\n");
  }
}

// Example: security review of 50 files
const review = new MapReduceAgent(
  // Map: one agent reviews a chunk of files
  async (chunk) => {
    const result = await spawnAgent("claude",
      `Review these files for security issues:\n${chunk.value}`);
    return { key: chunk.key, findings: parseFindings(result) };
  },
  // Reduce: one agent aggregates all findings
  async (reduced) => {
    return spawnAgent("claude",
      `Synthesize these security findings into a prioritized report:\n` +
      JSON.stringify(reduced.allFindings, null, 2));
  },
  maxParallel = 4,  // 4 agents review chunks in parallel
);

const report = await review.execute(
  chunkFiles(await getFiles("src/"), 10),  // 50 files → 5 chunks of 10
);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parallel processing (map phase) | ❌ Only for embarrassingly parallel tasks |
| ✅ Scale to large inputs (many chunks) | ❌ Reduce phase is bottleneck |
| ✅ Natural aggregation (findings → report) | ❌ Context lost between chunks (each agent fresh) |
| ✅ Simple mental model (map + reduce) | ❌ Cross-chunk dependencies impossible |
| ✅ Google-proven (Hadoop) | |

## Khi nào chọn

- Large inputs cần chia nhỏ (review 100 files, analyze logs)
- Tasks độc lập (embarrassingly parallel)
- Need aggregation (findings → report, results → summary)
- Want horizontal scaling (more agents = more chunks)
- Budget-constrained (map parallel = faster wall-clock)
