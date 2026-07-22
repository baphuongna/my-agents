// Minimal stdio MCP server fixture for McpManager.start() integration tests.
// Responds to initialize, tools/list (with a real inputSchema), tools/call.
// Echoes MYA_B6_TEST env in the tool description (B6 env-retention verification).
// NOT a vitest test file (.cjs) — spawned as a child process by mcp.test.ts.
// Supports BOTH newline-delimited JSON (MCP standard) and Content-Length framing.
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  // Parse newline-delimited JSON (MCP standard) AND Content-Length (legacy)
  while (buf.length > 0) {
    // Try Content-Length framing first
    let idx = buf.indexOf("\r\n\r\n");
    if (idx >= 0 && idx < 200) {
      const header = buf.slice(0, idx);
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (m) {
        const bodyStart = idx + 4;
        const len = parseInt(m[1], 10);
        if (buf.length < bodyStart + len) break;
        let msg;
        try { msg = JSON.parse(buf.slice(bodyStart, bodyStart + len)); }
        catch { buf = buf.slice(bodyStart + len); continue; }
        buf = buf.slice(bodyStart + len);
        handle(msg);
        continue;
      }
    }
    // Fall back to newline-delimited JSON
    let nl = buf.indexOf("\n");
    if (nl < 0) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch { /* not JSON — skip */ }
  }
});
function send(obj) {
  // MCP standard: newline-delimited JSON
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture-mcp", version: "1.0" } } });
  } else if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo tool (B6 env MYA_B6_TEST=" + (process.env.MYA_B6_TEST || "UNSET") + ")", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
  } else if (msg.method === "tools/call") {
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echoed: " + JSON.stringify(msg.params?.arguments) }] } });
  }
}
process.stdin.on("end", () => process.exit(0));
