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
  /** Last-processed update_id + 1 for Telegram long-polling offset. */
  private pollOffset = 0;

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
    if (!this.token) return [];
    try {
      const url = `https://api.telegram.org/bot${this.token}/getUpdates` +
        `?offset=${this.pollOffset}&timeout=30`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = (await res.json()) as { ok?: boolean; result?: Array<{ update_id: number; message?: { chat?: { id?: number }; from?: { username?: string; first_name?: string }; text?: string } }> };
      if (!data.ok || !data.result) return [];
      const msgs: ChannelMessage[] = [];
      for (const upd of data.result) {
        this.pollOffset = upd.update_id + 1;
        const msg = upd.message;
        if (!msg || !msg.text) continue;
        msgs.push({
          channelId: this.id,
          from: msg.from?.username ?? msg.from?.first_name ?? "unknown",
          text: msg.text,
          ts: nowWallclock(),
          replyTarget: String(msg.chat?.id ?? ""),
        });
      }
      return msgs;
    } catch {
      return [];
    }
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
  private lastMessageId: string | undefined; // HIGH-3 fix: dedup tracking

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

  async receive(): Promise<ChannelMessage[]> {
    if (!this.token) return [];
    const channelId = this.alias
      ? process.env[`DISCORD_CHANNEL_ID_${this.alias.toUpperCase()}`]
      : process.env["DISCORD_CHANNEL_ID"];
    if (!channelId) return [];
    try {
      // HIGH-3 fix: dedup — only fetch messages after lastMessageId
      const afterParam = this.lastMessageId ? `&after=${this.lastMessageId}` : "";
      const res = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages?limit=50${afterParam}`,
        { headers: { "authorization": `Bot ${this.token}` } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as Array<{ id: string; content?: string; author?: { username?: string }; channel_id?: string }>;
      const msgs: ChannelMessage[] = [];
      // Discord returns newest-first → reverse to oldest-first for processing
      for (const m of data) {
        if (!m.content) continue;
        this.lastMessageId = m.id;
        msgs.push({
          channelId: this.id,
          from: m.author?.username ?? "unknown",
          text: m.content,
          ts: nowWallclock(),
          replyTarget: m.channel_id ?? channelId,
        });
      }
      return msgs;
    } catch {
      return [];
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
  private lastTs: string | undefined; // HIGH-3 fix: dedup tracking

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

  async receive(): Promise<ChannelMessage[]> {
    if (!this.token) return [];
    const channel = this.alias
      ? process.env[`SLACK_CHANNEL_ID_${this.alias.toUpperCase()}`]
      : process.env["SLACK_CHANNEL_ID"];
    if (!channel) return [];
    try {
      // HIGH-3 fix: dedup — only fetch messages after lastTs
      const oldestParam = this.lastTs ? `&oldest=${this.lastTs}` : "";
      const res = await fetch(
        `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&limit=50${oldestParam}`,
        { headers: { "authorization": `Bearer ${this.token}` } },
      );
      if (!res.ok) return []; // LOW fix: check HTTP status before JSON parse
      const data = (await res.json()) as { ok?: boolean; messages?: Array<{ text?: string; user?: string; ts?: string }> };
      if (!data.ok || !data.messages) return [];
      const msgs: ChannelMessage[] = [];
      // Slack returns newest-first → reverse to oldest-first
      for (const m of data.messages) {
        if (!m.text) continue;
        if (m.ts) this.lastTs = m.ts;
        msgs.push({
          channelId: this.id,
          from: m.user ?? "unknown",
          text: m.text,
          ts: nowWallclock(),
          replyTarget: channel,
        });
      }
      return msgs;
    } catch {
      return [];
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

// ── WhatsApp (Cloud API) ──────────────────────────────────────────────────
export class WhatsAppChannel implements Channel {
  readonly type = "whatsapp";
  readonly alias?: string;
  readonly label: string;
  private token: string | undefined;
  private phoneNumberId: string | undefined;
  private verifyToken: string | undefined;

  constructor(token?: string, phoneNumberId?: string, alias?: string) {
    const suffix = alias ? `_${alias.toUpperCase()}` : "";
    this.token = token ?? (suffix ? process.env[`WHATSAPP_TOKEN${suffix}`] : process.env["WHATSAPP_TOKEN"]);
    this.phoneNumberId = phoneNumberId ?? (suffix ? process.env[`WHATSAPP_PHONE_NUMBER_ID${suffix}`] : process.env["WHATSAPP_PHONE_NUMBER_ID"]);
    // Webhook verify token: explicit override if set, else fall back to the access token.
    this.verifyToken = (suffix ? process.env[`WHATSAPP_VERIFY_TOKEN${suffix}`] : process.env["WHATSAPP_VERIFY_TOKEN"]) ?? this.token;
    this.alias = alias;
    this.label = alias ? `WhatsApp (${alias})` : "WhatsApp";
  }

  get id(): string {
    return this.alias ? `whatsapp:${this.alias}` : "whatsapp";
  }

  isConfigured(): boolean {
    return !!this.token && !!this.phoneNumberId;
  }

  validateConfig(): void {
    if (!this.token) throw new Error("WHATSAPP_TOKEN not set");
    if (!this.phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID not set");
  }

  /** Meta webhook verification: GET with hub.mode/hub.verify_token/hub.challenge. */
  verify(params: Record<string, string>): { ok: boolean; challenge?: string } {
    if (params["hub.mode"] === "subscribe" && this.verifyToken && params["hub.verify_token"] === this.verifyToken) {
      return { ok: true, challenge: params["hub.challenge"] };
    }
    return { ok: false };
  }

  async send(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.token || !this.phoneNumberId) return { ok: false, error: "not configured" };
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "authorization": `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: text },
          }),
        },
      );
      if (!res.ok) return { ok: false, error: `WhatsApp API ${res.status}` };
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

