/**
 * @my-agent/gateway/push.test — Web Push RFC 8291 delivery tests (C-3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock web-push module before importing push.ts
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webpush from "web-push";
import { sendPushAll, addSubscription, removeSubscription, listSubscriptions } from "./push.js";

describe("sendPushAll (C-3 Web Push)", () => {
  beforeEach(() => {
    // Reset mock state
    vi.mocked(webpush.sendNotification).mockReset();
    vi.mocked(webpush.setVapidDetails).mockReset();
    // Clear all subscriptions via public API
    for (const sub of listSubscriptions()) {
      removeSubscription(sub.endpoint);
    }
    // Clear env vars by default
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
  });

  const testSub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
  };

  it("calls webpush.sendNotification with correct arguments", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BG3b-test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "nDk0-test-private");
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    addSubscription(testSub);
    await sendPushAll({ title: "Hello", body: "World" });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: testSub.endpoint, keys: testSub.keys },
      JSON.stringify({ title: "Hello", body: "World" }),
      { TTL: 86_400 },
    );
  });

  it("returns correct sent/failed counts for multiple subscriptions", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BG3b-test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "nDk0-test-private");
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    addSubscription(testSub);
    addSubscription({ endpoint: "https://fcm/send/def", keys: { p256dh: "b", auth: "c" } });

    const result = await sendPushAll({ title: "Test", body: "Multi" });
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("handles 410 Gone by removing the expired subscription", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BG3b-test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "nDk0-test-private");
    // Simulate push service returning 410 Gone
    const goneError = Object.assign(new Error("Subscription expired"), { statusCode: 410 });
    vi.mocked(webpush.sendNotification).mockRejectedValue(goneError);

    addSubscription(testSub);
    expect(listSubscriptions()).toHaveLength(1);

    const result = await sendPushAll({ title: "Test", body: "Cleanup" });
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(listSubscriptions()).toHaveLength(0);
  });

  it("returns { sent: 0, failed: 0 } without VAPID keys configured", async () => {
    // VAPID_PUBLIC_KEY is empty (set in beforeEach)
    const result = await sendPushAll({ title: "Test", body: "NoKey" });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});

// ─── generateVapidKeys ───────────────────────────────────────────────────────

describe("generateVapidKeys", () => {
  it("returns base64url public + private keys", async () => {
    const { generateVapidKeys } = await import("./push.js");
    const keys = generateVapidKeys();
    expect(typeof keys.publicKey).toBe("string");
    expect(typeof keys.privateKey).toBe("string");
    expect(keys.publicKey.length).toBeGreaterThan(0);
    expect(keys.privateKey.length).toBeGreaterThan(0);
    // Distinct keys.
    expect(keys.publicKey).not.toBe(keys.privateKey);
  });

  it("produces a 65-byte uncompressed public key (0x04 + X + Y)", async () => {
    const { generateVapidKeys } = await import("./push.js");
    const keys = generateVapidKeys();
    const pub = Buffer.from(keys.publicKey, "base64url");
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04); // uncompressed point prefix
  });

  it("produces a 32-byte private scalar", async () => {
    const { generateVapidKeys } = await import("./push.js");
    const keys = generateVapidKeys();
    const priv = Buffer.from(keys.privateKey, "base64url");
    expect(priv.length).toBe(32);
  });

  it("generates fresh keys on each call", async () => {
    const { generateVapidKeys } = await import("./push.js");
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

// ─── getVapidPublicKey ──────────────────────────────────────────────────────

describe("getVapidPublicKey", () => {
  it("reflects the VAPID_PUBLIC_KEY env var", async () => {
    const { getVapidPublicKey } = await import("./push.js");
    vi.stubEnv("VAPID_PUBLIC_KEY", "BG3b-explicit-public");
    expect(getVapidPublicKey()).toBe("BG3b-explicit-public");
  });

  it("returns an empty string when VAPID_PUBLIC_KEY is unset", async () => {
    const { getVapidPublicKey } = await import("./push.js");
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    expect(getVapidPublicKey()).toBe("");
  });
});

// ─── subscription store ─────────────────────────────────────────────────────

describe("subscription store", () => {
  beforeEach(() => {
    for (const sub of listSubscriptions()) {
      removeSubscription(sub.endpoint);
    }
  });

  const subA = { endpoint: "https://push/a", keys: { p256dh: "pa", auth: "aa" } };
  const subB = { endpoint: "https://push/b", keys: { p256dh: "pb", auth: "ab" } };

  it("addSubscription then listSubscriptions returns it", () => {
    expect(listSubscriptions()).toHaveLength(0);
    addSubscription(subA);
    expect(listSubscriptions()).toHaveLength(1);
    expect(listSubscriptions()[0]!.endpoint).toBe(subA.endpoint);
  });

  it("removeSubscription returns true for an existing endpoint", () => {
    addSubscription(subA);
    expect(removeSubscription(subA.endpoint)).toBe(true);
    expect(listSubscriptions()).toHaveLength(0);
  });

  it("removeSubscription returns false for a non-existent endpoint", () => {
    expect(removeSubscription("https://push/ghost")).toBe(false);
  });

  it("adding the same endpoint twice dedupes (overwrites)", () => {
    addSubscription(subA);
    addSubscription({ ...subA, keys: { p256dh: "pa2", auth: "aa2" } });
    expect(listSubscriptions()).toHaveLength(1);
    expect(listSubscriptions()[0]!.keys.p256dh).toBe("pa2");
  });

  it("supports multiple distinct subscriptions", () => {
    addSubscription(subA);
    addSubscription(subB);
    expect(listSubscriptions()).toHaveLength(2);
  });
});

// ─── notifyEvent ────────────────────────────────────────────────────────────

describe("notifyEvent", () => {
  beforeEach(() => {
    for (const sub of listSubscriptions()) {
      removeSubscription(sub.endpoint);
    }
    vi.mocked(webpush.sendNotification).mockReset();
    vi.stubEnv("VAPID_PUBLIC_KEY", "BG3b-test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "nDk0-test-private");
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  });

  it("is a no-op when there are no subscriptions", async () => {
    const { notifyEvent } = await import("./push.js");
    notifyEvent({ kind: "done", summary: "hello" });
    // Allow any pending microtask (void sendPushAll) to flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("dispatches a push when a subscription exists", async () => {
    const { notifyEvent } = await import("./push.js");
    addSubscription({ endpoint: "https://push/notify", keys: { p256dh: "p", auth: "a" } });
    notifyEvent({ kind: "done", sessionId: "sess-1", summary: "a".repeat(200) });
    await new Promise((r) => setTimeout(r, 10));
    expect(webpush.sendNotification).toHaveBeenCalled();
    const payload = JSON.parse(
      (vi.mocked(webpush.sendNotification).mock.calls[0]![1] as string),
    );
    expect(payload.title).toContain("done");
    expect(payload.url).toBe("/?session=sess-1");
    // summary is truncated to 100 chars.
    expect(payload.body.length).toBeLessThanOrEqual(100);
  });
});
