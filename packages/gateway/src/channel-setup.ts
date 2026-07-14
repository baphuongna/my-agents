/**
 * @my-agent/gateway — Channel auto-configuration wizard.
 *
 * Auto-detects credentials from env vars, generates config files,
 * and provides an interactive setup flow so users don't have to
 * manually edit JSON or set env vars one by one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ChannelRegistry, ChannelConfig } from "./channels.js";

/** A credential requirement for a channel. */
export interface CredentialSpec {
  /** Env var name (e.g. "TELEGRAM_BOT_TOKEN"). */
  envVar: string;
  /** Human-readable label. */
  label: string;
  /** Optional help URL. */
  helpUrl?: string;
}

/** Per-channel setup spec: what credentials it needs + how to get them. */
export const CHANNEL_SETUP: Record<string, { name: string; credentials: CredentialSpec[]; helpUrl: string }> = {
  telegram: {
    name: "Telegram",
    helpUrl: "https://core.telegram.org/bots#creating-a-new-bot",
    credentials: [
      { envVar: "TELEGRAM_BOT_TOKEN", label: "Bot Token", helpUrl: "https://t.me/BotFather" },
    ],
  },
  discord: {
    name: "Discord",
    helpUrl: "https://discord.com/developers/applications",
    credentials: [
      { envVar: "DISCORD_BOT_TOKEN", label: "Bot Token" },
    ],
  },
  slack: {
    name: "Slack",
    helpUrl: "https://api.slack.com/apps",
    credentials: [
      { envVar: "SLACK_BOT_TOKEN", label: "Bot OAuth Token (xoxb-...)" },
    ],
  },
  email: {
    name: "Email (Resend/SendGrid)",
    helpUrl: "https://resend.com/api-keys",
    credentials: [
      { envVar: "EMAIL_API_KEY", label: "API Key" },
      { envVar: "EMAIL_PROVIDER", label: "Provider (resend/sendgrid)", helpUrl: "https://resend.com" },
      { envVar: "EMAIL_FROM", label: "From address (e.g. agent@mya.dev)" },
    ],
  },
  webhook: {
    name: "Webhook",
    helpUrl: "",
    credentials: [
      { envVar: "WEBHOOK_URL", label: "Webhook URL" },
    ],
  },
  whatsapp: {
    name: "WhatsApp (Cloud API)",
    helpUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    credentials: [
      { envVar: "WHATSAPP_TOKEN", label: "Access Token", helpUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" },
      { envVar: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone Number ID" },
    ],
  },
  signal: {
    name: "Signal (signal-cli REST API)",
    helpUrl: "https://github.com/bbernhard/signal-cli-rest-api",
    credentials: [
      { envVar: "SIGNAL_CLI_URL", label: "signal-cli REST URL (default http://localhost:8080)" },
    ],
  },
  matrix: {
    name: "Matrix (Client-Server API)",
    helpUrl: "https://matrix.org/docs/matrix-concepts/",
    credentials: [
      { envVar: "MATRIX_HOMESERVER", label: "Homeserver base URL (e.g. https://matrix.org)" },
      { envVar: "MATRIX_ACCESS_TOKEN", label: "Access Token" },
      { envVar: "MATRIX_ROOM_ID", label: "Room ID (e.g. !abc:matrix.org)" },
    ],
  },
};

/** Channels config file path: ~/.mya/agent/channels.json */
export function channelsConfigPath(): string {
  return join(homedir(), ".mya", "agent", "channels.json");
}

/** Detection result for a single channel. */
export interface ChannelDetection {
  id: string;
  name: string;
  configured: boolean;
  missing: CredentialSpec[];
  found: { envVar: string; label: string }[];
}

/**
 * Scan env vars + config file to detect what's configured and what's missing.
 * Returns a report per channel.
 */
export function detectChannels(): ChannelDetection[] {
  // Load existing config
  const config = loadChannelsConfig();
  const results: ChannelDetection[] = [];

  for (const [id, spec] of Object.entries(CHANNEL_SETUP)) {
    const found: { envVar: string; label: string }[] = [];
    const missing: CredentialSpec[] = [];

    for (const cred of spec.credentials) {
      // Check env var first, then config file
      const envValue = process.env[cred.envVar];
      const configValue = config[id]?.credentials?.[cred.envVar];
      if (envValue || configValue) {
        found.push({ envVar: cred.envVar, label: cred.label });
      } else {
        missing.push(cred);
      }
    }

    results.push({
      id,
      name: spec.name,
      configured: missing.length === 0,
      missing,
      found,
    });
  }

  return results;
}

/** Load channels.json (returns empty record if not present). */
export function loadChannelsConfig(): Record<string, ChannelConfig> {
  try {
    const raw = readFileSync(channelsConfigPath(), "utf8");
    return JSON.parse(raw) as Record<string, ChannelConfig>;
  } catch {
    return {};
  }
}

/**
 * Save a channel credential. Writes to both:
 * 1. ~/.mya/agent/channels.json (durable)
 * 2. process.env (for immediate use)
 */
export function saveChannelCredential(channelId: string, envVar: string, value: string): void {
  // Set env var for immediate use
  process.env[envVar] = value;

  // Persist to channels.json
  const config = loadChannelsConfig();
  if (!config[channelId]) {
    config[channelId] = { id: channelId, enabled: true, credentials: {}, targets: {} };
  }
  config[channelId]!.credentials[envVar] = value;
  config[channelId]!.enabled = true;

  const configDir = join(homedir(), ".mya", "agent");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(channelsConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Apply detected env vars to a ChannelRegistry.
 * Called at startup to activate all channels that have credentials.
 */
export function autoConfigureChannels(registry: ChannelRegistry): { activated: string[]; skipped: string[] } {
  const config = loadChannelsConfig();
  const activated: string[] = [];
  const skipped: string[] = [];

  for (const channel of registry.list()) {
    const detection = detectChannels().find((d) => d.id === channel.id);
    if (detection?.configured) {
      // Apply config file credentials to env if not already set
      const channelConfig = config[channel.id];
      if (channelConfig?.credentials) {
        for (const [envVar, value] of Object.entries(channelConfig.credentials)) {
          if (!process.env[envVar]) process.env[envVar] = value;
        }
      }
      registry.configure(channel.id, {
        id: channel.id,
        enabled: true,
        credentials: channelConfig?.credentials ?? {},
        targets: channelConfig?.targets ?? {},
      });
      activated.push(channel.id);
    } else {
      skipped.push(channel.id);
    }
  }

  return { activated, skipped };
}

/** Generate a summary string for display (e.g. /channel status). */
export function channelStatusSummary(): string {
  const detections = detectChannels();
  const lines: string[] = [];
  for (const d of detections) {
    const icon = d.configured ? "✅" : "⬜";
    const detail = d.configured
      ? `${d.found.length} credential(s) found`
      : `missing: ${d.missing.map((m) => m.envVar).join(", ")}`;
    lines.push(`  ${icon} ${d.name} (${d.id}) — ${detail}`);
  }
  return lines.join("\n");
}
