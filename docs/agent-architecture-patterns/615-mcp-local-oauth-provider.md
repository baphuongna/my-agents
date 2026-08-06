# Hướng WQ: MCP Local OAuth Provider — local callback OAuth provider; redirect URI đích 127.0.0.1 xử lý local

> **Nguồn gốc:** opencode `MCP OAuth` (local callback OAuth provider; redirect URI `127.0.0.1` xử lý local — không cần public server); "local callback OAuth", "redirect URI 127.0.0.1", "handle OAuth locally" | **Coupling:** 🟡 — thêm local OAuth callback server vào MCP/gateway auth | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (gateway + secrets sẵn — chưa có local OAuth callback + 127.0.0.1 redirect) | **Effort:** 2-3 tuần

## Nguồn gốc

**opencode** MCP server cần **OAuth** để authenticate (vd GitHub MCP cần token). Thay vì public redirect URI (cần domain + HTTPS), dùng **local callback**: (1) Spawn **local HTTP server** trên `127.0.0.1:PORT`. (2) OAuth redirect URI = `http://127.0.0.1:PORT/callback`. (3) User authorize → provider redirect về `127.0.0.1` → local server **bắt callback** → extract `code`. (4) Exchange code → token → store local. Lợi ích: **không cần public server** — toàn bộ flow xử lý local (loopback), an toàn (token không lọt network ngoài). Nguyên tắc: **loopback OAuth + local callback handler**.

## Mô tả

mya MCP local OAuth provider: (1) **Local callback server**: spawn HTTP server trên `127.0.0.1:random_port`. (2) **Redirect URI**: `http://127.0.0.1:PORT/callback` → đăng ký với OAuth provider. (3) **Authorize flow**: mở browser → user authorize → redirect về local → server bắt `code`. (4) **Token exchange**: code → POST provider → access token → store (SecretStore). (5) **Cleanup**: server close sau khi nhận token. mya có gateway + secrets — WQ thêm **local OAuth callback server** + **127.0.0.1 redirect** + **token exchange**.

## Kiến trúc

```
  ┌─── 1. SPAWN LOCAL SERVER (127.0.0.1) ────────────────┐
  │  server = listen("127.0.0.1", randomPort)             │
  │  redirectURI = "http://127.0.0.1:PORT/callback"       │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── 2. OPEN BROWSER (authorize URL) ──────────────────┐
  │  url = provider.authorizeURL(redirectURI, state)      │
  │  open(url) → browser → user login → authorize         │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── 3. PROVIDER REDIRECT → 127.0.0.1 ─────────────────┐
  │  provider redirect: http://127.0.0.1:PORT/callback    │
  │    ?code=AUTH_CODE&state=XYZ                           │
  │  → LOCAL SERVER bắt callback                           │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── 4. EXCHANGE code → token ─────────────────────────┐
  │  token = provider.exchange(code, clientSecret)        │
  │  → access_token: "xxx", refresh_token: "yyy"          │
  │  → store SecretStore (local, không leak)              │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── 5. CLEANUP ───────────────────────────────────────┐
  │  server.close() → local server shutdown               │
  │  MCP server dùng token authenticate                   │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway — gateway/HTTP (nền — WQ local server ở đây)
// ✅ packages/secrets SecretStore — secret store (nền — WQ token store)
// ✅ packages/180 agent-identity-oauth — OAuth pattern (nền — WQ reference)
// ✅ packages/core redact.ts — redaction (nền — WQ token redact)

// ❌ THIẾU: local callback HTTP server (127.0.0.1 listener)
// ❌ THIẾU: redirect URI registration (127.0.0.1:PORT/callback)
// ❌ THIẾU: code→token exchange flow
// ❌ THIẾU: browser-open + state validation (CSRF guard)
```

## Implementation

```typescript
// packages/gateway/src/mcp-local-oauth.ts (MỘI)
import { createServer, Server } from "node:http";
import { randomUUID } from "node:crypto";

interface OAuthConfig {
  authorizeURL: string;   // provider authorize endpoint
  tokenURL: string;       // provider token exchange endpoint
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

class McpLocalOAuth {
  private server?: Server;

  // run full local OAuth flow → return access token
  async authenticate(config: OAuthConfig, storeToken: (t: string) => void): Promise<string> {
    const port = 0; // OS assign free port
    const redirectURI = `http://127.0.0.1:${port}/callback`;
    const state = randomUUID(); // CSRF guard

    // 1. spawn local server → wait callback
    const code = await new Promise<string>((resolve, reject) => {
      this.server = createServer((req, res) => {
        const url = new URL(req.url ?? "", redirectURI);
        if (url.pathname !== "/callback") { res.writeHead(404); return res.end(); }
        if (url.searchParams.get("state") !== state) { res.writeHead(400); return res.end("state mismatch"); }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h1>Auth successful. Close this tab.</h1>");
        const authCode = url.searchParams.get("code");
        authCode ? resolve(authCode) : reject(new Error("no code"));
      });
      this.server.listen(port, "127.0.0.1");
      this.openBrowser(`${config.authorizeURL}?response_type=code&client_id=${config.clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectURI)}&scope=${config.scopes.join(" ")}&state=${state}`);
    });

    // 2. exchange code → token → store local
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectURI, client_id: config.clientId, client_secret: config.clientSecret });
    const tokenRes = await fetch(config.tokenURL, { method: "POST", body });
    const token = (await tokenRes.json() as { access_token: string }).access_token;
    storeToken(token);
    this.server?.close();
    return token;
  }

  private openBrowser(url: string): void { /* platform-specific open */ }
}

// Usage:
// const oauth = new McpLocalOAuth();
// const token = await oauth.authenticate(githubConfig, t => secretStore.set("GITHUB_MCP_TOKEN", t));
```

## Được

- ✅ No public server (127.0.0.1 loopback — không cần domain/HTTPS)
- ✅ Secure (token không lọt network ngoài — local exchange)
- ✅ Standard flow (browser authorize → callback → exchange — familiar UX)
- ✅ Reusable (mỗi MCP provider cùng flow — chỉ đổi config)

## Mất

- ❌ Port conflict (127.0.0.1:PORT bị chiếm → random port fallback)
- ❌ Browser dependency (headless/CI → không mở browser được)
- ❌ Timeout (user không authorize → server hang → cần timeout)
- ❌ Token refresh (access token expire → cần refresh flow)

## Khác

Khác **541 TU request-scoped-secrets** (caller provide secret) — WQ **OAuth flow** (user authorize → obtain token). Khác **180 agent-identity-oauth** (agent identity OAuth) — WQ **MCP-specific local** (loopback callback cho MCP provider). Khác **public redirect** (domain + HTTPS) — WQ **loopback 127.0.0.1** (local, simpler).

## Khi nào chọn

- MCP provider cần OAuth (GitHub, Google, Slack MCP) → local callback flow
- Không có public server/domain → 127.0.0.1 loopback
- Muốn secure (token local, không network ngoài)
- Nối packages/gateway + packages/secrets SecretStore + 180 agent-identity-oauth + packages/core redact.ts; guard state-validation (CSRF — state match), timeout-handling (user không authorize → graceful timeout), và token-refresh (expire → refresh flow); WQ = MCP local OAuth provider, kết hợp 541 TU request-scoped-secrets (secret transport) + 180 agent-identity-oauth (OAuth pattern)
