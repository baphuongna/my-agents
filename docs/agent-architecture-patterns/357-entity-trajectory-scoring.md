# Hướng MS: Entity Trajectory Scoring — theo dõi claims có thời gian của entity, auto-flag regression

> **Nguồn gốc:** gbrain (entity trajectory — track claims over time, flag regression); "entity timeline"; "temporal claim tracking"; "regression detection"; "anomaly in entity evolution"; "milestone/event tracking per entity"
> **Coupling:** 🟡 — thêm trajectory tracker vào entity graph
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (graph.ts entity nodes + lifecycle temporal sẵn — chưa có trajectory scoring + regression flag)
> **Effort:** 2-3 tuần

## Nguồn gốc

**gbrain**: theo dõi **claims có thời gian** của mỗi entity (person, project, metric) — tạo **trajectory** (quỹ đạo). VD: entity "project X" có trajectory: [Jan: status=planning] → [Mar: status=active] → [May: status=active, mrr=$5k] → [Jul: status=stalled]. **Regression detection**: nếu metric **giảm** (mrr ↓) hoặc status **lùi** (active→stalled) → **auto-flag** red flag. **Milestone tracking**: entity có mốc (event) — auto-detect milestone (new high, crossing threshold). Nguyên tắc: **entity thay đổi theo thời gian** — trajectory cho thấy xu hướng, regression là cảnh báo. Khác **357** (self — MS = 357); khác **356 MR time-retrieval** (rank query) — MS **track + flag** entity qua thời gian; khác **349 MK gap-analysis** (report gap) — MS **trend analysis** per entity.

## Mô tả

mya entity trajectory scoring: mỗi entity (graph.ts node) có **trajectory** — chuỗi claims có timestamp. (1) Mỗi observation về entity → append claim (temporal). (2) **Score trajectory**: trend (tăng/giảm/ổn), velocity (tốc độ đổi), stability (variance). (3) **Regression flag**: metric giảm hoặc status lùi → red flag alert. (4) **Milestone detection**:新高/threshold crossing → green flag. Nối 88 hybrid-graph (entity), 351 MM append-only (temporal claim), 356 MR retrieval. Agent query "project X trending sao?" → trajectory analysis → "⚠ mrr giảm 20% tháng qua (regression)".

## Kiến trúc

```
  ENTITY: "project X" (graph.ts node)
       │
       ▼
  ┌─── TRAJECTORY (temporal claims) ───────────┐
  │                                            │
  │  [Jan 15] status=planning                  │
  │  [Mar 01] status=active                    │
  │  [May 10] mrr=$5k, users=120               │
  │  [Jul 20] mrr=$4k, users=110  ◀ REGRESSION │
  │                                            │
  └──────────────────┬─────────────────────────┘
                     │
                     ▼
  ┌─── TRAJECTORY SCORING ─────────────────────┐
  │                                            │
  │  TREND:     mrr 5k→4k = DECLINING (⬇)      │
  │  VELOCITY:  -20% in 2 months               │
  │  STABILITY: high variance (unstable)       │
  │                                            │
  │  REGRESSION FLAG: mrr ↓ (red flag 🚩)      │
  │  MILESTONE:    none this period            │
  └──────────────────┬─────────────────────────┘
                     │
                     ▼
  ALERT: "project X regression: mrr -20% (May→Jul)"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/graph.ts — entity nodes (nền — MS track per-entity)
// ✅ packages/memory/src/lifecycle.ts — temporal (nền)
// ✅ 88 CJ hybrid-graph-vector — entity extraction (nền)
// ✅ 351 MM append-only — temporal claim (claim source)
// ✅ 356 MR time-aware-retrieval — temporal rank (nền)
// ✅ 349 MK gap-analysis — report (MS là trend per-entity)

// ❌ THIẾU: trajectory store (per-entity temporal claim list)
// ❌ THIẾU: trajectory scoring (trend/velocity/stability)
// ❌ THIẾU: regression detection (metric decrease / status backtrack)
// ❌ THIẾU: milestone detection (新高 / threshold crossing)
```

## Implementation

```typescript
// packages/memory/src/entity-trajectory.ts (NEW)
interface TemporalClaim {
  metric: string;     // "mrr", "status", "users"
  value: string | number;
  timestamp: number;
}

type TrajectoryTrend = 'improving' | 'stable' | 'declining';

interface TrajectoryScore {
  trend: TrajectoryTrend;
  velocity: number;   // % change per period
  stability: number;  // variance (lower = more stable)
  flags: { kind: 'regression' | 'milestone'; detail: string }[];
}

class EntityTrajectory {
  private trajectories = new Map<string, TemporalClaim[]>(); // entityId → claims

  observe(entityId: string, claim: TemporalClaim): TrajectoryScore {
    const claims = this.trajectories.get(entityId) ?? [];
    claims.push(claim);
    this.trajectories.set(entityId, claims);
    return this.score(entityId, claim.metric);
  }

  score(entityId: string, metric: string): TrajectoryScore {
    const claims = (this.trajectories.get(entityId) ?? [])
      .filter(c => c.metric === metric).sort((a, b) => a.timestamp - b.timestamp);
    if (claims.length < 2) return { trend: 'stable', velocity: 0, stability: 1, flags: [] };

    const nums = claims.map(c => typeof c.value === 'number' ? c.value : NaN).filter(n => !isNaN(n));
    if (nums.length < 2) return { trend: 'stable', velocity: 0, stability: 1, flags: [] };

    const prev = nums[nums.length - 2]!;
    const curr = nums[nums.length - 1]!;
    const velocity = ((curr - prev) / prev) * 100;
    const variance = this.variance(nums);
    const trend: TrajectoryTrend = velocity > 5 ? 'improving' : velocity < -5 ? 'declining' : 'stable';

    const flags: TrajectoryScore['flags'] = [];
    if (velocity < -10) flags.push({ kind: 'regression', detail: `${metric} ${velocity.toFixed(0)}% (⬇)` });
    if (curr === Math.max(...nums) && nums.length > 2) flags.push({ kind: 'milestone', detail: `${metric}新高 ${curr}` });

    return { trend, velocity, stability: variance, flags };
  }

  private variance(nums: number[]): number {
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Auto-detect regression (metric ↓ → alert) (gbrain) | ❌ Numeric parsing (some claims qualitative) |
| ✅ Milestone detection (新高 / threshold) | ❌ Trajectory storage (grows per entity) |
| ✅ Trend analysis per entity ("project trending sao?") | ❌ Regression threshold tuning (5%? 10%?) |
| ✅ Early warning (flag trước khi critical) | ❌ False positive (normal fluctuation) |

## Khác các hướng gần

| | 356 MR Time-Retrieval | 349 MK Gap-Analysis | 88 CJ Hybrid Graph | MS: Trajectory |
|---|---|---|---|---|
| Cái gì | Rank query tense | Report knowledge gap | Entity/relationship | **Entity trend + flag** |
| Regression | ❌ | ❌ | ❌ | **✅ auto-flag** |
| Per-entity | ❌ | ❌ | ✅ (static) | **✅ temporal** |

## Khi nào chọn

- Entity có metric đổi theo thời gian (project mrr, user activity, system health)
- Muốn auto-alert khi regression (metric ↓)
- Trend analysis cần thiết ("đang tốt lên hay xấu đi?")
- Kết hợp 88 hybrid-graph (entity) + 351 MM (temporal claim) + 356 MR (retrieval) + 349 MK (gap); tune regression threshold + smooth noise
