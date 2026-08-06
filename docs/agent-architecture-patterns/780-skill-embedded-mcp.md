# Hướng ACZ: Skill-Embedded MCP — skill mang MCP server riêng, spin up on-demand scoped theo task rồi tắt khi xong, giải quyết context bloat

> **Nguồn gốc:** oh-my-openagent (README.md) | **Coupling:** 🟢 — skill + MCP lifecycle, core không đổi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có MCP client + skills — chưa có skill-embedded MCP) | **Effort:** 2 tuần

## Nguồn gốc

**oh-my-openagent** cho phép **skill mang MCP server riêng của nó** — khi skill được invoke, MCP server của skill **spin up on-demand, scoped theo task**, rồi **tắt khi xong**. Điều này giải quyết **context bloat**: MCP schema **không phải lúc nào cũng nạp vào context window** — chỉ nạp khi skill (và server của nó) thực sự được dùng cho task đó. Khác với MCP server global (schema tốn 20k+ tokens/server mỗi turn — xem ACV), skill-embedded MCP chỉ tốn khi cần. Nguyên tắc: **MCP gắn với skill, lifecycle theo task — schema chỉ vào context khi skill được invoke**.

## Mô tả

mya skill-embedded MCP: (1) **skill manifest mở rộng** — SKILL.md frontmatter thêm `mcp: { server, command, args }` (khai báo server riêng của skill); (2) **spin up on-demand** — khi model invoke skill, agent khởi động MCP server (packages/gateway mcp-client.ts đã có client) scoped theo task; (3) **schema nạp có điều kiện** — schema của server chỉ vào prompt khi skill active (không global mỗi turn); (4) **teardown khi xong** — task xong → tắt server, giải phóng process + tokens; (5) **scoped theo task** — mỗi lần invoke tạo context riêng, không share trạng thái lộn xộn. Nối ACV (MCP budget) — ACZ là cơ chế làm MCP on-demand thay vì global.

## Kiến trúc

```
  SKILL.md + frontmatter
    mcp: { server: "db-tools", command: "npx", args: ["db-mcp"] }
       │  model invoke skill
       ▼
  SPIN UP ON-DEMAND (scoped theo task)
    MCP server (process riêng) — schema vào prompt CHỈ khi skill active
    task dùng tool từ server
       ▼
  TEARDOWN KHI XONG — tắt server → giải phóng process + tokens
  (SO SÁNH: MCP global 20k+ tokens/server/turn ❌ · skill-embedded chỉ tốn khi dùng ✅)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway mcp-client.ts — MCP client (nền — spin up server)
// ✅ packages/gateway mcp-lifecycle.ts — McpPhase (nền — lifecycle quản lý)
// ✅ packages/gateway mcp.ts — MCP integration (nền — tool từ MCP)
// ✅ packages/skills skill.ts — parseSkillMarkdown frontmatter (nền — thêm mcp field)
// ✅ packages/skills curator.ts — SkillStore.loadBody (nền — load khi invoke)
// ✅ packages/gateway mcp-budget.ts (ACV) — schema budget (nền — chỉ nạp khi cần)

// ❌ THIẾU: mcp field trong SKILL.md frontmatter
// ❌ THIẾU: spin up on-demand + teardown khi skill xong
// ❌ THIẾU: schema chỉ vào prompt khi skill active
```
## Implementation
```typescript
// packages/gateway/src/skill-mcp.ts (MỚI)
import { spawn, type ChildProcess } from "node:child_process";
export interface SkillMcpSpec {
  server: string;
  command: string;
  args: string[];
}
/** Parse mcp field từ SKILL.md frontmatter (đã có parseSkillMarkdown — mở rộng). */
export function parseSkillMcp(frontmatter: Record<string, unknown>): SkillMcpSpec | null {
  const mcp = frontmatter["mcp"];
  if (typeof mcp !== "object" || mcp === null) return null;
  const m = mcp as Record<string, unknown>;
  if (typeof m["server"] !== "string" || typeof m["command"] !== "string") return null;
  return {
    server: m["server"],
    command: m["command"],
    args: Array.isArray(m["args"]) ? m["args"].map(String) : [],
  };
}
/** Spin up on-demand — scoped theo task, trả handle có teardown. */
export async function spinUpSkillMcp(spec: SkillMcpSpec): Promise<{
  server: string; child: ChildProcess;
  /** Teardown — tắt server khi task xong. */
  stop(): Promise<void>;
}> {
  const child = spawn(spec.command, spec.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MCP_SERVER_NAME: spec.server },
  });
  await waitForReady(child);
  return {
    server: spec.server,
    child,
    stop: () => new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000).unref();
    }),
  };
}
function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("MCP server không sẵn sàng trong 5s")), 5_000);
    child.once("spawn", () => { clearTimeout(t); resolve(); });
    child.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}
/** Registry skill-MCP — theo dõi server đang chạy per skill. */
export class SkillMcpRegistry {
  private readonly running = new Map<string, Awaited<ReturnType<typeof spinUpSkillMcp>>>();
  async acquire(spec: SkillMcpSpec): Promise<Awaited<ReturnType<typeof spinUpSkillMcp>>> {
    const existing = this.running.get(spec.server);
    if (existing) return existing;
    const handle = await spinUpSkillMcp(spec);
    this.running.set(spec.server, handle);
    return handle;
  }
  /** Teardown khi skill xong — giải phóng process. */
  async release(server: string): Promise<void> {
    const h = this.running.get(server);
    if (!h) return;
    await h.stop();
    this.running.delete(server);
  }
  activeServers(): string[] { return [...this.running.keys()]; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Schema MCP chỉ tốn khi skill dùng — hết context bloat | ❌ Spin up latency (khởi động server) khi invoke lần đầu |
| ✅ Scoped theo task — không share trạng thái lộn xộn | ❌ Teardown quên = process rò rỉ (phải có timeout) |

## Khác các hướng gần

| | MCP global (mcp.ts) | ACZ: Skill-Embedded MCP |
|---|---|---|
| Lifecycle | Bật cùng gateway | **Spin up on-demand, tắt khi skill xong** |
| Schema | Nạp mỗi turn (20k+ tokens/server) | **Chỉ nạp khi skill active** |
| Scope | Global | **Scoped theo task** |

## Khi nào chọn

- Nhiều MCP server — schema global đang phình context (kết hợp ACV)
- Guard: validate mcp field (command từ skill — sandbox/allowlist), teardown có timeout, registry không rò rỉ
