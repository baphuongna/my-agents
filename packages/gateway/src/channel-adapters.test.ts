/**
 * Tests for built-in channel adapters: Email, Webhook (channel-adapters.ts)
 * and MSGraph, Feishu, WeChat, Spotify (channel-adapters-extra.ts).
 *
 * Tests verify structure/meta (type, label, id), the Channel interface contract
 * (isConfigured / validateConfig / send / health), and registerBuiltinChannels
 * auto-discovery. No real API calls are made — fetch is mocked where send() is
 * exercised.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  EmailChannel,
  WebhookChannel,
  registerBuiltinChannels,
} from "./channel-adapters.js";
import {
  MsGraphChannel,
  FeishuChannel,
  WeChatChannel,
  SpotifyChannel,
} from "./channel-adapters-extra.js";
import type { Channel } from "./channels.js";

/** Snapshot + clear a set of env vars, restoring them after the test. */
function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

/** Mock fetch returning a JSON response, capturing call details. */
function mockFetch(status = 200, jsonBody: unknown = {}): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(jsonBody), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── EmailChannel ─────────────────────────────────────────────────────────────

describe("EmailChannel", () => {
  it("has type 'email' and default id 'email'", () => {
    const ch = new EmailChannel("key");
    expect(ch.type).toBe("email");
    expect(ch.id).toBe("email");
    expect(ch.label).toBe("Email");
  });

  it("supports an alias", () => {
    const ch = new EmailChannel("key", "work");
    expect(ch.id).toBe("email:work");
    expect(ch.label).toBe("Email (work)");
    expect(ch.alias).toBe("work");
  });

  it("isConfigured() reflects whether an api key is present", () => {
    expect(new EmailChannel().isConfigured()).toBe(false);
    expect(new EmailChannel("k").isConfigured()).toBe(true);
  });

  it("validateConfig() throws when not configured", () => {
    const ch = new EmailChannel();
    expect(() => ch.validateConfig()).toThrow("EMAIL_API_KEY");
  });

  it("validateConfig() does not throw when configured", () => {
    const ch = new EmailChannel("k");
    expect(() => ch.validateConfig()).not.toThrow();
  });

  it("health() is 'Failed' when unconfigured, 'Healthy' when configured", () => {
    expect(new EmailChannel().health()).toBe("Failed");
    expect(new EmailChannel("k").health()).toBe("Healthy");
  });

  it("send() returns error when not configured", async () => {
    const ch = new EmailChannel();
    const res = await ch.send("a@b.com", "hi");
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("send() POSTs to the email provider API when configured", async () => {
    const { calls } = mockFetch(200);
    const ch = new EmailChannel("k");
    const res = await ch.send("a@b.com", "hello world");
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.to).toBe("a@b.com");
    expect(body.text).toBe("hello world");
    expect(calls[0]!.init!.method).toBe("POST");
  });
});

// ── WebhookChannel ───────────────────────────────────────────────────────────

describe("WebhookChannel", () => {
  it("has type 'webhook' and default id 'webhook'", () => {
    const ch = new WebhookChannel("https://hook.example");
    expect(ch.type).toBe("webhook");
    expect(ch.id).toBe("webhook");
    expect(ch.label).toBe("Webhook");
  });

  it("supports an alias", () => {
    const ch = new WebhookChannel("https://hook.example", "prod");
    expect(ch.id).toBe("webhook:prod");
    expect(ch.alias).toBe("prod");
  });

  it("isConfigured() reflects whether a url is present", () => {
    expect(new WebhookChannel().isConfigured()).toBe(false);
    expect(new WebhookChannel("u").isConfigured()).toBe(true);
  });

  it("validateConfig() throws when not configured", () => {
    expect(() => new WebhookChannel().validateConfig()).toThrow("WEBHOOK_URL");
  });

  it("health() reports Failed/Healthy based on config", () => {
    expect(new WebhookChannel().health()).toBe("Failed");
    expect(new WebhookChannel("u").health()).toBe("Healthy");
  });

  it("send() returns error when not configured", async () => {
    const ch = new WebhookChannel();
    const res = await ch.send("t", "text");
    expect(res.ok).toBe(false);
  });

  it("send() POSTs to the configured url", async () => {
    const { calls } = mockFetch(200);
    const ch = new WebhookChannel("https://hook.example/inbox");
    const res = await ch.send("room1", "payload");
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://hook.example/inbox");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.text).toBe("payload");
  });
});

// ── MsGraphChannel ───────────────────────────────────────────────────────────

describe("MsGraphChannel", () => {
  it("has type 'msgraph' and correct label", () => {
    const ch = new MsGraphChannel();
    expect(ch.type).toBe("msgraph");
    expect(ch.id).toBe("msgraph");
    expect(ch.label).toBe("Microsoft Graph");
  });

  it("accepts a custom id", () => {
    const ch = new MsGraphChannel("msgraph:teams");
    expect(ch.id).toBe("msgraph:teams");
  });

  it("isConfigured() requires MSGRAPH_CLIENT_ID + MSGRAPH_CLIENT_SECRET", withEnv(
    { MSGRAPH_CLIENT_ID: undefined, MSGRAPH_CLIENT_SECRET: undefined },
    () => {
      const ch = new MsGraphChannel();
      expect(ch.isConfigured()).toBe(false);
      process.env.MSGRAPH_CLIENT_ID = "id";
      expect(ch.isConfigured()).toBe(false);
      process.env.MSGRAPH_CLIENT_SECRET = "secret";
      expect(ch.isConfigured()).toBe(true);
    },
  ));

  it("validateConfig() throws when not configured", withEnv(
    { MSGRAPH_CLIENT_ID: undefined, MSGRAPH_CLIENT_SECRET: undefined },
    () => {
      const ch = new MsGraphChannel();
      expect(() => ch.validateConfig()).toThrow("MSGRAPH_CLIENT_ID");
    },
  ));

  it("health() reports Failed/Healthy based on env", withEnv(
    { MSGRAPH_CLIENT_ID: "id", MSGRAPH_CLIENT_SECRET: "secret" },
    () => {
      expect(new MsGraphChannel().health()).toBe("Healthy");
    },
  ));

  it("send() returns error when MSGRAPH_ACCESS_TOKEN is absent", withEnv(
    { MSGRAPH_ACCESS_TOKEN: undefined },
    async () => {
      const ch = new MsGraphChannel();
      const res = await ch.send("chat1", "hi");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("ACCESS_TOKEN");
    },
  ));

  it("send() POSTs to Graph API when token is set", withEnv(
    { MSGRAPH_ACCESS_TOKEN: "tok" },
    async () => {
      const { calls } = mockFetch(201);
      const ch = new MsGraphChannel();
      const res = await ch.send("chat1", "hello");
      expect(res.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("graph.microsoft.com");
      expect(calls[0]!.init!.headers).toHaveProperty("authorization", "Bearer tok");
    },
  ));
});

// ── FeishuChannel ────────────────────────────────────────────────────────────

describe("FeishuChannel", () => {
  it("has type 'feishu' and correct label", () => {
    const ch = new FeishuChannel();
    expect(ch.type).toBe("feishu");
    expect(ch.id).toBe("feishu");
    expect(ch.label).toBe("Feishu");
  });

  it("isConfigured() requires FEISHU_APP_ID + FEISHU_APP_SECRET", withEnv(
    { FEISHU_APP_ID: undefined, FEISHU_APP_SECRET: undefined },
    () => {
      expect(new FeishuChannel().isConfigured()).toBe(false);
      process.env.FEISHU_APP_ID = "a";
      expect(new FeishuChannel().isConfigured()).toBe(false);
      process.env.FEISHU_APP_SECRET = "b";
      expect(new FeishuChannel().isConfigured()).toBe(true);
    },
  ));

  it("validateConfig() throws when not configured", withEnv(
    { FEISHU_APP_ID: undefined, FEISHU_APP_SECRET: undefined },
    () => {
      expect(() => new FeishuChannel().validateConfig()).toThrow("FEISHU");
    },
  ));

  it("health() is Failed when unconfigured", () => {
    vi.stubEnv("FEISHU_APP_ID", undefined);
    vi.stubEnv("FEISHU_APP_SECRET", undefined);
    expect(new FeishuChannel().health()).toBe("Failed");
  });

  it("send() acquires a tenant token then sends a message", withEnv(
    { FEISHU_APP_ID: "a", FEISHU_APP_SECRET: "b" },
    async () => {
      const { calls } = mockFetch(200, { tenant_access_token: "t" });
      const ch = new FeishuChannel();
      const res = await ch.send("ou_x", "hi");
      expect(res.ok).toBe(true);
      // two calls: token + send
      expect(calls).toHaveLength(2);
      expect(calls[1]!.init!.headers).toHaveProperty("authorization", "Bearer t");
    },
  ));
});

// ── WeChatChannel ────────────────────────────────────────────────────────────

describe("WeChatChannel", () => {
  it("has type 'wechat' and correct label", () => {
    const ch = new WeChatChannel();
    expect(ch.type).toBe("wechat");
    expect(ch.id).toBe("wechat");
    expect(ch.label).toBe("WeChat");
  });

  it("isConfigured() requires WECHAT_APP_ID + WECHAT_APP_SECRET", withEnv(
    { WECHAT_APP_ID: undefined, WECHAT_APP_SECRET: undefined },
    () => {
      expect(new WeChatChannel().isConfigured()).toBe(false);
      process.env.WECHAT_APP_ID = "a";
      expect(new WeChatChannel().isConfigured()).toBe(false);
      process.env.WECHAT_APP_SECRET = "b";
      expect(new WeChatChannel().isConfigured()).toBe(true);
    },
  ));

  it("validateConfig() throws when not configured", withEnv(
    { WECHAT_APP_ID: undefined, WECHAT_APP_SECRET: undefined },
    () => {
      expect(() => new WeChatChannel().validateConfig()).toThrow("WECHAT");
    },
  ));

  it("health() is Failed when unconfigured", withEnv(
    { WECHAT_APP_ID: undefined, WECHAT_APP_SECRET: undefined },
    () => {
      expect(new WeChatChannel().health()).toBe("Failed");
    },
  ));

  it("send() fetches an access token then sends", withEnv(
    { WECHAT_APP_ID: "a", WECHAT_APP_SECRET: "b" },
    async () => {
      const { calls } = mockFetch(200, { access_token: "tok" });
      const ch = new WeChatChannel();
      const res = await ch.send("user1", "hi");
      expect(res.ok).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[0]!.url).toContain("api.weixin.qq.com/cgi-bin/token");
    },
  ));
});

// ── SpotifyChannel ───────────────────────────────────────────────────────────

describe("SpotifyChannel", () => {
  it("has type 'spotify' and correct label", () => {
    const ch = new SpotifyChannel();
    expect(ch.type).toBe("spotify");
    expect(ch.id).toBe("spotify");
    expect(ch.label).toBe("Spotify");
  });

  it("isConfigured() requires SPOTIFY_ACCESS_TOKEN", withEnv(
    { SPOTIFY_ACCESS_TOKEN: undefined },
    () => {
      expect(new SpotifyChannel().isConfigured()).toBe(false);
      process.env.SPOTIFY_ACCESS_TOKEN = "tok";
      expect(new SpotifyChannel().isConfigured()).toBe(true);
    },
  ));

  it("validateConfig() throws when not configured", withEnv(
    { SPOTIFY_ACCESS_TOKEN: undefined },
    () => {
      expect(() => new SpotifyChannel().validateConfig()).toThrow("SPOTIFY");
    },
  ));

  it("health() is Healthy when configured", withEnv(
    { SPOTIFY_ACCESS_TOKEN: "tok" },
    () => {
      expect(new SpotifyChannel().health()).toBe("Healthy");
    },
  ));

  it("send() with 'pause' hits the pause endpoint", withEnv(
    { SPOTIFY_ACCESS_TOKEN: "tok" },
    async () => {
      const { calls } = mockFetch(200);
      const ch = new SpotifyChannel();
      const res = await ch.send("me", "pause");
      expect(res.ok).toBe(true);
      expect(calls[0]!.url).toContain("/v1/me/player/pause");
      expect(calls[0]!.init!.method).toBe("PUT");
    },
  ));

  it("send() with 'play' hits the play endpoint", withEnv(
    { SPOTIFY_ACCESS_TOKEN: "tok" },
    async () => {
      const { calls } = mockFetch(200);
      const ch = new SpotifyChannel();
      const res = await ch.send("me", "play");
      expect(res.ok).toBe(true);
      expect(calls[0]!.url).toContain("/v1/me/player/play");
      expect(calls[0]!.init!.method).toBe("PUT");
    },
  ));
});

// ── registerBuiltinChannels ──────────────────────────────────────────────────

describe("registerBuiltinChannels", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // restore env
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Clear all known channel env vars so tests start from a known empty state. */
  function clearChannelEnv(): void {
    const keys = [
      "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN",
      "EMAIL_API_KEY", "WEBHOOK_URL", "WHATSAPP_TOKEN", "SIGNAL_CLI_URL",
      "MATRIX_ACCESS_TOKEN", "MSGRAPH_CLIENT_ID", "FEISHU_APP_ID",
      "WECHAT_APP_ID", "SPOTIFY_ACCESS_TOKEN",
    ];
    for (const k of keys) {
      if (!(k in saved)) saved[k] = process.env[k];
      delete process.env[k];
    }
  }

  it("is a function", () => {
    expect(typeof registerBuiltinChannels).toBe("function");
  });

  it("registers nothing when no credentials are set", () => {
    clearChannelEnv();
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    expect(registered).toHaveLength(0);
  });

  it("registers Email when EMAIL_API_KEY is set", () => {
    clearChannelEnv();
    process.env.EMAIL_API_KEY = "k";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    expect(registered).toHaveLength(1);
    expect(registered[0]!.type).toBe("email");
  });

  it("registers Webhook when WEBHOOK_URL is set", () => {
    clearChannelEnv();
    process.env.WEBHOOK_URL = "https://hook.example";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    expect(registered).toHaveLength(1);
    expect(registered[0]!.type).toBe("webhook");
  });

  it("registers MsGraph when MSGRAPH_CLIENT_ID is set", () => {
    clearChannelEnv();
    process.env.MSGRAPH_CLIENT_ID = "id";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    const types = registered.map((c) => c.type);
    expect(types).toContain("msgraph");
  });

  it("registers Feishu when FEISHU_APP_ID is set", () => {
    clearChannelEnv();
    process.env.FEISHU_APP_ID = "id";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    const types = registered.map((c) => c.type);
    expect(types).toContain("feishu");
  });

  it("registers WeChat when WECHAT_APP_ID is set", () => {
    clearChannelEnv();
    process.env.WECHAT_APP_ID = "id";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    const types = registered.map((c) => c.type);
    expect(types).toContain("wechat");
  });

  it("registers Spotify when SPOTIFY_ACCESS_TOKEN is set", () => {
    clearChannelEnv();
    process.env.SPOTIFY_ACCESS_TOKEN = "tok";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    const types = registered.map((c) => c.type);
    expect(types).toContain("spotify");
  });

  it("discovers aliased variants (EMAIL_API_KEY_BOT1)", () => {
    clearChannelEnv();
    process.env.EMAIL_API_KEY = "default";
    process.env.EMAIL_API_KEY_BOT1 = "key1";
    const registered: Channel[] = [];
    const registry = { register: (c: Channel) => registered.push(c) };
    registerBuiltinChannels(registry);
    const ids = registered.map((c) => c.id);
    expect(ids).toContain("email");
    expect(ids).toContain("email:bot1");
  });
});
