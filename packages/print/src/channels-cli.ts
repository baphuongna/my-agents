/**
 * mya channels — CLI for channel management.
 *
 * Usage:
 *   mya channels list              # List all registered channels
 *   mya channels test <id>         # Send test message to verify config
 *   mya channels add <type> [alias]  # Setup wizard for a channel
 */
import { authHeaders, withAuth } from "./gw-auth.js";

const GW_PORT = parseInt(process.env["MYA_PORT"] ?? "3000", 10);

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  red: (s: string) => `\x1b[38;2;201;79;79m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[38;2;210;153;34m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
};

interface ChannelInfo {
  id: string;
  type: string;
  alias?: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  health: "Healthy" | "Degraded" | "Failed";
}

async function fetchChannels(): Promise<ChannelInfo[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/status`, { headers: authHeaders(), signal: AbortSignal.timeout(2000) });
    if (!r.ok) return [];
    const data = (await r.json()) as { channels?: ChannelInfo[] };
    return data.channels ?? [];
  } catch { return []; }
}

export async function channelsList(): Promise<void> {
  const channels = await fetchChannels();
  if (channels.length === 0) {
    console.log(`${A.muted("No channels registered. Gateway is not running or has no channels.")}`);
    console.log(`${A.muted("Start the gateway first: ")}${A.accent("mya serve")}`);
    return;
  }
  console.log(`${A.bold("Channels")} (${channels.length})`);
  console.log("");
  console.log(`  ${A.muted("ID".padEnd(28))} ${"TYPE".padEnd(12)} ${"ALIAS".padEnd(12)} ${"STATUS".padEnd(20)} ${"HEALTH"}`);
  console.log(`  ${A.muted("─".repeat(80))}`);
  for (const ch of channels) {
    const statusIcon = ch.configured && ch.enabled ? A.green("✓ enabled") : A.muted("○ disabled");
    const healthIcon =
      ch.health === "Healthy" ? A.green("Healthy") :
      ch.health === "Degraded" ? A.yellow("Degraded") :
      A.red("Failed");
    console.log(`  ${ch.id.padEnd(28)} ${ch.type.padEnd(12)} ${(ch.alias ?? "-").padEnd(12)} ${statusIcon.padEnd(20)} ${healthIcon}`);
  }
  console.log("");
  console.log(`${A.muted("Aliases:")} ${A.muted("set ")}${A.accent("TELEGRAM_BOT_TOKEN_BOT1")}${A.muted(", ")}${A.accent("DISCORD_BOT_TOKEN_MAIN")}${A.muted(" for multi-bot per platform.")}`);
}

export async function channelsTest(id?: string): Promise<void> {
  if (!id) {
    console.log(`${A.red("Usage:")} mya channels test <id>`);
    console.log(`${A.muted("Example: mya channels test telegram")}`);
    return;
  }
  const channels = await fetchChannels();
  const ch = channels.find((c) => c.id === id);
  if (!ch) {
    console.log(`${A.red("Channel not found:")} ${id}`);
    return;
  }
  if (!ch.configured) {
    console.log(`${A.red("Channel not configured:")} ${id}`);
    return;
  }
  // For webhook: just hit the URL with a test payload
  if (ch.type === "webhook") {
    try {
      const r = await fetch(`http://127.0.0.1:${GW_PORT}/channel/webhook/webhook`, {
        method: "POST",
        headers: withAuth({ "content-type": "application/json" }),
        body: JSON.stringify({ from: "test", text: "🧪 mya channels test", target: "test" }),
      });
      console.log(r.ok ? `${A.green("✓ Webhook OK")}` : `${A.red("✗ Webhook failed:")} ${r.status}`);
    } catch (e) {
      console.log(`${A.red("✗ Error:")} ${(e as Error).message}`);
    }
    return;
  }
  // For other channels: check the health via /status
  console.log(`${A.green("✓ Channel configured:")} ${id}`);
  console.log(`  Type:    ${ch.type}`);
  console.log(`  Alias:   ${ch.alias ?? "(default)"}`);
  console.log(`  Health:  ${ch.health}`);
  console.log(`${A.muted("Send a real message via the channel to fully test.")}`);
}

export async function channelsAdd(type?: string, alias?: string): Promise<void> {
  if (!type) {
    console.log(`${A.bold("Available channel types:")} telegram, discord, slack, email, webhook`);
    console.log("");
    console.log(`${A.bold("Usage:")} mya channels add <type> [alias]`);
    console.log("");
    console.log(`${A.bold("Examples:")}`);
    console.log(`  mya channels add telegram`);
    console.log(`  mya channels add telegram bot2   ${A.muted("# multi-bot: TELEGRAM_BOT_TOKEN_BOT2")}`);
    console.log("");
    console.log(`${A.bold("Setup:")} set the env var, then restart gateway.`);
    return;
  }
  const envVar = `TELEGRAM_DISCORD_SLACK_EMAIL_WEBHOOK`.split("_"); // not real
  const typeUpper = type.toUpperCase();
  const varName = alias
    ? `${typeUpper}_BOT_TOKEN_${alias.toUpperCase()}`
    : type === "email"
      ? "EMAIL_API_KEY"
      : type === "webhook"
        ? "WEBHOOK_URL"
        : `${typeUpper}_BOT_TOKEN`;
  console.log(`${A.bold("Add channel:")} ${type}${alias ? ` (${alias})` : ""}`);
  console.log(`  Set env var: ${A.accent(varName)}=<value>`);
  console.log(`  Then restart: ${A.accent("mya serve")}`);
  console.log("");
  switch (type) {
    case "telegram": console.log(`  Get a bot token: ${A.muted("https://t.me/BotFather")}`); break;
    case "discord":  console.log(`  Get a bot token: ${A.muted("https://discord.com/developers/applications")}`); break;
    case "slack":    console.log(`  Get a bot token: ${A.muted("https://api.slack.com/apps")}`); break;
    case "email":    console.log(`  Get an API key:  ${A.muted("https://resend.com/api-keys")} (or SendGrid)`); break;
    case "webhook":  console.log(`  Set URL to your HTTP endpoint.`); break;
    default:         console.log(`  ${A.yellow("Unknown type.")}`);
  }
}
