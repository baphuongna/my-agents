# Hướng KZ: Knowledge Retention Policy — chính sách hết hạn & dọn memory agent

> **Nguồn gốc:** GDPR "right to erasure"; data retention lifecycle (ITIL); "Knowledge Management Life Cycle"; TTL/eviction (Redis/CDN); "Forgetting in AI agents" research; memory compaction
> **Coupling:** 🟡 — chạm memory store + session lifecycle
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory store + distill sẵn — thiếu TTL policy + expiry sweep + legal hold)
> **Effort:** 2-3 tuần

## Nguồn gốc

Data retention (ITIL/GDPR): data có **lifecycle** — tạo → active → archive → expire → purge. GDPR "right to erasure": user có quyền yêu cầu xóa; doanh nghiệp phải tuân. Redis TTL + LRU eviction: auto-expire key sau N giây, evict least-recently-used khi đầy. Agent memory: "Forgetting in AI agents" — memory vô hạn phình to, context cost tăng, hallucination; cần **chính sách quên có chủ đích** (intentional forgetting). Compaction: gộp fact cũ → summary (giữ ý, bỏ detail). Cốt lõi: **không giữ mãi** — classify fact theo độ quan trọng + nhạy cảm → TTL khác nhau → auto-expire hoặc compact.

## Mô tả

mya retention policy: mỗi fact/memory có **classification** (essential / useful / ephemeral / sensitive) → TTL tương ứng. Essential: không hết hạn (domain rules). Useful: 30-90 ngày rồi compact thành summary. Ephemeral (tmp file path, transient state): 1-7 ngày rồi purge. Sensitive (PII): GDPR erasure — expire ngay khi task done hoặc theo user request. Background sweep job chạy định kỳ → expire + compact + purge. Nối 165 memory-dedup (compact sau dedup), 166 prompt-caching (compact giảm prefix cost), 283 data-classification (classify → policy).

## Kiến trúc

```
  MEMORY FACT enters store
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  CLASSIFY (283 data-classification)                  │
  │  · essential   → TTL: ∞ (domain rule, learned skill) │
  │  · useful      → TTL: 90d → then COMPACT to summary  │
  │  · ephemeral   → TTL: 7d  → then PURGE               │
  │  · sensitive   → TTL: task-done → PURGE (GDPR)       │
  └──────────────────┬───────────────────────────────────┘
                     │ tag with expiry timestamp
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  RETENTION STORE (tagged facts)                      │
  │  fact { id, class, expiresAt, lastAccess }           │
  └──────────────────┬───────────────────────────────────┘
                     │
        ═════════════╧═══════════════
        BACKGROUND SWEEP (cron / interval)
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
  ┌──────────┐ ┌──────────┐ ┌────────────┐
  │ EXPIRED? │ │ STALE    │ │ USER       │
  │ purge    │ │ compact  │ │ erasure    │
  │ (del)    │ │ (→sum)   │ │ (GDPR)     │
  └──────────┘ └──────────┘ └────────────┘
```

```
mya: memory store + distill sẵn — thiếu TTL tag + expiry sweep + legal hold + compact-to-summary
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — memory store (sẵn)
// ✅ distill (112 learning-from-corrections) — compaction idea (sẵn)
// ✅ 165 memory-dedup — dedup before retain (documented)
// ✅ 283 data-classification — classify sensitivity (documented)

// ❌ THIẾU: TTL/expiry tag on each fact
// ❌ THIẾU: background sweep (cron-based expiry + compact + purge)
// ❌ THIẾU: legal hold / GDPR erasure endpoint
// ❌ THIẾU: compact-to-summary (merge old facts → one summary)
```

## Implementation

```typescript
// packages/memory/src/retention.ts (NEW)
type FactClass = "essential" | "useful" | "ephemeral" | "sensitive";

interface RetentionMeta {
  id: string;
  class: FactClass;
  expiresAt: number | null; // null = never
  lastAccess: number;
}

const TTL_MS: Record<FactClass, number | null> = {
  essential: null,
  useful: 90 * 86400_000,
  ephemeral: 7 * 86400_000,
  sensitive: 0, // purge when task done
};

export class RetentionPolicy {
  constructor(private store: MemoryStore, private now: () => number) {}

  tag(fact: { id: string; data: string; class: FactClass }): RetentionMeta {
    const ttl = TTL_MS[fact.class];
    return {
      id: fact.id,
      class: fact.class,
      expiresAt: ttl === null ? null : this.now() + ttl,
      lastAccess: this.now(),
    };
  }

  // Background sweep — expire + compact + purge
  async sweep(): Promise<{ purged: number; compacted: number }> {
    const facts = await this.store.listMeta();
    let purged = 0;
    const toCompact: string[] = [];
    for (const f of facts) {
      if (f.expiresAt !== null && f.expiresAt < this.now()) {
        if (f.class === "useful") toCompact.push(f.id); // compact, not delete
        else { await this.store.delete(f.id); purged++; } // ephemeral/sensitive
      }
    }
    const compacted = toCompact.length > 0
      ? await this.compact(toCompact) // merge old → one summary fact
      : 0;
    return { purged, compacted };
  }

  // GDPR erasure — user requests deletion of all their data
  async erasureForUser(userId: string): Promise<number> {
    const userFacts = await this.store.findByUser(userId);
    await Promise.all(userFacts.map((f) => this.store.delete(f.id)));
    return userFacts.length;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Memory không phình — auto expire (Redis TTL analogy) | ❌ Sweep job complexity (scheduling, locking) |
| ✅ GDPR compliance — erasure endpoint | ❌ Compact = mất detail (chỉ giữ summary) |
| ✅ Cost giảm — ít fact = ít prefix cost (166) | ❌ Phân loại sai → expire fact quan trọng |
| ✅ Intentional forgetting — giảm hallucination | ❌ Legal hold cần audit log (extra) |

## Khác các hướng gần

| | 165 Dedup | 283 Data-Classification | KZ: Retention Policy |
|---|---|---|---|
| Mục | Bỏ trùng | Phân nhạy cảm | **Lifecycle: expire + compact + purge** |
| Khi | Khi insert | Khi insert | **Theo thời gian (TTL + sweep)** |
| Xóa | Trùng lặp | ❌ | **Có chủ đích (GDPR + stale)** |

## Khi nào chọn

- Memory phình to, cost prefix tăng (166) — cần dọn
- Phải tuân GDPR / privacy regulation (erasure)
- Fact có tuổi thọ khác nhau (transient vs domain rule)
- Nối 165 dedup + 283 classification + 166 prompt-cache + 313 incremental-kb
