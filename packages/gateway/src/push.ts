/**
 * @my-agent/gateway/push — Web Push sender using VAPID.
 *
 * Sends push notifications to subscribed browsers. Requires VAPID keys
 * (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY env vars).
 *
 * Uses the Web Push protocol (RFC 8291) with JWT auth (RFC 7519).
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import webpush from "web-push";

// Configure VAPID once at import time (guarded — no-op without keys).
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_SUBJECT ?? "noreply@mya.local"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** In-memory subscription store (Tier-1; persistent store for Tier-2). */
const subscriptions = new Map<string, PushSubscription>();

/** Generate VAPID keys if not provided (P-256 ECDH). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ type: "spki", format: "der" });
  const priv = privateKey.export({ type: "pkcs8", format: "pem" });
  // Convert raw public key bytes to base64url (skip DER header — 26 bytes for prime256v1)
  const rawPub = pub.subarray(26);
  return {
    publicKey: rawPub.toString("base64url"),
    privateKey: priv.toString(),
  };
}

/** Get the configured VAPID public key. */
export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/** Add a subscription. */
export function addSubscription(sub: PushSubscription): void {
  subscriptions.set(sub.endpoint, sub);
}

/** Remove a subscription by endpoint. */
export function removeSubscription(endpoint: string): boolean {
  return subscriptions.delete(endpoint);
}

/** List all subscriptions. */
export function listSubscriptions(): PushSubscription[] {
  return [...subscriptions.values()];
}

/** Send a push notification to all subscribers via RFC 8291 (C-3).
 * Returns { sent, failed } counts. Requires VAPID keys in env. */
export async function sendPushAll(
  payload: { title: string; body: string; url?: string },
): Promise<{ sent: number; failed: number }> {
  if (!process.env.VAPID_PUBLIC_KEY) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions.values()) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 86_400 }, // 24h
      );
      sent++;
    } catch (e) {
      // 410 Gone = subscription expired → remove
      if ((e as { statusCode?: number }).statusCode === 410) {
        subscriptions.delete(sub.endpoint);
      }
      failed++;
    }
  }
  return { sent, failed };
}

/** Broadcast a notification when a gateway event occurs. */
export function notifyEvent(event: { kind: string; sessionId?: string; summary: string }): void {
  if (subscriptions.size === 0) return;
  void sendPushAll({
    title: `mya: ${event.kind}`,
    body: event.summary.slice(0, 100),
    url: event.sessionId ? `/?session=${event.sessionId}` : "/",
  });
}

export type PushServer = Server;