// ── Signal (signal-cli REST API) ──────────────────────────────────────────
export class SignalChannel implements Channel {
  readonly type = "signal";
  readonly alias?: string;
  readonly label: string;
  private url: string;
  private configured: boolean;
  private verifyToken: string | undefined;

  constructor(url?: string, alias?: string) {
    const suffix = alias ? `_${alias.toUpperCase()}` : "";
    const envUrl = url ?? (suffix ? process.env[`SIGNAL_CLI_URL${suffix}`] : process.env["SIGNAL_CLI_URL"]);
    // The CLI URL defaults to localhost, but "configured" tracks whether a
    // credential/env var was actually supplied (so auto-configure only
    // activates channels the user opted into).
    this.configured = !!envUrl;
    this.url = envUrl ?? "http://localhost:8080";
    this.verifyToken = suffix ? process.env[`SIGNAL_VERIFY_TOKEN${suffix}`] : process.env["SIGNAL_VERIFY_TOKEN"];
    this.alias = alias;
    this.label = alias ? `Signal (${alias})` : "Signal";
  }

  get id(): string {
    return this.alias ? `signal:${this.alias}` : "signal";
  }

  isConfigured(): boolean {
    return this.configured;
  }

  validateConfig(): void {
    if (!this.configured) throw new Error("SIGNAL_CLI_URL not set");
  }

  /** signal-cli has no native webhook handshake; verify is an optional token
   * check. With no token configured, all webhooks are accepted (ACK). */
  verify(params: Record<string, string>): { ok: boolean } {
    if (!this.verifyToken) return { ok: true };
    return { ok: params["token"] === this.verifyToken };
  }

