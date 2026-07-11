import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ControlPlane, HandleLruCache, Gateway } from "@my-agent/gateway";
import { get as httpGet } from "node:http";

function get(port: number, path: string): Promise<{ code: number; body: string }> {
  return new Promise((resolve) => {
    const req = httpGet(`http://127.0.0.1:${port}${path}`, (res) => {
      let b = "";
      res.on("data", (c: Buffer) => (b += c.toString()));
      res.on("end", () => resolve({ code: res.statusCode ?? 0, body: b }));
    });
    req.on("error", () => resolve({ code: 0, body: "" }));
  });
}

describe("§12 HandleLruCache — bounded LRU + idle-TTL eviction", () => {
  it("evicts the oldest entry beyond maxSize, flushing its handle", () => {
    const flushed: string[] = [];
    const cache = new HandleLruCache(2, 999_999);
    cache.set("a", { flush: () => flushed.push("a") });
    cache.set("b", { flush: () => flushed.push("b") });
    cache.set("c", { flush: () => flushed.push("c") }); // exceeds 2 → evict "a"
    expect(cache.size).toBe(2);
    expect(flushed).toContain("a");
    expect(cache.get("a")).toBeUndefined();
  });

  it("get() refreshes recency (LRU order)", () => {
    const cache = new HandleLruCache(2, 999_999);
    cache.set("a", {});
    cache.set("b", {});
    cache.get("a"); // a is now most-recent; b is oldest
    cache.set("c", {}); // evict b, not a
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("sweepIdle removes entries past the idle TTL", () => {
    const cache = new HandleLruCache(99, 100); // 100ms TTL
    cache.set("a", {});
    // simulate time passing beyond TTL by backdating lastUsed
    const entries = (cache as unknown as { entries: Map<string, { lastUsed: number }> }).entries;
    entries.get("a")!.lastUsed = 1; // backdate to epoch (invariant #10: no Date.now in tests)
    const swept = cache.sweepIdle();
    expect(swept).toBe(1);
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("§12 ControlPlane — registry", () => {
  it("registers + lists sessions; sets status", () => {
    const cp = new ControlPlane();
    cp.registerSession("s1");
    cp.registerSession("s2", "idle");
    expect(cp.listSessions().length).toBe(2);
    cp.setSessionStatus("s1", "closed");
    expect(cp.getSession("s1")!.status).toBe("closed");
  });

  it("registers + lists cron jobs", () => {
    const cp = new ControlPlane();
    cp.registerCronJob({ id: "nightly", schedule: "0 0 * * *", enabled: true });
    expect(cp.listCronJobs().length).toBe(1);
  });

  it("exposes config + tools", () => {
    const cp = new ControlPlane({ config: { model: "gpt-4o", tools: ["read", "write"] } });
    expect(cp.getConfig()["model"]).toBe("gpt-4o");
    expect(cp.listTools()).toEqual(["read", "write"]);
  });
});

describe("§12 gateway REST control-plane routes", () => {
  let port = 0;
  const gw = new Gateway({ host: "127.0.0.1", port: 0 });
  beforeAll(async () => {
    gw.control.registerSession("s1");
    gw.control.registerCronJob({ id: "j1", schedule: "*/5 * * * *", enabled: true });
    const started = await gw.start();
    port = started.port;
  });
  afterAll(async () => { await gw.stop(); });

  it("GET /sessions lists sessions", async () => {
    const r = await get(port, "/sessions");
    expect(r.code).toBe(200);
    expect(r.body).toContain("s1");
  });

  it("GET /sessions/:id returns the session; 404 for unknown", async () => {
    expect((await get(port, "/sessions/s1")).code).toBe(200);
    expect((await get(port, "/sessions/nope")).code).toBe(404);
  });

  it("GET /cron/jobs + /config + /tools", async () => {
    expect((await get(port, "/cron/jobs")).body).toContain("j1");
    expect((await get(port, "/config")).code).toBe(200);
    expect((await get(port, "/tools")).code).toBe(200);
  });
});
