/**
 * Built-in channel adapters: Telegram, Discord, Slack, Email (SMTP), Webhook.
 *
 * Each adapter reads credentials from env vars or ~/.mya/agent/channels.json.
 * Sending uses fetch() (HTTP API) — no SDK dependencies.
 */
import type { Channel, ChannelMessage } from "./channels.js";
import { nowWallclock } from "@my-agent/core";

// ── Telegram ──────────────────────────────────────────────────────────────
export class TelegramChannel implements Channel {
  readonly id = "telegram";
  readonly label = "Telegram";
  private token: string | undefined;

  constructor(token?: string) {
    this.token = token ?? process.env["TELEGRAM_BOT_TOKEN"];
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  validateConfig(): void {
    if (!this.token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  async send(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.token) return { ok: false, error: "not configured" };
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
        },
      );
      if (!res.ok) return { ok: false, error: `Telegram API ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async receive(): Promise<ChannelMessage[]> {
    // Telegram uses long-polling getUpdates; in production, use a webhook.
    return [];
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }
}

// ── Discord ───────────────────────────────────────────────────────────────
export class DiscordChannel implements Channel {
  readonly id = "discord";
  readonly label = "Discord";
  private token: string | undefined;

  constructor(token?: string) {
    this.token = token ?? process.env["DISCORD_BOT_TOKEN"];
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  validateConfig(): void {
    if (!this.token) throw new Error("DISCORD_BOT_TOKEN not set");
  }

  async send(channelId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.token) return { ok: false, error: "not configured" };
    try {
      const res = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: {
            "authorization": `Bot ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: text }),
        },
      );
      if (!res.ok) return { ok: false, error: `Discord API ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }
}

// ── Slack ─────────────────────────────────────────────────────────────────
export class SlackChannel implements Channel {
  readonly id = "slack";
  readonly label = "Slack";
  private token: string | undefined;

  constructor(token?: string) {
    this.token = token ?? process.env["SLACK_BOT_TOKEN"];
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  validateConfig(): void {
    if (!this.token) throw new Error("SLACK_BOT_TOKEN not set");
  }

  async send(channel: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.token) return { ok: false, error: "not configured" };
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "authorization": `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ channel, text }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) return { ok: false, error: data.error ?? "Slack API error" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }
}

// ── Email (SMTP via API) ──────────────────────────────────────────────────
export class EmailChannel implements Channel {
  readonly id = "email";
  readonly label = "Email";
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    // Uses Resend/SendGrid-style API (set EMAIL_API_KEY + EMAIL_PROVIDER)
    this.apiKey = apiKey ?? process.env["EMAIL_API_KEY"];
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  validateConfig(): void {
    if (!this.apiKey) throw new Error("EMAIL_API_KEY not set");
  }

  async send(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) return { ok: false, error: "not configured" };
    const provider = process.env["EMAIL_PROVIDER"] ?? "resend";
    try {
      const res = await fetch(`https://api.${provider}.com/emails`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: process.env["EMAIL_FROM"] ?? "agent@mya.local",
          to,
          subject: text.slice(0, 80),
          text,
        }),
      });
      if (!res.ok) return { ok: false, error: `Email API ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }
}

// ── Webhook (generic HTTP POST) ───────────────────────────────────────────
export class WebhookChannel implements Channel {
  readonly id = "webhook";
  readonly label = "Webhook";
  private url: string | undefined;

  constructor(url?: string) {
    this.url = url ?? process.env["WEBHOOK_URL"];
  }

  isConfigured(): boolean {
    return !!this.url;
  }

  validateConfig(): void {
    if (!this.url) throw new Error("WEBHOOK_URL not set");
  }

  async send(target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.url) return { ok: false, error: "not configured" };
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, text, ts: nowWallclock() }),
      });
      if (!res.ok) return { ok: false, error: `Webhook ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }
}

/** Register all built-in channel adapters with a registry. */
export function registerBuiltinChannels(registry: { register: (c: Channel) => void }): void {
  registry.register(new TelegramChannel());
  registry.register(new DiscordChannel());
  registry.register(new SlackChannel());
  registry.register(new EmailChannel());
  registry.register(new WebhookChannel());
}
