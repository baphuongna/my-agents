import { describe, it, expect, afterEach } from "vitest";
import { Gateway } from "@my-agent/gateway";

const started: Array<{ stop: () => Promise<void> | void }> = [];
async function start(opts: { wsToken?: string; wsInfo?: () => unknown }): Promise<{ port: number; stop: () => Promise<void> }> {
  const gw = new Gateway({ host: "127.0.0.1", port: 0, rootHtml: "<html></html>", wsInfo: () => ({ ok: true }), ...opts });
  const { port } = await gw.start();
  const stop = async () => { try { await gw.stop(); } catch { /* best-effort */ } };
  started.push({ stop });
  return { port, stop };
}
afterEach(async () => { for (const s of started.splice(0)) { await s.stop(); } });

const base = (port: number) => `http://127.0.0.1:${port}`;

describe("gateway auth gate (Phase 0C)", () => {
  it("allows health/ready without auth (allowlist)", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const r = await fetch(`${base(port)}/health/live`);
    expect(r.status).toBe(200);
    await stop();
  });

  it("rejects /cron/jobs without auth → 401", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const r = await fetch(`${base(port)}/cron/jobs`);
    expect(r.status).toBe(401);
    await stop();
  });

  it("accepts /cron/jobs with a correct Bearer token → 200", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const r = await fetch(`${base(port)}/cron/jobs`, { headers: { authorization: "Bearer secret" } });
    expect(r.status).toBe(200);
    await stop();
  });

  it("rejects a wrong Bearer token → 401", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const r = await fetch(`${base(port)}/cron/jobs`, { headers: { authorization: "Bearer wrong" } });
    expect(r.status).toBe(401);
    await stop();
  });

  it("accepts /cron/jobs via the mya_ws cookie", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const r = await fetch(`${base(port)}/cron/jobs`, { headers: { cookie: "mya_ws=secret" } });
    expect(r.status).toBe(200);
    await stop();
  });

  it("GET / sets the HttpOnly SameSite=Strict auth cookie (token-free dashboard bootstrap)", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const r = await fetch(`${base(port)}/`);
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toContain("mya_ws=secret");
    expect(sc.toLowerCase()).toContain("httponly");
    expect(sc.toLowerCase()).toContain("samesite=strict");
    await stop();
  });

  it("GET / is reachable without auth (sets cookie); /ws-info is gated", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const root = await fetch(`${base(port)}/`);
    expect(root.status).toBe(200); // allowlisted
    // /ws-info is no longer open — requires auth (closes the token-leak hole).
    const wsInfo = await fetch(`${base(port)}/ws-info`);
    expect(wsInfo.status).toBe(401);
    const wsInfoAuthed = await fetch(`${base(port)}/ws-info`, { headers: { authorization: "Bearer secret" } });
    expect(wsInfoAuthed.status).toBe(200);
    await stop();
  });

  it("with no wsToken (MYA_NO_WS_TOKEN dev), everything is open", async () => {
    const { port, stop } = await start({ wsToken: undefined });
    const r = await fetch(`${base(port)}/cron/jobs`);
    expect(r.status).toBe(200); // no auth configured
    await stop();
  });

  it("CSRF: a state-changing POST with a cross-port localhost Origin → 403", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    // authed (cookie) but Origin is a DIFFERENT localhost port → blocked
    const r = await fetch(`${base(port)}/cron/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mya_ws=secret", origin: `http://localhost:${port + 1}` },
      body: JSON.stringify({ name: "x", schedule: "* * * * *", prompt: "p" }),
    });
    expect(r.status).toBe(403);
    await stop();
  });

  it("CSRF: a state-changing POST with the gateway's OWN origin → passes the CSRF check", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    // own origin + cookie → passes CSRF (then 201 or 400 depending on body; not 403)
    const r = await fetch(`${base(port)}/cron/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mya_ws=secret", origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ name: "x", schedule: "* * * * *", prompt: "p" }),
    });
    expect(r.status).not.toBe(403);
    expect(r.status).not.toBe(401);
    await stop();
  });

  it("/ws-info is Bearer-only (cookie alone → 401, defeating HttpOnly bypass via XSS)", async () => {
    const { port, stop } = await start({ wsToken: "secret" });
    const cookieOnly = await fetch(`${base(port)}/ws-info`, { headers: { cookie: "mya_ws=secret" } });
    expect(cookieOnly.status).toBe(401);
    const bearer = await fetch(`${base(port)}/ws-info`, { headers: { authorization: "Bearer secret" } });
    expect(bearer.status).toBe(200);
    await stop();
  });
});
