# Hướng DP: Artifact Catalog & Multi-Artifact Versioning — quản artifact agent theo phiên bản

> **Nguồn gốc:** "Multi-Artifact Versioning (MAV)" (SSRN 2026); solo.io agentregistry; fast.io agent artifacts guide 2025
> **Coupling:** 🟢 — tầng lưu trữ, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit/53 sẵn; thiếu catalog)
> **Effort:** 1-2 tuần

## Nguồn gốc

Artifact management: **mọi output agent (file sửa, report, patch, docs) là artifact — catalog + versioning** — SSRN 2026 "Multi-Artifact Versioning (MAV)": "foundational requirement for reliable engineering of LLM-agent-based software" (đổi prompt → artifact khác — cần biết version nào sinh từ stack nào); solo.io agentregistry: "centralized catalog for AI artifacts"; fast.io 2025: "beyond chat UIs — agents save work directly to shared artifact space"; gumloop: cùng filename trong 1 conversation → tự tạo version mới thay vì overwrite; jfrog: artifact = reproducibility (tái tạo build đúng version dependencies). Với mya: agent sửa file, tạo report, sinh patch — không catalog → không biết artifact nào từ prompt/model nào (QQQQ replay cần thứ này để chạy lại đúng).

## Mô tả

mya artifact layer (nối git + eval): (1) **registry** — mỗi artifact (file output/report/patch/docs) ghi: task ID, agent, prompt version, model, thời gian, hash (nối VV audit); (2) **MAV** — đổi artifact theo vòng (prompt v1 → v2) → version chain — không overwrite (gumloop); (3) **catalog UI/query** — tìm artifact theo task/model/prompt version (nối report 53, giao diện print); (4) **reproducibility** — mỗi version gắn stack hash (SSSSS) → tái tạo/so sánh; (5) **lifecycle** — retain/clean (artifact cũ — disk policy), liên kết artifact→trace (QQQQ). Khác **28/29 canary** (deploy code) — QQQQQ *mọi artifact* của agent; khác **53 report** (kết quả đo) — QQQQQ lưu *sản phẩm* (file/patch/docs).

## Kiến trúc

```
  AGENT OUTPUT (file sửa · patch · report · docs)
        │
        ▼
  ARTIFACT REGISTRY (mỗi artifact ghi: task · agent · prompt v · model · hash)
        ├─ MAV: prompt v1→v2 → version chain (KHÔNG overwrite — gumloop)
        ├─ stack hash → reproducibility (SSSSS — tái tạo đúng)
        ├─ catalog query: theo task/model/prompt version
        ├─ link artifact ↔ trace (QQQQ replay dùng lại)
        └─ lifecycle: retain/clean (disk policy)
```

```
mya: audit + 53 + git SẸN — thiếu: artifact registry + MAV + catalog
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ VV audit — ghi hành vi (nền metadata artifact)
// ✅ 53 report — artifact đo (1 dạng artifact)
// ✅ git — versioning file code (artifact chính)
// ✅ QQQQ replay — cần artifact version (reproducibility)
// ✅ 28 versioning — pattern versioned (nền)
// ✅ SSSSS stack hash — khi có reproducibility

// ❌ THIẾU: artifact registry (metadata chuẩn)
// ❌ THIẾU: MAV (prompt version → artifact version chain)
// ❌ THIẾU: catalog query + lifecycle
```

## Implementation

```typescript
// packages/artifacts/src/registry.ts (NEW)
interface Artifact {
  id: string; taskId: string; kind: "file" | "report" | "patch" | "doc";
  promptVersion: string; model: string; hash: string; createdAt: Date;
}

function register(a: ArtifactInput, prev?: ArtifactId): Artifact {
  return registry.upsert({
    ...a, hash: hashContent(a), prev,   // MAV: version chain — không overwrite
  });
}

function catalog({ task, model, promptVersion }): Artifact[] { ... }
// reproducibility: stack hash (SSSSS) — tái tạo cùng version (jfrog/MAV)
// liên kết trace (QQQQ): replay đúng artifact version
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết artifact nào từ stack nào (prompt/model — MAV) | ❌ Metadata thêm vào mọi output path |
| ✅ Không overwrite — version chain (gumloop) | ❐ Catalog cần UI/query (print) |
| ✅ Reproducibility (jfrog) + replay đúng (QQQQ) | ❌ Lifecycle policy phải định (disk) |
| ✅ Nối audit/53/git thành hệ vết đầy đủ | ❌ Agent chưa quen ghi artifact chuẩn |

## Khác các hướng gần

| | 53 Report | VV Audit | QQQQQ: Artifacts |
|---|---|---|---|
| Lưu gì | Kết quả đo | Hành vi | **Sản phẩm (file/patch/docs)** |
| Versioning | Không | Có | **MAV (đầy đủ)** |
| Mối quan hệ | 1 loại artifact | Nguồn metadata | **Lớp quản lý tổng** |

## Khi nào chọn

- Agent tạo nhiều output (file/patch/docs) khó truy vết
- Muốn replay/so sánh giữa prompt versions
- Đã có audit + git + 53 — thêm registry + MAV
- Sẵn sàng khai báo artifact khi agent xong việc