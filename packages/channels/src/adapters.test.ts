import { describe, it, expect, vi } from "vitest";
import { WhatsAppAdapter, type WhatsAppConfig } from "./whatsapp.js";
import { MatrixAdapter, type MatrixConfig } from "./matrix.js";
import type { TransportHandle } from "./base-adapter.js";

function mockFactory(): { factory: (cfg: unknown, cb: unknown) => Promise<TransportHandle>; transport: TransportHandle } {
  const transport: TransportHandle = {
    sendMessage: vi.fn(async (_chatId: string, _text: string) => ({ messageId: "msg-1" })),
    close: vi.fn(async () => {}),
  };
  return {
    factory: vi.fn(async () => transport),
    transport,
  };
}

describe("[unit] WhatsAppAdapter", () => {
  it("type is whatsapp", () => {
    const { factory } = mockFactory();
    const a = new WhatsAppAdapter({} as WhatsAppConfig, factory);
    expect(a.type).toBe("whatsapp");
  });

  it("connect + send via injected transport", async () => {
    const { factory, transport } = mockFactory();
    const a = new WhatsAppAdapter({ phoneNumber: "+123" } as WhatsAppConfig, factory);
    await a.connect();
    const r = await a.send("123@s.whatsapp.net", "hi");
    expect(r.ok).toBe(true);
    expect(transport.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", "hi");
    await a.disconnect();
  });

  it("createTransport passes config to factory", async () => {
    const { factory } = mockFactory();
    const cfg: WhatsAppConfig = { sessionData: "data", phoneNumber: "+999" };
    const a = new WhatsAppAdapter(cfg, factory);
    await a.connect();
    expect(factory).toHaveBeenCalledWith(cfg, expect.any(Function));
  });
});

describe("[unit] MatrixAdapter", () => {
  it("type is matrix", () => {
    const { factory } = mockFactory();
    const a = new MatrixAdapter({} as MatrixConfig, factory);
    expect(a.type).toBe("matrix");
  });

  it("connect + send via injected transport", async () => {
    const { factory, transport } = mockFactory();
    const a = new MatrixAdapter({ homeserverUrl: "https://m.org", accessToken: "tok" } as MatrixConfig, factory);
    await a.connect();
    const r = await a.send("!room:m.org", "hello");
    expect(r.ok).toBe(true);
    expect(transport.sendMessage).toHaveBeenCalledWith("!room:m.org", "hello");
    await a.disconnect();
  });

  it("createTransport passes config to factory", async () => {
    const { factory } = mockFactory();
    const cfg: MatrixConfig = { homeserverUrl: "https://m.org", accessToken: "tok", userId: "@bot:m.org" };
    const a = new MatrixAdapter(cfg, factory);
    await a.connect();
    expect(factory).toHaveBeenCalledWith(cfg, expect.any(Function));
  });
});
