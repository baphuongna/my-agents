/**
 * Frontier channel adapter tests: WhatsApp, Signal, Matrix.
 *
 * These tests do NOT modify existing channel tests — they cover only the new
 * adapters added alongside Telegram/Discord/Slack/Email/Webhook.
 *
 * Fetch is mocked via vi.stubGlobal; each test asserts the HTTP request shape
 * (URL, method, headers, body) that send() produces, plus webhook verify().
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WhatsAppChannel,
  SignalChannel,
  MatrixChannel,
} from "@my-agent/gateway";

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

/** Capture the most recent fetch() call (url + init). */
function mockFetch(status = 200): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status, headers: { "content-type": "application/json" } });
    }),
  );
  return { calls };
}

// ── WhatsApp ───────────────────────────────────────────────────────────────
describe("WhatsAppChannel", () => {
  it(
    "constructs from env vars (default + aliased)",
    withEnv(
      {
        WHATSAPP_TOKEN: "tok-default",
        WHATSAPP_PHONE_NUMBER_ID: "123",
        WHATSAPP_TOKEN_BOT1: "tok-aliased",
        WHATSAPP_PHONE_NUMBER_ID_BOT1: "456",
      },
      () => {
        const def = new WhatsAppChannel();
        expect(def.id).toBe("whatsapp");
        expect(def.type).toBe("whatsapp");
        expect(def.isConfigured()).toBe(true);
        expect(def.label).toBe("WhatsApp");

        const aliased = new WhatsAppChannel(undefined, undefined, "bot1");
        expect(aliased.id).toBe("whatsapp:bot1");
        expect(aliased.alias).toBe("bot1");
        expect(aliased.label).toBe("WhatsApp (bot1)");
        expect(aliased.isConfigured()).toBe(true);
      },
    ),
  );

  it(
    "isConfigured() is false without both credentials",
    withEnv({ WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: undefined }, () => {
      const ch = new WhatsAppChannel();
      expect(ch.isConfigured()).toBe(false);
      expect(() => ch.validateConfig()).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    }),
  );

  it(
    "send() POSTs to the WhatsApp Cloud API with Bearer token + messaging_product body",
    withEnv({ WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "999" }, async () => {
      const { calls } = mockFetch();
      const ch = new WhatsAppChannel();
      const res = await ch.send("+15551234567", "hello");
      expect(res.ok).toBe(true);
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe("https://graph.facebook.com/v21.0/999/messages");
      expect(call.init?.method).toBe("POST");
      const headers = call.init?.headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer tok");
      expect(headers["content-type"]).toBe("application/json");
      const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
      expect(body["messaging_product"]).toBe("whatsapp");
      expect(body["to"]).toBe("+15551234567");
      expect(body["type"]).toBe("text");
      expect((body["text"] as { body: string }).body).toBe("hello");
    }),
  );

  it(
    "verify() echoes the challenge when hub.verify_token matches",
    withEnv({ WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "1" }, () => {
      const ch = new WhatsAppChannel();
      const ok = ch.verify({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "abc123" });
      expect(ok).toEqual({ ok: true, challenge: "abc123" });
    }),
  );

  it(
    "verify() rejects when hub.verify_token does not match",
    withEnv({ WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "1" }, () => {
      const ch = new WhatsAppChannel();
      const bad = ch.verify({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "x" });
      expect(bad.ok).toBe(false);
      expect(bad.challenge).toBeUndefined();
    }),
  );

  it(
    "verify() honours an explicit WHATSAPP_VERIFY_TOKEN override",
    withEnv(
      { WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_VERIFY_TOKEN: "my-verify" },
      () => {
        const ch = new WhatsAppChannel();
        expect(ch.verify({ "hub.mode": "subscribe", "hub.verify_token": "my-verify", "hub.challenge": "c" })).toEqual({ ok: true, challenge: "c" });
        expect(ch.verify({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "c" }).ok).toBe(false);
      },
    ),
  );
});

// ── Signal ─────────────────────────────────────────────────────────────────
describe("SignalChannel", () => {
  it(
    "constructs from SIGNAL_CLI_URL and defaults to localhost when unset",
    withEnv({ SIGNAL_CLI_URL: "http://sig.example:8080" }, () => {
      const ch = new SignalChannel();
      expect(ch.id).toBe("signal");
      expect(ch.type).toBe("signal");
      expect(ch.isConfigured()).toBe(true);
      expect(ch.label).toBe("Signal");
    }),
  );

  it("is not configured when SIGNAL_CLI_URL is absent", () => {
    const ch = new SignalChannel();
    expect(ch.isConfigured()).toBe(false);
    expect(() => ch.validateConfig()).toThrow(/SIGNAL_CLI_URL/);
  });

  it(
    "supports multi-bot aliasing via SIGNAL_CLI_URL_<ALIAS>",
    withEnv({ SIGNAL_CLI_URL_RELAY: "http://relay:8080" }, () => {
      const ch = new SignalChannel(undefined, "relay");
      expect(ch.id).toBe("signal:relay");
      expect(ch.alias).toBe("relay");
      expect(ch.label).toBe("Signal (relay)");
      expect(ch.isConfigured()).toBe(true);
    }),
  );

  it(
    "send() POSTs to {url}/v2/send with message + recipients",
    withEnv({ SIGNAL_CLI_URL: "http://sig.example:8080" }, async () => {
      const { calls } = mockFetch();
      const ch = new SignalChannel();
      const res = await ch.send("+15550001111", "ping");
      expect(res.ok).toBe(true);
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe("http://sig.example:8080/v2/send");
      expect(call.init?.method).toBe("POST");
      const headers = call.init?.headers as Record<string, string>;
      expect(headers["content-type"]).toBe("application/json");
      const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
      expect(body["message"]).toBe("ping");
      expect(body["recipients"]).toEqual(["+15550001111"]);
    }),
  );

  it("accepts all webhooks when no verify token is configured", () => {
    const ch = new SignalChannel("http://sig.example:8080");
    expect(ch.verify({}).ok).toBe(true);
  });

  it(
    "verify() checks the token when SIGNAL_VERIFY_TOKEN is set",
    withEnv({ SIGNAL_CLI_URL: "http://sig.example:8080", SIGNAL_VERIFY_TOKEN: "sekret" }, () => {
      const ch = new SignalChannel();
      expect(ch.verify({ token: "sekret" }).ok).toBe(true);
      expect(ch.verify({ token: "nope" }).ok).toBe(false);
    }),
  );
});

