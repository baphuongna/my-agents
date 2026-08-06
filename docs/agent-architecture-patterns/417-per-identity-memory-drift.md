# Hướng PA: Per-Identity Memory Drift — partition memory theo identity, drift riêng không merge ngầm

> **Nguồn gốc:** gbrain (per-identity memory); "partition memory by identity/agent"; "isolated memory drift per identity"; "no implicit cross-identity merge"; "identity-scoped knowledge evolution"
> **Coupling:** 🟡 — thêm identity-partition + drift-isolation layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (delegated-identity + multi-tenancy sẵn — chưa có per-identity memory drift partition)
> **Effort:** 3 tuần

## Nguồn gốc

**gbrain** **partition memory theo identity** — mỗi identity (agent/persona/user) có memory riêng, **drift độc lập** (knowledge evolves khác nhau), **không merge ngầm**. Vd identity "code-reviewer" học "auth module cần careful review"; identity "feature-dev" học "auth module ổn định" — 2 drift khác nhau, không trộn. Query scoped theo identity (chỉ memory của identity đó). Nguyên tắc: **opinion/knowledge phụ thuộc góc nhìn** — không hòa memory của identities khác nhau. Khác **141 multi-tenancy** — PA là **epistemic drift isolation** (không phải data isolation); khác **414 OX holder-attributed** — PA là **per-store partition** (không phải per-take holder).

## Mô tả

mya per-identity memory drift: (1) **Partition** — memory store chia theo identity key. (2) **Drift isolated** — mỗi identity memory evolves riêng (add/update/decay độc lập). (3) **No implicit merge** — query identity A chỉ thấy A's memory (không thấy B). (4) **Explicit cross-ref** — nếu cần reference identity khác → explicit link (không silent merge). mya có `141 multi-tenancy` + `149 delegated-identity` — PA thêm **memory drift partition**.

## Kiến trúc

```
  ┌─── MEMORY PARTITIONS (per identity) ───────────────┐
  │                                                     │
  │  IDENTITY "code-reviewer":                          │
  │    · "auth module cần careful review" (drift A)     │
  │    · "test coverage auth = 80%"                     │
  │    (evolves riêng, decays riêng)                     │
  │                                                     │
  │  IDENTITY "feature-dev":                            │
  │    · "auth module ổn định" (drift B — KHÁC A)       │
  │    · "OAuth2 tích hợp dễ"                           │
  │    (evolves riêng, không merge với A)                │
  │                                                     │
  │  IDENTITY "security-auditor":                       │
  │    · "auth có risk OAuth token leak" (drift C)      │
  │    (isolated — C không thấy A/B)                    │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  QUERY (scoped by identity):
  ┌─── "code-reviewer" hỏi về auth ────────────────────┐
  │  → chỉ memory partition "code-reviewer":            │
  │    "auth cần careful review" + "coverage 80%"       │
  │  (KHÔNG thấy "auth ổn định" của feature-dev)        │
  │  → drift giữ riêng, không merge ngầm                │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 141 multi-tenancy — data isolation (nền — PA = epistemic drift isolation)
// ✅ 149 delegated-agent-identity — identity (nền — PA partition by identity)
// ✅ 414 OX holder-attributed — per-take holder (nền — PA = per-store partition)
// ✅ 413 OW knowledge-kind — take subset (nền — PA isolates takes)

// ❌ THIẾU: memory partition per identity (store keyed by identity)
// ❌ THIẾU: drift isolation (each identity evolves independently)
// ❌ THIẕU: no-implicit-merge guard (query scoped strictly)
// ❌ THIẕU: explicit cross-identity reference link
```

## Implementation

```typescript
// packages/agent/src/memory/per-identity-drift.ts (MỚI)
interface MemoryEntry {
  text: string;
  confidence: number;
  timestamp: number;
}

class PerIdentityMemory {
  private partitions = new Map<string, MemoryEntry[]>();  // identityId → entries

  // Add to a specific identity's partition
  add(identityId: string, entry: MemoryEntry): void {
    if (!this.partitions.has(identityId)) this.partitions.set(identityId, []);
    this.partitions.get(identityId)!.push(entry);
  }

  // Query scoped to ONE identity (no cross-identity merge)
  query(identityId: string, filter: string): MemoryEntry[] {
    const partition = this.partitions.get(identityId) ?? [];
    return partition
      .filter(e => e.text.includes(filter))
      .sort((a, b) => b.confidence - a.confidence);
  }

  // Drift isolation: decay/evolve one identity without affecting others
  decay(identityId: string, factor: number): void {
    const partition = this.partitions.get(identityId);
    if (!partition) return;
    for (const e of partition) e.confidence *= factor;  // only this identity decays
  }

  // Explicit cross-identity reference (NOT silent merge)
  linkReference(fromId: string, toId: string, note: string): void {
    // add explicit reference entry (clearly marked, not merged)
    this.add(fromId, {
      text: `[REF → ${toId}] ${note}`,
      confidence: 0.5,
      timestamp: Date.now(),
    });
  }

  // List all identities (for management)
  identities(): string[] {
    return [...this.partitions.keys()];
  }
}

// Usage:
// const mem = new PerIdentityMemory();
// mem.add('code-reviewer', { text: 'auth cần careful review', confidence: 0.8, timestamp: Date.now() });
// mem.add('feature-dev', { text: 'auth ổn định', confidence: 0.9, timestamp: Date.now() });
// const reviewerView = mem.query('code-reviewer', 'auth');
//   → ["auth cần careful review"] (feature-dev's "ổn định" NOT seen)
// mem.linkReference('security-auditor', 'code-reviewer', 'reviewer flag auth risk');
//   → explicit reference, not silent merge
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Drift độc lập (identity evolve riêng) | ❌ Store phình (mỗi identity partition riêng) |
| ✅ Không merge ngầm (giữ góc nhìn khác nhau) | ❌ Cross-identity blind spot (A không thấy B) |
| ✅ Query scoped (chính xác theo identity) | ❌ Reference overhead (explicit link manual) |
| ✅ Nối 141 multi-tenancy + 149 identity | ❌ Consistency (fact shared nhưng drift khác) |

## Khác các hướng gần

| | 141 Multi-Tenancy | 149 Delegated-Identity | 414 OX Holder-Attributed | PA: Per-Identity-Drift |
|---|---|---|---|---|
| Cái gì | Data isolation | Identity delegation | Per-take holder | **Memory drift partition** |
| Scope | Tenant | Agent identity | Take | **Store per identity** |
| Merge | ❌ isolated | ❌ | No silent | ✅ no implicit merge |
| Drift | ❌ | ❌ | ❌ | ✅ independent evolve |

## Khi nào chọn

- Nhiều identity/persona với góc nhìn khác nhau
- Muốn memory evolve độc lập (drift riêng)
- Tránh merge ngầm opinions trái chiều
- Nối 141 multi-tenancy (data iso base) + 149 delegated-agent-identity (identity) + 414 OX holder-attributed (per-take); guard cross-identity blind spot (explicit reference when needed) + store growth (decay per partition)
