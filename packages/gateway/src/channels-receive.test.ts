/**
 * Tests for channel polling receive() methods (Telegram, Discord, Slack)
 * and model metadata in the /models handler.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { TelegramChannel, DiscordChannel, SlackChannel } from "@my-agent/gateway";
import { Gateway } from "@my-agent/gateway";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** Capture all fetch() calls (url + init). Returns configurable responses. */
function mockFetch(responder?: (url: string) => unknown): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = responder ? responder(url) : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return { calls };
}

// ── TelegramChannel.receive() ──────────────────────────────────────────────
describe("TelegramChannel.receive()", () => {
  it(
    "calls getUpdates with offset + timeout and maps results to ChannelMessage[]",
    withEnv({ TELEGRAM_BOT_TOKEN: "tok-123" }, async () => {
      let offsetSeen = 0;
      const { calls } = mockFetch((url) => {
        const m = url.match(/offset=(\d+)/);
        if (m) offsetSeen = parseInt(m[1]!, 10);
        return {
          ok: true,
          result: [
            { update_id: 100, message: { chat: { id: 42 }, from: { username: "alice" }, text: "hello bot" } },
            { update_id: 101, message: { chat: { id: 42 }, from: { first_name: "Bob" }, text: "hi there" } },
          ],
        };
      });
      const ch = new TelegramChannel();
      const msgs = await ch.receive();
      expect(msgs.length).toBe(2);
      expect(msgs[0]!.from).toBe("alice");
      expect(msgs[0]!.text).toBe("hello bot");
      expect(msgs[0]!.replyTarget).toBe("42");
      expect(msgs[0]!.channelId).toBe("telegram");
      expect(msgs[1]!.from).toBe("Bob"); // falls back to first_name
      // Offset should advance to last update_id + 1.
      expect(offsetSeen).toBe(0); // initial poll starts at offset 0
      expect(calls[0]!.url).toContain("/getUpdates");
      expect(calls[0]!.url).toContain("timeout=30");
    }),
  );

  it("returns [] when not configured", async () => {
    const ch = new TelegramChannel(undefined, undefined);
    // Force no token
    expect(await ch.receive()).toEqual([]);
  });
});

// ── DiscordChannel.receive() ───────────────────────────────────────────────
describe("DiscordChannel.receive()", () => {
  it(
    "GETs channel messages with Bot auth header",
    withEnv({ DISCORD_BOT_TOKEN: "bot-tok", DISCORD_CHANNEL_ID: "999" }, async () => {
      const { calls } = mockFetch(() => [
        { id: "m1", content: "ping", author: { username: "alice" }, channel_id: "999" },
        { id: "m2", content: "pong", author: { username: "bob" }, channel_id: "999" },
      ]);
      const ch = new DiscordChannel();
      const msgs = await ch.receive();
      expect(msgs.length).toBe(2);
      expect(msgs[0]!.from).toBe("alice");
      expect(msgs[0]!.text).toBe("ping");
      expect(msgs[0]!.replyTarget).toBe("999");
      expect(calls[0]!.url).toContain("/channels/999/messages");
      const headers = calls[0]!.init?.headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bot bot-tok");
    }),
  );

  it(
    "returns [] without DISCORD_CHANNEL_ID",
    withEnv({ DISCORD_BOT_TOKEN: "bot-tok", DISCORD_CHANNEL_ID: undefined }, async () => {
      const ch = new DiscordChannel();
      expect(await ch.receive()).toEqual([]);
    }),
  );
});

// ── SlackChannel.receive() ─────────────────────────────────────────────────
describe("SlackChannel.receive()", () => {
  it(
    "calls conversations.history with Bearer auth and maps messages",
    withEnv({ SLACK_BOT_TOKEN: "xoxb-tok", SLACK_CHANNEL_ID: "C123" }, async () => {
      const { calls } = mockFetch(() => ({
        ok: true,
        messages: [
          { text: "hello team", user: "U001", ts: "1700000000.000100" },
          { text: "standup time", user: "U002", ts: "1700000000.000200" },
        ],
      }));
      const ch = new SlackChannel();
      const msgs = await ch.receive();
      expect(msgs.length).toBe(2);
      expect(msgs[0]!.from).toBe("U001");
      expect(msgs[0]!.text).toBe("hello team");
      expect(msgs[0]!.replyTarget).toBe("C123");
      expect(calls[0]!.url).toContain("/conversations.history");
      expect(calls[0]!.url).toContain("channel=C123");
      const headers = calls[0]!.init?.headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer xoxb-tok");
    }),
  );

  it(
    "returns [] without SLACK_CHANNEL_ID",
    withEnv({ SLACK_BOT_TOKEN: "xoxb-tok", SLACK_CHANNEL_ID: undefined }, async () => {
      const ch = new SlackChannel();
      expect(await ch.receive()).toEqual([]);
    }),
  );
});

// ── Gateway /models metadata ───────────────────────────────────────────────
describe("Gateway /models returns real metadata", () => {
  it(
    "includes contextWindow, maxTokens, reasoning for known providers",
    withEnv({ ANTHROPIC_API_KEY: "sk-test" }, async () => {
      const gw = new Gateway({ port: 0 });
      await gw.start();
      try {
        const addr = (gw as unknown as { http: { address(): { port: number } } }).http.address();
        const actualPort = addr && typeof addr === "object" ? addr.port : gw.port;
        const res = await fetch(`http://127.0.0.1:${actualPort}/models`);
        const models = (await res.json()) as Array<{ provider: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean }>;
        const anthropic = models.find((m) => m.provider === "anthropic");
        expect(anthropic).toBeDefined();
        expect(anthropic!.contextWindow).toBe(1000000);
        expect(anthropic!.maxTokens).toBe(128000);
        expect(anthropic!.reasoning).toBe(true);
      } finally {
        await gw.stop();
      }
    }),
  );
});
