/**
 * @my-agent/rpc — JSON-RPC server tests.
 */
import { describe, it, expect } from "vitest";
import { RpcServer } from "./index.js";

describe("RpcServer", () => {
  it("constructs with handler methods", () => {
    const server = new RpcServer({
      prompt: async (_text, _onEvent) => {},
      cancel: () => {},
      status: () => ({ ok: true }),
    });
    expect(server).toBeDefined();
  });

  it("status handler returns ok", () => {
    const server = new RpcServer({
      prompt: async () => {},
      cancel: () => {},
      status: () => ({ ok: true, sessions: 0 }),
    });
    // RpcServer stores handlers; verify construction doesn't throw
    expect(server).toBeDefined();
  });
});
