// Minimal stdio MCP server fixture for McpManager.start() integration tests.
// Responds to initialize, tools/list (with a real inputSchema), tools/call.
// Echoes MYA_B6_TEST env in the tool description (B6 env-retention verification).
// NOT a vitest test file (.cjs) — spawned as a child process by mcp.test.ts.
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\r\n\r\n")) >= 0) {
    const header = buf.slice(0, idx);
    const bodyStart = idx + 4;
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) { buf = buf.slice(bodyStart); continue; }
    const len = parseInt(m[1], 10);
    if (buf.length < bodyStart + len) break;
    let msg;
    try { msg = JSON.parse(buf.slice(bodyStart, bodyStart + len)); }
    catch { buf = buf.slice(bodyStart + len); continue; }
    buf = buf.slice(bodyStart + len);
    handle(msg);
  }
});
function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
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
