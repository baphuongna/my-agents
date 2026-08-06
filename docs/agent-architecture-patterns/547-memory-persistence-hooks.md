# Hướng UA: Memory Persistence Hooks — hook vào SessionStart/PreCompact/Stop để memory sống qua vòng đời session

> **Nguồn gốc:** ECC `hooks/memory-persistence/hooks.json` (SessionStart, PreCompact, Stop hook definitions); "load context before session starts", "save state before compact", "write session summary on stop"; "memory survives session lifecycle" | **Coupling:** 🟡 — thêm lifecycle hooks vào session manager | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session + memory store sẵn — chưa có lifecycle-hook wiring) | **Effort:** 2-3 tuần

## Nguồn gốc

**ECC** khai báo memory persistence qua **hooks declarative** trong `hooks/memory-persistence/hooks.json`. Ba điểm gắn: (1) **SessionStart** — trước khi agent chạy turn đầu, **load context trước** (đọc memory từ store, inject vào context để agent có lịch sử/fact). (2) **PreCompact** — trước khi compress transcript (để giảm token), **lưu state quan trọng** (fact, decision, progress) ra store trước khi mất trong compact. (3) **Stop** — khi session kết thúc, **ghi session summary** (rút gọn toàn bộ session → durable summary cho session sau). Nguyên tắc: **memory gắn lifecycle session** — load đầu, save trước compact, summarize cuối; memory **sống qua** vòng đời session (không mất khi compact/stop).

## Mô tả

mya memory persistence hooks: (1) **Hook registry**: đăng ký 3 lifecycle hook (SessionStart, PreCompact, Stop). (2) **SessionStart → load**: đọc memory store → inject context trước turn đầu. (3) **PreCompact → save**: extract state quan trọng từ transcript → persist trước compress. (4) **Stop → summarize**: rút session summary → durable store. mya có session manager + memory store — UA thêm **hook-registry** + **load-hook** + **precompact-save-hook** + **stop-summarize-hook**.

## Kiến trúc

```
  SESSION LIFECYCLE (3 hook points)
        │
        ▼
  ┌─── 1. SessionStart ─────────────────────────────────────┐
  │  hook fire → load memory store → inject context            │
  │  agent có: facts, prior decisions, progress               │
  └───────────────────────┬─────────────────────────────────┘
                          │ (agent chạy turns...)
                          ▼
  ┌─── 2. PreCompact ───────────────────────────────────────┐
  │  transcript sắp compress → hook fire                       │
  │  extract: key facts, decisions, progress → persist         │
  │  → compress an tâm (không mất state quan trọng)            │
  └───────────────────────┬─────────────────────────────────┘
                          │ (compact xong, agent tiếp tục)
                          ▼
  ┌─── 3. Stop ─────────────────────────────────────────────┐
  │  session kết thúc → hook fire                              │
  │  summarize toàn session → durable store                    │
  │  session sau load summary này                              │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core session.ts — session manager (nền — UA hook ở đây)
// ✅ packages/memory brain-store.ts — durable store (nền — UA load/save)
// ✅ packages/prompts compress.ts — transcript compact (nền — UA PreCompact hook)
// ✅ packages/core lifecycle.ts — lifecycle events (nền — UA gắn hook)

// ❌ THIẾU: hook-registry (SessionStart/PreCompact/Stop declarative)
// ❌ THIẾU: load-hook (SessionStart → memory → context)
// ❌ THIẾU: precompact-save-hook (PreCompact → extract → persist)
// ❌ THIẾU: stop-summarize-hook (Stop → summary → durable)
```

## Implementation

```typescript
// packages/agent/src/memory-persistence-hooks.ts (MỚI)
import type { Session } from '@my-agent/core';

type HookEvent = 'SessionStart' | 'PreCompact' | 'Stop';
type HookFn = (session: Session) => Promise<void>;

interface HookConfig { event: HookEvent; run: HookFn }

class MemoryPersistenceHooks {
  private hooks = new Map<HookEvent, HookFn[]>();

  register(config: HookConfig): void {
    const list = this.hooks.get(config.event) ?? [];
    list.push(config.run);
    this.hooks.set(config.event, list);
  }

  async fire(event: HookEvent, session: Session): Promise<void> {
    const fns = this.hooks.get(event) ?? [];
    for (const fn of fns) await fn(session);
  }
}

// Wiring (declarative, như hooks.json):
// hooks.register({ event: 'SessionStart', run: loadMemoryIntoContext });
// hooks.register({ event: 'PreCompact', run: saveStateBeforeCompact });
// hooks.register({ event: 'Stop', run: writeSessionSummary });
//
// async function loadMemoryIntoContext(s) {
//   const facts = await brain.recall(s.id);           // load trước
//   s.inject(`Prior context: ${facts.join('; ')}`);   // inject context
// }
// async function saveStateBeforeCompact(s) {
//   const state = extractKeyState(s.transcript);       // fact/decision/progress
//   await brain.write(s.id, state);                    // persist trước compress
// }
// async function writeSessionSummary(s) {
//   const summary = await summarize(s.transcript);     // rút gọn
//   await brain.write(`${s.id}:summary`, [summary]);   // durable
// }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Memory sống qua compact (state quan trọng không mất) | ❌ Hook order dependency (load trước fire run) |
| ✅ Session mới có context (SessionStart load) | ❌ Summarize cost (LLM call mỗi Stop) |
| ✅ Declarative (hooks.json → registry, dễ thêm) | ❌ PreCompact timing (extract phải xong trước compress) |
| ✅ Durable summary (Stop → long-term memory) | ❌ Hook failure → memory mất (cần error handling) |

## Khác các hướng gần

| | Auto-save mỗi turn | dream-cycle consolidate | UA: Lifecycle-Hooks |
|---|---|---|---|
| Cái gì | Lưu sau mỗi turn | Định kỳ gộp memory | **3 lifecycle point load/save/summarize** |
| Timing | Mỗi turn | Định kỳ | **Start/PreCompact/Stop** |
| Compact-safe | ⚠ (có thể mất) | ❌ (không gate compact) | **✅ PreCompact save** |

## Khi nào chọn

- Session dài → transcript compact nhiều lần → cần giữ state qua compact
- Muốn session mới tự có context (load trước)
- Cần durable summary (long-term memory cross-session)
- Nối packages/core session.ts + lifecycle.ts + packages/memory brain-store + packages/prompts compress.ts; guard hook ordering (SessionStart fire trước turn đầu), PreCompact atomicity (save xong mới compress), và hook error-handling (hook fail → log, không crash session); UA = memory persistence hooks, kết hợp 544 TX debounced-queue (extract fact) + 548 UB instinct-learning (learn qua lifecycle)
