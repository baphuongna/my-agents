# Hướng RQ: Out-Of-Band Byte Marker Bridge — MCP server ghi byte vào file marker, PostToolUse tiêu thụ telemetry

> **Nguồn gốc:** context-mode (`retrieval-marker.ts`); "server→hook bridge for byte count"; "own MCP tools never fire PostToolUse"; "append-only marker keyed by session DB basename"; "consume-once so next fire cannot re-forward"; "phantom-event guard"
> **Coupling:** 🟢 — marker bridge là side-channel file (không can thiệp agent core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (PostToolUse hook + telemetry sẵn — chưa có out-of-band marker consume-once)
> **Effort:** 1 tuần

## Nguồn gốc

**context-mode** gặp vấn đề đo lường: **MCP server's own retrieval tools** (`ctx_search` / `ctx_fetch_and_index`) **không bao giờ fire PostToolUse** cho chính plugin đó → hook-side `extractMcpToolCall` không thể quan sát → `bytes_retrieved` luôn 0 (verified: 0/124454 in prod). Vấn đề: server đo được byte mỗi retrieval **trực tiếp** (trong response), nhưng **không có hook để forward telemetry**. Giải pháp: **out-of-band byte marker bridge** — server **append byte count** vào **tmp marker file** (keyed by session DB *basename* — identifier duy nhất cả server và hook resolve được). **PostToolUse fire tiếp theo** (chạy cho tool thường Bash/Read/Edit) **tiêu thụ marker** (sum + delete → consume-once) → emit event forward-able mang `bytes_retrieved`. Nguyên tắc: **khi hook không quan sát được tool, dùng side-channel file làm cầu nối**. **Consume-once** (delete sau đọc) → next fire không re-forward cùng byte (phantom-event guard). **Append-only** → nhiều retrieval giữa 2 lần fire accumulate. Khác **466 QX citation-attribution** (citation trong output) — RQ **telemetry byte qua marker**; khác **432 PP cache-miss** — RQ **byte retrieved, không cache token**.

## Mô tả

mya out-of-band byte marker bridge: (1) **Side-channel file**: server ghi byte count vào `tmpdir/context-mode-retrieval-<basename>.txt` (basename = session DB filename — cả server và hook resolve cùng file). (2) **Append-only**: nhiều retrieval giữa 2 hook fire → accumulate (mỗi retrieval 1 dòng). (3) **Positive-only**: 0-byte/failed → không ghi (không là context cost). (4) **PostToolUse consume**: fire tiếp theo (cho tool thường) → read marker → sum tất cả dòng → delete file (consume-once). (5) **Emit event**: forward event mang `bytes_retrieved` (sum) vào telemetry. (6) **Phantom-event guard**: không có marker → return 0 (không event ma). **Best-effort**: marker I/O không bao giờ throw vào response path. mya có PostToolUse + telemetry — RQ thêm **marker append/consume** cho tool không fire hook.

## Kiến trúc

```
  MCP SERVER (ctx_search / ctx_fetch_and_index)
  │  own retrieval tools — KHÔNG fire PostToolUse cho plugin
  │  nhưng server đo được byte mỗi response
  ▼
  ┌─── APPEND MARKER (side-channel file) ───────────────────┐
  │  path = tmpdir/retrieval-<sessionDBbasename>.txt         │
  │  append: "4823\n"   (byte count, 1 dòng/retrieval)       │
  │  append: "1190\n"   (retrieval thứ 2 accumulate)         │
  │  append-only, positive-only (0-byte → skip)              │
  │  best-effort — không throw vào response path              │
  └──────────────────────────┬──────────────────────────────┘
                             │
                             │  (fire tiếp theo — tool thường: Bash/Read)
                             ▼
  ┌─── PostToolUse HOOK (consume-once) ─────────────────────┐
  │  read marker → sum lines (4823 + 1190 = 6013)            │
  │  delete file (CONSUME — next fire không re-forward)      │
  │  emit event { bytes_retrieved: 6013 }                    │
  │  → telemetry/dashboard nhận byte đã tiêu thụ             │
  └──────────────────────────────────────────────────────────┘

  KEY = session DB basename: cả server (getSessionDbPath) và hook (getSessionDBPath)
        derive CÙNG file → bridge hoạt động dù CLAUDE_SESSION_ID thiếu
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PostToolUse hook (packages/*) — hook sau tool (nền — RQ = consume marker ở đây)
// ✅ telemetry / stats tracking — event capture (nền — RQ = forward bytes_retrieved)
// ✅ 466 QX context-citation-attribution — citation (đối chiếu — RQ = byte telemetry)
// ✅ 432 PP cache-miss-attribution — đo token (đối chiếu — RQ = byte retrieved)

// ❌ THIẾU: marker append (server ghi byte → side-channel file)
// ❌ THIẾU: marker consume-once (read + sum + delete trong PostToolUse)
// ❌ THIẾU: stable key (basename cả server/hook resolve cùng file)
// ❌ THIẾU: phantom-event guard (không marker → return 0, không throw)
```

## Implementation

```typescript
// packages/agent/src/retrieval-marker.ts (MỚI)
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// path marker — keyed by session DB basename (cả server & hook resolve cùng file)
function markerPath(sessionDbPath: string, tmp = tmpdir()): string {
  return join(tmp, `context-mode-retrieval-${basename(sessionDbPath)}.txt`);
}

// SERVER side: ghi 1 retrieval's response byte count (append-only, positive-only)
export function appendRetrievalBytes(sessionDbPath: string, bytes: number, tmp?: string): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;       // 0/failed → không context cost
  try {
    appendFileSync(markerPath(sessionDbPath, tmp), `${Math.floor(bytes)}\n`);
  } catch { /* best-effort — không block response */ }
}

// HOOK side (PostToolUse): sum + delete (consume-once) — phantom-event guard
export function consumeRetrievalBytes(sessionDbPath: string, tmp?: string): number {
  const path = markerPath(sessionDbPath, tmp);
  let total = 0;
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const n = Number.parseInt(line, 10);
      if (Number.isFinite(n) && n > 0) total += n;
    }
    rmSync(path, { force: true });                         // consume-once
  } catch { /* không marker → return 0 */ }
  return total;
}

// chèn vào PostToolUse handler
function onPostToolUse(sessionDbPath: string): void {
  const bytes = consumeRetrievalBytes(sessionDbPath);      // consume-once
  if (bytes > 0) {
    emitTelemetry({ bytes_retrieved: bytes });             // forward → dashboard
  }
}

// Usage:
// SERVER: appendRetrievalBytes(dbPath, 4823);   // ctx_search trả 4823 byte
//         appendRetrievalBytes(dbPath, 1190);   // ctx_fetch_and_index trả 1190
// HOOK:   onPostToolUse(dbPath);                // PostToolUse (Bash) → consume 6013 → emit
//         onPostToolUse(dbPath);                // lần sau → 0 (đã consume, phantom guard)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo được byte của tool không fire hook (own MCP tools) | ❌ Side-channel file (phụ thuộc tmpdir + basename unique) |
| ✅ Consume-once → không double-count (phantom guard) | ❌ Delay: byte forward ở fire kế tiếp (không real-time) |
| ✅ Append-only accumulate (nhiều retrieval giữa 2 fire) | ❌ Tmp file leak nếu hook crash trước delete |
| ✅ Best-effort (marker I/O không phá response) | ❌ Basename collision (hiếm — worktree hash) |

## Khác các hướng gần

| | 466 Citation-Attribution | 432 Cache-Miss-Attribution | RQ: Byte-Marker-Bridge |
|---|---|---|---|
| Cái gì | Citation trong output | Đo cache token | **Byte telemetry qua marker** |
| Kênh | Trong response | Token metric | **Side-channel file** |
| Tool | Có fire hook | Có fire hook | **KHÔNG fire hook (bridge)** |

## Khi nào chọn

- Có tool (own MCP server) không fire PostToolUse → cần đo byte/telemetry
- Server đo được metric nhưng không có hook để forward
- Muốn consume-once (không double-count) + accumulate (nhiều call giữa 2 fire)
- Nối PostToolUse hook (RQ = consume marker) + telemetry (RQ = forward bytes_retrieved); guard stable key (basename cả server/hook resolve cùng file) + consume-once (delete sau đọc, phantom guard) + best-effort (marker I/O không throw vào response) + tmp leak (cleanup nếu hook crash)
