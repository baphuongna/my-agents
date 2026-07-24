/**
 * @my-agent/gateway — Bridge: @my-agent/channels adapters → local Channel.
 *
 * The new `@my-agent/channels` package provides transport-injected adapters
 * (`WhatsAppAdapter`, `MatrixAdapter`) with a lifecycle (connect/disconnect),
 * ack/retry, and session tracking. The gateway's existing `ChannelRegistry`
 * (in `channels.ts`) uses a different, richer interface (`Channel` with `id`,
 * `label`, `isConfigured()`, `health()`, `receive()`) that the `/status`
 * endpoint, cron delivery, and channel polling depend on.
 *
 * This bridge wraps a `@my-agent/channels` `ChannelAdapter` so it can be
 * registered in the local `ChannelRegistry` and appear in `/status` (and thus
 * the launcher's Channels tab) without changing the gateway's external HTTP/WS
 * behavior.
 *
 * Source: Frontier §P3-3; Item 17 gateway wiring.
 */
import type { Channel, ChannelMessage } from "./channels.js";
import {
  WhatsAppAdapter,
  MatrixAdapter,
  type WhatsAppConfig,
  type WhatsAppTransportFactory,
  type MatrixConfig,
  type MatrixTransportFactory,
  type ChannelAdapter,
  type ChannelType,
  type TransportHandle,
} from "@my-agent/channels";

/** Human-readable labels for each channel type. */
const TYPE_LABELS: Record<ChannelType, string> = {
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  signal: "Signal",
};

/**
 * Bridge: wraps a {@link ChannelAdapter} from `@my-agent/channels` into the
 * gateway's local {@link Channel} interface.
 *
 * - `id` / `type` come from `adapter.type`.
 * - `label` is derived from a human-readable map.
 * - `isConfigured()` is `true` — the adapter was explicitly instantiated from
 *   config (unlike env-var auto-discovery which may find partial creds).
 * - `send()` delegates to `adapter.send()` and maps `SendResult` → `{ ok, error? }`.
 * - `health()` reflects `adapter.isConnected()`.
 * - `receive()` returns `[]` — new-style adapters use push (`onMessage`), not poll.
 */
export class ChannelAdapterBridge implements Channel {
  readonly type: string;
  readonly label: string;
  private readonly _adapter: ChannelAdapter;

  constructor(adapter: ChannelAdapter) {
    this._adapter = adapter;
    this.type = adapter.type;
    this.label = TYPE_LABELS[adapter.type] ?? adapter.type;
  }

  /** Expose the underlying adapter (for connect/disconnect lifecycle). */
  get adapter(): ChannelAdapter {
    return this._adapter;
  }

  get id(): string {
    return this._adapter.type;
  }

  isConfigured(): boolean {
    return true;
  }

  validateConfig(): void {
    // Configuration is validated at adapter construction time.
  }

  async send(target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this._adapter.send(target, text);
    return { ok: res.ok, error: res.error };
  }

  async receive(): Promise<ChannelMessage[]> {
    return [];
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this._adapter.isConnected() ? "Healthy" : "Degraded";
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Gateway-level configuration for `@my-agent/channels` adapters.
 * Each entry maps to the corresponding adapter config in the channels package.
 */
export interface ChannelsPackageConfig {
  whatsapp?: {
    enabled: boolean;
    /** Session restore data (serialized Baileys auth state). */
    sessionData?: string;
    /** Phone number for identification (informational). */
    phoneNumber?: string;
  };
  matrix?: {
    enabled: boolean;
    /** Homeserver URL (e.g. `https://matrix.org`). */
    homeserver?: string;
    /** Bot access token. */
    accessToken?: string;
    /** Bot user id (e.g. `@bot:matrix.org`). */
    userId?: string;
  };
}

/**
 * Injectable transport factories. In production, the host (or SDK loader)
 * provides real Baileys / matrix-bot-sdk factories. In tests, mocks are used.
 * If a factory is absent, a placeholder transport is used (the adapter appears
 * in `/status` but cannot connect).
 */
export interface ChannelTransportFactories {
  whatsapp?: WhatsAppTransportFactory;
  matrix?: MatrixTransportFactory;
}

/**
 * Create a placeholder transport factory that rejects all sends with a clear
 * error. Used when no real SDK transport is available — the adapter is still
 * constructed and appears in `/status`, but `connect()` will succeed (no-op)
 * and `send()` will fail with a descriptive message.
 */
function placeholderTransportFactory(type: ChannelType): (
  _config: unknown,
  _onMessage: (msg: never) => void,
) => Promise<TransportHandle> {
  return async () => ({
    sendMessage: async () => {
      throw new Error(`${type}: no transport factory configured`);
    },
    close: async () => {},
  });
}

/**
 * Instantiate and register `@my-agent/channels` adapters (WhatsApp + Matrix)
 * into a local {@link ChannelRegistry}-compatible registry, wrapped via
 * {@link ChannelAdapterBridge}.
 *
 * @param registry  The local ChannelRegistry (or any object with
 *                  `register` + `get` methods).
 * @param config    Channel package config from the host config file.
 * @param transports Optional real transport factories. Falls back to
 *                   placeholder transports when absent.
 * @returns List of channel types that were registered.
 */
export function registerChannelsPackageAdapters(
  registry: { register: (c: Channel) => void; get: (id: string) => Channel | undefined },
  config: ChannelsPackageConfig,
  transports?: ChannelTransportFactories,
): ChannelType[] {
  const registered: ChannelType[] = [];

  // ── WhatsApp ──
  if (config.whatsapp?.enabled) {
    // Skip if the local registry already has a "whatsapp" channel (env-var
    // auto-discovery may have registered the Cloud API adapter).
    if (!registry.get("whatsapp")) {
      const waConfig: WhatsAppConfig = {
        sessionData: config.whatsapp.sessionData,
        phoneNumber: config.whatsapp.phoneNumber,
      };
      const factory = transports?.whatsapp ?? (placeholderTransportFactory("whatsapp") as unknown as WhatsAppTransportFactory);
      const adapter = new WhatsAppAdapter(waConfig, factory);
      registry.register(new ChannelAdapterBridge(adapter));
      registered.push("whatsapp");
    }
  }

  // ── Matrix ──
  if (config.matrix?.enabled) {
    if (!registry.get("matrix")) {
      const mxConfig: MatrixConfig = {
        homeserverUrl: config.matrix.homeserver ?? "",
        accessToken: config.matrix.accessToken ?? "",
        userId: config.matrix.userId,
      };
      const factory = transports?.matrix ?? (placeholderTransportFactory("matrix") as unknown as MatrixTransportFactory);
      const adapter = new MatrixAdapter(mxConfig, factory);
      registry.register(new ChannelAdapterBridge(adapter));
      registered.push("matrix");
    }
  }

  return registered;
}
