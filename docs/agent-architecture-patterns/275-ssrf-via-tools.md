# Hướng JO: SSRF Prevention — chặn tool fetch vào mạng nội bộ/metadata, giới hạn egress

> **Nguồn gốc:** OWASP "Server-Side Request Forgery"; AWS "IMDSv2" (SSRF protection cho metadata endpoint 169.254.169.254); Google Cloud "metadata endpoint protection"; PortSwigger SSRF cheat sheet; Cloudflare SSRF protection; "SSRF in LLM agents" (tool fetch URL có thể truy cập internal); DNS rebinding attacks
> **Coupling:** 🟡 — chèn URL validator/proxy tại tool fetch boundary
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (fetch tool sẵn — chưa có allowlist/blocklist URL)
> **Effort:** 1-3 tuần

## Nguồn gốc

SSRF (OWASP): server fetch URL do attacker cung cấp → truy cập internal resource (localhost, private IP, cloud metadata 169.254.169.254 lấy credential). AWS IMDSv2 yêu cầu token challenge — chống SSRF đọc metadata. Đối với agent: tool web-browsing/fetch nhận URL từ LLM (có thể từ user input hoặc prompt injection) → LLM có thể bị lừa fetch `http://169.254.169.254/latest/meta-data/` → lộ credential cloud. PortSwigger: blocklist dễ bypass (DNS rebinding, IP encoding `2130706433` = 127.0.0.1, redirect chain) — prefer **allowlist**. Cloudflare: validate DNS resolve → chặn nếu IP nội bộ (phải check *sau* DNS resolve, không phải host string). Khác **69 BQ agentic firewall** (chống prompt injection) — JO chặn *network egress cụ thể*; khác **168 FL guardrails** (chặn hành động nguy hiểm chung) — JO chuyên *URL/network*; khác **JN (274) containerized** (cô lập toàn resource) — JO chỉ network layer.

## Mô tả

mya SSRF prevention: mọi tool fetch URL phải qua validator — parse URL → resolve DNS → check IP không thuộc private/metadata range (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7) → chỉ allowlist domain hoặc deny private. Fetch qua proxy bắt buộc (cho audit + chặn DNS rebinding: re-resolve sau connect). mya có web-browsing tool (217) và firewall BQ — JO thêm egress validator layer + metadata-block (169.254).

## Kiến trúc

```
  TOOL FETCH (url từ LLM/user)
        │
        ▼
  URL PARSE ──► host, scheme (chỉ http/https)
        │
        ▼
  DNS RESOLVE ──► IPs
        │
        ▼
  IP CHECK ──► chặn private/metadata:
   │   127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, 0.0.0.0
        │   (chặn sau resolve — chống DNS rebinding/encoding bypass)
        ▼
  ALLOWLIST? ──► fetch qua EGRESS PROXY (re-resolve sau connect — chặn rebinding)
        │
        ▼
  RESPONSE (sanitize headers/body — không rò credential)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 217 web-browsing tool — fetch URL (sẵn chỗ chèn validator)
// ✅ 69 BQ agentic firewall — injection defense (nền)
// ✅ 168 FL guardrails — hành động nguy hiểm (nền)
// ✅ JN (274) container — network isolation (bổ sung)

// ❌ THIẾU: URL/IP validator (private + metadata range)
// ❌ THIẾU: egress proxy (re-resolve chống DNS rebinding)
// ❌ THIẾU: allowlist domain (prefer over blocklist — PortSwigger)
// ❌ THIẾU: redirect-follow check (mỗi hop re-validate IP)
```

## Implementation

```typescript
// packages/ssrf-guard/src/check.ts (NEW)
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
const BLOCKED = ["127.0.0.0/8","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16",
                 "169.254.0.0/16","0.0.0.0/8","::1/128","fc00::/7"]; // + metadata
export async function assertSafeUrl(raw: string): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
  if (!ALLOWLIST.has(u.hostname)) throw new Error("not allowlisted");   // prefer allowlist
  const { address } = await lookup(u.hostname);                          // resolve
  if (BLOCKED.some(c => ipaddr.parse(address).range() === "private" ||
        isInSubnet(address, c))) throw new Error("private/metadata");    // check IP
} // fetch qua proxy re-resolve sau connect — chống DNS rebinding; re-check mỗi redirect hop
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn lộ credential cloud (IMDSv2/metadata) | ❌ Allowlist tắt — agent duyệt site mới bị chặn |
| ✅ Chặn truy cập internal service (OWASP) | ❌ DNS rebinding cần re-resolve sau connect (phức) |
| ✅ Audit egress qua proxy (mọi fetch tracked) | ❌ IP encoding/redirect bypass — phải check mỗi hop |
| ✅ Prefer allowlist — chống bypass (PortSwigger) | ❌ IPv6 edge case (::1, fc00::/7) dễ quên |

## Khác các hướng gần

| | 69 BQ Firewall | 168 FL Guardrails | JN Container | JO: SSRF |
|---|---|---|---|---|
| Chặn gì | Prompt injection | Hành động nguy hiểm | Toàn resource | **Network egress cụ thể** |
| Layer | Input | Action | Runtime | **URL/IP tại fetch** |
| Phương thức | Sanitize/tách | Quyền/rào | Namespace | **Allowlist + IP check** |

## Khi nào chọn

- Tool fetch URL từ LLM/user (web-browsing 217, research) — buộc có
- Agent chạy trên cloud (metadata endpoint rủi ro) — chặn 169.254
- Luôn: allowlist (không blocklist), check IP *sau* DNS resolve, re-check redirect hop, fetch qua proxy audit
- Không bỏ qua: DNS rebinding/encoding/redirect là bypass kinh điển — blocklist đơn thuần không đủ
