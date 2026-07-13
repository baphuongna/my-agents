/**
 * Built-in channel adapters: Telegram, Discord, Slack, Email, Webhook.
 *
 * Multi-bot per platform: Set env vars with alias suffix:
 *   TELEGRAM_BOT_TOKEN_BOT1=xxx  → channel id "telegram:bot1"
 *   TELEGRAM_BOT_TOKEN_BOT2=yyy  → channel id "telegram:bot2"
 *   TELEGRAM_BOT_TOKEN=xxx       → channel id "telegram" (default alias)
 *
 * Each adapter reads credentials from env vars or ~/.mya/agent/channels.json.
 * Sending uses fetch() (HTTP API) — no SDK dependencies.
 */
import type { Channel, ChannelMessage } from "./channels.js";
import { nowWallclock } from "@my-agent/core";

// ── Helper: discover all env vars for a credential ────────────────────────
function discoverCredentials(prefix: string, defaultVar: string): Array<{ alias?: string; value: string }> {
  const found: Array<{ alias?: string; value: string }> = [];
  // Default: env without suffix
  const def = process.env[defaultVar];
  if (def) found.push({ alias: undefined, value: def });
  // Aliased: env vars with _<ALIAS> suffix (uppercased)
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix + "_") || !value) continue;
    const alias = key.slice(prefix.length + 1).toLowerCase();
    if (!alias) continue;
    if (key === defaultVar) continue;
    found.push({ alias, value });
  }
  return found;
}

// ── Telegram ──────────────────────────────────────────────────────────────
export class TelegramChannel implements Channel {
  readonly type = "telegram";
  readonly alias?: string;
  readonly label: string;
  private token: string | undefined;

  constructor(token?: string, alias?: string) {
    this.token = token ?? (alias ? process.env[`TELEGRAM_BOT_TOKEN_${alias.toUpperCase()}`] : process.env["TELEGRAM_BOT_TOKEN"]);
    this.alias = alias;
    this.label = alias ? `Telegram (${alias})` : "Telegram";
  }

  get id(): string {
    return this.alias ? `telegram:${this.alias}` : "telegram";
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
    return [];
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }
}

// ── Discord ───────────────────────────────────────────────────────────────
export class DiscordChannel implements Channel {
  readonly type = "discord";
  readonly alias?: string;
  readonly label: string;
  private token: string | undefined;

  constructor(token?: string, alias?: string) {
    this.token = token ?? (alias ? process.env[`DISCORD_BOT_TOKEN_${alias.toUpperCase()}`] : process.env["DISCORD_BOT_TOKEN"]);
    this.alias = alias;
    this.label = alias ? `Discord (${alias})` : "Discord";
  }

  get id(): string {
    return this.alias ? `discord:${this.alias}` : "discord";
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
  readonly type = "slack";
  readonly alias?: string;
  readonly label: string;
  private token: string | undefined;

  constructor(token?: string, alias?: string) {
    this.token = token ?? (alias ? process.env[`SLACK_BOT_TOKEN_${alias.toUpperCase()}`] : process.env["SLACK_BOT_TOKEN"]);
    this.alias = alias;
    this.label = alias ? `Slack (${alias})` : "Slack";
  }

  get id(): string {
    return this.alias ? `slack:${this.alias}` : "slack";
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

// ── Email ─────────────────────────────────────────────────────────────────
export class EmailChannel implements Channel {
  readonly type = "email";
  readonly alias?: string;
  readonly label: string;
  private apiKey: string | undefined;

  constructor(apiKey?: string, alias?: string) {
    this.apiKey = apiKey ?? (alias ? process.env[`EMAIL_API_KEY_${alias.toUpperCase()}`] : process.env["EMAIL_API_KEY"]);
    this.alias = alias;
    this.label = alias ? `Email (${alias})` : "Email";
  }

  get id(): string {
    return this.alias ? `email:${this.alias}` : "email";
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

// ── Webhook ───────────────────────────────────────────────────────────────
export class WebhookChannel implements Channel {
  readonly type = "webhook";
  readonly alias?: string;
  readonly label: string;
  private url: string | undefined;

  constructor(url?: string, alias?: string) {
    this.url = url ?? (alias ? process.env[`WEBHOOK_URL_${alias.toUpperCase()}`] : process.env["WEBHOOK_URL"]);
    this.alias = alias;
    this.label = alias ? `Webhook (${alias})` : "Webhook";
  }

  get id(): string {
    return this.alias ? `webhook:${this.alias}` : "webhook";
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

/** Register all built-in channel adapters, including aliased instances. */
export function registerBuiltinChannels(registry: { register: (c: Channel) => void }): void {
  // Default (no alias) + auto-discover aliased variants
  for (const { alias, value } of discoverCredentials("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN")) {
    registry.register(new TelegramChannel(value, alias));
  }
  for (const { alias, value } of discoverCredentials("DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN")) {
    registry.register(new DiscordChannel(value, alias));
  }
  for (const { alias, value } of discoverCredentials("SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN")) {
    registry.register(new SlackChannel(value, alias));
  }
  for (const { alias, value } of discoverCredentials("EMAIL_API_KEY", "EMAIL_API_KEY")) {
    registry.register(new EmailChannel(value, alias));
  }
  for (const { alias, value } of discoverCredentials("WEBHOOK_URL", "WEBHOOK_URL")) {
    registry.register(new WebhookChannel(value, alias));
  }
}
