/**
 * @my-agent/channels — multi-platform messaging adapters (Frontier §P3-3).
 *
 * Provides a unified channel abstraction over messaging platforms (WhatsApp,
 * Matrix, Signal). Each adapter implements {@link ChannelAdapter} with a
 * consistent lifecycle: connect → send/receive → disconnect.
 *
 * Design principles:
 *   - **Injectable transport** — every adapter accepts a transport factory so
 *     tests can mock the network layer without external dependencies.
 *   - **Session per chat** — each conversation has independent state
 *     (message history, ack tracking).
 *   - **Ack/retry** — failed sends are retried with exponential backoff up to
 *     `maxRetries` (default 3). Unacked messages are visible via
 *     `pendingMessages(chatId)`.
 *   - **Fail-safe** — disconnect always runs even if the transport is already
 *     closed.
 *
 * Source: Frontier §P3-3 "More channels (WhatsApp/Signal/Matrix)".
 */

// ─── Core types ──────────────────────────────────────────────────────────────

// ─── Shared types + BaseChannelAdapter (extracted to break cycle) ────────
export {
  type ChannelType,
  type ChannelMessage,
  type SendResult,
  type TransportHandle,
  type TransportFactory,
  type AckState,
  type ChatSession,
  type ChannelAdapterOptions,
  BaseChannelAdapter,
  type ChannelAdapter,
} from "./base-adapter.js";

// Re-import for local use in ChannelRegistry/ChannelRouter.
import type {
  ChannelType,
  ChannelMessage,
  SendResult,
  ChannelAdapter,
} from "./base-adapter.js";

// ─── Registry & Router ───────────────────────────────────────────────────────

/**
 * Central registry for channel adapters. Supports dynamic registration,
 * lookup by type, and broadcasting to all connected channels.
 */
export class ChannelRegistry {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.type)) {
      throw new Error(`channels: adapter for "${adapter.type}" already registered`);
    }
    this.adapters.set(adapter.type, adapter);
  }

  unregister(type: ChannelType): boolean {
    return this.adapters.delete(type);
  }

  get(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  list(): ChannelType[] {
    return [...this.adapters.keys()];
  }

  get size(): number {
    return this.adapters.size;
  }

  /** Connect all registered adapters. */
  async connectAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.connect()));
  }

  /** Disconnect all registered adapters. */
  async disconnectAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((a) => a.disconnect()));
  }
}

/**
 * Routes inbound messages to a handler based on channel type. Supports
 * fan-out (one handler receives from all channels) and per-channel handlers.
 */
export class ChannelRouter {
  private readonly globalHandlers = new Set<(msg: ChannelMessage) => Promise<void>>();
  private readonly channelHandlers = new Map<ChannelType, Set<(msg: ChannelMessage) => Promise<void>>>();

  constructor(private readonly registry: ChannelRegistry) {}

  /** Route all inbound messages from all adapters to a single handler. */
  onAny(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.globalHandlers.add(handler);
    for (const adapter of this.registry.list()) {
      this.registry.get(adapter)?.onMessage(handler);
    }
  }

  /** Route inbound messages from a specific channel to a handler. */
  onChannel(type: ChannelType, handler: (msg: ChannelMessage) => Promise<void>): void {
    let handlers = this.channelHandlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(type, handlers);
    }
    handlers.add(handler);
    this.registry.get(type)?.onMessage(handler);
  }

  /**
   * Send a message to a specific chat on a specific channel.
   * Throws if the channel is not registered.
   */
  async send(type: ChannelType, chatId: string, text: string): Promise<SendResult> {
    const adapter = this.registry.get(type);
    if (!adapter) return { ok: false, error: `channels: no adapter for "${type}"` };
    return adapter.send(chatId, text);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

// ─── Concrete adapter re-exports ─────────────────────────────────────────────

export { WhatsAppAdapter } from "./whatsapp.js";
export type { WhatsAppConfig, WhatsAppTransportFactory } from "./whatsapp.js";
export { MatrixAdapter } from "./matrix.js";
export type { MatrixConfig, MatrixTransportFactory } from "./matrix.js";
