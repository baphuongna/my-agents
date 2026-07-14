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
