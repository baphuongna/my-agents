# Hướng RK: Server-Side Tool Profiles — MCP server cung cấp 3 tier tool profile per client + fallback chain

> **Nguồn gốc:** codebase-memory-mcp (MCP server tool profiles); "3 tier per client: Scout / Verify / Audit"; "profile-based tool exposure"; "fallback chain when tier unavailable"; "server-side capability negotiation"
> **Coupling:** 🟢 — thêm profile layer vào MCP server tool discovery
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (MCP tool registry sẵn — chưa có tier profile + fallback chain)
> **Effort:** 2-3 tuần

## Nguồn gốc

**codebase-memory-mcp** MCP server expose tool theo **3 tier profile** tùy client capability: **Scout** (read-only — search, browse, lightweight, cho exploration), **Verify** (read + targeted write — fact-check, edit specific, cho verification), **Audit** (full — read/write/delete/admin, cho deep work). Client negotiate profile khi connect (I'm a Scout client → chỉ nhận Scout tools). **Fallback chain**: nếu tool trong tier không khả dụng → fallback xuống tier thấp hơn hoặc generic tool. Nguyên tắc: **tool exposure = right-sized per client** — không cho Scout client destructive tools, không limit Audit client. Khác **083 tool-discovery** (find tools) — RK là **profile-based exposure**; khác **83** (all tools) — RK **tiers**.

## Mô tả

mya server-side tool profiles: (1) **Profile tiers**: Scout (read-only: search, read, grep), Verify (read + targeted write: edit_single, verify_fact), Audit (full: write, delete, bulk_edit, admin). (2) **Client negotiation**: client connect → declare profile (Scout/Verify/Audit) → server expose chỉ tool trong tier đó. (3) **Fallback chain**: tool không khả dụng → fallback (Scout edit_single missing → fallback read + suggest manual; Audit bulk_edit missing → fallback edit_single loop). (4) **Profile enforcement**: client cố gọi tool ngoài tier → deny (Scout client gọi delete → rejected). mya có MCP tool registry — RK thêm **profile definitions** + **negotiation** + **fallback chain** + **enforcement**.

## Kiến trúc

```
  MCP SERVER (tool registry with 3 tiers)
  ┌─────────────────────────────────────────────────────────┐
  │                                                           │
  │  TIER: SCOUT (read-only — exploration)                    │
  │    tools: search, read, grep, list, browse                │
  │    permissions: READ ONLY (no write/delete)                │
  │                                                           │
  │  TIER: VERIFY (read + targeted write — verification)      │
  │    tools: [all Scout] + edit_single, verify_fact,          │
  │           check_import                                    │
  │    permissions: READ + SINGLE WRITE (no bulk/delete)       │
  │                                                           │
  │  TIER: AUDIT (full — deep work)                            │
  │    tools: [all Verify] + write, delete, bulk_edit,         │
  │           admin, reindex                                   │
  │    permissions: FULL ACCESS                                │
  │                                                           │
  └────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                   ▼
  CLIENT: Scout        CLIENT: Verify      CLIENT: Audit
  (exploration)        (fact-check)        (deep work)
        │                  │                   │
        ▼                  ▼                   ▼
  receives:             receives:           receives:
  search, read,         search, read,      ALL tools
  grep, list,           grep, edit_single, (write, delete,
  browse                verify_fact         bulk, admin)
        │                  │                   │
        │ fallback:        │ fallback:        │ fallback:
        │ edit → deny      │ bulk_edit →      │ (none, top
        │ (suggest read)   │   edit loop      │  tier)
        │                  │ delete → deny
        ▼                  ▼                   ▼
  PROFILE ENFORCED     PROFILE ENFORCED    PROFILE ENFORCED
  (Scout can't write)  (Verify can't       (Audit = full)
                       bulk/delete)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ MCP tool registry (packages/agent) — tool discovery (nền — RK = profile on top)
// ✅ 083 tool-discovery — find tools (nền — RK = tiered exposure)
// ✅ tool permissions — basic allow/deny (nền — RK = profile-based)

// ❌ THIẾU: profile tier definitions (Scout/Verify/Audit tool sets)
// ❌ THIẾU: client negotiation (declare profile on connect)
// ❌ THIẾU: fallback chain (tool unavailable → lower tier or generic)
// ❌ THIẾU: profile enforcement (deny out-of-tier tool calls)
```

## Implementation

```typescript
// packages/agent/src/tool-profiles.ts (MỚI)
type ProfileTier = 'scout' | 'verify' | 'audit';

interface ToolDef {
  name: string;
  tier: ProfileTier;
  permissions: string[]; // 'read', 'write', 'delete', 'admin'
  fallback?: string; // fallback tool name if this unavailable
}

class ToolProfileServer {
  // All tools with tier assignment
  private tools: ToolDef[] = [
    // Scout (read-only)
    { name: 'search', tier: 'scout', permissions: ['read'] },
    { name: 'read', tier: 'scout', permissions: ['read'] },
    { name: 'grep', tier: 'scout', permissions: ['read'] },
    { name: 'list', tier: 'scout', permissions: ['read'] },
    // Verify (read + targeted write)
    { name: 'edit_single', tier: 'verify', permissions: ['read', 'write'], fallback: 'read' },
    { name: 'verify_fact', tier: 'verify', permissions: ['read'] },
    // Audit (full)
    { name: 'write', tier: 'audit', permissions: ['read', 'write'], fallback: 'edit_single' },
    { name: 'delete', tier: 'audit', permissions: ['read', 'write', 'delete'] },
    { name: 'bulk_edit', tier: 'audit', permissions: ['read', 'write'], fallback: 'edit_single' },
    { name: 'admin', tier: 'audit', permissions: ['read', 'write', 'delete', 'admin'] },
  ];

  private tierRank: Record<ProfileTier, number> = { scout: 0, verify: 1, audit: 2 };

  // Negotiate: client declares profile → server returns available tools
  negotiate(clientTier: ProfileTier): string[] {
    const rank = this.tierRank[clientTier];
    return this.tools
      .filter(t => this.tierRank[t.tier] <= rank) // include all tiers up to client's
      .map(t => t.name);
  }

  // Check if tool call is allowed for client profile
  isAllowed(toolName: string, clientTier: ProfileTier): boolean {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) return false;
    return this.tierRank[tool.tier] <= this.tierRank[clientTier];
  }

  // Fallback chain: if tool unavailable, find fallback within tier
  getFallback(toolName: string, clientTier: ProfileTier): string | null {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool?.fallback) return null;
    // Check if fallback is in client's tier
    if (this.isAllowed(tool.fallback, clientTier)) return tool.fallback;
    // Recursive fallback
    return this.getFallback(tool.fallback, clientTier);
  }

  // Execute with profile enforcement + fallback
  async execute(
    toolName: string,
    args: unknown[],
    clientTier: ProfileTier,
    runner: (name: string, args: unknown[]) => Promise<unknown>,
  ): Promise<{ ok: boolean; result?: unknown; usedFallback?: string; error?: string }> {
    if (!this.isAllowed(toolName, clientTier)) {
      // Try fallback
      const fb = this.getFallback(toolName, clientTier);
      if (fb) {
        const result = await runner(fb, args);
        return { ok: true, result, usedFallback: fb };
      }
      return { ok: false, error: `tool "${toolName}" not allowed for tier "${clientTier}"` };
    }
    const result = await runner(toolName, args);
    return { ok: true, result };
  }
}

// Usage:
// const server = new ToolProfileServer();
// const scoutTools = server.negotiate('scout');   // [search, read, grep, list]
// const auditTools = server.negotiate('audit');   // ALL tools
// // Scout client tries delete → denied, fallback attempted
// const r = await server.execute('delete', args, 'scout', runner);
// // → ok: false, error: not allowed (no fallback for delete in Scout)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Right-sized exposure (Scout = read-only, Audit = full) | ❌ Profile mismatch (client cần tool ngoài tier) |
| ✅ Fallback chain (tool missing → lower tier or generic) | ❌ Fallback degradation (lower tier = less capable) |
| ✅ Security (Scout can't delete — enforcement) | ❌ Negotiation overhead (profile check mỗi call) |
| ✅ Progressive access (Scout → Verify → Audit upgrade) | ❌ Tier design (sai tier = either too limited or too open) |

## Khác các hướng gần

| | 083 Tool-Discovery | Tool-Permissions | RK: Server-Side-Profiles |
|---|---|---|---|
| Cái gì | Find tools | Allow/deny per tool | **Tier-based exposure + fallback** |
| Granularity | All tools | Per-tool | **Per-profile (Scout/Verify/Audit)** |
| Fallback | ❌ | ❌ | ✅ chain when unavailable |

## Khi nào chọn

- MCP server serve nhiều client type (exploration vs verification vs deep work)
- Muốn right-sized tool exposure (không over-expose destructive tools)
- Cần fallback chain (tool unavailable → graceful degradation)
- Nối MCP tool registry (RK = profile layer) + 083 tool-discovery (RK = tiered on top); guard tier design (chọn tier boundary đúng — Scout read-only, Audit full) + fallback safety (fallback không vô tình escalate)