  async send(target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) return { ok: false, error: "not configured" };
    try {
      const payload: Record<string, unknown> = { message: text, recipients: [target] };
      const sender = this.alias
        ? process.env[`SIGNAL_PHONE_NUMBER_${this.alias.toUpperCase()}`]
        : process.env["SIGNAL_PHONE_NUMBER"];
      if (sender) payload["number"] = sender;
      const res = await fetch(`${this.url}/v2/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: `Signal API ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async receive(): Promise<ChannelMessage[]> {
    return [];
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.configured ? "Healthy" : "Failed";
  }
}

// ── Matrix (Client-Server API) ────────────────────────────────────────────
export class MatrixChannel implements Channel {
  readonly type = "matrix";
  readonly alias?: string;
  readonly label: string;
  private homeserver: string | undefined;
  private accessToken: string | undefined;
  private roomId: string | undefined;
  private verifyToken: string | undefined;
  private txnCounter = 0;

  constructor(homeserver?: string, accessToken?: string, roomId?: string, alias?: string) {
    const suffix = alias ? `_${alias.toUpperCase()}` : "";
    this.homeserver = homeserver ?? (suffix ? process.env[`MATRIX_HOMESERVER${suffix}`] : process.env["MATRIX_HOMESERVER"]);
    this.accessToken = accessToken ?? (suffix ? process.env[`MATRIX_ACCESS_TOKEN${suffix}`] : process.env["MATRIX_ACCESS_TOKEN"]);
    this.roomId = roomId ?? (suffix ? process.env[`MATRIX_ROOM_ID${suffix}`] : process.env["MATRIX_ROOM_ID"]);
    this.verifyToken = suffix ? process.env[`MATRIX_VERIFY_TOKEN${suffix}`] : process.env["MATRIX_VERIFY_TOKEN"];
    this.alias = alias;
    this.label = alias ? `Matrix (${alias})` : "Matrix";
  }

  get id(): string {
    return this.alias ? `matrix:${this.alias}` : "matrix";
  }

  isConfigured(): boolean {
    return !!this.homeserver && !!this.accessToken && !!this.roomId;
  }

  validateConfig(): void {
    if (!this.homeserver) throw new Error("MATRIX_HOMESERVER not set");
    if (!this.accessToken) throw new Error("MATRIX_ACCESS_TOKEN not set");
    if (!this.roomId) throw new Error("MATRIX_ROOM_ID not set");
  }

  /** Matrix has no standard webhook handshake; verify is an optional token
   * check. With no token configured, all webhooks are accepted (ACK). */
  verify(params: Record<string, string>): { ok: boolean } {
    if (!this.verifyToken) return { ok: true };
    return { ok: params["token"] === this.verifyToken };
  }

  async send(_target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "not configured" };
    // Unique transaction id per message (uses the single time helper, not Date.now()).
    const txnId = `mya-${nowWallclock()}-${++this.txnCounter}`;
    try {
      const res = await fetch(
        `${this.homeserver}/_matrix/client/v3/rooms/${this.roomId}/send/m.room.message/${txnId}` +
          `?access_token=${encodeURIComponent(this.accessToken!)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ msgtype: "m.text", body: text }),
        },
      );
      if (!res.ok) return { ok: false, error: `Matrix API ${res.status}` };
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
  // WhatsApp: discover by WHATSAPP_TOKEN, pair with WHATSAPP_PHONE_NUMBER_ID.
  for (const { alias, value } of discoverCredentials("WHATSAPP_TOKEN", "WHATSAPP_TOKEN")) {
    const phoneId = alias
      ? process.env[`WHATSAPP_PHONE_NUMBER_ID_${alias.toUpperCase()}`]
      : process.env["WHATSAPP_PHONE_NUMBER_ID"];
    if (!phoneId) continue; // need both credentials
    registry.register(new WhatsAppChannel(value, phoneId, alias));
  }
  // Signal: single credential (CLI URL).
  for (const { alias, value } of discoverCredentials("SIGNAL_CLI_URL", "SIGNAL_CLI_URL")) {
    registry.register(new SignalChannel(value, alias));
  }
  // Matrix: discover by MATRIX_ACCESS_TOKEN, pair with HOMESERVER + ROOM_ID.
  for (const { alias, value } of discoverCredentials("MATRIX_ACCESS_TOKEN", "MATRIX_ACCESS_TOKEN")) {
    const homeserver = alias
      ? process.env[`MATRIX_HOMESERVER_${alias.toUpperCase()}`]
      : process.env["MATRIX_HOMESERVER"];
    const roomId = alias
      ? process.env[`MATRIX_ROOM_ID_${alias.toUpperCase()}`]
      : process.env["MATRIX_ROOM_ID"];
    if (!homeserver || !roomId) continue; // need all three credentials
    registry.register(new MatrixChannel(homeserver, value, roomId, alias));
  }
}
