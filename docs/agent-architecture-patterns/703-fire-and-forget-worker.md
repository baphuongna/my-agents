# Hướng AAA: Fire-and-Forget Worker — extension process gửi observation bất đồng bộ tới worker process riêng qua HTTP timeout ngắn

> **Nguồn gốc:** claude-mem (docs/public/architecture/hooks.mdx) | **Coupling:** 🟢 — thêm worker process riêng, transport qua HTTP fire-and-forget | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có bg-runner + RPC TCP — chưa có HTTP fire-and-forget worker) | **Effort:** 1-2 tuần

## Nguồn gốc

**claude-mem** dùng kiến trúc **hai process**: extension process (chạy trong IDE, vòng đời ngắn) gửi **HTTP fire-and-forget** (timeout 2s) tới **worker process riêng** (Bun-managed, port 37777) để xử lý observation bất đồng bộ. Điểm mấu chốt: extension không chờ kết quả — gửi xong là trả về ngay; nếu worker chậm hoặc chết, extension không bị block. **Session state sống sót qua IDE restart** vì nó nằm trong worker process độc lập, không phải trong extension. Nguyên tắc: **tách vòng đời ngắn (IDE) khỏi vòng đời dài (state/memory)** — worker là nơi duy nhất giữ state bền.

## Mô tả

mya fire-and-forget worker: `mya --bg` hiện có (packages/print bg-runner.ts) đã làm TCP RPC — AAA thêm **HTTP endpoint fire-and-forget**: extension/CLI process gọi `POST /observe` với observation (turn_end, tool output…), timeout 2s, không đọc response body. Worker (process riêng) nhận, đẩy vào hàng đợi xử lý (auto-capture, memory store), trả `202 Accepted` ngay. Session state nằm trong worker (memory.db + JSONL) — IDE restart không mất. Dùng HTTP thay vì TCP RPC vì: client có sẵn (fetch), timeout dễ set, không cần framing protocol riêng.

## Kiến trúc

```
  IDE EXTENSION / CLI (vòng đời ngắn)
        │
        │  POST /observe {observation}  (fire-and-forget, timeout 2s)
        ▼
  WORKER PROCESS (vòng đời dài — Bun/Node, port 37777)
        │
        ▼
  ┌─── OBSERVATION QUEUE ─────────────────────────────┐
  │  202 Accepted ngay → queue xử lý bất đồng bộ:      │
  │   ├─ auto-capture (memory)                        │
  │   ├─ memory store (sqlite)                        │
  │   └─ session JSONL (state bền — sống qua restart) │
  └────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print bg-runner.ts — mya --bg background session (process riêng)
// ✅ packages/rpc tcp-server.ts — TCP RPC server (nền — AAA dùng HTTP thay)
// ✅ packages/memory auto-capture.ts — pattern-based extraction (nền cho observation)
// ✅ packages/intercom broker.ts — process nền + manifest (nền cho worker discovery)
// ✅ packages/core spill.ts — LargeValueRef (payload lớn không chặn wire)

// ❌ THIẾU: HTTP endpoint fire-and-forget (POST /observe, 202)
// ❌ THIẾU: queue + xử lý bất đồng bộ tách khỏi request
// ❌ THIẾU: session state trong worker (hiện session trong agent process)
```

## Implementation

```typescript
// packages/print/src/observe-server.ts (NEW)
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

export interface Observation { kind: string; payload: unknown; ts: number }

export function startObserveServer(
  ingest: (o: Observation) => void,
  port = 37777,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/observe") {
      res.writeHead(404).end(); return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const obs = JSON.parse(body) as Observation;
        ingest({ ...obs, ts: obs.ts ?? Date.now() }); // vào queue — không await
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true, id: randomUUID() }));
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        port,
        stop: () => new Promise((r) => server.close(() => r())),
      }),
    );
  });
}

// Client — fire-and-forget, timeout 2s, không đọc body
export async function fireAndForget(url: string, obs: Observation): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2_000);
  try {
    await fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(obs),
    });
  } catch { /* fire-and-forget: lỗi không block caller */ }
  finally { clearTimeout(t); }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Session state sống sót qua IDE restart | ❌ Hai process — thêm điểm quản lý (spawn/health) |
| ✅ Extension không bao giờ bị block (2s timeout) | ❌ Observation có thể rớt nếu worker chết |
| ✅ HTTP chuẩn — client rẻ (fetch), dễ test | ❌ Phải chống trùng khi worker restart (idempotency) |
| ✅ Worker riêng — crash không kéo IDE theo | ❌ Port cố định dễ đụng — cần manifest/port rơi |

## Khác các hướng gần

| | TCP RPC (bg-runner) | AAA: HTTP Fire-and-Forget |
|---|---|---|
| Giao thức | TCP + framing riêng | **HTTP chuẩn (fetch sẵn)** |
| Chờ kết quả | Có (round-trip) | **Không (202 ngay)** |
| Vòng đời state | Trong agent process | **Trong worker riêng** |
| Mối quan hệ | Có sẵn — AAA là variant bất đồng bộ | **Bổ sung cho observation path** |

## Khi nào chọn

- Extension/CLI cần gửi observation mà không muốn block vòng đời ngắn
- Session state phải sống sót qua restart (IDE/CLI chết không mất memory)
- Đã có bg-runner/RPC — thêm HTTP fire-and-forget cho observation path
- Dùng 202 + queue để decouple; thêm idempotency key (observation id) để chống trùng khi worker restart
