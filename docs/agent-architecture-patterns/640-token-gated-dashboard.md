# Hướng XP: Token-Gated Dashboard — Dev server sinh one-time token in ra terminal; mọi data endpoint đòi ?token= khớp mới 200, cộng path allowlist suy từ graph

> **Nguồn gốc:** Understand-Anything (dev dashboard auth) | **Coupling:** 🟡 — thêm token gate + path allowlist vào web dashboard | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có web dashboard + signing — chưa có one-time token gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**Understand-Anything** serve dashboard dev server nhưng không mở port trần. Khi khởi động, server **sinh one-time token** (random) và **in ra terminal** (chỉ người chạy server thấy). Mọi **data endpoint** đòi query `?token=` khớp mới trả `200`, sai → `401`. Ngoài token, có **path allowlist** — server suy ra từ code graph những path nào được phép expose (chỉ path trong graph, không arbitrary file). Nguyên tắc: **token bind process + path allowlist từ graph** — không ai đọc data nếu không có token (chỉ local user) và không truy cập path ngoài graph.

## Mô tả

mya token-gated dashboard: dev server (dashboard visualization) khởi động → sinh one-time token in ra stdout → mọi `/api/data/*` middleware check `?token=` → sai 401. Thêm **path allowlist**: endpoint chỉ serve path tồn tại trong codegraph (suy từ graph node), path ngoài graph → 403. mya có packages/web (dashboard React) + packages/signing (crypto) — XP thêm **one-time token middleware** + **graph-derived allowlist**.

## Kiến trúc

```
  ┌─── SERVER STARTUP ─────────────────────────────────────┐
  │  token = randomBytes(32).toString("hex")                 │
  │  console.log("Dashboard token: " + token)  ← chỉ terminal│
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── ALLOWLIST (suy từ graph) ───────────────────────────┐
  │  graph.nodes → Set<path>  ← chỉ path trong graph expose │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  REQUEST GET /api/data/src/a.ts?token=XYZ
        │
        ▼
  ┌─── MIDDLEWARE (2 check) ───────────────────────────────┐
  │  1. token == XYZ?     ❌ → 401 Unauthorized              │
  │  2. path ∈ allowlist? ❌ → 403 Forbidden (ngoài graph)   │
  │  ✓ → 200 + data                                          │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/web — dashboard server (nền — XP gate middleware ở đây)
// ✅ packages/signing — crypto/signing (nền — XP token gen analog)
// ✅ packages/tools codegraph.ts — graph (nền — XP allowlist suy từ node)
// ✅ packages/secrets — secret store (nền — XP token lưu tạm)

// ❌ THIẾU: one-time token gen + in ra terminal
// ❌ THIẾU: token-check middleware (?token= khớp → 200)
// ❌ THIẾU: graph-derived path allowlist (path ∈ graph node)
```

## Implementation

```typescript
// packages/web/src/token-gate.ts (MỚI)
import { randomBytes, timingSafeEqual } from "node:crypto";

function issueToken(): string {
  const token = randomBytes(32).toString("hex");
  console.log(`\n  🔑 Dashboard token: ${token}\n`); // chỉ terminal local
  return token;
}

function makeTokenMiddleware(expected: string) {
  return (req: { query: { token?: string } }, res: { status: (n: number) => void; end: () => void }, next: () => void) => {
    const got = req.query.token ?? "";
    // timingSafeEqual chống timing attack
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      res.status(401);
      res.end();
      return;
    }
    next();
  };
}

function makeAllowlistMiddleware(allowlist: Set<string>) {
  return (req: { params: { path: string } }, res: { status: (n: number) => void; end: () => void }, next: () => void) => {
    if (!allowlist.has(req.params.path)) {
      res.status(403); // path ngoài graph
      res.end();
      return;
    }
    next();
  };
}

function allowlistFromGraph(nodes: Iterable<string>): Set<string> {
  return new Set(nodes); // chỉ path trong graph expose
}

// Usage:
// const token = issueToken();
// const allowlist = allowlistFromGraph(graph.edges.keys());
// app.use("/api/data/:path", makeTokenMiddleware(token));
// app.use("/api/data/:path", makeAllowlistMiddleware(allowlist));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero-config auth (token in terminal, không setup password) | ❌ Token leak (terminal scroll/log → ai cũng thấy) |
| ✅ Path allowlist (chỉ graph path expose, không arbitrary) | ❌ Allowlist stale (graph chưa update → path hợp lệ bị 403) |
| ✅ Timing-safe (timingSafeEqual chống timing attack) | ❌ Token không rotate (one-time, restart mới đổi) |
| ✅ Bind process (ai có token = ai chạy server) | ❌ No HTTPS (dev local — token qua HTTP rõ) |

## Khác các hướng gần

| | Open port | Basic auth | OAuth | XP: Token + Allowlist |
|---|---|---|---|
| Setup | none | password | full OAuth | **zero-config (print)** |
| Path scoping | ❌ | ❌ | ❌ | **✅ graph allowlist** |
| Local-first | ✅ | ❌ | ❌ | **✅ (terminal)** |

## Khi nào chọn

- Dev server expose dashboard/data local (không muốn mở port trần)
- Muốn zero-config auth (không setup password/OAuth — chỉ in token terminal)
- Cần path scoping (chỉ path trong graph expose — không arbitrary file read)
- Nối packages/web + packages/signing + packages/tools codegraph.ts + packages/secrets; guard token-rotation (regenerate token + invalidate cũ khi nhạy cảm), allowlist-freshness (rebuild allowlist khi graph update), và no-log-token (không log token ra file — chỉ stdout ephemeral); XP = token-gated dashboard, kết hợp 640 web dashboard + 642 XR topology-driven-tours (tour consume graph qua gated endpoint) + 644 XT worktree-output-redirect (dashboard serve main repo root)
