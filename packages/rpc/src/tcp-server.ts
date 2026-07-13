/**
 * @my-agent/rpc — TCP server wrapper around RpcServer.
 *
 * Enables background sessions: the agent runs as a TCP server on localhost.
 * The launcher connects/disconnects freely — the session survives.
 *
 * Cross-platform: TCP works on Linux, macOS, AND Windows (no tmux needed).
 */
import { createServer as createTcpServer, type Socket } from "node:net";
import { RpcServer, type RpcHandler } from "./index.js";

/**
 * Run an RPC server over TCP on a random localhost port.
 * Returns the port and a stop() function.
 */
export async function startTcpRpcServer(
  handler: RpcHandler,
  opts?: { port?: number; host?: string },
): Promise<{ port: number; host: string; stop: () => Promise<void> }> {
  const host = opts?.host ?? "127.0.0.1";
  const port = opts?.port ?? 0; // 0 = ephemeral

  return new Promise((resolve, reject) => {
    const server = createTcpServer((socket: Socket) => {
      // Each TCP connection gets its own RpcServer reading/writing the socket.
      const rpc = new RpcServer(handler, socket, socket);
      rpc.start();
      socket.on("close", () => {
        // Client disconnected — session keeps running (server stays up).
        // Cancel any in-flight turn so it doesn't stream to a dead socket.
        try { handler.cancel(); } catch { /* best-effort */ }
      });
    });

    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : port;
      resolve({
        port: actualPort,
        host,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
