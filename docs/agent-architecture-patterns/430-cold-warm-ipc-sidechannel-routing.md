# Hướng PN: Cold-Warm IPC Sidechannel Routing — routing 2 kênh: side-channel IPC nóng, fallback local no-LSP

> **Nguồn gốc:** pi-lens (mcp/ipc.ts — diagnosticsIpcPathForCwd, requestWarmDiagnostics, contentHash; warm-attach.ts — IPC server, net.Server); "IPC side-channel routing"; "named-pipe / unix-socket diagnostics"; "warm server IPC path"; "cold fallback local analysis"
> **Coupling:** 🟡 — thêm IPC side-channel transport vào LSP/diagnostics layer (transport layer cho PM warm branch)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pi-lens IPC path + request/response sẵn — chưa có IPC transport trong mya LSP)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**pi-lens** (`mcp/ipc.ts`, `warm-attach.ts`) route diagnostics qua **side-channel IPC** — channel riêng (Unix socket / named pipe) **không đi qua LSP stdio**. `diagnosticsIpcPathForCwd(cwd)` compute socket path cho mỗi project. Warm server listen trên socket này (`net.Server`), worker connect + send request (`requestWarmDiagnostics` — JSON request với `contentHash` để cache). Response trả về qua socket. **Side-channel** vì: LSP stdio đã dùng cho LSP protocol (JSON-RPC) — không thể multi-channel trên 1 stdio. IPC socket = channel riêng, không conflict. **Cold fallback**: nếu IPC không connect được (warm server chưa start / crashed) → fallback local analysis (no LSP — PN đối ứng PM fresh branch). `contentHash` cho cache: nếu file content không đổi → dùng cached diagnostics (không query server lại). Nguyên tắc: **2 kênh** — IPC nóng (warm server, cross-file) + local fallback (cold, no LSP). Khác **09 pi-rpc-bridge** (RPC bridge) — PN là **IPC side-channel** cho diagnostics.

## Mô tả

mya cold-warm IPC side-channel routing: LSP diagnostics đi qua **2 kênh** — (1) **Side-channel IPC (hot)**: worker connect tới warm server socket (`diagnosticsIpcPathForCwd`), send `requestWarmDiagnostics` (JSON + contentHash), receive response qua socket. Không đi qua LSP stdio (channel riêng, không conflict). `contentHash` cache — file không đổi → cached response (no server query). (2) **Local fallback (cold)**: IPC không connect được (server chưa start/crashed) → fallback local analysis (no LSP, regex/AST). Routing logic: try IPC first → if connect fail → fallback local. mya có LSP/RPC transport — PN thêm **IPC side-channel** (socket path + request/response + contentHash cache + cold fallback).

## Kiến trúc

```
  DIAGNOSTICS REQUEST (worker → warm server)
        │
        ▼
  ┌─── ROUTING ───────────────────────────────────────────┐
  │                                                        │
  │  try SIDE-CHANNEL IPC (hot path):                      │
  │    path = diagnosticsIpcPathForCwd(cwd)                │
  │    → /tmp/pi-lens-ipc-{hash-cwd}/diagnostics.sock      │
  │    connect to socket                                    │
  │    send: {                                              │
  │      cwd, filePath,                                     │
  │      contentHash: "a1b2c3...",  ← cache key             │
  │      schemaVersion: 1                                   │
  │    }                                                    │
  │    receive: { diagnostics: [...] }                      │
  │    ✅ CROSS-FILE (warm server has full project)         │
  │                                                        │
  │  catch (connect FAIL):                                  │
  │    → COLD FALLBACK (local, no LSP):                     │
  │    read file → local analysis (regex/AST)               │
  │    ⚡ FAST but LOCAL (no cross-file)                     │
  │                                                        │
  └────────────────────────────────────────────────────────┘

  WHY SIDE-CHANNEL:
    LSP stdio = JSON-RPC protocol (occupied)
    → can't multiplex diagnostics on same stdio
    → IPC socket = separate channel, no conflict

  CONTENTHASH CACHE:
    file content hash → cached diagnostics
    if hash unchanged → skip server query (return cached)
    if hash changed → query server (content modified)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ LSP / RPC transport (packages/rpc) — RPC bridge (nền — PN = IPC side-channel)
// ✅ 429 PM warm-fresh-dual — dual analysis (nền — PN = transport layer cho PM warm)
// ✅ 09 pi-rpc-bridge — RPC bridge (nền — PN = IPC variant)
// ✅ pi-lens mcp/ipc.ts + warm-attach.ts (source/ — reference impl)

// ❌ THIẾU: IPC socket path (diagnosticsIpcPathForCwd)
// ❌ THIẾU: IPC request/response (requestWarmDiagnostics, contentHash)
// ❌ THIẾU: routing logic (try IPC → fallback local)
// ❌ THIẾU: contentHash cache (skip server if content unchanged)
```

