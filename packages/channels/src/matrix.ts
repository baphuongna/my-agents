/**
 * Matrix channel adapter (Frontier §P3-3).
 *
 * Wraps a matrix-bot-sdk-like transport interface. In production, the host
 * injects a real Matrix client; in tests, a mock transport is used.
 *
 * Transport contract (mimics matrix-bot-sdk `MatrixClient`):
 *   - `connect()` → starts sync, authenticates via access token.
 *   - `sendText(roomId, text)` → returns `{ event_id }`.
 *   - `on("room.message", cb)` → inbound messages.
 *
 * Room id format: `!opaque:server.domain`.
 *
 * Source: Frontier §P3-3; matrix-bot-sdk API surface.
 */
import {
  BaseChannelAdapter,
  type ChannelMessage,
  type TransportHandle,
  type ChannelAdapterOptions,
} from "./index.js";

/** Matrix-specific configuration. */
export interface MatrixConfig {
  /** Homeserver URL (e.g. `https://matrix.org`). */
  homeserverUrl: string;
  /** Bot access token. */
  accessToken: string;
  /** Bot user id (e.g. `@bot:matrix.org`). */
  userId?: string;
}

/** Injectable transport factory for the Matrix adapter. */
export type MatrixTransportFactory = (
  config: MatrixConfig,
  onMessage: (msg: ChannelMessage) => void,
) => Promise<TransportHandle>;

/**
 * Matrix channel adapter. Uses {@link BaseChannelAdapter} for lifecycle,
 * ack/retry, and session tracking. The transport is injected via the
 * constructor for testability.
 *
 * @example
 * ```ts
 * const adapter = new MatrixAdapter(
 *   { homeserverUrl: "https://matrix.org", accessToken: "syt_..." },
 *   mockTransportFactory,
 * );
 * await adapter.connect();
 * await adapter.send("!room:matrix.org", "Hello!");
 * ```
 */
export class MatrixAdapter extends BaseChannelAdapter<MatrixConfig> {
  readonly type = "matrix" as const;
  private readonly transportFactory: MatrixTransportFactory;

  constructor(
    config: MatrixConfig,
    transportFactory: MatrixTransportFactory,
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
