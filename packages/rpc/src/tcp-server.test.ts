import { describe, it, expect } from "vitest";
import { connect as netConnect } from "node:net";
import { startTcpRpcServer } from "./tcp-server.js";

describe("[unit] rpc tcp-server", () => {
  it("starts on ephemeral port + stop closes", async () => {
    const server = await startTcpRpcServer({
      prompt: async () => "ok",
      cancel: () => {},
      status: () => ({ ok: true }),
    });
    expect(server.port).toBeGreaterThan(0);
    expect(server.host).toBe("127.0.0.1");
    await server.stop();
  });

  it("accepts TCP connection", async () => {
    const server = await startTcpRpcServer({
      prompt: async () => "ok",
      cancel: () => {},
      status: () => ({ ok: true }),
    });
    const socket = netConnect(server.port, server.host);
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    expect(socket.destroyed).toBe(false);
    socket.destroy();
    await server.stop();
  });

  it("custom host + port", async () => {
    const server = await startTcpRpcServer({
      prompt: async () => "ok",
      cancel: () => {},
      status: () => ({ ok: true }),
    }, { host: "127.0.0.1", port: 0 });
    expect(server.host).toBe("127.0.0.1");
    await server.stop();
  });
});