## Implementation

```typescript
// packages/agent/src/ipc-sidechannel.ts (MỚI — port từ pi-lens mcp/ipc.ts)
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

interface WarmDiagnosticsRequest {
  cwd: string;
  filePath: string;
  contentHash: string;
  schemaVersion: number;
}

interface WarmDiagnosticsResponse {
  diagnostics: Array<{ line: number; message: string; severity: string }>;
}

// Compute IPC socket path for a project cwd
function diagnosticsIpcPathForCwd(cwd: string): string {
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `pi-lens-ipc-${hash}`, 'diagnostics.sock');
}

// Compute content hash for cache
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// IPC client: send request, receive response (side-channel)
async function requestWarmDiagnostics(
  req: WarmDiagnosticsRequest,
  timeoutMs = 5000,
): Promise<WarmDiagnosticsResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = diagnosticsIpcPathForCwd(req.cwd);
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify(req));
    });
    socket.setTimeout(timeoutMs);
    let data = '';
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid IPC response')); }
    });
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('IPC timeout'));
    });
  });
}

// IPC server: listen on socket (warm server side)
function createDiagnosticsServer(cwd: string, handler: (req: WarmDiagnosticsRequest) => WarmDiagnosticsResponse): net.Server {
  const socketPath = diagnosticsIpcPathForCwd(cwd);
  const server = net.createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => {
      const req = JSON.parse(data) as WarmDiagnosticsRequest;
      const res = handler(req);
      socket.write(JSON.stringify(res));
      socket.end();
    });
  });
  server.listen(socketPath);
  return server;
}

// Routing: try IPC → fallback local
async function routeDiagnostics(
  cwd: string,
  filePath: string,
  content: string,
  localFallback: () => Promise<WarmDiagnosticsResponse>,
): Promise<{ result: WarmDiagnosticsResponse; source: 'ipc' | 'local' }> {
  try {
    const result = await requestWarmDiagnostics({
      cwd, filePath, contentHash: contentHash(content), schemaVersion: 1,
    });
    return { result, source: 'ipc' };
  } catch {
    // IPC failed (server not running / crashed) → cold fallback
    const result = await localFallback();
    return { result, source: 'local' };
  }
}

// Usage:
// const { result, source } = await routeDiagnostics(cwd, file, content, () => freshDiagnostics(file, content));
// → source: 'ipc' (warm server) or 'local' (cold fallback)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Side-channel (không conflict LSP stdio — channel riêng) | ❌ Socket lifecycle (create/cleanup/reaper) |
| ✅ ContentHash cache (file không đổi → skip server query) | ❌ Platform differences (Unix socket vs named pipe Windows) |
| ✅ Cold fallback (IPC fail → local — degraded mode) | ❌ IPC overhead (connect round-trip nếu cache miss) |
| ✅ Warm server reuse (1 server nhiều worker — shared context) | ❌ Security (socket path guessable — cần permission guard) |

## Khác các hướng gần

| | 09 Pi-RPC-Bridge | 429 PM Warm-Fresh-Dual | PN: IPC-Sidechannel |
|---|---|---|---|
| Cái gì | RPC bridge | Analysis dual branch | **IPC transport cho warm** |
| Channel | RPC (stdio) | Warm + fresh | **Socket side-channel** |
| Cache | ❌ | ❌ | ✅ contentHash |
| Fallback | ❌ | ❌ | ✅ cold local fallback |

## Khi nào chọn

- Warm LSP server cần channel riêng (không conflict LSP stdio JSON-RPC)
- Muốn contentHash cache (file không đổi → skip query)
- Muốn cold fallback (IPC fail → local analysis degraded mode)
- Nối 429 PM warm-fresh-dual (PN = transport layer, PM = analysis logic) + 09 pi-rpc-bridge (PN = IPC variant of RPC); guard socket security (permission, path collision)
