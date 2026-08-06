# Hướng ADT: Deep Module Design Vocabulary — shared vocabulary để thiết kế deep modules

> **Nguồn gốc:** mattpocock-skills | **Coupling:** 🟢 — thuần skill/convention | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn skills; thiếu vocabulary skill) | **Effort:** 1 tuần

## Nguồn gốc

**mattpocock-skills** có codebase-design skill định nghĩa **shared vocabulary**: **module, interface, implementation, depth, seam, adapter, leverage, locality**. Ý tưởng cốt lõi (từ A Philosophy of Software Design — Ousterhout): **deep module = nhiều behavior sau small interface** — interface nhỏ (ít param, ít khái niệm), implementation sâu (xử lý nhiều). Module được đặt tại **clean seam** (ranh giới tự nhiên) và **test qua interface** (không test implementation detail).

Điểm mạnh của pattern: "**consistent language is the whole point**" — khi agent và human dùng cùng từ (depth, seam, leverage), review và prompt đều chính xác hơn. Skill này là **vocabulary layer**: agent được dạy gọi đúng tên các khái niệm thiết kế, từ đó áp dụng nhất quán khi viết code.

## Mô tả

Với mya, pattern là một **skill codebase-design** trong `packages/skills`: SKILL.md định nghĩa glossary (module/interface/depth/seam/leverage/locality) + heuristic (interface nhỏ, behavior nhiều, đặt tại seam, test qua interface) + anti-pattern (shallow module = interface to mà behavior ít). Khi agent viết module mới, skill nhắc: đo depth (interface tokens vs implementation lines), tìm seam, test qua interface. Có thể nối `packages/eval` — check depth heuristic trong code review; `packages/codegraph` tool (tools/src/codegraph.ts) để đo locality.

## Kiến trúc (ASCII)

```
  CODEBASE-DESIGN SKILL (packages/skills)
    ├─ GLOSSARY (shared vocabulary)
    │    module · interface · implementation
    │    depth  · seam · adapter
    │    leverage · locality
    ├─ HEURISTIC
    │    interface NHỎ (ít param/khái niệm)
    │    behavior NHIỀU (implementation sâu)
    │    đặt tại clean seam (ranh giới tự nhiên)
    │    test QUA interface (không test detail)
    └─ ANTI-PATTERN
         shallow module: interface to, behavior ít
            │
            ▼
  AGENT VIẾT CODE dùng đúng từ + áp dụng heuristic
  review cùng ngôn ngữ → prompt chính xác hơn
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — SkillStore + parseSkillMarkdown (nơi chứa skill này)
// ✅ packages/skills/src/skill.ts — extract_skill_description (description cho model)
// ✅ packages/tools/src/codegraph.ts — codegraph tool (nền đo locality/depth)
// ✅ packages/core — module boundaries rõ (packages/* tách bạch — nền seam)
// ✅ packages/eval — tiers (nền review heuristic)

// ❌ THIẾU: SKILL.md codebase-design với glossary + heuristic
// ❌ THIẾU: depth heuristic tool (interface tokens vs behavior lines)
// ❌ THIẾU: review check "test qua interface, không test detail"
```

## Implementation

```typescript
// packages/skills/skills/codebase-design/SKILL.md (NEW — trích)
/*
---
name: codebase-design
description: >
  Dùng khi thiết kế hoặc review module: áp dụng deep module
  vocabulary (depth, seam, leverage, locality) để interface nhỏ,
  behavior nhiều, đặt tại clean seam.
triggers: ["thiết kế module", "deep module", "refactor interface"]
---
# Shared vocabulary
- module: đơn vị behavior có interface riêng
- interface: bề mặt gọi (params, types, exports) — càng nhỏ càng tốt
- depth: behavior / interface-size — deep = nhiều behavior, ít interface
- seam: ranh giới tự nhiên (I/O, format, protocol)
- adapter: chuyển đổi giữa hai seam
- leverage: behavior tái dùng qua interface nhỏ
- locality: liên quan code gần nhau — giữ gần, không rải
# Heuristic
1. interface ít param + ít khái niệm
2. implementation giải quyết nhiều case
3. đặt tại seam — đừng đặt giữa hai trách nhiệm
4. test qua interface, không test implementation detail
# Anti-pattern
- shallow module: interface to mà behavior ít → gộp lại
*/

// packages/tools/src/depth-check.ts (NEW — heuristic tool)
export function measureDepth(iface: string[], implLines: number): number {
  return implLines / Math.max(iface.length, 1);  // behavior / interface-size
}

export function isShallow(iface: string[], implLines: number): boolean {
  return measureDepth(iface, implLines) < 10;    // nhiều interface, ít behavior
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent + human cùng ngôn ngữ — review chính xác | ❌ Vocabulary phải được huấn luyện nhất quán |
| ✅ Deep module giảm chi phí maintain | ❌ Đo depth heuristic thô (số dòng không đủ) |
| ✅ Test qua interface — refactor an toàn | ❌ Skill chỉ hiệu quả nếu agent đọc đúng lúc |
| ✅ Seam/adapter giúp thay thế implementation | ❌ Ép deep module có thể over-engineer module nhỏ |

## Khác các hướng gần

| | ADT Design Vocabulary | ADU Grilling Session | ADS Invocation Axis |
|---|---|---|---|
| Trọng tâm | Ngôn ngữ thiết kế | Sharpening plan | Ai gọi skill |
| Output | Glossary + heuristic | ADR + glossary | Trục user/model |
| Dùng khi | Thiết kế/review code | Trước khi code | Load skill |

## Khi nào chọn

- Agent viết module thường shallow (interface to, behavior ít)
- Team muốn review code cùng ngôn ngữ thiết kế
- Đã có skill store — thêm skill vocabulary
- Muốn test qua interface thay vì implementation detail