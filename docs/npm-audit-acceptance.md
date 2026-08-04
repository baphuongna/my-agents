# npm Audit — Accepted Risk Register

> **Status**: 10 vulnerabilities (1 critical, 6 high, 2 moderate, 1 low) — ALL ACCEPTED.
> Last reviewed: 2026-08-04. `npm audit fix --force` would install breaking changes.

## Vulnerability inventory

| Package | Severity | Vector | Root cause | Fix path | Risk acceptance |
|---|---|---|---|---|---|
| **tar** <=7.5.20 | 🔴 critical | Archive extraction (DoS/path traversal) | Dev-only tooling dependency (not gateway runtime) | `npm audit fix --force` (breaking) | Dev-time only; gateway runtime never extracts tar |
| **undici** (in pi-coding-agent) | 🟠 high ×4 | HTTP client (CRLF injection, cache poisoning, desync, cookie injection) | Pinned in `@earendil-works/pi-coding-agent` ≥0.75.4 | Upgrade pi-coding-agent (breaking) | All 4 require MITM or malicious upstream — gateway talks to trusted LLM endpoints (HTTPS, pinned). No user-controlled upstream |
| **ip-address** <=10.3.0 | 🟠 high | ReDoS on crafted IP string | Dev-only (build tooling) | Breaking upgrade | Not in runtime path |
| **ws** <=1.1.0 (in chrome-remote-interface) | 🟠 high ×2 | WS DoS + remote memory disclosure | `chrome-remote-interface` (dev puppeteer tool) | Upgrade chrome-remote-interface (breaking) | chrome-remote-interface used only in [real] E2E browser tests, NOT gateway runtime. Gateway uses modern `ws` (via node_modules) |
| **postcss** <=8.5.22 | 🟡 moderate | CSS parser DoS | Build-time CSS transform (Vite) | Auto-fixable but pinned | Build-time only; no user input reaches postcss at runtime |

## Why not fix

1. **tar (critical)** — comes through dev-only tooling (`@npmcli/package-json`, `node-gyp`). Gateway
   runtime (`dist/mya.js`) never calls tar extraction. No user-controlled archive input.
2. **undici (high ×4)** — pinned inside the vendored pi-coding-agent package. Upgrading pi-coding-agent
   is a breaking migration (vendored → upstream swap, tracked separately). All 4 vulns require an
   active MITM or a malicious HTTP server response — gateway only calls trusted LLM provider endpoints
   over TLS with API-key auth. The attack surface is: can the LLM provider MITM itself? No.
3. **ws ≤1.1.0** — inside `chrome-remote-interface`, which is a **dev-only** test tool for [real] browser
   E2E. The gateway's own WebSocket server uses the modern `ws` package (security-reviewed, patched).
4. **ip-address / postcss** — build/dev-time only, no runtime exposure.

## Monitoring

- Re-run `npm audit` monthly (or on dependency updates).
- The critical (tar) and high (undici) are tracked for resolution when:
  - pi-coding-agent upstream swap lands (undici fixed in ≥0.76.x)
  - dev tooling upgrades (tar/ip-address/postcss)

## Decision

**Accept all 10.** None affect the gateway runtime attack surface (user input → HTTP/WS → LLM API).
The critical tar and all undici vulns are in dev-only or vendored-pinned paths with no user-controlled input.