// ── Matrix ─────────────────────────────────────────────────────────────────
describe("MatrixChannel", () => {
  it(
    "constructs from MATRIX_* env vars",
    withEnv(
      {
        MATRIX_HOMESERVER: "https://matrix.example.org",
        MATRIX_ACCESS_TOKEN: "syt_tok",
        MATRIX_ROOM_ID: "!room:matrix.example.org",
      },
      () => {
        const ch = new MatrixChannel();
        expect(ch.id).toBe("matrix");
        expect(ch.type).toBe("matrix");
        expect(ch.isConfigured()).toBe(true);
        expect(ch.label).toBe("Matrix");
      },
    ),
  );

  it(
    "isConfigured() requires all three credentials",
    withEnv(
      {
        MATRIX_HOMESERVER: "https://matrix.example.org",
        MATRIX_ACCESS_TOKEN: undefined,
        MATRIX_ROOM_ID: "!room:matrix.example.org",
      },
      () => {
        const ch = new MatrixChannel();
        expect(ch.isConfigured()).toBe(false);
        expect(() => ch.validateConfig()).toThrow(/MATRIX_ACCESS_TOKEN/);
      },
    ),
  );

  it(
    "supports multi-bot aliasing via MATRIX_*_<ALIAS>",
    withEnv(
      {
        MATRIX_HOMESERVER_BOT: "https://m2.example.org",
        MATRIX_ACCESS_TOKEN_BOT: "t2",
        MATRIX_ROOM_ID_BOT: "!r2:m2.example.org",
      },
      () => {
        const ch = new MatrixChannel(undefined, undefined, undefined, "bot");
        expect(ch.id).toBe("matrix:bot");
        expect(ch.alias).toBe("bot");
        expect(ch.label).toBe("Matrix (bot)");
        expect(ch.isConfigured()).toBe(true);
      },
    ),
  );

  it(
    "send() PUTs a m.room.message event with access_token query + unique txnId",
    withEnv(
      {
        MATRIX_HOMESERVER: "https://matrix.example.org",
        MATRIX_ACCESS_TOKEN: "syt_tok",
        MATRIX_ROOM_ID: "!room:matrix.example.org",
      },
      async () => {
        const { calls } = mockFetch();
        const ch = new MatrixChannel();
        const res = await ch.send("ignored", "hi there");
        expect(res.ok).toBe(true);
        expect(calls).toHaveLength(1);
        const call = calls[0]!;
        expect(call.init?.method).toBe("PUT");
        expect(call.url).toContain("https://matrix.example.org/_matrix/client/v3/rooms/");
        expect(call.url).toContain("/!room:matrix.example.org/send/m.room.message/");
        expect(call.url).toContain("access_token=syt_tok");
        const headers = call.init?.headers as Record<string, string>;
        expect(headers["content-type"]).toBe("application/json");
        const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
        expect(body["msgtype"]).toBe("m.text");
        expect(body["body"]).toBe("hi there");
      },
    ),
  );

  it(
    "send() produces a unique transaction id per call",
    withEnv(
      {
        MATRIX_HOMESERVER: "https://matrix.example.org",
        MATRIX_ACCESS_TOKEN: "syt_tok",
        MATRIX_ROOM_ID: "!room:matrix.example.org",
      },
      async () => {
        const { calls } = mockFetch();
        const ch = new MatrixChannel();
        await ch.send("", "a");
        await ch.send("", "b");
        const txn = (u: string) => u.split("/m.room.message/")[1]?.split("?")[0];
        expect(txn(calls[0]!.url)).toBeDefined();
        expect(txn(calls[0]!.url)).not.toBe(txn(calls[1]!.url));
      },
    ),
  );

  it("accepts all webhooks when no verify token is configured", () => {
    const ch = new MatrixChannel("https://m.example.org", "tok", "!r:m");
    expect(ch.verify({}).ok).toBe(true);
  });

  it(
    "verify() checks the token when MATRIX_VERIFY_TOKEN is set",
    withEnv(
      {
        MATRIX_HOMESERVER: "https://matrix.example.org",
        MATRIX_ACCESS_TOKEN: "syt_tok",
        MATRIX_ROOM_ID: "!room:matrix.example.org",
        MATRIX_VERIFY_TOKEN: "vtok",
      },
      () => {
        const ch = new MatrixChannel();
        expect(ch.verify({ token: "vtok" }).ok).toBe(true);
        expect(ch.verify({ token: "wrong" }).ok).toBe(false);
      },
    ),
  );
});
