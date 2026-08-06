# Hướng OS: Slotted Memory Schema — memory 30-40 slot định sẵn, validation schema trước ghi

> **Nguồn gốc:** agentmemory (fixed-slot schema design); "30-40 predefined memory slots"; "schema-validated memory writes"; "structured slot-based memory"; "reject invalid slot writes"; "deterministic memory structure"
> **Coupling:** 🟡 — thêm slotted-schema validation layer trước memory write
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory-store + structured-output sẵn — chưa có predefined-slot schema)
> **Effort:** 2-3 tuần

## Nguồn gốc

**agentmemory** thay vì memory free-form (bất kỳ text nào), dùng **slotted schema**: **30-40 slot định sẵn** (vd `user_name`, `user_location`, `preferred_language`, `dietary_restrictions`, `work_role`, `timezone` …). Mỗi write phải **match slot** + pass **validation** (type, enum, format). Memory ngoài slot → **reject** (hoặc map vào slot `misc`). Nguyên tắc: **structured memory dễ query + ít rác** — không để LLM ghi tự do gây noise. Khác **165 FI hierarchical-memory** — OS là **fixed slots** (không phân cấp free); khác **175 structured-output-validation** — OS validate **memory write** (không phải LLM output).

## Mô tả

mya slotted memory schema: (1) **Schema define** 30-40 slot (name, type, validator). (2) **Write gate**: mỗi memory write phải chỉ định slot + pass validation (type/enum/format). (3) **Reject invalid**: write sai slot/type → reject + log. (4) **Query by slot**: retrieve trực tiếp theo slot (không cần vector search cho structured data). mya có `165 hierarchical-memory` + `175 structured-validation` — OS thêm **predefined-slot schema** + **write-gate**.

## Kiến trúc

```
  ┌─── SLOTTED SCHEMA (30-40 predefined) ──────────────┐
  │                                                     │
  │  slot               type      validator             │
  │  ─────────────────  ────────  ──────────────────    │
  │  user_name          string    nonEmpty              │
  │  user_location      string    city enum             │
  │  preferred_language enum      [vi,en,ja]            │
  │  dietary_restrict  string[]  subset known           │
  │  work_role          string    nonEmpty              │
  │  timezone           string    IANA tz format        │
  │  ... (30-40 total)                                 │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  WRITE: { slot: "preferred_language", value: "vi" }
        │
        ▼
  ┌─── WRITE GATE (validate) ──────────────────────────┐
  │  slot exists? ✅ "preferred_language"               │
  │  type match?  ✅ "vi" is enum member                │
  │  validator?   ✅ in [vi,en,ja]                      │
  │  → COMMIT to slot                                   │
  │                                                     │
  │  WRITE: { slot: "unknown_slot", value: X }          │
  │  → REJECT (slot not in schema)                      │
  └─────────────────────────────────────────────────────┘
                          │
                          ▼
  QUERY: get("preferred_language") → "vi" (direct, no search)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 165 FI hierarchical-memory — memory layer (nền — OS = structured slots)
// ✅ 175 structured-output-validation — validate output (nền — OS validate memory write)
// ✅ 182 conversational-memory — store facts (nền — OS = slotted version)
// ✅ 352 MN confidence-scoring — score (nền — OS slot có thể attach)

// ❌ THIẾU: predefined slot schema (30-40 slots)
// ❌ THIẾU: write gate (validate slot + type before commit)
// ❌ THIẾU: query-by-slot (direct lookup, no vector search)
```

## Implementation

```typescript
// packages/agent/src/memory/slotted-schema.ts (MỚI)
type SlotType = 'string' | 'string[]' | 'enum' | 'number' | 'boolean';

interface SlotDef {
  name: string;
  type: SlotType;
  enumValues?: string[];    // for enum type
  validator?: (v: unknown) => boolean;
  description: string;
}

const SCHEMA: SlotDef[] = [
  { name: 'user_name', type: 'string', validator: v => typeof v === 'string' && v.length > 0, description: 'Tên user' },
  { name: 'preferred_language', type: 'enum', enumValues: ['vi', 'en', 'ja'], description: 'Ngôn ngữ ưa thích' },
  { name: 'dietary_restrictions', type: 'string[]', description: 'Hạn chế ăn uống' },
  { name: 'timezone', type: 'string', validator: v => typeof v === 'string' && /^[a-z_]+\/[a-z_]+$/i.test(v), description: 'IANA timezone' },
  // ... 30-40 total
];

class SlottedMemory {
  private slots = new Map<string, SlotDef>(SCHEMA.map(s => [s.name, s]));
  private data = new Map<string, unknown>();

  write(slot: string, value: unknown): { ok: boolean; error?: string } {
    const def = this.slots.get(slot);
    if (!def) return { ok: false, error: `slot "${slot}" not in schema` };

    // type check
    if (def.type === 'enum' && !def.enumValues?.includes(value as string)) {
      return { ok: false, error: `"${value}" not in enum [${def.enumValues}]` };
    }
    if (def.validator && !def.validator(value)) {
      return { ok: false, error: `value failed validator for "${slot}"` };
    }

    this.data.set(slot, value);
    return { ok: true };
  }

  // Direct lookup — no vector search needed for structured slots
  read<T = unknown>(slot: string): T | undefined {
    return this.data.get(slot) as T | undefined;
  }

  // List all filled slots
  filled(): string[] {
    return [...this.data.keys()];
  }
}

// Usage:
// const mem = new SlottedMemory();
// mem.write('preferred_language', 'vi');  // ✅ valid
// mem.write('unknown_slot', 'x');          // ❌ reject
// mem.read('preferred_language');          // → 'vi' (direct)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Memory structured (dễ query, ít noise) | ❌ Rigid (slot cố định → info ngoài schema reject) |
| ✅ Query trực tiếp (no vector search) | ❌ Schema maintenance (thêm slot = update schema) |
| ✅ Validation (type/enum/format trước ghi) | ❌ Mapping cost (LLM phải map fact → slot) |
| ✅ Deterministic (luôn biết có slot nào) | ❌ Không scale (30-40 slot cố định → giới hạn) |

## Khác các hướng gần

| | 165 FI Hierarchical | 182 Conversational | 175 Structured-Validation | OS: Slotted-Schema |
|---|---|---|---|---|
| Cái gì | Memory phân cấp | Store facts | Validate output | **Fixed slots + gate** |
| Structure | Tier-based | Free text | Output schema | **30-40 predefined** |
| Query | Search | Search | ❌ | **Direct lookup** |
| Reject | ❌ | ❌ | ✅ output | ✅ invalid slot |

## Khi nào chọn

- User profile có field cố định (name, prefs, role, tz)
- Muốn query trực tiếp (không cần vector search cho structured)
- Cần validation nghiêm (reject memory rác/sai type)
- Nối 165 FI hierarchical-memory (tier layer) + 175 structured-output-validation (validator); guard schema rigidity (misc slot cho info ngoài) + LLM mapping accuracy
