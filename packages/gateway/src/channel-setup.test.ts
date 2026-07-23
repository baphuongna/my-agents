/**
 * @my-agent/gateway/channel-setup.test — channel auto-configuration wizard tests.
 *
 * Covers CHANNEL_SETUP shape, channelsConfigPath, loadChannelsConfig,
 * detectChannels, saveChannelCredential, autoConfigureChannels, and
 * channelStatusSummary. Isolated via a temp HOME so no real config files are
 * touched (env keys are saved/restored individually — never reassign process.env,
 * which breaks os.homedir()'s env reads).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHANNEL_SETUP,
  channelsConfigPath,
  loadChannelsConfig,
  detectChannels,
  saveChannelCredential,
  autoConfigureChannels,
  channelStatusSummary,
} from "./channel-setup.js";
import { ChannelRegistry } from "./channels.js";

let tempHome: string;
let savedHome: string | undefined;
const savedCreds = new Map<string, string | undefined>();

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "gw-setup-"));
  savedHome = process.env.HOME;
  // Isolate os.homedir() + the config file path to the temp dir.
  process.env.HOME = tempHome;
  // Wipe any channel-credential env vars so detection starts clean.
  savedCreds.clear();
  for (const k of Object.keys(CHANNEL_SETUP)) {
    for (const cred of CHANNEL_SETUP[k]!.credentials) {
      savedCreds.set(cred.envVar, process.env[cred.envVar]);
      delete process.env[cred.envVar];
    }
  }
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  // Restore env keys individually (never reassign process.env wholesale).
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  for (const [k, v] of savedCreds) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Write a channels.json config into the temp HOME. */
function writeConfig(cfg: Record<string, unknown>): void {
  mkdirSync(join(tempHome, ".mya", "agent"), { recursive: true });
  writeFileSync(channelsConfigPath(), JSON.stringify(cfg));
}

// ─── CHANNEL_SETUP shape ──────────────────────────────────────────────────────

describe("CHANNEL_SETUP", () => {
  it("contains the expected core channels", () => {
    for (const id of ["telegram", "discord", "slack", "email", "webhook", "whatsapp", "signal", "matrix"]) {
      expect(CHANNEL_SETUP[id]).toBeDefined();
    }
  });

  it("every channel has a name and at least one credential spec", () => {
    for (const spec of Object.values(CHANNEL_SETUP)) {
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.credentials.length).toBeGreaterThanOrEqual(1);
      for (const cred of spec.credentials) {
        expect(cred.envVar.length).toBeGreaterThan(0);
        expect(typeof cred.label).toBe("string");
      }
    }
  });

  it("email channel requires three credentials", () => {
    const ids = CHANNEL_SETUP.email.credentials.map((c) => c.envVar);
    expect(ids).toContain("EMAIL_API_KEY");
    expect(ids).toContain("EMAIL_PROVIDER");
    expect(ids).toContain("EMAIL_FROM");
  });
});

// ─── channelsConfigPath ───────────────────────────────────────────────────────

describe("channelsConfigPath", () => {
  it("points to <HOME>/.mya/agent/channels.json (under temp HOME)", () => {
    expect(channelsConfigPath()).toBe(join(tempHome, ".mya", "agent", "channels.json"));
  });

  it("always ends with the canonical relative path", () => {
    expect(channelsConfigPath().endsWith(`${join(".mya", "agent", "channels.json")}`)).toBe(true);
  });
});

// ─── loadChannelsConfig ───────────────────────────────────────────────────────

describe("loadChannelsConfig", () => {
  it("returns an empty record when no config file exists", () => {
    expect(loadChannelsConfig()).toEqual({});
  });

  it("loads a written config file", () => {
    writeConfig({
      telegram: { id: "telegram", enabled: true, credentials: { TELEGRAM_BOT_TOKEN: "tok" }, targets: {} },
    });
    const loaded = loadChannelsConfig();
    expect(loaded.telegram?.credentials.TELEGRAM_BOT_TOKEN).toBe("tok");
  });

  it("returns empty record for a corrupt config file", () => {
    mkdirSync(join(tempHome, ".mya", "agent"), { recursive: true });
    writeFileSync(channelsConfigPath(), "not valid json {{{");
    expect(loadChannelsConfig()).toEqual({});
  });
});

// ─── detectChannels ───────────────────────────────────────────────────────────

