# Hướng SK: Runtime API Key Rotation — xoay key khi 429/401: multi key/provider, cooldownMs

> **Nguồn gốc:** pi-soly (runtime key rotation); "rotate API key on 429/401"; "multi-key multi-provider failover"; "cooldownMs backoff per key"; "key pool with rate-limit aware rotation"
> **Coupling:** 🟡 — thêm rotation layer quanh LLM client (intercept 429/401 → rotate key → retry)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai LLM client + retry sẵn — chưa có key pool + cooldown rotation)
> **Effort:** 1-2 tuần

## Nguồn gốc

**pi-soly** pattern: khi LLM call gặp **429 (rate limit)** hoặc **401 (key invalid/expired)**, không retry ngay cùng key (vẫn lỗi) — mà **xoay key** sang key/provider khác trong **pool**, đặt key lỗi vào **cooldown** (cooldownMs — không dùng lại trong N ms). Nguyên tắc: **multi-key multi-provider pool** + **rate-limit-aware rotation** — key bị 429 → cooldown (đợi reset quota) + xoay sang key khác; key 401 → mark bad (có thể hết hạn) + xoay. Nếu tất cả key cooldown → đợi cooldown ngắn nhất hết. Khác retry-with-backoff (cùng key) — SK là **rotate-to-different-key**; khác single-key — SK có **pool failover**.

## Mô tả

mya runtime API key rotation: (1) **Key pool**: config nhiều key + provider (`[{ key, provider, weight }]`). (2) **Intercept error**: LLM call → nếu 429/401 → không ném ngay, catch → handle. (3) **429 → cooldown**: key rate-limited → `cooldownUntil = now + cooldownMs` (ví dụ 60s); xoay sang key tiếp theo. (4) **401 → mark bad**: key invalid → mark bad (không dùng lại); xoay sang key tiếp. (5) **Pick next**: chọn key available (không cooldown, không bad) — round-robin hoặc weight. (6) **All cooldown**: nếu hết key available → đợi `min(cooldownUntil)` hết → retry. mya có LLM client + retry — SK thêm **key pool manager** + **cooldown tracker**.

## Kiến trúc

```
  LLM CALL (key pool):
  ┌─────────────────────────────────────────────────────┐
  │  pool: [keyA@openai, keyB@openai, keyC@anthropic]    │
  └───────────────┬─────────────────────────────────────┘
                  │ pick (round-robin, available)
                  ▼
  ┌─── CALL keyA ───────────────────────────────────────┐
  │  → 429 (rate limit)                                   │
  └───────────────┬─────────────────────────────────────┘
                  │ intercept
                  ▼
  ┌─── ROTATE ──────────────────────────────────────────┐
  │  keyA → cooldownUntil = now + 60s (cooldownMs)        │
  │  keyB? available → pick keyB                          │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── CALL keyB ───────────────────────────────────────┐
  │  → 200 OK (thành công, key khác quota)                │
  └──────────────────────────────────────────────────────┘
  EDGE: all cooldown → đợi min(cooldownUntil) → retry
        401 → mark bad (keyC hết hạn) → không dùng lại
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — LLM client (nền — SK bọc rotation quanh nó)
// ✅ retry logic — retry on error (nền — SK = rotate thay vì retry cùng key)
// ✅ provider config — multi-provider (nền — SK pool)

// ❌ THIẾU: key pool manager (multi-key + provider)
// ❌ THIẾU: cooldown tracker (key → cooldownUntil)
// ❌ THIẾU: rotation interceptor (catch 429/401 → rotate → retry)
```

## Implementation

```typescript
// packages/ai/src/key-rotation.ts (MỚI)
interface KeyEntry { key: string; provider: string; bad?: boolean; cooldownUntil?: number }

class KeyRotation {
  private pool: KeyEntry[];
  private idx = 0;
  constructor(keys: { key: string; provider: string }[], private cooldownMs = 60_000) {
    this.pool = keys.map(k => ({ ...k }));
  }

  // pick next available key (round-robin, skip cooldown/bad)
  pick(): KeyEntry | null {
    const now = Date.now();
    for (let i = 0; i < this.pool.length; i++) {
      const e = this.pool[this.idx % this.pool.length]!;
      this.idx++;
      if (!e.bad && (!e.cooldownUntil || e.cooldownUntil <= now)) return e;
    }
    return null; // all unavailable
  }

  // min cooldown remaining (when all unavailable → wait)
  minWaitMs(): number {
    const now = Date.now();
    const waits = this.pool.filter(e => !e.bad && e.cooldownUntil && e.cooldownUntil > now)
      .map(e => e.cooldownUntil! - now);
    return waits.length ? Math.min(...waits) : 0;
  }

  // handle error: 429 → cooldown, 401 → mark bad
  onError(entry: KeyEntry, status: number): void {
    if (status === 429) entry.cooldownUntil = Date.now() + this.cooldownMs;
    else if (status === 401) entry.bad = true;
  }

  // call wrapper: rotate on 429/401
  async call<T>(fn: (key: string, provider: string) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.pool.length + 1; attempt++) {
      const entry = this.pick();
      if (!entry) {
        const wait = this.minWaitMs();
        if (wait > 0) { await new Promise(r => setTimeout(r, wait)); continue; }
        throw new Error('no available key (all bad/expired)');
      }
      try { return await fn(entry.key, entry.provider); }
      catch (e: any) {
        const status = e?.status ?? e?.response?.status;
        if (status === 429 || status === 401) { this.onError(entry, status); lastErr = e; continue; }
        throw e; // non-rotation error → ném
      }
    }
    throw lastErr ?? new Error('rotation exhausted');
  }
}

// Usage:
// const r = await rot.call((key, provider) => llm.complete({ prompt, key, provider }));
// // 429/401 → tự xoay key + cooldown, caller không cần xử lý
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Failover (key lỗi → xoay, không chết) | ❌ Cấu hình nhiều key (cost — cần nhiều account) |
| ✅ Rate-limit aware (429 → cooldown, không spam) | ❌ Latency khi all-cooldown (đợi wait) |
| ✅ Multi-provider (openai down → anthropic) | ❌ Key bad mark (401 — cần re-add key mới thủ công) |
| ✅ Caller không xử lý (wrap transparent) | ❌ Pool exhaustion (hết key → error) |

## Khác các hướng gần

| | Retry-Backoff (cùng key) | Single-Key | SK: Key-Rotation |
|---|---|---|---|
| Khi 429 | Retry cùng key (backoff) | Fail | **Rotate sang key khác** |
| Pool | ❌ | 1 key | **Multi-key/provider** |
| Cooldown | ❌ | ❌ | **✅ cooldownMs per key** |

## Khi nào chọn

- LLM call hay gặp 429 (rate limit) — cần nhiều key quota
- Muốn failover (key/provider lỗi → tự xoay, không chết)
- Có nhiều key/provider (pool)
- Nối packages/ai (LLM client) + retry logic; guard cooldown accuracy (cooldownMs đúng quota reset) + 401 detection (bad key mark) + pool health (monitor bad/cooldown rate); phối provider config (multi-provider failover); 429 vs 401 phân biệt (cooldown vs bad)
