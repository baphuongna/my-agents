# Hướng NZ: Low-Cost Agent Triggers — watcher lệnh rẻ, chỉ wake AI khi trúng điều kiện

> **Nguồn gốc:** Event-driven architecture (watcher/observer); "cheap predicate, expensive action"; "event filter / fan-in"; "trigger condition"; cron + file-watch; MyAgents; "pre-filter before LLM"
> **Coupling:** 🟢 — watcher layer ngoài agent, không chạm core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cron + lifecycle-hooks sẵn — chưa có cheap watcher + condition predicate)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**Event-driven architecture** (watcher/observer pattern): component theo dõi event source (file change, git push, webhook, schedule) → khi event match condition → trigger action. **Cheap predicate, expensive action**: phần **filter** (kiểm tra điều kiện) rẻ (regex, threshold, glob) — chỉ khi filter **trúng** mới chạy phần **đắt** (LLM inference, agent wake). **Pre-filter before LLM**: không wake AI cho mọi event — chỉ wake khi event "đáng" (trúng rule). **Fan-in**: nhiều event source → 1 watcher → filter → agent. Nguyên tắc: **watcher rẻ chạy liên tục** (file/cron/webhook), **AI chỉ wake khi điều kiện trúng** (tiết kiệm cost). Khác **389 hibernation** (sleep/wake mechanism) — NZ là **trigger condition logic** (khi nào wake).

## Mô tả

mya low-cost agent triggers: watcher nền (rẻ — chi phí thấp, chạy liên tục) theo dõi event source (file change, git webhook, cron, queue). Watcher áp **condition predicate** (rẻ: regex/threshold/glob/keyword) — chỉ khi **trúng** mới wake AI (đắt: LLM inference). VD: watcher file `*.log` → condition "contains ERROR" → trúng → wake agent analyze. Không trúng → skip (không tốn AI cost). mya có `packages/cron` + `292 hooks` — NZ thêm **cheap watcher** + **condition predicate** + **wake-on-match**. Kết hợp 389 hibernation (agent sleep → watcher wake khi trúng).

## Kiến trúc

```
   EVENT SOURCES (nhiều, rẻ):
   file-watch   git-webhook   cron   queue   webhook
       │            │          │       │       │
       ▼            ▼          ▼       ▼       ▼
   ┌── WATCHER (cheap, always running) ──────────────┐
   │                                                  │
   │  for each event:                                 │
   │    · apply CONDITION PREDICATE (rẻ):             │
   │      - regex match? (contains "ERROR")           │
   │      - threshold? (CPU > 90%)                    │
   │      - glob? (path matches *.sec.json)           │
   │      - keyword? (mentions "@agent")              │
   │                                                  │
   │    ┌── MISS ──┐         ┌── HIT ───────────┐     │
   │    │ skip     │         │ wake AI (đắt)    │     │
   │    │ (no cost)│         │ → agent analyze  │     │
   │    └──────────┘         └──────────────────┘     │
   └──────────────────────────────────────────────────┘
        │ (hit only)
        ▼
   AGENT (wake from 389 hibernate, hoặc spawn)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/cron — scheduled trigger (nền — NZ watcher source)
// ✅ 292 agent-lifecycle-hooks — hooks (nền — NZ wake trigger)
// ✅ 389 NY hibernation — sleep/wake (nền — NZ wake mechanism)
// ✅ 384 NT daemon — supervisor (nền — NZ chạy trên daemon)

// ❌ THIẾU: cheap watcher (file/git/queue event source)
// ❌ THIẾU: condition predicate (regex/threshold/glob/keyword filter)
// ❌ THIẾU: wake-on-match (chỉ wake AI khi trúng)
// ❌ THIẾU: event fan-in (nhiều source → 1 watcher)
```

## Implementation

```typescript
// packages/agent/src/low-cost-trigger.ts (MỚI)
type Condition =
  | { type: 'regex'; pattern: RegExp }
  | { type: 'threshold'; field: string; op: '>' | '<'; value: number }
  | { type: 'glob'; pattern: string }
  | { type: 'keyword'; terms: string[] };

interface WatchRule {
  source: 'file' | 'git' | 'cron' | 'queue' | 'webhook';
  condition: Condition;
  agentId: string; // wake ai nào
}

class LowCostTrigger {
  constructor(private rules: WatchRule[], private wake: (agentId: string, event: unknown) => Promise<void>) {}

  // Watcher nhận event → filter → wake chỉ khi trúng
  async onEvent(source: WatchRule['source'], event: unknown): Promise<void> {
    for (const rule of this.rules.filter(r => r.source === source)) {
      if (this.matches(rule.condition, event)) {
        await this.wake(rule.agentId, event); // đắt — chỉ khi HIT
      }
      // MISS → skip (no AI cost)
    }
  }

  // Cheap predicate — KHÔNG gọi LLM
  private matches(cond: Condition, event: unknown): boolean {
    const text = typeof event === 'string' ? event : JSON.stringify(event);
    switch (cond.type) {
      case 'regex': return cond.pattern.test(text);
      case 'threshold': {
        const v = Number((event as Record<string, unknown>)?.[cond.field]);
        return cond.op === '>' ? v > cond.value : v < cond.value;
      }
      case 'glob': return minimatch(text, cond.pattern);
      case 'keyword': return cond.terms.some(t => text.includes(t));
    }
  }
}

// VD: watch file *.log → contains ERROR → wake agent
// rules: [{ source: 'file', condition: { type: 'regex', pattern: /ERROR/i }, agentId: 'log-analyzer' }]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm AI cost (chỉ wake khi trúng) | ❌ Watcher phải chạy liên tục (always-on nhỏ) |
| ✅ Predicate rẻ (regex/threshold — không LLM) | ❌ Condition tuning (regex sai → miss/wake nhầm) |
| ✅ Fan-in nhiều source (1 watcher) | ❌ False negative (điều kiện hẹp → miss event quan trọng) |
| ✅ Nối 389 hibernation (wake từ sleep) | ❌ Watcher latency (event → predicate → wake delay) |

## Khác các hướng gần

| | packages/cron | 389 Hibernation | 384 Daemon | NZ: Low-Cost Triggers |
|---|---|---|---|---|
| Cái gì | Scheduled | Sleep/wake | Always-on | **Cheap watcher + condition** |
| Filter | ❌ (all fire) | ❌ | ❌ | ✅ predicate |
| AI cost | Mỗi schedule | — | Luôn | ✅ chỉ khi HIT |
| Event source | Time | — | — | ✅ file/git/queue/webhook |

## Khi nào chọn

- Event source nhiều (file/git/webhook/queue) — không thể wake AI cho mọi event
- Muốn tiết kiệm AI cost (chỉ wake khi đáng)
- Có rule rõ ràng (regex/threshold/keyword — filter được)
- Kết hợp 389 hibernation (agent sleep, watcher wake khi trúng) + 384 daemon (watcher always-on nhỏ); tune condition predicate (guard miss/false-positive); cheap watcher KHÔNG gọi LLM
