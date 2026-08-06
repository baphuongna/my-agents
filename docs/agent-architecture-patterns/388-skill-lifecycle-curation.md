# Hướng NX: Skill Lifecycle Curation — curator nền theo usage → stale → archive

> **Nguồn gốc:** Skill/tool library management; "knowledge curation"; "stale detection" (LRU — least recently used); "garbage collection"; lifecycle states (draft→active→deprecated→archived); hermes-agent; skill marketplace curation
> **Coupling:** 🟡 — thêm background curator vào skills layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/skills sẵn — chưa có usage tracking + auto-curate/archive)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Skill/tool library management**: agent có nhiều skill/tool — theo thời gian, skill cũ không dùng → clutter. **Stale detection** (LRU — least recently used): skill không được gọi trong N ngày → flag stale. **Garbage collection**: stale quá lâu → archive (xóa khỏi active set, giữ để restore). **Lifecycle states**: draft (mới tạo, chưa verify) → active (verified, dùng được) → deprecated (cũ, cảnh báo) → archived (ẩn, restore được). **Curation** (knowledge curation): chọn lọc giữ skill hữu ích, loại skill lỗi thời. Nguyên tắc: skill có **lifecycle** — curator nền track usage, flag stale, auto-archive → giữ skill set sạch. Khác **283 data-classification** (classify data) — NX classify **skill**.

## Mô tả

mya skill lifecycle curation: curator nền (background job) theo dõi **usage** mỗi skill (lần cuối dùng, tần suất, success rate). Skill theo lifecycle: **draft** (mới, chưa verify) → **active** (verified, thường dùng) → **deprecated** (ít dùng / outdated, cảnh báo) → **archived** (ẩn khỏi active, restore được). Rule: không dùng > 30 ngày → deprecated; > 90 ngày → archived; success rate thấp → flag review. Curator chạy nền (cron) → không ảnh hưởng agent. mya có `packages/skills` — NX thêm **usage tracking** + **lifecycle state machine** + **background curator**.

## Kiến trúc

```
   SKILL LIFECYCLE:
     DRAFT ──verified──► ACTIVE ──no use 30d──► DEPRECATED ──90d──► ARCHIVED
       ▲                    │                       │                    │
       │                  used often             used again            restore
       │                    │                       │                    │
       └────────────────────┘ ◄─────────────────────┘ ◄──────────────────┘
                             (revive)

   BACKGROUND CURATOR (cron):
     ┌─ scan all skills ──────────────────────────┐
     │  · lastUsed > 30d? → DEPRECATED (warn)     │
     │  · lastUsed > 90d? → ARCHIVED (hide)       │
     │  · successRate < 0.5? → flag REVIEW        │
     │  · draft + verified? → ACTIVE              │
     └─────────────────────────────────────────────┘
          │
   USAGE TRACKING (mỗi skill call):
     record(skillId, { ts, success, durationMs })
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — skill registry + invoke (nền — NX lifecycle)
// ✅ packages/cron — background curator schedule (nền)
// ✅ 198 GP audit — log usage (nền — NX track)

// ❌ THIẾU: usage tracking (lastUsed, frequency, successRate)
// ❌ THIẾU: lifecycle state machine (draft→active→deprecated→archived)
// ❌ THIẾU: background curator (stale detection + auto-archive)
// ❌ THIẾU: restore archived skill (un-archive)
```

## Implementation

```typescript
// packages/skills/src/curator.ts (MỚI)
type SkillLifecycle = 'draft' | 'active' | 'deprecated' | 'archived';

interface SkillMeta {
  id: string;
  lifecycle: SkillLifecycle;
  verified: boolean;
  lastUsedAt?: number;
  useCount: number;
  successCount: number;
}

class SkillCurator {
  constructor(
    private skills: Map<string, SkillMeta> = new Map(),
    private staleThresholdDays = 30,
    private archiveThresholdDays = 90,
    private lowSuccessRate = 0.5,
  ) {}

  // Record usage — gọi mỗi skill invoke
  record(skillId: string, success: boolean): void {
    const s = this.skills.get(skillId);
    if (!s) return;
    s.lastUsedAt = Date.now();
    s.useCount++;
    if (success) s.successCount++;
  }

  // Background curate — chạy qua cron
  curate(): SkillMeta[] {
    const now = Date.now();
    const changes: SkillMeta[] = [];
    for (const s of this.skills.values()) {
      // draft + verified → active
      if (s.lifecycle === 'draft' && s.verified) {
        this.transition(s, 'active', changes);
        continue;
      }
      if (s.lifecycle === 'archived' || s.lifecycle === 'draft') continue;

      const daysSince = s.lastUsedAt ? (now - s.lastUsedAt) / 86_400_000 : Infinity;
      const successRate = s.useCount > 0 ? s.successCount / s.useCount : 1;

      // active/deprecated → stale rules
      if (daysSince > this.archiveThresholdDays) {
        this.transition(s, 'archived', changes);
      } else if (daysSince > this.staleThresholdDays || successRate < this.lowSuccessRate) {
        this.transition(s, 'deprecated', changes);
      }
    }
    return changes; // notify: skill deprecated/archived
  }

  // Restore archived skill
  restore(skillId: string): void {
    const s = this.skills.get(skillId);
    if (s && s.lifecycle === 'archived') s.lifecycle = 'active';
  }

  private transition(s: SkillMeta, to: SkillLifecycle, out: SkillMeta[]) {
    if (s.lifecycle !== to) { s.lifecycle = to; out.push(s); }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Skill set sạch (loại stale tự động) | ❌ Curator overhead (scan định kỳ) |
| ✅ Usage-driven (data, không guess) | ❌ Threshold tuning (30d? 90d?) |
| ✅ Restore được (archived không mất) | ❌ Auto-archive có thể sai (skill seasonal) |
| ✅ Success rate flag (skill lỗi) | ❌ Usage tracking storage grow |

## Khác các hướng gần

| | packages/skills | 198 Audit | 283 Data Classification | NX: Skill Curation |
|---|---|---|---|---|
| Cái gì | Skill registry | Log events | Classify data | **Skill lifecycle + curate** |
| Usage track | ❌ | ❌ | ❌ | ✅ lastUsed/freq |
| Stale detect | ❌ | ❌ | ❌ | ✅ LRU |
| Auto-archive | ❌ | ❌ | ❌ | ✅ background |

## Khi nào chọn

- Nhiều skill (skill set phình to, clutter)
- Skill cũ không dùng (cần auto-archive)
- Muốn data-driven (usage → decision, không guess)
- Kết hợp packages/skills (registry) + packages/cron (curator schedule) + 198 audit (usage log); tune stale/archive threshold; guard seasonal skill (restore khi cần)
