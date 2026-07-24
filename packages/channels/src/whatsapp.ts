/**
 * WhatsApp channel adapter (Frontier §P3-3).
 *
 * Wraps a Baileys-like transport interface. In production, the host injects a
 * real Baileys connection factory; in tests, a mock transport is used.
 *
 * Transport contract (mimics Baileys `makeWASocket`):
 *   - `connect()` → starts the socket, authenticates via session data / QR.
 *   - `sendMessage(jid, text)` → returns `{ key: { id } }`.
 *   - `ev.on("messages.upsert", cb)` → inbound messages.
 *
 * JID format: `<phone>@s.whatsapp.net` (individual) or `<id>@g.us` (group).
 *
 * Source: Frontier §P3-3; Baileys library API surface.
 */
import {
  BaseChannelAdapter,
  type ChannelMessage,
  type TransportHandle,
  type ChannelAdapterOptions,
} from "./base-adapter.js";

/** WhatsApp-specific configuration. */
export interface WhatsAppConfig {
  /** Session restore data (serialized Baileys auth state). */
  sessionData?: string;
  /** Phone number for identification (informational). */
  phoneNumber?: string;
}

/** Injectable transport factory for the WhatsApp adapter. */
export type WhatsAppTransportFactory = (
  config: WhatsAppConfig,
  onMessage: (msg: ChannelMessage) => void,
) => Promise<TransportHandle>;

/**
 * WhatsApp channel adapter. Uses {@link BaseChannelAdapter} for lifecycle,
 * ack/retry, and session tracking. The transport is injected via the
 * constructor for testability.
 *
 * @example
 * ```ts
 * const adapter = new WhatsAppAdapter(
 *   { phoneNumber: "+1234567890" },
 *   mockTransportFactory,
 * );
 * await adapter.connect();
 * await adapter.send("1234567890@s.whatsapp.net", "Hello!");
 * ```
 */
export class WhatsAppAdapter extends BaseChannelAdapter<WhatsAppConfig> {
  readonly type = "whatsapp" as const;
  private readonly transportFactory: WhatsAppTransportFactory;

  constructor(
    config: WhatsAppConfig,
    transportFactory: WhatsAppTransportFactory,
    opts?: ChannelAdapterOptions,
  ) {
    super(config, opts);
    this.transportFactory = transportFactory;
  }

  protected async createTransport(
    onMessage: (msg: ChannelMessage) => void,
  ): Promise<TransportHandle> {
    return this.transportFactory(this.config, onMessage);
  }
}
