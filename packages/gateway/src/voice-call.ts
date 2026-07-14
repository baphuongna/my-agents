/**
 * @my-agent/gateway/voice-call — Twilio voice call channel (Phase E Gap 9).
 *
 * Implements the Channel interface for PSTN voice calls via Twilio.
 * Real-time audio uses Twilio Media Streams (WebSocket, mulaw 8kHz).
 *
 * Config: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 */
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { nowWallclock } from "@my-agent/core";
import type { Channel } from "./channels.js";

export interface VoiceCallOpts {
  timeout?: number;
  record?: boolean;
}

export interface ActiveCall {
  callSid: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound";
  startedAt: number;
  ws?: WebSocket;
}

/**
 * Voice call channel adapter. Routes PSTN calls to the agent via Twilio
 * Media Streams. Each call opens a WebSocket (mulaw 8kHz bidirectional audio).
 */
export class VoiceCallChannel implements Channel {
  readonly id = "voice-call";
  readonly type = "voice";
  readonly label = "Voice Call (Twilio)";
  private readonly calls = new Map<string, ActiveCall>();
  private wss?: WebSocketServer;

  constructor(
    private readonly opts: {
      accountSid?: string;
      authToken?: string;
      fromNumber?: string;
    } = {},
  ) {}

  isConfigured(): boolean {
    return !!(this.opts.accountSid && this.opts.authToken && this.opts.fromNumber);
  }

  validateConfig(): void {
    if (!this.opts.accountSid) throw new Error("TWILIO_ACCOUNT_SID required");
    if (!this.opts.authToken) throw new Error("TWILIO_AUTH_TOKEN required");
    if (!this.opts.fromNumber) throw new Error("TWILIO_FROM_NUMBER required");
  }

  health(): "Healthy" | "Degraded" | "Failed" {
    return this.isConfigured() ? "Healthy" : "Failed";
  }

  /** Attach a WebSocket server for Twilio Media Streams.
   * E-R1-1 fix: use noServer mode with path regex (ws does exact string match). */
  attachMediaStreamServer(server: Server, basePath = "/voice/stream"): void {
    // Use WebSocketServer in noServer mode + handleUpgrade for path-based routing
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
      if (!url.pathname.startsWith(basePath + "/")) return;
      const callSid = url.pathname.slice(basePath.length + 1) || "unknown";
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws, callSid);
      });
    });
  }

  /** Handle a new WS connection (extracted for clarity). */
  private handleConnection(ws: WebSocket, callSid: string): void {
    const call = this.calls.get(callSid);
    if (call) {
      call.ws = ws;
    } else {
      this.calls.set(callSid, {
        callSid, from: "", to: this.opts.fromNumber ?? "", direction: "inbound", startedAt: nowWallclock(), ws,
      });
    }
    ws.on("message", (data) => { void this.handleMediaFrame(callSid, data.toString()); });
    ws.on("close", () => { this.calls.delete(callSid); });
  }

  /** Process an incoming media frame (mulaw audio). */
  private async handleMediaFrame(callSid: string, frame: string): Promise<void> {
    try {
      const msg = JSON.parse(frame) as { event: string; media?: { payload?: string } };
      if (msg.event === "media" && msg.media?.payload) {
        // STT would process the mulaw audio here (Phase E Tier-2)
        void msg.media.payload;
      }
    } catch {
      // Non-JSON frame — ignore
    }
  }

  /** Place an outbound call via Twilio REST API. */
  async placeCall(to: string, opts: VoiceCallOpts = {}): Promise<string> {
    if (!this.isConfigured()) throw new Error("voice-call: not configured");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls.json`;
    const body = new URLSearchParams({
      To: to,
      From: this.opts.fromNumber!,
      Url: `${opts.record ? "record" : ""}`,  // TwiML webhook URL (Tier-2)
    });
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!resp.ok) throw new Error(`twilio call failed: ${resp.status}`);
    const data = await resp.json() as { sid: string };
    this.calls.set(data.sid, {
      callSid: data.sid,
      from: this.opts.fromNumber ?? "",
      to,
      direction: "outbound",
      startedAt: nowWallclock(),
    });
    return data.sid;
  }

  /** Play audio to the caller (mulaw 8kHz). */
  async playAudio(callSid: string, audio: Buffer): Promise<void> {
    const call = this.calls.get(callSid);
    if (!call?.ws || call.ws.readyState !== WebSocket.OPEN) return;
    // Send audio as Twilio Media Stream frame
    call.ws.send(JSON.stringify({
      event: "media",
      streamSid: callSid,
      media: { payload: audio.toString("base64") },
    }));
  }

  /** Hang up an active call. */
  async hangup(callSid: string): Promise<void> {
    const call = this.calls.get(callSid);
    if (call?.ws) call.ws.close();
    if (this.isConfigured()) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls/${callSid}.json`;
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64"),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Status: "completed" }),
      }).catch(() => {});
    }
    this.calls.delete(callSid);
  }

  /** List active calls. */
  listActive(): ActiveCall[] {
    return [...this.calls.values()];
  }

  // Channel interface (minimal — voice is event-driven via WS)
  async send(target: string, _text: string): Promise<{ ok: boolean; error?: string }> {
    // Voice calls use playAudio for real-time audio, not text send
    void target;
    return { ok: true };
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {
    for (const [sid] of this.calls) await this.hangup(sid);
    this.wss?.close();
  }
}
