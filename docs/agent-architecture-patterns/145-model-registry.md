# Hướng EO: Model Registry — catalog tập trung mọi model, quản vòng đời model

> **Nguồn gốc:** MLflow Model Registry; AWS SageMaker Model Registry ("catalog and manage model versions, collaboration, governance"); Databricks Unity Catalog Model Lifecycle; Portkey "Model Catalog accelerates LLM development"; Atlan "Model Registry Implementation Guide" (schema/versioning/lineage/access)
> **Coupling:** 🟢 — thêm lớp catalog, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (LLM gateway + cascade + versioning sẵn; thiếu registry layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Model registry: **centralized store của mọi model — version, lineage, governance** — MLflow: "a centralized model store, set of APIs and a UI designed to collaboratively manage the full lifecycle of a machine learning model"; AWS: "catalog and manage model versions and facilitates collaboration and governance — when a model is trained and evaluated"; Atlan: "schema design, versioning, lineage tracking, access controls, CI/CD"; Portkey: "centralized registry of all the LLMs an organization has access to, across all providers, versions, and capabilities". Điểm khác **GG gateway** (route request tới model) và **HHH cascade** (chọn model theo độ khó) — PPPPPP *quản model như asset*: catalog model (provider, phiên bản, capability, cost, benchmark, carbon); chọn model dựa trên catalog (không cứng nơi code); thay model = đổi catalog entry (không redeploy — vendor-neutral); approve model mới trước khi agent dùng (governance); theo dõi model nào agent dùng (usage + cost + quality — drift). Nối GG (gateway dùng catalog), HHH (cascade chọn từ catalog), XXXXX (cost từ catalog), AAAAAA (arena — benchmark model trong registry), FFFFFF (version model cùng version agent).

## Mô tả

mya model registry: (1) **catalog** — mỗi model: provider, access, version, context window, capability (tool-call/vision), cost/token, carbon, benchmark score, trạng thái (dev/prod/deprecated); (2) **version & vòng đời** — model enum: candidate (test) → prod → deprecated (thay bằng bản mới — theo dõi EOL provider); (3) **lựa chọn tập trung** — agent không code cứng model; chọn qua registry (GG: routing đọc catalog — model "default"/"cheap"/"capable" là entry point); (4) **governance gate** — model mới phải qua eval (PP benchmark + AAAAAA arena + ZZZZZ shadow) mới đủ điều kiện prod; (5) **usage tracking** — ghi model nào dùng cho task nào (YYYY + XXXXX) — thấy model tốn tiền/phải thay; (6) **rollback** — model prod xấu → trỏ lại version cũ (như FFFFFF env tags nhưng cho model).

## Kiến trúc

```
  MODEL CATALOG (MLflow/SageMaker style): provider · version · capability
   cost/token · benchmark · carbon · status (dev/prod/deprecated)
        │
        ▼
  GATEWAY (GG) đọc catalog — model = entry point ("default"/"cheap"/"capable")
        │
        ▼
  CASCADE (HHH) chọn từ catalog theo độ khó task
        │
        ▼
  GOVERNANCE: model mới → eval PP + arena AAAAAA + shadow ZZZZ → prod
        │
        ▼
  USAGE/QUALITY: YYYY + XXXXX — model nào đắt/ ngu / drift → rollback (FFFF)
```

```
mya: GG + HHH + FFFFFF SẸN — thiếu: model catalog + lifecycle + governance gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GG LLM gateway — route tới model (đọc catalog thay vì cứng)
// ✅ HHH cascade — chọn model theo độ khó
// ✅ FFFFFF versioning — trỏ model theo tag (rollback)
// ✅ PP eval + AAAAAA arena — benchmark model mới
// ✅ XXXXX + YYYY — cost + usage theo model

// ❌ THIẾU: model catalog (schema đầy đủ — provider/version/capability/cost)
// ❌ THIẾU: lifecycle (dev/prod/deprecated + EOL)
// ❌ THIẾU: governance gate (eval mandatory trước prod)
```

## Implementation

```typescript
// packages/registry/src/models.ts (NEW)
export class ModelRegistry {
  models = new Catalog<Model>(); // provider · version · capability · cost · status
  select(task: Task, intent: "cheap" | "capable" | "default"): Model {
    return this.models
      .active(this.status)                 // chỉ prod — không deprecated
      .filter(m => m.capability.covers(task))
      .sort(by(intent))[0] ?? this.fallbackModel;
  }
  promote(m: Model, gate: Eval) {          // governance — PP + arena + shadow
    if (!gate.passed(m)) throw new ModelNotQualified(m.id);
    m.status = "prod";                     // rollback = trỏ version cũ
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Model là asset quản được — không cứng ở code | ❌ Thêm lớp catalog + vòng đời |
| ✅ Thay model = đổi catalog entry (không redeploy) | ❐ Catalog stale nếu không cập nhật (benchmark/cost) |
| ✅ Governance — model mới phải eval mới prod | ❌ Nhiều model chọn rối — cần intent rõ |
| ✅ Vendor-neutral (Portkey) — tránh khóa nhà cung cấp | ❌ Model ngoài registry gin take off |

## Khác các hướng gần

| | GG Gateway | HHH Cascade | PPPPPP: Registry |
|---|---|---|---|
| Vai trò | Route | Chọn theo độ khó | **Catalog + lifecycle + governance** |
| Thành phần | Đọc registry | Chọn từ registry | **Nguồn sự thật cho cả 2** |
| Thêm | — | — | **Version/lifecycle/status/usage** |

## Khi nào chọn

- Dùng nhiều model/provider — cần catalog tập trung
- Model thay đổi thường (version mới, EOL) — quản vòng đời
- Cần governance (model mới phải eval) + tránh khóa vendor
- Đã có GG + HHH + FFFFFF — thêm catalog + lifecycle + gate