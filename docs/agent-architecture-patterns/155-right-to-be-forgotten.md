# Hướng EY: Right-to-Be-Forgotten — agent quên dữ liệu người dùng theo yêu cầu (GDPR)

> **Nguồn gốc:** GDPR Article 17 "Right to Erasure"; TechPolicy "The Right to Be Forgotten Is Dead: Data Lives Forever in AI"; CSA "The Right to Be Forgotten — But Can AI Forget?" 2025; Varonis "GDPR: Right to Be Forgotten and AI"; Fosch-Villaronga "AI and the Right to Be Forgotten" (318 cites)
> **Coupling:** 🟡 — mọi nơi lưu dữ liệu user phải hỗ trợ xóa theo yêu cầu
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit VV + memory MM + artifact sẵn; thiếu erasure pipeline)
> **Effort:** 2-3 tuần

## Nguồn gốc

Right-to-be-forgotten: **người dùng yêu cầu xóa dữ liệu — hệ thống phải xóa được** — GDPR Art. 17: "individuals have the right to request the erasure of personal data when it is no longer necessary"; TechPolicy: "GDPR grants the right to request data erasure, but it does not define erasure in the context of AI" — bài toán mở; CSA 2025: "Can AI forget? — Article 17 requests"; Varonis: "data held by the data controller must be removed on request"; ResearchGate: "Deletion Paradox — is deleting logs sufficient, or must we also 'unlearn'"? Điểm khác **MM memory** (quản bộ nhớ) — ZZZZZZ *xóa có kỷ luật*: user yêu cầu → tìm mọi nơi lưu (memory MM, audit VV, artifact QQQQ, session log, embedding store) → xóa/thay thế (anonymize/hash) → xác nhận đã xóa (bằng chứng VV). Bài toán khó: embedding đã ghi mất gốc → cần kỹ thuật forget (approximate unlearning) hoặc partition data (user A không nằm chung embedding với user B — LLLLLL tenancy giúp). Nối MM (memory — nơi chính), VV (audit — phải xóa nhưng giữ bằng chứng tuân thủ), LLLLLL (tenancy — cô lập giúp xóa), KKKKKK (prefs — dữ liệu cá nhân), HHHHHH (edge — dữ liệu ở local, xóa local là xong).

## Mô tả

mya erasure: (1) **inventory** — bản đồ dữ liệu user nằm đâu: memory (MM tiers), audit (VV), artifact (QQQQ), session, embedding store, backup; (2) **request flow** — user yêu cầu xóa (id + scope) → erasure pipeline chạy; (3) **xóa theo nơi** — memory: xóa entries; audit: anonymize (thay user id bằng hash — vì audit còn cần bằng chứng tuân thủ, không giữ dữ liệu cá nhân); artifact: xóa/ẩn (QQQQ); embedding: khó nhất — partition per user (LLLLLL) hoặc rebuild index; (4) **xác nhận** — sau khi xóa: bằng chứng "đã xử lý yêu cầu" (không chứa dữ liệu cá nhân — VV đã anonymize); (5) **test** — tự động: kiểm tra sau xóa không còn trace dữ liệu user trong memory/artifact (PP-style audit test); (6) **backup** — dữ liệu trong backup phải xóa theo (retention window — backup lăn xóa sau N ngày, không giữ vô hạn).

## Kiến trúc

```
  USER YÊU CẦU XÓA (GDPR Art.17 / CCPA) ──► ERASURE PIPELINE
        │
        ▼
  INVENTORY: dữ liệu nằm ở đâu?
   memory MM · audit VV · artifact QQQQ · session · embeddings · backup
        │
  ┌─────┼──────────────┬────────────────┐
  ▼     ▼              ▼                ▼
 XÓA    ANONYMIZE     XÓA/ẨN          REBUILD/PARTITION
 memory  audit (hash   artifact QQQQ   embeddings (LLLLLL
 MM      user id — giữ              partition per user)
         bằng chứng)
        │
        ▼
  XÁC NHẬN: bằng chứng đã xử lý (không chứa dữ liệu cá nhân — VV)
        │
        ▼
  TEST TỰ ĐỘNG: không còn trace user trong memory/artifact/audit
```

```
mya: VV + MM + QQQQ SẸN — thiếu: erasure pipeline + inventory + anonymize
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ MM memory — nơi dữ liệu chính (xóa entries)
// ✅ VV audit — bằng chứng (anonymize — hash user id)
// ✅ QQQQ artifact — versioned (xóa/ẩn version có data)
// ✅ LLLLLL tenancy — cô lập per user (giúp xóa embedding)
// ✅ KKKKKK preference — dữ liệu cá nhân (xóa theo user)
// ✅ HHHHHH edge — dữ liệu local (xóa local là xong)

// ❌ THIẾU: erasure pipeline (request → xóa mọi nơi)
// ❌ THIẾU: inventory (bản đồ dữ liệu user)
// ❌ THIẾU: anonymize audit (hash — giữ bằng chứng)
// ❌ THIẾU: post-erasure test (không còn trace)
```

## Implementation

```typescript
// packages/privacy/src/erasure.ts (NEW)
export class Erasure {
  async forget(user: UserId, scope: Scope): Promise<Receipt> {
    const places = inventory(user);                  // bản đồ dữ liệu
    await memory.delete(user, scope);                // MM
    await audit.anonymize(user);                     // VV — hash id, giữ bằng chứng
    await artifacts.hide(user, scope);               // QQQQ
    await embeddings.rebuild(user);                  // LLLLLL partition/rebuild
    await assertNoTrace(user, scope);                // test tự động
    return receipt(user);                            // bằng chứng tuân thủ
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tuân GDPR Art.17/CCPA — xóa theo yêu cầu | ❌ Embedding đã "khắc" khó xóa gốc (rebuild) |
| ✅ Bằng chứng tuân thủ (audit anonymize giữ) | ❐ Audit/log dính đầy dữ liệu — anonymize phức tạp |
| ✅ Tenancy giúp xóa sạch (partition) | ❌ Backup lăn — dữ liệu cũ trong backup phải đợi |
| ✅ Test tự động không còn trace | ❌ "Unlearn" model (nếu có) là bài toán mở (CSA) |

## Khác các hướng gần

| | MM Memory | LLLLLL Tenancy | ZZZZZZ: Erasure |
|---|---|---|---|
| Vai trò | Nơi lưu | Cô lập | **Quy trình xóa có kỷ luật** |
| Mục đích | Quản nhớ | Không lộ chéo | **Tuân thủ pháp lý (GDPR)** |
| Quan hệ | Nơi bị xóa | Giúp xóa | **Điều phối mọi nơi lưu** |

## Khi nào chọn

- Phục vụ khách hàng (B2C/SaaS) — phải tuân GDPR/CCPA
- User có thể yêu cầu xóa dữ liệu — cần pipeline + bằng chứng
- Đã có MM + VV + QQQQ + LLLLLL — thêm erasure + inventory + test
- Lưu nhiều dữ liệu cá nhân (prefs, memory, log)