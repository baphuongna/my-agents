# Hướng GGGGGGGG: Least Privilege Tool Scoping — agent chỉ thấy/có quyền tool vừa đủ cho task

> **Nguồn gốc:** Microsoft Security "Least Privilege for AI Agents" (managed identity + least-privilege RBAC — nếu không agent có thể access/modify sensitive data); Cequence "Why AI Agents Need Least Privilege" (restrict tool access/API permissions/data scope — chỉ đúng task cần); arXiv 2607.22445 "Dynamic Capability Scoping" (dynamic least-privilege — prevention trước detection); Okta (implement guide); Oso research (96% permissions unused — agents inherit at machine speed)
> **Coupling:** 🟡 — tool registry phải hỗ trợ scope động theo task
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (perms UUUU + registry NNN sẵn; thiếu dynamic scoping)
> **Effort:** 2-3 tuần

## Nguồn gốc

Least privilege tool scoping: **agent không có "mọi quyền" — mỗi task: đúng subset tool + quyền vừa đủ, tự thu hẹp theo thời gian** — Microsoft: "when an agent operates without managed identity and least-privilege RBAC, it can access or modify sensitive data" (hậu quả nếu không); Cequence: "restricting each agent's tool access, API permissions, and data scope to only what its specific task needs"; arXiv 2607.22445: "capability scoping must follow a dynamic least-privilege principle — treated as a prevention mechanism before a detection one" (scope ĐỘNG, chặn trước — không phát hiện sau); Oso: "96% of enterprise permissions go unused, until AI agents inherit them at machine speed" (nguy cơ khi cấp thừa). Điểm khác **UUUU perms** (phân quyền tĩnh theo user/role) và **MMMMMMM guardrails** (chặn hành động xấu) — GGGGGGGG *scope tool theo task động*: (1) task intent → tool subset (WWWWWW — task cần gì: "viết email" → chỉ mail tools; "đọc file" → read-only); (2) dynamic scope — lúc bắt đầu task: cấp đúng; task xong thu lại (arXiv dynamic — prevention); (3) tool binding — agent + task + nguồn dữ liệu gắn scope (Microsoft RBAC per agent); (4) read-only default — thao tác ghi cần quyền riêng (least privilege core); (5) JIT — cấp quyền đúng lúc cần (just-in-time — Arthur), không "cấp sẵn"; (6) audit — scope thực tế khi chạy (VV — quyền cấp có dùng hết không — Oso unused), thu hẹp dần (147 feedback). Nối UUUU (nền), NNN (registry — expose scope), WWWWWW (intent → tool subset), MMMMMMM (guard), KKKK (credentials — cấp theo scope), VV (audit), 155 (forget — xóa scope cũ).

## Kiến trúc

```
  TASK ĐẾN → INTENT (WWWWWW: "viết email" / "đọc file" / "gọi API")
        │
        ▼
  SCOPE ENGINE (Cequence — restrict tới đúng task cần)
   · TOOL SUBSET: đúng tool → ít thừa (NNN registry — expose gì)
   · QUYỀN: read-only default · ghi cần riêng (least privilege)
   · DATA SCOPE: nguồn dữ liệu cho phép (Microsoft RBAC)
        │
        ▼
  JIT (Arthur just-in-time): cấp đúng lúc cần · task xong → THU LẠI
   · dynamic scoping (arXiv 2607.22445 — prevention, không detection)
        │
        ▼
  AUDIT (VV + Oso): quyền cấp có dùng hết? → thu hẹp dần (147)
```

```
mya: UUUU + NNN SẴN — thiếu: dynamic scoping + JIT
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ UUUU perms — phân quyền (nền tĩnh)
// ✅ NNN registry — tool expose (nền subset)
// ✅ WWWWWW intent — biết task cần gì (nền scope)
// ✅ MMMMMMM guardrails — chặn vượt scope (lớp sau)
// ✅ KKKK credentials — secret per scope (cấp theo scope)
// ✅ VV audit — log quyền dùng (Oso analysis)

// ❌ THIẾU: dynamic scope theo task (Cequence)
// ❌ THIẾU: JIT (just-in-time — cấp xong thu lại)
// ❌ THIẾU: read-only default (ghi cần riêng)
```

## Implementation

```typescript
// packages/scoping/src/dynamic.ts (NEW)
export class Scoper {
  async begin(task: Task): Promise<Scope> {
    const need = intent.tools(task);               // WWWWWW — task cần gì
    const s = { tools: subset(registry, need),     // NNN — đúng subset
                ro: !need.writes, data: task.dataScope, // read-only default
                ttl: task.estDuration };
    audit.grant(task, s);                          // VV — grant log
    return s;                                      // JIT: cấp đúng lúc task bắt đầu
  }
  async end(task: Task, s: Scope): Promise<void> {
    revoke(s);                                     // thu lại khi xong (arXiv dynamic)
    audit.usage(task, s);                          // Oso — có dùng hết không → thu hẹp
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Attack surface nhỏ — agent không chạm thứ không cần (Microsoft) | ❌ Intent sai → scope thiếu → task fail |
| ✅ Động — cấp xong thu lại, không "cấp sẵn" (JIT) | ❐ Mỗi task phải scope — thêm overhead |
| ✅ Chặn trước thay vì phát hiện sau (arXiv prevention) | ❌ Tool mới chưa có scope → chặn nhầm |
| ✅ Xây trên UUUU + NNN + WWWWWW | ❌ Scope quá chặt → agent đổi hướng giữa task bị kẹt |

## Khác các hướng gần

| | UUUU Perms | MMMMMMM Guardrails | GGGGGGGG: Scoping |
|---|---|---|---|
| Lúc | Tĩnh (config) | Mỗi hành động | **Động theo task (JIT)** |
| Phạm vi | User/role | Action | **Tool + data + time** |
| Quan hệ | Nền | Chặn khi vượt | **Cấp đúng → guard chỉ xử lý sót** |

## Khi nào chọn

- Agent có quyền tool mạnh — rủi ro khi lạm dụng (Microsoft)
- Task rõ phạm vi (viết email/đọc file) — scope dễ xác định
- Chống "quyền thừa kế máy tốc độ" (Oso 96% unused)
- Đã có UUUU + NNN + WWWWWW — thêm dynamic + JIT