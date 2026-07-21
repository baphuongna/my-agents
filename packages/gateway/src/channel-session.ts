/**
 * @my-agent/gateway — Channel session router.
 *
 * Maps inbound channel messages to agent sessions. Each (channelId, userId)
 * pair gets a dedicated session so conversations are continuous across
 * multiple messages from the same user on the same platform.
 *
 * Flow:
 *   1. Channel adapter receives a message (webhook push or poll)
 *   2. ChannelSessionRouter.route(msg) → finds or creates a session
 *   3. Agent runs the prompt → produces response
 *   4. Router sends response back via the channel
 */
import type { ChannelMessage } from "./channels.js";
import type { ChannelRegistry } from "./channels.js";
import { nowWallclock } from "@my-agent/core";
import { scanInject } from "@my-agent/prompts";

/** A session bound to a channel conversation. */
export interface ChannelSession {
  /** Composite key: `${channelId}:${userId}`. */
  key: string;
  channelId: string;
  userId: string;
  /** Agent session ID (pi session or mya session). */
  sessionId: string;
  /** Last activity timestamp (ms). */
  lastActivity: number;
  /** Conversation history (for context — bounded). */
  history: { role: "user" | "assistant"; text: string; ts: number }[];
}

/** Options for the router. */
export interface ChannelSessionRouterOptions {
  /** Max history entries per session (default 50). */
  maxHistory?: number;
  /** Idle TTL in seconds before session is evicted (default 3600). */
  idleTtlSec?: number;
}

/** Event emitted by the channel session router (for TUI visibility). */
export type ChannelEvent =
  | { type: "channel_message"; sessionId: string; channelId: string; from: string; text: string; ts: number }
  | { type: "agent_response"; sessionId: string; channelId: string; from: string; text: string; ts: number }
  | { type: "session_created"; sessionId: string; channelId: string; userId: string };

/**
 * Routes inbound channel messages to sessions. Each (channel, user) pair
 * gets a continuous conversation. The router does NOT run the agent itself —
 * it delegates to a caller-provided handler that receives the prompt +
 * session context and returns the agent's response text.
 */
export class ChannelSessionRouter {
  private sessions = new Map<string, ChannelSession>();
  private maxHistory: number;
  private idleTtlSec: number;

  /** The agent handler: receives (session, prompt) → returns response text. */
  private agentHandler?: (session: ChannelSession, prompt: string) => Promise<string>;

  /**
   * Event listener: called when a message is received from a channel.
   * Used to forward channel events to the TUI for real-time visibility.
   */
  private eventListeners = new Set<(event: ChannelEvent) => void>();

  /**
   * Optional command checker: if set, messages starting with "/" are checked
   * against the shared command registry FIRST. If it returns a string, that's
   * the command output (agent is NOT invoked). If null, falls through to agent.
   */
  commandChecker?: (msg: string, ctx: { channelId: string; userId: string }) => Promise<string | null>;

  constructor(opts: ChannelSessionRouterOptions = {}) {
    this.maxHistory = opts.maxHistory ?? 50;
    this.idleTtlSec = opts.idleTtlSec ?? 3600;
  }

  /** Subscribe to channel events (incoming messages, agent responses). */
  onEvent(listener: (event: ChannelEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: ChannelEvent): void {
    for (const l of this.eventListeners) {
      try { l(event); } catch { /* */ }
    }
  }

  /** Set the agent handler (called when a message arrives). */
  onPrompt(handler: (session: ChannelSession, prompt: string) => Promise<string>): void {
    this.agentHandler = handler;
  }

  /** Get or create a session for a (channel, user) pair. */
  getOrCreateSession(channelId: string, userId: string): ChannelSession {
    const key = `${channelId}:${userId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        key,
        channelId,
        userId,
        sessionId: `ch-${channelId}-${userId.slice(0, 8)}-${nowWallclock().toString(36)}`,
        lastActivity: nowWallclock(),
        history: [],
      };
      this.sessions.set(key, session);
      this.emit({ type: "session_created", sessionId: session.sessionId, channelId, userId });
    }
    session.lastActivity = nowWallclock();
    return session;
  }

  /** Get an existing session (without creating). */
  getSession(channelId: string, userId: string): ChannelSession | undefined {
    return this.sessions.get(`${channelId}:${userId}`);
  }

  /** List all active sessions. */
  listSessions(): ChannelSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Route an inbound message: find/create session → run agent → return response.
   * The caller is responsible for sending the response back via the channel.
   */
  async route(msg: ChannelMessage): Promise<{ session: ChannelSession; response: string } | { error: string }> {
    const session = this.getOrCreateSession(msg.channelId, msg.from);
    this.emit({ type: "channel_message", sessionId: session.sessionId, channelId: msg.channelId, from: msg.from, text: msg.text, ts: msg.ts });

    // ── Check for slash commands FIRST (before agent) ──
    // This lets channel users run /audit, /skills, /mcp, etc. — same as TUI.
    if (this.commandChecker && msg.text.trim().startsWith("/")) {
      try {
        const cmdResult = await this.commandChecker(msg.text, {
          channelId: msg.channelId,
          userId: msg.from,
        });
        if (cmdResult !== null) {
          session.history.push({ role: "user", text: msg.text, ts: msg.ts });
          session.history.push({ role: "assistant", text: cmdResult, ts: msg.ts });
          return { session, response: cmdResult };
        }
      } catch {
        // command failed → fall through to agent
      }
    }

    // Add user message to history
    // R6-1 fix: scan inbound channel messages for prompt injection (§12 R27-15).
    // scanInject returns [BLOCKED: ...] fence when a pattern matches.
    const safeText = scanInject([msg.text], "context").trim();
    session.history.push({ role: "user", text: safeText, ts: msg.ts });
    if (session.history.length > this.maxHistory * 2) {
      session.history = session.history.slice(-this.maxHistory);
    }

    if (!this.agentHandler) {
      return { error: "no agent handler registered (call onPrompt first)" };
    }

    try {
      // R4-2 security fix: use safeText (scanned) not raw msg.text in prompt.
      const contextPrompt = this.buildContextPrompt(session, safeText);
      const response = await this.agentHandler(session, contextPrompt);

      // Add assistant response to history
      session.history.push({ role: "assistant", text: response, ts: msg.ts });
      if (session.history.length > this.maxHistory * 2) {
        session.history = session.history.slice(-this.maxHistory);
      }
      this.emit({ type: "agent_response", sessionId: session.sessionId, channelId: msg.channelId, from: msg.from, text: response, ts: msg.ts });

      return { session, response };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  /** Build a prompt with conversation context. */
  private buildContextPrompt(session: ChannelSession, currentText: string): string {
    if (session.history.length <= 1) {
      return currentText; // first message — no context needed
    }
    const recent = session.history.slice(-10, -1); // exclude current
    const context = recent
      .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`)
      .join("\n");
    return `Previous conversation:\n${context}\n\nUser: ${currentText}`;
  }

  /** Evict idle sessions (call periodically). */
  sweepIdle(): number {
    const now = nowWallclock();
    let evicted = 0;
    for (const [key, session] of this.sessions) {
      if (now - session.lastActivity > this.idleTtlSec * 1000) {
        this.sessions.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Evict a specific session. */
  evict(channelId: string, userId: string): boolean {
    return this.sessions.delete(`${channelId}:${userId}`);
  }

  /** Get session count. */
  get size(): number {
    return this.sessions.size;
  }
}
