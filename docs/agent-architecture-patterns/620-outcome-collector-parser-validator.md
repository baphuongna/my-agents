# Hướng WV: Outcome Collector / Parser / Validator — tách outcome thành ba việc: collector đếm artifact, parser đọc thành typed data, schema async validate tính đúng

> **Nguồn gốc:** rpiv-mono (outcome pipeline); "collector counts artifact", "parser reads into typed data", "schema async validate correctness" | **Coupling:** 🟡 — thêm 3-pha outcome pipeline (collect → parse → validate) vào workflow kết quả | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (audit + telemetry sẵn — chưa có typed collector/parser/validator split) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** xử lý **outcome** (kết quả workflow) qua ba pha **tách biệt trách nhiệm**: (1) **Collector** — **đếm** artifact (mỗi artifact sinh ra trong workflow → collector ghi nhận count/metadata, không đọc nội dung). (2) **Parser** — **đọc** artifact raw thành **typed data** (parse JSON/markdown/file → object có kiểu, transform raw → structured). (3) **Validator** — **async schema validate** tính đúng (so typed data với schema, trả pass/fail + lỗi cụ thể). Nguyên tắc: **mỗi pha làm đúng 1 việc** — collector chỉ đếm, parser chỉ đọc/kiểu hóa, validator chỉ kiểm; không pha nào kiêm nhiệm → dễ test độc lập + thay thế.

## Mô tả

mya outcome collector/parser/validator: (1) **Collector** thu artifact sinh ra (đếm, ghi metadata: id, type, stage). (2) **Parser** lấy artifact raw → biến thành typed object (parse + transform). (3) **Validator** chạy schema (async — có thể gọi service) → decide pass/fail. Workflow kết thúc → outcome = { collected, parsed, validated }. mya có audit + telemetry — WV thêm **3-pha outcome pipeline** tách bạch.

## Kiến trúc

```
  WORKFLOW ARTIFACTS (raw)
        │
        ▼
  ┌─── 1. COLLECTOR (đếm, metadata) ──────────────────────┐
  │  for each artifact: { id, type, stage } → count         │
  │  → artifacts: [ {id:a1,type:report,stage:B}, ... ]      │  ← chỉ đếm, không đọc
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── 2. PARSER (đọc → typed data) ──────────────────────┐
  │  artifact raw → parse → typed object                    │
  │  a1: "# Report\n..." → { title, sections[] }            │  ← chỉ kiểu hóa
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── 3. VALIDATOR (async schema) ───────────────────────┐
  │  typed data vs schema → { pass, errors[] }              │
  │  await schema.validate(parsed) → true/false             │  ← chỉ kiểm
  └───────────────────────┬───────────────────────────────┘
                          ▼
  OUTCOME = { collected: N, parsed: {...}, validated: { pass, errors } }
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — audit trail (nền — WV collector sink)
// ✅ packages/core telemetry.ts — telemetry (nền — WV collect metric)
// ✅ packages/eval — schema/check (nền — WV validator analog)

// ❌ THIẾU: collector (đếm artifact + metadata)
// ❌ THIẾU: parser (raw artifact → typed data)
// ❌ THIẾU: async schema validator (typed vs schema)
```

## Implementation

```typescript
// packages/workflows/src/outcome-pipeline.ts (MỚI)
interface ArtifactMeta { id: string; type: string; stage: string; raw: unknown }

// 1. COLLECTOR — chỉ đếm + ghi metadata
interface Collector {
  collect(a: ArtifactMeta): void;
  result(): { count: number; artifacts: ArtifactMeta[] };
}
function makeCollector(): Collector {
  const list: ArtifactMeta[] = [];
  return { collect: (a) => list.push(a), result: () => ({ count: list.length, artifacts: list }) };
}

// 2. PARSER — raw → typed
type Parser<T> = (raw: unknown) => T;

// 3. VALIDATOR — async schema
type Validator<T> = (data: T) => Promise<{ pass: boolean; errors: string[] }>;

interface Outcome<C, P, V> { collected: C; parsed: P; validated: V }

async function runOutcome<C, T, V>(
  collector: Collector, parser: Parser<T>, validator: Validator<T>,
): Promise<Outcome<ReturnType<Collector["result"]>, T, { pass: boolean; errors: string[] }>> {
  const collected = collector.result();
  const parsed = parser(collected.artifacts.map((a) => a.raw)); // typed
  const validated = await validator(parsed);                   // async check
  return { collected, parsed, validated };
}

// Usage:
// const col = makeCollector();
// artifacts.forEach(a => col.collect(a));
// const outcome = await runOutcome(col, parseReport, validateReportSchema);
// → collected.count, parsed.sections, validated.pass
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Trách nhiệm tách (mỗi pha 1 việc, dễ test) | ❌ 3-pha overhead (nhiều pass hơn) |
| ✅ Typed safety (parser → object có kiểu) | ❌ Parser brittleness (raw lệch format → throw) |
| ✅ Async validate (gọi service/schema external) | ❌ Async latency (validator chậm block outcome) |
| ✅ Compose (đổi parser/validator độc lập) | ❌ Partial-failure (parser throw → validator skip) |

## Khác các hướng gần

| | Single-result | Count-only audit | WV: 3-Pha-Outcome |
|---|---|---|---|
| Collector | ❌ | ✅ | **✅ (đếm + metadata)** |
| Parser | ❌ | ❌ | **✅ (raw → typed)** |
| Validator | sync guess | ❌ | **✅ (async schema)** |

## Khi nào chọn

- Outcome workflow cần tách "đếm kết quả" vs "đọc nội dung" vs "kiểm tính đúng"
- Cần typed safety + async schema validate (gọi external service kiểm)
- Nối packages/audit + packages/core telemetry.ts + packages/eval; guard parser-error-fallback (parser throw → outcome partial, không crash workflow), validator-timeout (async validator có deadline), và collector-idempotent (cùng artifact collect 2 lần → không double-count); WV = outcome collector/parser/validator, kết hợp 619 WU produces-acts-terminal-factories (produces artifact cho outcome collect) + 623 WY named-artifact-registry (collector đếm named artifact)
