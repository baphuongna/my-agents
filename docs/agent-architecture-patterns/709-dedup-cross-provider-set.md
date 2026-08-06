# Hướng AAG: Dedup Cross-Provider Set — seenKeys truyền vào mọi provider parser để một turn ở hai nguồn chỉ đếm một lần

> **Nguồn gốc:** codeburn (docs/architecture.md) | **Coupling:** 🟢 — thêm dedup layer vào parser/ingest | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có cost tracker + telemetry — chưa có seenKeys dedup) | **Effort:** 1 tuần

## Nguồn gốc

**codeburn** gặp vấn đề **double-count**: một turn xuất hiện ở hai nguồn (vd **Claude logs vs Cursor mirror**) nên token/cost bị đếm hai lần. Giải pháp: **set `seenKeys`** được truyền vào **mọi provider parser** — mỗi turn sinh ra một key ổn định (session id + turn timestamp/hash), parser nào gặp key đã có trong set thì **bỏ qua** (không đếm). Nguyên tắc: **idempotent ingest** — cùng một sự kiện từ nhiều nguồn chỉ được ghi nhận một lần, bất kể thứ tự/nguồn nào đến trước.

## Mô tả

mya dedup cross-provider set: packages/print runtimes có nhiều runtime adapter (pi, claude, mya-native) mỗi cái parse event riêng — cùng session có thể bị đếm ở nhiều adapter. AAG thêm **shared seenKeys**: mỗi turn key = `hash(sessionId + turnId + ts)`; ingest pipeline nhận key, check `seenKeys` (Set trong process + persist ra disk để sống qua restart) — hit → skip, miss → đếm + thêm. Áp dụng cho mọi nơi đếm token/cost: cost-tracker.ts, telemetry, audit log. Dùng canonical key từ packages/core canonical-json.ts để ổn định.

## Kiến trúc

```
  NGUỒN A (Claude logs)      NGUỒN B (Cursor mirror)
        │                          │
        ▼                          ▼
  ┌─── PROVIDER PARSER ────────────────────────────────┐
  │  key = hash(sessionId + turnId + ts)               │
  │  seenKeys.has(key)?                                │
  │   ├─ YES → SKIP (không đếm — double-count chặn)    │
  │   └─ NO  → count tokens/cost → seenKeys.add(key)   │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── INGEST (cost + telemetry + audit) ──────────────┐
  │  mỗi turn đếm ĐÚNG 1 lần dù 2 nguồn                │
  │  persist seenKeys → sống qua restart               │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print runtimes/ — pi/claude/mya-native runtime adapters (nơi chèn)
// ✅ packages/print runtimes/cost-tracker.ts — SessionCost per-session (nơi dedup)
// ✅ packages/core cost.ts — computeCost (đếm token → tiền)
// ✅ packages/core canonical-json.ts — canonical hash nền cho key
// ✅ packages/core telemetry.ts — projected counts (nơi dedup)
// ✅ packages/audit — audit log (nơi dedup)

// ❌ THIẾU: seenKeys shared set + persist
// ❌ THIẾU: key derivation chuẩn (sessionId+turnId+ts → hash)
// ❌ THIẾU: hook vào mọi parser/adapter
```

## Implementation

```typescript
// packages/print/src/seen-keys.ts (NEW)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { canonicalJson } from "@my-agent/core";

const SEEN_PATH = join(homedir(), ".mya", "seen-keys.json");

/** Set idempotency key cho mọi provider parser — persist ra disk. */
export class SeenKeys {
  private readonly keys = new Set<string>();
  private loaded = false;

  /** Key ổn định: canonical JSON (sessionId, turnId, ts) → sha256. */
  static derive(sessionId: string, turnId: string, ts: number): string {
    return createHash("sha256")
      .update(canonicalJson({ sessionId, turnId, ts }))
      .digest("hex")
      .slice(0, 24);
  }

  /** Check + add atomically. true = lần đầu (nên đếm), false = duplicate. */
  consume(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  /** Ingest hook: parser gọi qua đây — dedup ở một chỗ. */
  ingest(sessionId: string, turnId: string, ts: number, count: (k: string) => void): boolean {
    const key = SeenKeys.derive(sessionId, turnId, ts);
    if (!this.consume(key)) return false; // duplicate — bỏ qua
    count(key);
    return true;
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try { for (const k of JSON.parse(readFileSync(SEEN_PATH, "utf8")) as string[]) this.keys.add(k); } catch { /* fresh */ }
  }

  persist(): void {
    mkdirSync(join(homedir(), ".mya"), { recursive: true });
    writeFileSync(SEEN_PATH, JSON.stringify([...this.keys]));
  }
}
// Usage: seen.ingest("sess-1", "turn-9", ts, (k) => costTracker.add(tokens))
// → cùng turn từ Claude logs lẫn Cursor mirror chỉ đếm 1 lần
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hết double-count token/cost (nhiều nguồn) | ❌ Set phình theo thời gian — cần prune TTL |
| ✅ Idempotent — thứ tự nguồn đến không quan trọng | ❌ Key phải ổn định giữa các parser (cùng contract) |
| ✅ Persist — sống qua restart không đếm lại | ❌ Retry sau crash có thể miss key chưa persist |
| ✅ Một điểm chèn (ingest hook) | ❌ Hash collision cực hiếm — 24 hex đủ an toàn |

## Khác các hướng gần

| | Cost tracker (per-session) | AAG: SeenKeys Dedup |
|---|---|---|
| Phạm vi | Một runtime/session | **Xuyên provider/nguồn** |
| Cơ chế | Cộng dồn | **Idempotency set** |
| Persist | Trong process | **Disk — sống qua restart** |
| Mối quan hệ | Nền đếm | **Lớp chặn trước khi đếm** |

## Khi nào chọn

- Cùng session/turn đến từ nhiều nguồn (log mirror, adapter khác nhau)
- Số liệu token/cost phải chính xác (audit/billing/analytics)
- Đã có cost-tracker + telemetry — chèn seenKeys ở ingest hook
- Guard: prune TTL (key cũ > N ngày xóa), persist định kỳ, key contract dùng chung mọi parser
