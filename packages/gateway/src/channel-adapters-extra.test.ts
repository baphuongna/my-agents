import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MsGraphChannel, FeishuChannel } from "./channel-adapters-extra.js";

describe("[unit] channel-adapters-extra", () => {
  afterEach(() => {
    delete process.env.MSGRAPH_CLIENT_ID;
    delete process.env.MSGRAPH_CLIENT_SECRET;
    delete process.env.MSGRAPH_ACCESS_TOKEN;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });

  describe("MsGraphChannel", () => {
    it("id + type + label", () => {
      const c = new MsGraphChannel();
      expect(c.id).toBe("msgraph");
      expect(c.type).toBe("msgraph");
      expect(c.label).toBe("Microsoft Graph");
    });

    it("isConfigured: both env vars required", () => {
      expect(new MsGraphChannel().isConfigured()).toBe(false);
      process.env.MSGRAPH_CLIENT_ID = "x";
      expect(new MsGraphChannel().isConfigured()).toBe(false);
      process.env.MSGRAPH_CLIENT_SECRET = "y";
      expect(new MsGraphChannel().isConfigured()).toBe(true);
    });

    it("validateConfig throws when not configured", () => {
      expect(() => new MsGraphChannel().validateConfig()).toThrow(/MSGRAPH/);
    });

    it("health: not configured → Failed", () => {
      expect(new MsGraphChannel().health()).toBe("Failed");
    });

    it("health: configured → Healthy", () => {
      process.env.MSGRAPH_CLIENT_ID = "x";
      process.env.MSGRAPH_CLIENT_SECRET = "y";
      expect(new MsGraphChannel().health()).toBe("Healthy");
    });

    it("send without token → error", async () => {
      const r = await new MsGraphChannel().send("chat1", "hi");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/ACCESS_TOKEN/);
    });
  });

  describe("FeishuChannel", () => {
    it("id + type + label", () => {
      const c = new FeishuChannel();
      expect(c.id).toBe("feishu");
      expect(c.type).toBe("feishu");
      expect(c.label).toBe("Feishu");
    });

    it("isConfigured: both env vars required", () => {
      expect(new FeishuChannel().isConfigured()).toBe(false);
      process.env.FEISHU_APP_ID = "x";
      process.env.FEISHU_APP_SECRET = "y";
      expect(new FeishuChannel().isConfigured()).toBe(true);
    });

    it("validateConfig throws when not configured", () => {
      expect(() => new FeishuChannel().validateConfig()).toThrow(/FEISHU/);
    });

    it("health: not configured → Failed", () => {
      expect(new FeishuChannel().health()).toBe("Failed");
    });
  });
});
