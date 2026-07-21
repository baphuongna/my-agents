/**
 * @my-agent/gateway — Additional channel adapters (E3).
 * MSGraph, Feishu, WeChat, Lark — extends the 8 built-in adapters.
 * Source: §12 Channels, PLAN-FEATURES E3.
 */
import type { Channel, ChannelMessage } from "./channels.js";

/** MSGraph (Microsoft Teams/Email/Calendar) channel adapter. */
export class MsGraphChannel implements Channel {
  readonly id: string;
  readonly type = "msgraph";
  readonly label = "Microsoft Graph";
  constructor(id = "msgraph") { this.id = id; }
  isConfigured(): boolean { return !!process.env.MSGRAPH_CLIENT_ID && !!process.env.MSGRAPH_CLIENT_SECRET; }
  validateConfig(): void { if (!this.isConfigured()) throw new Error("MSGRAPH_CLIENT_ID + MSGRAPH_CLIENT_SECRET required"); }
  async send(target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const token = process.env.MSGRAPH_ACCESS_TOKEN;
    if (!token) return { ok: false, error: "MSGRAPH_ACCESS_TOKEN not set" };
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${target}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: { content: text, contentType: "text" } }),
        signal: AbortSignal.timeout(15_000),
      });
      return { ok: res.ok, error: res.ok ? undefined : `MSGraph API ${res.status}` };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  health(): "Healthy" | "Degraded" | "Failed" { return this.isConfigured() ? "Healthy" : "Failed"; }
}

/** Feishu/Lark channel adapter. */
export class FeishuChannel implements Channel {
  readonly id: string;
  readonly type = "feishu";
  readonly label = "Feishu";
  constructor(id = "feishu") { this.id = id; }
  isConfigured(): boolean { return !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET; }
  validateConfig(): void { if (!this.isConfigured()) throw new Error("FEISHU_APP_ID + FEISHU_APP_SECRET required"); }
  async send(target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      // Get tenant access token
      const tokenRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
        signal: AbortSignal.timeout(10_000),
      });
      const tokenData = await tokenRes.json() as { tenant_access_token?: string };
      if (!tokenData.tenant_access_token) return { ok: false, error: "Failed to get Feishu token" };
      const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokenData.tenant_access_token}` },
        body: JSON.stringify({ receive_id: target, msg_type: "text", content: JSON.stringify({ text }) }),
        signal: AbortSignal.timeout(15_000),
      });
      return { ok: res.ok, error: res.ok ? undefined : `Feishu API ${res.status}` };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  health(): "Healthy" | "Degraded" | "Failed" { return this.isConfigured() ? "Healthy" : "Failed"; }
}

/** WeChat Official Account channel adapter. */
export class WeChatChannel implements Channel {
  readonly id: string;
  readonly type = "wechat";
  readonly label = "WeChat";
  constructor(id = "wechat") { this.id = id; }
  isConfigured(): boolean { return !!process.env.WECHAT_APP_ID && !!process.env.WECHAT_APP_SECRET; }
  validateConfig(): void { if (!this.isConfigured()) throw new Error("WECHAT_APP_ID + WECHAT_APP_SECRET required"); }
  async send(target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const tokenRes = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${process.env.WECHAT_APP_ID}&secret=${process.env.WECHAT_APP_SECRET}`);
      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) return { ok: false, error: "Failed to get WeChat token" };
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${tokenData.access_token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ touser: target, msgtype: "text", text: { content: text } }),
        signal: AbortSignal.timeout(15_000),
      });
      return { ok: res.ok, error: res.ok ? undefined : `WeChat API ${res.status}` };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  health(): "Healthy" | "Degraded" | "Failed" { return this.isConfigured() ? "Healthy" : "Failed"; }
}

/** Spotify channel adapter (J3) — now-playing + control. */
export class SpotifyChannel implements Channel {
  readonly id: string;
  readonly type = "spotify";
  readonly label = "Spotify";
  constructor(id = "spotify") { this.id = id; }
  isConfigured(): boolean { return !!process.env.SPOTIFY_ACCESS_TOKEN; }
  validateConfig(): void { if (!this.isConfigured()) throw new Error("SPOTIFY_ACCESS_TOKEN required"); }
  async send(_target: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const token = process.env.SPOTIFY_ACCESS_TOKEN;
    const cmd = text.toLowerCase();
    try {
      if (cmd.includes("play")) {
        const res = await fetch("https://api.spotify.com/v1/me/player/play", { method: "PUT", headers: { authorization: `Bearer ${token}` } });
        return { ok: res.ok || res.status === 204 };
      }
      if (cmd.includes("pause")) {
        const res = await fetch("https://api.spotify.com/v1/me/player/pause", { method: "PUT", headers: { authorization: `Bearer ${token}` } });
        return { ok: res.ok || res.status === 204 };
      }
      // Default: search + play
      const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(text)}&type=track&limit=1`, { headers: { authorization: `Bearer ${token}` } });
      const searchData = await searchRes.json() as { tracks?: { items?: Array<{ uri: string }> } };
      const trackUri = searchData.tracks?.items?.[0]?.uri;
      if (!trackUri) return { ok: false, error: "no track found" };
      const res = await fetch("https://api.spotify.com/v1/me/player/play", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ uris: [trackUri] }) });
      return { ok: res.ok || res.status === 204 };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  health(): "Healthy" | "Degraded" | "Failed" { return this.isConfigured() ? "Healthy" : "Failed"; }
}
