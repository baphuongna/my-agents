/**
 * Shared channel types + BaseChannelAdapter.
 *
 * Extracted from index.ts to break the circular dependency:
 * whatsapp.ts/matrix.ts import BaseChannelAdapter from index.ts,
 * but index.ts re-exports WhatsAppAdapter/MatrixAdapter from those
 * files — creating a cycle where BaseChannelAdapter is undefined at
 * class-definition time. Moving the base here breaks the cycle.
 */
import { nowWallclock } from "@my-agent/core";


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
/** Promise-based sleep (used for retry backoff). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
