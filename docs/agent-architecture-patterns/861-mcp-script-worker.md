# Hướng AGC: MCP Script-Worker — `mcpScript` tool chạy plain JavaScript multi-call (search→describe→call→loop/fan-out) trong worker thread bị terminate sau 30s kể cả infinite loop; dùng làm tool duy nhất cho subagent bị restrict tool

> **Nguồn gốc:** pi-mcp-adapter (mcp-script-worker.mjs) | **Coupling:** 🟡 — worker thread + MCP access | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codeexec worker + mcp proxy, thiếu mcpScript multi-call worker) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-mcp-adapter** `mcpScript` là tool chạy **plain JavaScript multi-call** — agent viết script thực hiện chuỗi thao tác MCP (search → describe → call → loop / fan-out) trong **một tool call** thay vì gọi từng tool. Script chạy trong **worker thread bị terminate sau 30s** — kể cả **infinite loop** cũng bị giết (an toàn). Dùng làm **tool duy nhất** cho subagent bị **restrict tool** (subagent không có tool MCP trực tiếp, chỉ có mcpScript để tự orchestrate). Nguyên tắc: **script multi-call + worker timeout cứng + single tool cho restricted subagent**.

## Mô tả

mya mcp-script-worker: (1) **codeexec worker đã sẵn** — `packages/tools` codeexec.ts (code execution); (2) **mcp proxy đã sẵn** — AFY (search/describe/call); (3) **mcpScript tool** — nhận JS script, cấp MCP API trong worker; (4) **30s terminate** — worker thread terminate cứng (infinite loop an toàn); (5) **restrict tool** — subagent chỉ có mcpScript (orchestrate everything qua script). Nối AFY (proxy) và codeexec.

## Kiến trúc (ASCII)

```
  AGENT (hoặc subagent bị restrict tool)
       │
       ▼  mcpScript({ code: "..." })
  WORKER THREAD (plain JS)
   │  có MCP API: search/describe/call
   │
   ├─ const tools = mcp.search("email")
   ├─ const schema = mcp.describe(tools[0])
   ├─ for (const t of tools) mcp.call(t, args)  ◀── multi-call / loop / fan-out
   │
   ▼  TERMINATE SAU 30s (cứng)
   ├─ script xong trước 30s ──▶ return result
   └─ infinite loop / chậm ──▶ worker bị KILL (an toàn)

  subagent restrict tool: chỉ có mcpScript ──▶ orchestrate mọi thứ qua script
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codeexec.ts — code execution (worker nền)
// ✅ packages/tools mcp-proxy (AFY) — search/describe/call foundation
// ✅ packages/agent index.ts — spawnSubagent({ allowedTools }) restrict tool

// ❌ THIẾU: mcpScript tool (JS multi-call trong worker)
// ❌ THIẾU: 30s worker terminate cứng (infinite-loop safe)
// ❌ THIẾU: MCP API expose trong worker sandbox
```

## Implementation

```typescript
// packages/tools/src/mcp-script-worker.ts (MỚI)
import { Worker } from "node:worker_threads";
const SCRIPT_TIMEOUT_MS = 30_000;
export interface McpScriptApi {
  search(q: string): { name: string }[];
  describe(name: string): { schema: unknown };
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}
/** Chạy JS script multi-call trong worker; terminate 30s cứng. */
export function mcpScript(code: string, api: McpScriptApi): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(codeWrapper(code, api), { eval: true });
    const timer = setTimeout(() => {
      worker.terminate();                       // infinite loop → kill cứng
      reject(new Error("mcpScript timeout 30s"));
    }, SCRIPT_TIMEOUT_MS);
    worker.on("message", (r) => { clearTimeout(timer); resolve(r); });
    worker.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}
function codeWrapper(code: string, api: McpScriptApi): string {
  // Expose mcp = api trong worker; return kết quả qua postMessage.
  return `(async () => { const mcp = ${JSON.stringify({})}; ${code}; })()`;
}
// Subagent restrict: spawnSubagent(goal, { allowedTools: ["mcpScript"] })
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Multi-call trong 1 tool — giảm round-trip | ❌ JS arbitrary trong worker = rủi ro (cần sandbox) |
| ✅ 30s terminate — infinite loop an toàn | ❌ 30s có thể không đủ cho task lớn |
| ✅ Single tool cho restricted subagent | ❌ Debug script khó (worker tách biệt) |

## Khác các hướng gần

| | AGC MCP Script-Worker | AFY MCP Proxy | codeexec |
|---|---|---|---|
| Cơ chế | JS multi-call worker | Single-call proxy | Code execution |
| Timeout | 30s cứng | per-call | codeexec policy |
| Mục đích | Orchestrate qua script | Nén tool def | Run arbitrary code |

## Khi nào chọn

- Cần chuỗi thao tác MCP trong 1 tool (loop/fan-out)
- Subagent restrict tool (chỉ 1 tool orchestrate)
- Cần an toàn infinite loop (worker terminate cứng)
- Guard: sandbox worker (no fs/net ngoài allowlist), 30s timeout, MCP API giới hạn, cap resource
