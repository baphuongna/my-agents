# Hướng FU: Data Access Governance — quyền truy cập dữ liệu fine-grained, policy qua mọi lớp

> **Nguồn gốc:** KuppingerCole BalaGanski "Agentic AI and Data Access Control" (database-level enforcement của fine-grained, identity- và context-aware policies); Okta "Improve AI Agent Data Privacy" (identity-first, fine-grained authorization FGA, continuous monitoring); TrustLogix (FGAC — access dựa trên nhiều điều kiện đồng thời); colrows "Governing AI Agents That Query Enterprise Data" (enforce policy trước khi data queried — compile-time policy)
> **Coupling:** 🟡 — mọi truy cập dữ liệu của agent qua policy layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (perms + audit sẵn; thiếu data-level FGAC)
> **Effort:** 2-4 tuần

## Nguồn gốc

Data access governance: **ngoài quyền "ai làm gì" (tác vụ) — còn quyền "ai đọc/ghi dữ liệu gì" ở mức dữ liệu, nhiều điều kiện đồng thời** — KuppingerCole: "database-level enforcement of fine-grained, identity- and context-aware policies" (chặn ở chính database — không tin agent); Okta: "identity-first controls, fine-grained authorization (FGA), continuous monitoring across the data lifecycle"; TrustLogix: "FGAC grants or restricts access to data based on multiple conditions simultaneously" (người + context + policy — không chỉ role); colrows: "enforce policy before data is queried — compile-time policy" (chặn trước, ở tầng truy vấn). Điểm khác **UUUU perms** (quyền hoạt động — tool nào) và **KKKK credential broker** (giữ bí mật) — VVVVVVV *chặn ở lớp dữ liệu*: (1) policy per data — user/agent được xem cột/row nào (FGAC — nhiều chiều: role + context + time + phòng ban); (2) enforce ở nhiều lớp — không chỉ ở API agent mà cả database/column (KuppingerCole DB-level), compile-time trước query (colrows); (3) context-aware — theo nhiệm vụ hiện tại (agent làm finance → thấy số liệu finance — KuppingerCole context-aware), thay đổi theo thời gian (TTTTTT 155 — right-to-be-forgotten); (4) giám sát suốt vòng đời — continuous monitoring (Okta — log mọi access + phát hiện bất thường VV); (5) PII — nguồn nhạy cảm phải che/mask theo policy (143 privacy? — PII); (6) agent identity — không dùng chung credential (Okta identity-first — mỗi agent một danh tính TTTTTT).

## Kiến trúc

```
  AGENT → truy cập dữ liệu
        │
        ▼
  POLICY ENFORCE (FGAC — TrustLogix): nhiều điều kiện đồng thời
   · user/agent identity (Okta identity-first)
   · role + context (task hiện tại — KuppingerCole context-aware)
   · time · phòng ban · PII-che
        │
        ├── CHẶN Ở DATABASE (KuppingerCole DB-level — không tin agent)
        ├── CHẶN TRƯỚC QUERY (colrows compile-time — policy trước query)
        └── QUA → dữ liệu đã filter theo policy (row/column)
        │
        ▼
  MONITOR (Okta continuous): log mọi access · bất thường → alert (VV+YYY)
```

```
mya: UUUU + KKKK + VV SẴN — thiếu: data-level FGAC + DB enforce
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ UUUU perms — quyền hoạt động (nền — mở rộng xuống data)
// ✅ KKKK credential broker — agent identity per agent (identity-first)
// ✅ VV audit — log hành động (continuous monitoring)
// ✅ YYY alert — bất thường (phát hiện)
// ✅ 155 right-to-be-forgotten — xóa dữ liệu (lifecycle)
// ✅ PII — ẩn dữ liệu nhạy cảm (nền phần nào)

// ❌ THIẾU: data-level policy (column/row — FGAC)
// ❌ THIẾU: DB-level enforcement (chặn ở database — KuppingerCole)
// ❌ THIẾU: context-aware authorization (task → quyền dữ liệu)
```

## Implementation

```typescript
// packages/data-access/src/policy.ts (NEW)
export class DataPolicy {
  async authorize(q: Query, agent: AgentCtx): Promise<DataFrame> {
    const allowed = fga(q, {                        // TrustLogix FGAC
      identity: agent.id, role: agent.role,
      context: agent.currentTask, time: now(),
      dept: agent.dept, expiry: agent.dataScope,
    });   // colrows: enforce trước khi data được query
    return db.filterByPolicy(q, allowed);           // KuppingerCole DB-level
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn ngay ở dữ liệu — agent dù lạm quyền tool cũng không đọc được (KuppingerCole) | ❌ Policy phức tạp (nhiều chiều) — khó thiết kế/duy trì |
| ✅ Context-aware — quyền đổi theo task không theo cứng role | ❐ Mọi query qua filter — thêm latency |
| ✅ Tuân thủ — PII/privacy rõ ràng có vết (Okta monitor) | ❌ Metadata sai → chặn nhầm người đúng |
| ✅ Xây trên UUUU + VV + KKKK | ❌ Chỉ bảo vệ dữ liệu có policy — nguồn mới quên |

## Khác các hướng gần

| | UUUU Perms | KKKK Credentials | VVVVVVV: Data Governance |
|---|---|---|---|
| Mức | Hoạt động/tool | Bí mật | **Dữ liệu (row/column/DB)** |
| Cơ chế | Role/permission | Broker | **FGAC nhiều chiều + DB enforce** |
| Quan hệ | Quyền làm | Danh tính | **Chặn ở lớp dữ liệu — vượt trên cả 2** |

## Khi nào chọn

- Agent truy cập dữ liệu nhạy cảm (tài chính, PII, nội bộ)
- Cần quyền theo ngữ cảnh task (finance task → finance data)
- Enforce ở nguồn dữ liệu (DB), không tin tưởng agent (KuppingerCole)
- Đã có UUUU + KKKK + VV — thêm FGAC data-level