# Hướng SX: Gbrain Entity-Create Safety Hint — trả gợi ý exists/probable/unknown trước khi tạo entity mới

> **Nguồn gốc:** gbrain `core/check-resolvable.ts` (resolver validation, `ResolvableFix`), `core/schema-pack/mutate.ts`, `core/chunkers/edge-extractor.ts` ("duplicate entity", "already exists", "disambiguate"); "entity create pre-check"; "exists/probable/unknown hint"; "avoid duplicate entity creation"; "create safety gate" | **Coupling:** 🟢 — thêm pre-create lookup layer trước entity mutation (hint exists/probable/unknown) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (memory store + lookup sẵn — chưa có entity-similarity matcher + create-hint gate) | **Effort:** 2-3 tuần

## Nguồn gốc

**gbrain** (knowledge-graph memory) khi agent **tạo entity mới** (node trong graph) có nguy cơ **duplicate** (tạo `UserService` khi đã có `UserSvc`, `user_service`). Trước khi commit tạo mới, gbrain trả **safety hint**: **exists** (entity y hệt đã có → dùng cái đó), **probable** (entity gần giống tên/alias/định nghĩa → gợi ý merge/xác nhận), **unknown** (chưa có gì gần → OK tạo mới). Agent nhận hint → quyết định dùng entity cũ / merge / tạo mới (không tạo trùng). Nguyên tắc: **create không mù** — lookup trước, hint rõ mức độ chắc chắn, tránh graph rác (duplicate nodes). Khác **088 hybrid-graph-vector-memory** (lưu) — SX là **create-safety gate**; khác search thuần — SX **hint分级 exists/probable/unknown**.

## Mô tả

mya entity-create safety hint: (1) **Pre-create lookup**: agent muốn tạo entity → query store (name + alias + definition). (2) **Match**: so sánh exact (exists), gần giống (probable — fuzzy/alias/semantic), không có (unknown). (3) **Hint**: trả `{ status: exists|probable|unknown, candidates, suggestion }`. (4) **Gate**: exists → reject tạo (dùng cũ); probable → gợi ý merge/confirm; unknown → OK. mya có memory store + search — SX thêm **entity-similarity matcher** + **create-hint gate** + **candidate surfacer**.

## Kiến trúc

```
  AGENT muốn tạo entity: { name: "UserService", def: "manage users" }
        │
        ▼
  ┌─── PRE-CREATE LOOKUP (name + alias + definition) ────┐
  │  search store cho "UserService" + gần giống            │
  └───────────────────────┬─────────────────────────────┘
                          │ (match)
                          ▼
  ┌─── SAFETY HINT (exists/probable/unknown) ────────────┐
  │  EXACT match:   "UserService" đã có → status: exists   │
  │  FUZZY match:   "UserSvc" (alias) → status: probable   │
  │  SEMANTIC:      "AccountManager" (gần def) → probable   │
  │  NO match:      → status: unknown                       │
  └───────────┬───────────────────────┬───────────────────┘
       exists/probable               unknown
              ▼                        ▼
  ┌─── GATE ────────────────────┐  ┌─── CREATE OK ────────┐
  │ exists → REJECT (dùng cũ)    │  │ unknown → tạo mới     │
  │ probable → hint merge/confirm│  │ (graph sạch, no dup)  │
  └──────────────────────────────┘  └───────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory brain-store — entity store (nền — SX lookup ở đây)
// ✅ packages/tools search — fuzzy/semantic search (nền — SX probable match)
// ✅ 465 QW fuzzy-finder — fuzzy match (nền — SX alias match)

// ❌ THIẾU: entity-similarity matcher (exact + fuzzy + semantic → score)
// ❌ THIẾU: create-hint gate (exists reject / probable confirm / unknown ok)
// ❌ THIẾU: candidate surfacer (gợi ý merge candidate rõ)
```

## Implementation

```typescript
// packages/memory/src/entity-create-hint.ts (MỚI)
type HintStatus = 'exists' | 'probable' | 'unknown';
interface Entity { id: string; name: string; aliases: string[]; definition: string }
interface CreateHint { status: HintStatus; candidates: Entity[]; suggestion: string }

class EntityCreateHint {
  constructor(
    private findExact: (name: string) => Entity | null,
    private findSimilar: (name: string, def: string) => Entity[], // fuzzy + semantic
  ) {}

  // pre-create lookup → hint
  check(name: string, def: string): CreateHint {
    // 1. exact
    const exact = this.findExact(name);
    if (exact) return { status: 'exists', candidates: [exact], suggestion: `use existing "${exact.name}" (${exact.id})` };

    // 2. probable (fuzzy name / alias / semantic def)
    const similar = this.findSimilar(name, def).slice(0, 5);
    if (similar.length > 0) {
      return {
        status: 'probable',
        candidates: similar,
        suggestion: `similar entities exist — merge into one, or confirm new is distinct`,
      };
    }

    // 3. unknown
    return { status: 'unknown', candidates: [], suggestion: 'no similar entity — safe to create new' };
  }

  // gate: decide action from hint
  gate(hint: CreateHint): 'reject' | 'confirm' | 'create' {
    if (hint.status === 'exists') return 'reject';   // use existing
    if (hint.status === 'probable') return 'confirm'; // ask user/agent
    return 'create';                                  // unknown → ok
  }
}

// Usage:
// const hint = checker.check('UserService', 'manage users');
// if (hint.status === 'exists') → reject, use existing UserService
// if (hint.status === 'probable') → surface [UserSvc, AccountManager] → confirm merge/new
// if (hint.status === 'unknown') → create new (graph clean)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Graph sạch (không duplicate entity) | ❌ Lookup overhead (mỗi create query) |
| ✅ Hint rõ (exists/probable/unknown) | ❌ Probable false-positive (gần giống nhưng khác) |
| ✅ Merge gợi ý (probable → dùng cũ) | ❌ Cold-start (store trống → toàn unknown) |
| ✅ Agent không tạo mù | ❌ Semantic match cost (embedding query) |

## Khác các hướng gần

| | 088 Hybrid-Graph-Memory | Search thuần | SX: Entity-Create-Hint |
|---|---|---|---|
| Cái gì | Lưu entity | Tìm entity | **Pre-create safety gate** |
| Khi | Sau create | Khi query | **Trước create (gate)** |
| Hint | ❌ | Ranked | **exists/probable/unknown** |

## Khi nào chọn

- Memory là knowledge-graph (entity/node) — duplicate làm rác graph
- Agent tạo entity nhiều → cần check trước
- Muốn hint分级 (chắc chắn tồn tại / có thể trùng / mới hoàn toàn)
- Nối packages/memory brain-store + packages/tools search (fuzzy/semantic) + 465 QW fuzzy-finder; guard false-positive (probable nhưng thực sự khác entity → confirm không auto-reject), cold-start (store trống), và semantic cost (embedding chỉ khi cần); SX = create-safety gate cho graph memory, kết hợp 088 hybrid-graph-vector-memory
