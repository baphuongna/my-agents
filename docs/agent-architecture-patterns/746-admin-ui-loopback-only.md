# Hướng ABR: Admin UI Loopback-Only — control plane chỉ nghe loopback, giới hạn attack surface

> **Nguồn gốc:** free-claude-code (README.md) | **Coupling:** 🟢 — thêm bind policy + auth cho admin surface | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có gateway loopback guard — chưa có admin surface riêng) | **Effort:** 1 tuần

## Nguồn gốc

**free-claude-code** đặt **Admin UI tại `/admin` chỉ nghe loopback** (127.0.0.1) — control plane không expose ra mạng ngoài. Admin UI cho phép **sửa proxy settings**, **validate thay đổi**, và **check provider** — nhưng chỉ từ máy local (loopback). Mục đích: **giới hạn attack surface của control plane** — kẻ tấn công từ mạng không thể chạm tới trang admin (không có route từ ngoài), settings/proxy chỉ đổi được từ máy chủ. Nguyên tắc: **control plane tách khỏi data plane, loopback-only bind, admin actions có validate**.

## Mô tả

mya admin UI loopback-only: control plane (admin surface) **bind loopback** — chỉ 127.0.0.1; các route `/admin/*` (sửa settings, proxy config, provider check) **không lắng nghe trên interface mạng ngoài**. Admin actions đều có **validate** (thay đổi được kiểm tra trước khi áp dụng). mya có packages/gateway index.ts với **loopback guard** (từ chối non-loopback bind khi chưa opt-in — M8 fix) + control.ts (control plane) — ABR thêm **admin surface tách riêng** + **loopback-only policy** + **validate-before-apply**.

## Kiến trúc

```
  MẠNG NGOÀI (internet / LAN)
  ┌──────────────────────────────┐
  │  attacker ──✗──► /admin      │  ← KHÔNG tới được (loopback only)
  └──────────────────────────────┘
                │ (không route từ ngoài)
                ▼
  LOOPBACK (127.0.0.1 — chỉ máy local)
  ┌──────────────────────────────────────────┐
  │  Admin UI /admin                         │
  │    ├─ sửa proxy settings ──► validate    │
  │    ├─ check provider ──────► health      │
  │    └─ validate thay đổi ───► apply       │
  │  → control plane chỉ local               │
  └──────────────────────────────────────────┘
                │
                ▼
  DATA PLANE (provider calls, agent traffic — mạng cho phép)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway index.ts — loopback guard (từ chối non-loopback bind, M8) (nền — ABR policy)
// ✅ packages/gateway control.ts — control plane (sessions/cron/config/tools) (nền — ABR admin)
// ✅ packages/gateway gateway-types.ts — host option + loopback default (nền — ABR bind)
// ✅ packages/web — dashboard SPA (nền — ABR admin UI host)

// ❌ THIẾU: admin surface tách riêng (route /admin với policy riêng)
// ❌ THIẾU: validate-before-apply (thay đổi settings được validate trước khi áp dụng)
// ❌ THIẾU: admin auth (loopback + thêm auth layer cho admin actions)
```

## Implementation

```typescript
// packages/gateway/src/admin-surface.ts (MỚI)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", ""]);

export interface AdminSetting { key: string; value: unknown; validate: (v: unknown) => string | null }

/** Admin surface: chỉ lắng nghe loopback — control plane không ra mạng ngoài. */
export class AdminSurface {
  private settings = new Map<string, AdminSetting>();
  private server: ReturnType<typeof createServer> | null = null;

  register(setting: AdminSetting): void { this.settings.set(setting.key, setting); }

  /** Bind loopback-only: từ chối nếu host không phải loopback. */
  listen(port: number, host = "127.0.0.1"): Promise<number> {
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(`admin: refuse non-loopback bind ${host} — control plane chỉ local`);
    }
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith("/admin")) { res.writeHead(404); res.end(); return; }
      void this.handleAdmin(req, res);
    });
    return new Promise(resolve => this.server!.listen(port, host, () => {
      resolve((this.server!.address() as { port: number }).port);
    }));
  }

  /** Admin action: validate trước, apply sau — thay đổi hỏng bị chặn. */
  private async handleAdmin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, "http://127.0.0.1");
    const key = url.searchParams.get("key") ?? "";
    const setting = this.settings.get(key);
    if (!setting) { res.writeHead(404); res.end("unknown setting"); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    const value = JSON.parse(body || "null") as unknown;
    const error = setting.validate(value);
    if (error) { res.writeHead(400); res.end(`invalid: ${error}`); return; } // validate chặn
    this.settings.set(key, { ...setting, value });                            // apply
    res.writeHead(200); res.end(`applied ${key}`);
  }
}
// Usage:
// const admin = new AdminSurface();
// admin.register({ key: "proxy.timeout", value: 30, validate: v => typeof v === "number" && v > 0 ? null : "must be > 0" });
// await admin.listen(8080, "127.0.0.1"); // loopback only — mạng ngoài không tới
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Attack surface nhỏ (control plane không ra mạng ngoài) | ❌ Remote admin khó (muốn quản lý từ xa phải tunnel) |
| ✅ Validate trước apply (settings hỏng bị chặn) | ❌ Loopback giả (reverse proxy có thể expose /admin ra ngoài) |
| ✅ Bind policy rõ (từ chối non-loopback khi chưa opt-in) | ❌ Auth thiếu (loopback ≠ đủ — process local khác vẫn gọi được) |
| ✅ Zero LLM cost (admin thuần HTTP) | ❌ Port management (admin port riêng hay dùng chung gateway port) |

## Khác các hướng gần

| | Admin không có | Admin mở mạng | ABR: Loopback-Only Admin |
|---|---|---|---|
| Attack surface | — | lớn (ai cũng tới) | **chỉ máy local** |
| Remote admin | không | có | **tunnel nếu cần** |
| Validate | — | tùy | **validate trước apply** |
| Bind policy | — | mở | **từ chối non-loopback** |

## Khi nào chọn

- Control plane (settings/proxy/config) không nên expose ra mạng
- Admin user chỉ ở máy local (dev tool, agent host)
- Muốn validate thay đổi trước khi apply (không để setting hỏng làm sập)
- Nối packages/gateway index.ts loopback-guard + control.ts + gateway-types.ts + packages/web; guard bind-policy (mọi admin surface dùng chung policy loopback — không sót route), auth-layer (loopback chỉ là lớp 1 — thêm token cho admin actions), và validate-completeness (mọi setting có validate — không setting nào apply mù); ABR = admin UI loopback-only, kết hợp 746-family free-claude-code control plane với gateway loopback guard M8 (đã có trong packages/gateway)
