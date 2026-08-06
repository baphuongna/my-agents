# Hướng CG: Declarative Agent Spec — định nghĩa agent bằng khai báo

> **Nguồn gốc:** Oracle Open Agent Spec (2025); contract4agents (2025); Agent SDKs (OpenAI/Claude)
> **Coupling:** 🟢 — spec là dữ liệu, không phụ thuộc runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (roles/skills config sẵn; thiếu spec chuẩn + validator)
> **Effort:** 1-2 tuần

## Nguồn gốc

Declarative agent spec — **định nghĩa agent bằng khai báo** thay vì code: Oracle **Open Agent Spec** (2025): "framework-agnostic declarative language for defining agentic systems"; **contract4agents** (2025): typed declarative contracts cho agents — ràng buộc input/output, workflow routes, stage sequencing — "doesn't replace your SDK, gives your SDK contracts". Triết lý: agent = cấu hình + tri thức (spec), phần code (runtime) tách rời — **portable giữa frameworks** (LangGraph ↔ OpenAI SDK ↔ ADK), máy validate được, con người đọc được, diff được (git). Khác **BBB Capability Cards** (A2A — mô tả agent *cho agent khác* tại runtime) — spec là **định nghĩa agent *trước khi chạy*** (blueprint); khác **OO roles** (quyền tool đơn giản) — spec đầy đủ hơn: mô tả, tools, policies, guardrails, memory config.

## Mô tả

mya chuyển cấu hình agent hiện tại (roles, skills, tools, policies) thành **spec chuẩn hóa** (YAML/JSON có schema): `agent.yaml` = name, description, tools (OO refs), skills (YY), policies (budget SS, permissions OO), memory config (MM), guardrails (RRR), handoff routes (CCC). **Validator** check spec trước khi nạp (tool có tồn tại, policy hợp lệ, không vòng lặp route) — fail sớm không fail runtime. Spec versioned (git diff — ai đổi gì khi nào — YY gần), portability: cùng spec chạy được runtime khác. Nối: spec → sinh AgentCard cho BBB; spec → context template cho CCCC.

## Kiến trúc

```
  agent.yaml (SPEC — khai báo, versioned, git-diffable)
  ├─ meta: name, description
  ├─ tools: refs OO registry (permission gắn sẵn)
  ├─ skills: refs YY
  ├─ policies: budget (SS) · rate (SS) · guardrails (RRR)
  ├─ memory: MM config (tầng, consolidation)
  └─ routes: handoff (CCC) · escalate (UU)
       │
       ▼
  VALIDATOR (spec check: tool tồn tại, policy hợp lệ, route không loop)
       │  fail sớm ──► báo trước khi chạy
       ▼
  RUNTIME nạp (agent chạy từ spec) ──► sinh AgentCard (BBB) · context (CCCC)
```

```
mya: roles config + skills + OO policies SẴN — dạng rời rạc
     thiếu: spec schema chuẩn + validator + git versioning
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ roles (packages/core) — đã khai báo agent bằng config
// ✅ packages/skills — tri thức khai báo (YY)
// ✅ OO ToolRegistry — tool + permission khai báo
// ✅ packages/prompts — context/template khai báo

// ❌ THIẾU: spec schema thống nhất (1 file, có schema) — hiện rải config nhiều chỗ
// ❌ THIẾU: validator (check cross-ref: tool tồn tại, route không loop)
// ❌ THIẾU: versioning spec (git diff per agent)
```

## Implementation

```typescript
// packages/core/src/agent-spec.ts (NEW)
interface AgentSpec {
  meta: { name: string; description: string; version: string };
  tools: Array<{ ref: string; permissions: string[] }>;   // OO
  skills: string[];                                        // YY
  policies: { budget?: number; rate?: number; guardrails?: string[] }; // SS/RRR
  routes: { handoff?: string[]; escalate?: string };       // CCC/UU
}

function validateSpec(spec: AgentSpec, registry: ToolRegistry): SpecIssue[] {
  return [
    ...spec.tools.filter((t) => !registry.has(t.ref)).map(missingTool),
    ...findRouteCycles(spec.routes.handoff ?? []),          // loop check
    ...spec.policies.budget && spec.policies.budget < 0 ? [badBudget] : [],
  ];
  // fail sớm: spec lỗi → từ chối nạp (không đợi runtime vỡ)
}

// git-diffable: đổi agent = đổi spec — review như code
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail sớm: validator chặn spec lỗi trước runtime | ❌ Schema phải thiết kế kỹ (đủ — không thừa) |
| ✅ Git-diffable: đổi agent review được như code | ❌ Điều chỉnh runtime phức tạp không spec hóa được |
| ✅ Portability: cùng spec chạy runtime khác | ❌ Migrate config hiện tại sang spec (công) |
| ✅ Nối BBB (sinh AgentCard) + CCCC (context) | ❌ Over-spec: agent nhỏ bị giấy tờ |
| ✅ Open Agent Spec (Oracle 2025) chuẩn hóa | |

## Khác các hướng gần

| | BBB Capability Cards | OO Tool Registry | HHHH: Agent Spec |
|---|---|---|---|
| Mục đích | Mô tả cho agent khác | Quyền tool | **Blueprint trước khi chạy** |
| Thời điểm | Runtime discovery | Runtime | Design time (khai báo) |
| Mối quan hệ | Sinh ra từ spec | Tham chiếu trong spec | **Bao gồm cả hai** |

## Khi nào chọn

- Nhiều agent, config rải rác — muốn 1 nguồn sự thật
- Muốn validator chặn spec lỗi trước runtime
- Muốn git-review thay đổi agent như code
- Đã có roles/skills/OO — gom vào spec là bước ngắn