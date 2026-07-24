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
import { nowWallclock } from "@my-agent/core";

// ─── Core types ──────────────────────────────────────────────────────────────

/** Supported channel types. */
export type ChannelType = "whatsapp" | "matrix" | "signal";

/** An inbound or outbound message on any channel. */
export interface ChannelMessage {
  id: string;
  channel: ChannelType;
  /** Unique conversation identifier (jid, room id, phone number…). */
  chatId: string;
  text: string;
  fromMe: boolean;
  timestamp: number;
}

/** Result of a send attempt. */
export interface SendResult {
  ok: boolean;
  /** Platform-assigned message id (present when ok). */
  messageId?: string;
  error?: string;
  /** Number of retry attempts made (0 on first-try success). */
  attempts?: number;
}

/** Generic transport handle returned by a transport factory. */
export interface TransportHandle {
  sendMessage(chatId: string, text: string): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

/** A factory that creates a transport handle for a channel adapter. */
export type TransportFactory<TConfig = Record<string, unknown>> = (
  config: TConfig,
  onMessage: (msg: ChannelMessage) => void,
) => Promise<TransportHandle>;

/** Ack state for a sent message. */
export type AckState = "pending" | "delivered" | "failed";

/** Per-chat session tracking. */
export interface ChatSession {
  chatId: string;
  messages: ChannelMessage[];
  createdAt: number;
  lastActivity: number;
}

/** Options for a channel adapter (shared by all adapters). */
export interface ChannelAdapterOptions {
  maxRetries?: number;
  retryBaseMs?: number;
}

// ─── Base ChannelAdapter ──────────────────────────────────────────────────────

/**
 * Abstract base for channel adapters. Implements connection lifecycle,
 * message routing, ack/retry, and session-per-chat tracking.
 *
 * Subclasses implement `createTransport()` to produce the platform-specific
 * transport handle (DI for tests).
 */
export abstract class BaseChannelAdapter<TConfig = Record<string, unknown>>
  implements ChannelAdapter
{
  abstract readonly type: ChannelType;

  protected handle: TransportHandle | null = null;
  private connected = false;
  private readonly sessions = new Map<string, ChatSession>();
  private readonly pending = new Map<string, { state: AckState; attempts: number; error?: string }>();
  private readonly messageHandlers = new Set<(msg: ChannelMessage) => Promise<void>>();
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(
    protected readonly config: TConfig,
    opts?: ChannelAdapterOptions,
  ) {
    this.maxRetries = opts?.maxRetries ?? 3;
    this.retryBaseMs = opts?.retryBaseMs ?? 200;
  }

  /** Subclass: create the transport handle from config + message callback. */
  protected abstract createTransport(
    onMessage: (msg: ChannelMessage) => void,
  ): Promise<TransportHandle>;

  // ── Connection lifecycle ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;
    this.handle = await this.createTransport((msg) => {
      this.recordInbound(msg);
      for (const h of this.messageHandlers) void h(msg);
    });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    if (this.handle) {
      try {
        await this.handle.close();
      } catch {
        // Fail-safe: disconnect always succeeds.
      }
      this.handle = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Message sending with ack/retry ────────────────────────────────────────

  /**
   * Send a message to a chat. Retries on failure with exponential backoff
   * up to `maxRetries`. Records the message in the chat session.
   */
  async send(chatId: string, text: string): Promise<SendResult> {
    if (!this.connected || !this.handle) {
      return { ok: false, error: `${this.type}: not connected`, attempts: 0 };
    }
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.handle.sendMessage(chatId, text);
        const msg: ChannelMessage = {
          id: result.messageId,
          channel: this.type,
          chatId,
          text,
          fromMe: true,
          timestamp: nowWallclock(),
        };
        this.recordOutbound(msg);
        this.pending.set(result.messageId, { state: "delivered", attempts: attempt });
        return { ok: true, messageId: result.messageId, attempts: attempt };
      } catch (e) {
        lastError = (e as Error).message;
        if (attempt < this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** attempt);
        }
      }
    }
    // All retries exhausted — record as failed.
    const failId = `fail:${this.type}:${chatId}:${nowWallclock()}`;
    this.pending.set(failId, { state: "failed", attempts: this.maxRetries, error: lastError });
    return { ok: false, error: lastError, attempts: this.maxRetries };
  }

  // ── Message receiving ─────────────────────────────────────────────────────

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.messageHandlers.add(handler);
  }

  // ── Session tracking ──────────────────────────────────────────────────────

  /** Get or create a session for a chat id. */
  getSession(chatId: string): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      const now = nowWallclock();
      session = { chatId, messages: [], createdAt: now, lastActivity: now };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  /** All known chat sessions. */
  getSessions(): ChatSession[] {
    return [...this.sessions.values()];
  }

  /** Pending (unacked or failed) messages for a chat. */
  pendingMessages(chatId: string): Array<{ messageId: string; state: AckState; attempts: number }> {
    const session = this.sessions.get(chatId);
    if (!session) return [];
    return session.messages
      .filter((m) => m.fromMe && this.pending.has(m.id))
      .map((m) => {
        const p = this.pending.get(m.id)!;
        return { messageId: m.id, state: p.state, attempts: p.attempts };
      });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private recordInbound(msg: ChannelMessage): void {
    const session = this.getSession(msg.chatId);
    session.messages.push(msg);
    session.lastActivity = nowWallclock();
  }

  private recordOutbound(msg: ChannelMessage): void {
    const session = this.getSession(msg.chatId);
    session.messages.push(msg);
    session.lastActivity = nowWallclock();
  }
}

/**
 * The public adapter interface (implemented by {@link BaseChannelAdapter}
 * and all concrete adapters).
 */
export interface ChannelAdapter {
  readonly type: ChannelType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  send(chatId: string, text: string): Promise<SendResult>;
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void;
}

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

/** Promise-based sleep (used for retry backoff). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Concrete adapter re-exports ─────────────────────────────────────────────

export { WhatsAppAdapter } from "./whatsapp.js";
export type { WhatsAppConfig, WhatsAppTransportFactory } from "./whatsapp.js";
export { MatrixAdapter } from "./matrix.js";
export type { MatrixConfig, MatrixTransportFactory } from "./matrix.js";