describe("detectChannels", () => {
  it("returns one detection per channel in CHANNEL_SETUP", () => {
    const detections = detectChannels();
    expect(detections).toHaveLength(Object.keys(CHANNEL_SETUP).length);
    for (const d of detections) {
      expect(typeof d.id).toBe("string");
      expect(typeof d.name).toBe("string");
      expect(typeof d.configured).toBe("boolean");
      expect(Array.isArray(d.missing)).toBe(true);
      expect(Array.isArray(d.found)).toBe(true);
    }
  });

  it("reports a channel as configured once all its env vars are set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const detections = detectChannels();
    const tg = detections.find((d) => d.id === "telegram")!;
    expect(tg.configured).toBe(true);
    expect(tg.missing).toHaveLength(0);
    expect(tg.found.map((f) => f.envVar)).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("reports a channel as not configured when credentials are missing", () => {
    const detections = detectChannels();
    const tg = detections.find((d) => d.id === "telegram")!;
    expect(tg.configured).toBe(false);
    expect(tg.missing.map((m) => m.envVar)).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("treats a multi-credential channel (email) as not configured until ALL are set", () => {
    process.env.EMAIL_API_KEY = "k";
    const email = detectChannels().find((d) => d.id === "email")!;
    expect(email.configured).toBe(false);
    expect(email.missing.length).toBe(2);
  });

  it("reads credentials from the config file when env vars are absent", () => {
    writeConfig({
      telegram: { id: "telegram", enabled: true, credentials: { TELEGRAM_BOT_TOKEN: "fromcfg" }, targets: {} },
    });
    const tg = detectChannels().find((d) => d.id === "telegram")!;
    expect(tg.configured).toBe(true);
  });
});

// ─── saveChannelCredential ────────────────────────────────────────────────────

describe("saveChannelCredential", () => {
  it("sets the env var for immediate use", () => {
    saveChannelCredential("telegram", "TELEGRAM_BOT_TOKEN", "saved-tok");
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe("saved-tok");
  });

  it("persists the credential to channels.json", () => {
    saveChannelCredential("telegram", "TELEGRAM_BOT_TOKEN", "persist-tok");
    expect(existsSync(channelsConfigPath())).toBe(true);
    const cfg = loadChannelsConfig();
    expect(cfg.telegram?.credentials.TELEGRAM_BOT_TOKEN).toBe("persist-tok");
    expect(cfg.telegram?.enabled).toBe(true);
  });

  it("creates the config directory if it does not exist", () => {
    expect(existsSync(join(tempHome, ".mya", "agent"))).toBe(false);
    saveChannelCredential("discord", "DISCORD_BOT_TOKEN", "dt");
    expect(existsSync(channelsConfigPath())).toBe(true);
  });

  it("merges into an existing config without clobbering other channels", () => {
    saveChannelCredential("telegram", "TELEGRAM_BOT_TOKEN", "t1");
    saveChannelCredential("discord", "DISCORD_BOT_TOKEN", "d1");
    const cfg = loadChannelsConfig();
    expect(cfg.telegram?.credentials.TELEGRAM_BOT_TOKEN).toBe("t1");
    expect(cfg.discord?.credentials.DISCORD_BOT_TOKEN).toBe("d1");
  });
});

// ─── autoConfigureChannels ────────────────────────────────────────────────────

describe("autoConfigureChannels", () => {
  /** Build a registry with stub channels whose isConfigured() reflects env. */
  function makeRegistry(ids: string[]): ChannelRegistry {
    const reg = new ChannelRegistry();
    for (const id of ids) {
      const envVar = CHANNEL_SETUP[id]!.credentials[0]!.envVar;
      reg.register({
        id,
        type: id,
        label: id,
        isConfigured: () => !!process.env[envVar],
        validateConfig: () => {},
        send: async () => ({ ok: true }),
        health: () => "Healthy" as const,
      });
    }
    return reg;
  }

  it("activates channels that are fully configured via env", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const reg = makeRegistry(["telegram", "discord"]);
    const { activated, skipped } = autoConfigureChannels(reg);
    expect(activated).toContain("telegram");
    expect(skipped).toContain("discord");
  });

  it("applies a stored config-file credential and activates the channel", () => {
    saveChannelCredential("telegram", "TELEGRAM_BOT_TOKEN", "cfgtok");
    // Clear the env var; autoConfigure should re-apply from the config file.
    delete process.env.TELEGRAM_BOT_TOKEN;
    const reg = makeRegistry(["telegram"]);
    const { activated } = autoConfigureChannels(reg);
    expect(activated).toContain("telegram");
    // env var should have been re-applied.
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe("cfgtok");
  });

  it("configures the registry with enabled:true for activated channels", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const reg = makeRegistry(["telegram"]);
    autoConfigureChannels(reg);
    expect(reg.getConfig("telegram")?.enabled).toBe(true);
  });

  it("skips all channels when none are configured", () => {
    const reg = makeRegistry(["telegram", "discord", "slack"]);
    const { activated, skipped } = autoConfigureChannels(reg);
    expect(activated).toHaveLength(0);
    expect(skipped).toHaveLength(3);
  });
});

// ─── channelStatusSummary ─────────────────────────────────────────────────────

describe("channelStatusSummary", () => {
  it("returns a line per channel", () => {
    const summary = channelStatusSummary();
    expect(summary.split("\n").length).toBe(Object.keys(CHANNEL_SETUP).length);
  });

  it("marks a configured channel with the configured icon", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const summary = channelStatusSummary();
    expect(summary).toContain("✅");
    expect(summary).toContain("credential(s) found");
  });

  it("lists missing credential env vars for an unconfigured channel", () => {
    const summary = channelStatusSummary();
    expect(summary).toContain("missing:");
    expect(summary).toContain("TELEGRAM_BOT_TOKEN");
  });
});
