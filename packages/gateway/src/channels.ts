/**
 * @my-agent/gateway — Channel registry + adapters (§12).
 *
 * A "channel" is a delivery surface: the agent can send/receive messages via
 * Telegram, Discord, Slack, Email, Webhook, etc. Each adapter implements the
 * Channel interface: check_fn (is this configured?) / validate_config / setup /
 * send / receive.
 *
 * Source: §12 Multi-platform gateway; hermes ChannelRegistry; mya-v1 channels.
 */
import type { RuntimeEvent } from "@my-agent/core";

/** A channel adapter — one per platform instance (e.g. "telegram:bot1", "discord:main"). */
export interface Channel {
  /** Unique channel id with optional alias (e.g. "telegram", "telegram:bot2", "discord"). */
  readonly id: string;
  /** Platform type (e.g. "telegram", "discord"). */
  readonly type: string;
  /** Optional alias for multi-bot per platform (e.g. "bot1", "main"). */
  readonly alias?: string;
  /** Human-readable label. */
  readonly label: string;
  /** Check if this channel is configured (has credentials/env vars). */
  isConfigured(): boolean;
  /** Validate configuration; throw if invalid. */
  validateConfig(): void;
  /** Send a message to a target (chat_id, channel, email, ...). */
  send(target: string, text: string): Promise<{ ok: boolean; error?: string }>;
  /** Optional: poll for incoming messages (push channels override this). */
  receive?(): Promise<ChannelMessage[]>;
  /** Health check. */
  health(): "Healthy" | "Degraded" | "Failed";
}

/** An incoming message from a channel. */
export interface ChannelMessage {
  channelId: string;
  from: string;
  text: string;
  ts: number;
  /** Reply target (to send a response back). */
  replyTarget: string;
}

/** Configuration for a channel (stored in ~/.mya/agent/channels.json). */
export interface ChannelConfig {
  id: string;
  enabled: boolean;
  credentials: Record<string, string>;
  targets: Record<string, string>;
}

/**
 * Registry of channel adapters. Each adapter is checked at startup;
 * configured ones are activated, others are skipped.
 */
export class ChannelRegistry {
  private channels = new Map<string, Channel>();
  private configs = new Map<string, ChannelConfig>();
  private handlers = new Map<string, (msg: ChannelMessage) => void>();

  /** Register a channel adapter. */
  register(channel: Channel): void {
    this.channels.set(channel.id, channel);
  }

  /** Load configuration for a channel. */
  configure(id: string, config: ChannelConfig): void {
    this.configs.set(id, config);
  }

  /** Get a channel by id. */
  get(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  /** List all registered channels. */
  list(): Channel[] {
    return [...this.channels.values()];
  }

  /** List only configured + enabled channels. */
  active(): Channel[] {
    return this.list().filter((c) => {
      const cfg = this.configs.get(c.id);
      return cfg?.enabled && c.isConfigured();
    });
  }

  /** Send a message via a specific channel. */
  async send(channelId: string, target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const channel = this.channels.get(channelId);
    if (!channel) return { ok: false, error: `channel "${channelId}" not registered` };
    if (!channel.isConfigured()) return { ok: false, error: `channel "${channelId}" not configured` };
    return channel.send(target, text);
  }

  /** Set a handler for incoming messages from any channel. */
  onMessage(handler: (msg: ChannelMessage) => void): void {
    // All channels share one handler (the agent loop).
    for (const id of this.channels.keys()) {
      this.handlers.set(id, handler);
    }
  }

  /** Get the config for a channel. */
  getConfig(id: string): ChannelConfig | undefined {
    return this.configs.get(id);
  }

  /** Aggregate health across all active channels. */
  get health(): "Healthy" | "Degraded" | "Failed" {
    const active = this.active();
    if (active.length === 0) return "Healthy";
    const healthy = active.filter((c) => c.health() === "Healthy").length;
    if (healthy === active.length) return "Healthy";
    if (healthy === 0) return "Failed";
    return "Degraded";
  }
}
