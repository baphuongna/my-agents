# Hướng LX: Tool Discovery Gateway — registry thống nhất tìm tool từ nhiều nguồn

> **Nguồn gốc:** Service discovery (Consul, etcd, DNS-SD); API gateway aggregation; MCP (Model Context Protocol) server discovery; tool marketplace; UDDI registry; "unified tool registry"; plugin discovery (VS Code, IntelliJ)
> **Coupling:** 🟡 — thêm discovery gateway layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool-registry sẵn — chưa có multi-source discovery)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**Service discovery** (Consul, etcd): service đăng ký → consumer tìm qua registry thay vì hardcode. **API gateway aggregation**: một endpoint tổng hợp nhiều backend. **MCP server discovery**: agent kết nối MCP server → tự động list tool. **Plugin discovery** (VS Code marketplace): tìm extension từ nhiều nguồn → install → dùng. Nguyên tắc: **một gateway tìm tool từ nhiều nguồn** (local, MCP, remote marketplace, plugin) — agent không cần biết tool ở đâu. Khác **40 tool-registry** (local registry) — LX **discovery gateway** tổng hợp multi-source; khác **288 tool-polyfill-fallback** (thay thế tool thiếu) — LX **tìm tool mới**; khác **101 dynamic-tool-selection** (chọn tool nào) — LX **tìm tool từ đâu**.

## Mô tả

mya tool discovery gateway: agent hỏi gateway "tôi cần tool đọc PDF" → gateway search multi-source (local registry, MCP servers, plugin marketplace) → trả danh sách tool match → agent chọn + auto-load. Gateway cache metadata, health-check tool (sống/chết), version negotiate. mya có 40 tool-registry (local) — LX thêm **multi-source discovery** (MCP, remote, plugin). Nối 337 context-tool-reco — LX là **discovery infra**, 337 là **recommendation logic**.

## Kiến trúc

```
  AGENT: "tôi cần tool đọc PDF"
        │
        ▼
  ┌──── TOOL DISCOVERY GATEWAY ──────────────────┐
  │                                              │
  │  QUERY: "read PDF"                           │
  │        │                                     │
  │  ┌─────┼──────────┬──────────┬─────────┐    │
  │  │     │          │          │         │    │
  │  ▼     ▼          ▼          ▼         ▼    │
  │ LOCAL  MCP        REMOTE     PLUGIN    BUILT-IN│
  │ reg    servers    market     store             │
  │  │      │          │          │                │
  │  └──────┴──────────┴──────────┘                │
  │        │                                     │
  │        ▼ merge + rank + health-check         │
  │  RESULTS:                                    │
  │   · pdf-reader (local, v2, ✅ healthy)        │
  │   · mcp-pdf-extract (MCP, v1, ✅)             │
  │   · pdf-toolkit (remote, v3, ❌ offline)      │
  │        │                                     │
  │   agent chọn → auto-load → dùng              │
  └──────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 40 tool-registry — local tool registry (nền discovery)
// ✅ 04 shell-mcp — MCP bridge (MCP source)
// ✅ 101 dynamic-tool-selection — chọn tool (nền — LX tìm nguồn)
// ✅ 288 tool-polyfill-fallback — fallback tool (nền)
// ✅ 189 interoperability-protocols — protocol (multi-source)

// ❌ THIẾU: multi-source discovery gateway (local + MCP + remote + plugin)
// ❌ THIẾU: health-check (tool sống/chết)
// ❌ THIẾU: version negotiation (agent yêu cầu v2, nguồn có v3)
// ❌ THIẾU: auto-load (chọn → load → dùng)
```

## Implementation

```typescript
// packages/tools/src/discovery.ts (NEW)
interface ToolSource {
  name: string;
  type: 'local' | 'mcp' | 'remote' | 'plugin';
  search(query: string): Promise<DiscoveredTool[]>;
  healthCheck(toolId: string): Promise<boolean>;
}

interface DiscoveredTool {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  healthy: boolean;
  loadToken: unknown; // để load tool khi chọn
}

class ToolDiscoveryGateway {
  constructor(private sources: ToolSource[]) {}

  async discover(query: string): Promise<DiscoveredTool[]> {
    const results = await Promise.all(this.sources.map(s => s.search(query).catch(() => [])));
    const merged = results.flat();
    // Health-check song song
    const healthChecks = await Promise.all(
      merged.map(async t => ({ ...t, healthy: await this.sources
        .find(s => s.name === t.source)!.healthCheck(t.id) }))
    );
    // Filter unhealthy + rank by relevance + prefer local
    return healthChecks
      .filter(t => t.healthy)
      .sort((a, b) => {
        const score = (t: DiscoveredTool) =>
          (t.source === 'local' ? 2 : 0) + (query.split(' ').some(w => t.name.includes(w)) ? 1 : 0);
        return score(b) - score(a);
      });
  }

  // Agent chọn → auto-load
  async load(tool: DiscoveredTool): Promise<Tool> {
    return await this.sources.find(s => s.name === tool.source)!.load(tool.loadToken);
  }
}

interface Tool { run(args: unknown): Promise<unknown>; }
// ToolSource cần thêm: load(token): Promise<Tool>
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một gateway tìm tool mọi nguồn (Consul proven) | ❌ Mỗi source cần adapter |
| ✅ Health-check — không gọi tool chết | ❌ Discovery latency (search multi-source) |
| ✅ Auto-load — agent không cần biết tool ở đâu | ❌ Version conflict (source A v2 vs B v3) |
| ✅ Nối 337 reco → recommendation infra | ❌ Security risk (remote tool untrusted) |

## Khác các hướng gần

| | 40 Tool Registry | 288 Polyfill Fallback | 101 Dynamic Selection | LX: Discovery Gateway |
|---|---|---|---|---|
| Scope | Local only | Thay thế thiếu | Chọn tool nào | **Tìm tool từ đâu** |
| Multi-source | ❌ | ❌ | ❌ | ✅ local+MCP+remote |
| Health | ❌ | ❌ | ❌ | ✅ check |
| Auto-load | ✅ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Tool đến từ nhiều nguồn (local, MCP, remote marketplace, plugin)
- Agent cần tìm tool theo nhu cầu (không hardcode)
- Muốn health-check + version negotiation
- Kết hợp 337 context-tool-reco (recommendation) + 288 polyfill (fallback); bảo mật remote tool (policy check 332)
