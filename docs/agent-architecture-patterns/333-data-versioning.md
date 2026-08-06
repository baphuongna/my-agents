# Hướng LU: Data Versioning — dataset versioning + lineage cho reproducibility

> **Nguồn gốc:** DVC (Data Version Control); Pachyderm; Delta Lake; MLflow data tracking; git-LFS; "data lineage"; W3C PROV; dbt versioned models; "reproducible ML pipeline"
> **Coupling:** 🟡 — cần data store versioned + lineage tracker
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (eval log sẵn — chưa có dataset versioning)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**DVC** (Data Version Control): version dataset cùng code (git cho data) — mỗi commit hash chỉ đến một snapshot dataset cụ thể. **Data lineage** (W3C PROV, Pachyderm): track **dữ liệu đến từ đâu, qua biến đổi gì, sinh ra gì** — reproducibility chain. Nguyên tắc: **mỗi eval/training run phải traceable đến exact dataset version** — không "data mới thì kết quả khác, không biết tại sao". MLflow tracking: log data hash + params + result. dbt: versioned model + lineage DAG. Khác **297 golden-trace-replay** (replay agent trace) — LU version **dataset**; khác **230 event-sourcing** (log event) — LU log **data lineage**.

## Mô tả

mya data versioning: mỗi dataset (eval corpus, training data, golden traces) có **version hash** — khi eval/training chạy, log `dataset@v3 + model@v2 = result`. Nếu result sai → trace lại đúng dataset version → reproduce. Lineage DAG: raw → cleaned → augmented → eval → result (mỗi node biết input/output version). mya có eval log (299) — LU thêm **dataset version hash + lineage chain**. Nối 297 golden-trace-replay — LU cung cấp **dataset reproducibility**.

## Kiến trúc

```
  RAW DATA ──► CLEAN ──► AUGMENT ──► EVAL CORPUS
  (v1 hash)   (v1)      (v2)        (v3)
      │          │         │           │
      └──────────┴─────────┴───────────┘
                   │
              LINEAGE DAG (PROV-style)
                   │
                   ▼
  EVAL RUN log: { dataset: corpus@v3, model: claude-v2,
                  result: 87.3% pass, timestamp }
                   │
                   ▼
  REPRODUCE: checkout dataset@v3 + model@v2 → re-run → 87.3% ✓
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 299 regression-gates-CI — eval gate (nền — cần data version)
// ✅ 297 golden-trace-replay — replay (nền — cần dataset reproducibility)
// ✅ 198 GP audit — log (nền)
// ✅ 230 HV event-sourcing — event log (lineage input)

// ❌ THIẾU: dataset version hash (content-addressed)
// ❌ THIẾU: lineage DAG (input → transform → output)
// ❌ THIẾU: eval run log with dataset + model version
// ❌ THIẾU: reproduce (checkout dataset@v → re-run)
```

## Implementation

```typescript
// packages/data/src/versioning.ts (NEW)
import { createHash } from 'crypto';

interface DatasetVersion {
  id: string;          // content hash
  name: string;
  parentIds: string[]; // lineage — derived từ version nào
  recordCount: number;
  createdAt: number;
}

interface RunRecord {
  datasetVersion: string;
  modelVersion: string;
  result: { passRate: number; metrics: Record<string, number> };
  timestamp: number;
}

class DataVersionStore {
  private versions = new Map<string, DatasetVersion>();
  private runs: RunRecord[] = [];

  // Content-addressed version — hash dataset content
  commit(name: string, data: unknown[], parentIds: string[] = []): string {
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
    if (!this.versions.has(hash)) {
      this.versions.set(hash, { id: hash, name, parentIds, recordCount: data.length, createdAt: Date.now() });
    }
    return hash;
  }

  logRun(rec: RunRecord): void { this.runs.push(rec); }

  // Reproduce — tìm run → re-run cùng dataset + model
  async reproduce(runId: number, execute: (data: unknown[]) => Promise<RunRecord>): Promise<RunRecord> {
    const original = this.runs[runId];
    if (!original) throw new Error(`run ${runId} not found`);
    const data = await this.checkout(original.datasetVersion);
    const result = await execute(data); // re-run
    const matched = result.result.passRate === original.result.passRate;
    return { ...result, timestamp: Date.now() }; // matched = reproducibility ✓
  }

  // Lineage — trace parent chain
  lineage(versionId: string): DatasetVersion[] {
    const chain: DatasetVersion[] = [];
    const visit = (id: string) => {
      const v = this.versions.get(id);
      if (!v) return;
      chain.push(v);
      v.parentIds.forEach(visit);
    };
    visit(versionId);
    return chain;
  }

  private async checkout(id: string): Promise<unknown[]> { /* load dataset by hash */ return []; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Reproducibility — trace result → dataset version (DVC) | ❌ Storage cost (lưu nhiều version) |
| ✅ Lineage trace (data đến từ đâu) | ❌ Hash tính lại khi data đổi |
| ✅ Audit: eval result gắn dataset + model version | ❌ Checkout old version chậm nếu lớn |
| ✅ Nối 297 replay → full reproducibility | ❌ Lineage DAG complex khi nhiều transform |

## Khác các hướng gần

| | 299 Regression Gates | 297 Golden Trace Replay | LU: Data Versioning |
|---|---|---|---|
| Version cái gì | Code/test | Agent trace | **Dataset** |
| Lineage | ❌ | ❌ | ✅ DAG |
| Reproduce | ❌ | Trace replay | **Dataset@v + model@v** |
| Audit | CI pass/fail | Trace diff | **Data provenance** |

## Khi nào chọn

- Cần reproducibility (eval result phải reproduce được)
- Dataset thay đổi thường xuyên (cần biết version nào sinh result nào)
- Compliance/audit yêu cầu data provenance
- Kết hợp 297 golden-trace-replay (trace) + LU (dataset) → full pipeline reproducibility
