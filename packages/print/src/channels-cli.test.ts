import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let origFetch: typeof globalThis.fetch;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  origFetch = globalThis.fetch;
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

function logText(): string {
  // Strip ANSI escape codes so substring assertions match colored output.
  return consoleSpy.mock.calls
    .map((c) => c.join(" "))
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "");
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function mockFetchDead(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
}

describe("channelsAdd", () => {
  it("lists available types when called with no args", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd();
    const text = logText();
    expect(text).toContain("Available channel types");
    expect(text).toContain("telegram");
    expect(text).toContain("discord");
    expect(text).toContain("webhook");
  });

  it("prints usage hint when no type given", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd();
    expect(logText()).toContain("mya channels add <type>");
  });

  it("prints the credential env var for telegram", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("telegram");
    const text = logText();
    expect(text).toContain("Add channel: telegram");
    expect(text).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("prints the credential env var for discord", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("discord");
    expect(logText()).toContain("DISCORD_BOT_TOKEN");
  });

  it("prints the credential env var for slack", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("slack");
    expect(logText()).toContain("SLACK_BOT_TOKEN");
  });

  it("suffices the env var with alias when provided", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("telegram", "bot2");
    const text = logText();
    expect(text).toContain("TELEGRAM_BOT_TOKEN_BOT2");
    expect(text).toContain("(bot2)");
  });

  it("uppercases the alias in the env var name", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("discord", "main");
    expect(logText()).toContain("DISCORD_BOT_TOKEN_MAIN");
  });

  it("reports unknown type and lists supported types", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("nonexistent");
    const text = logText();
    expect(text).toContain("Unknown type");
    expect(text).toContain("telegram");
  });

  it("includes a help URL for each channel type", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("telegram");
    expect(logText()).toContain("https://");
  });

  it("mentions restart command after setup", async () => {
    const mod = await import("./channels-cli.js");
    await mod.channelsAdd("telegram");
    expect(logText()).toContain("mya serve");
  });
});

describe("channelsList", () => {
  it("reports no channels when gateway returns empty list", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({ channels: [] });
    await mod.channelsList();
    expect(logText()).toContain("No channels registered");
  });

  it("reports no channels when gateway is down", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetchDead();
    await mod.channelsList();
    expect(logText()).toContain("No channels registered");
  });

  it("lists channels returned by the gateway", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({
      channels: [
        { id: "telegram", type: "telegram", alias: undefined, label: "Telegram", enabled: true, configured: true, health: "Healthy" },
        { id: "discord", type: "discord", alias: "main", label: "Discord", enabled: false, configured: true, health: "Degraded" },
      ],
    });
    await mod.channelsList();
    const text = logText();
    expect(text).toContain("Channels");
    expect(text).toContain("telegram");
    expect(text).toContain("discord");
  });

  it("shows health status for each channel", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({
      channels: [
        { id: "tg", type: "telegram", label: "T", enabled: true, configured: true, health: "Failed" as const },
      ],
    });
    await mod.channelsList();
    expect(logText()).toContain("Failed");
  });

  it("handles a gateway response without a channels field", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({ other: "data" });
    await mod.channelsList();
    expect(logText()).toContain("No channels registered");
  });
});

describe("channelsTest", () => {
  it("prints usage when no id given", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({ channels: [] });
    await mod.channelsTest();
    expect(logText()).toContain("Usage:");
    expect(logText()).toContain("mya channels test");
  });

  it("reports not found for an unknown channel id", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({
      channels: [
        { id: "telegram", type: "telegram", label: "T", enabled: true, configured: true, health: "Healthy" as const },
      ],
    });
    await mod.channelsTest("nonexistent");
    expect(logText()).toContain("Channel not found");
  });

  it("reports not configured when channel exists but configured=false", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({
      channels: [
        { id: "tg", type: "telegram", label: "T", enabled: true, configured: false, health: "Failed" as const },
      ],
    });
    await mod.channelsTest("tg");
    expect(logText()).toContain("not configured");
  });

  it("reports configured status for a ready non-webhook channel", async () => {
    const mod = await import("./channels-cli.js");
    globalThis.fetch = mockFetch({
      channels: [
        { id: "tg", type: "telegram", alias: "bot1", label: "T", enabled: true, configured: true, health: "Healthy" as const },
      ],
    });
    await mod.channelsTest("tg");
    const text = logText();
    expect(text).toContain("Channel configured");
    expect(text).toContain("telegram");
    expect(text).toContain("bot1");
    expect(text).toContain("Healthy");
  });

  it("POSTs a test payload for webhook channels", async () => {
    const mod = await import("./channels-cli.js");
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock;
    // First fetch = channels list; second fetch = webhook POST
    let call = 0;
    (fetchMock as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({
          channels: [
            { id: "wh", type: "webhook", label: "W", enabled: true, configured: true, health: "Healthy" as const },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    await mod.channelsTest("wh");
    expect(logText()).toContain("Webhook OK");
  });

  it("reports webhook failure on non-200", async () => {
    const mod = await import("./channels-cli.js");
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({
          channels: [
            { id: "wh", type: "webhook", label: "W", enabled: true, configured: true, health: "Healthy" as const },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    await mod.channelsTest("wh");
    expect(logText()).toContain("Webhook failed");
  });
});
