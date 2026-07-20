/**
 * @my-agent/gateway/push — Web Push sender using VAPID.
 *
 * Sends push notifications to subscribed browsers. Requires VAPID keys
 * (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY env vars).
 *
 * Uses the Web Push protocol (RFC 8291) with JWT auth (RFC 7519).
 *
 * C1 fix: subscriptions persist to ~/.mya/agent/push-subscriptions.json so
 * they survive gateway restarts.
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Server } from "node:http";
import webpush from "web-push";

const SUBSCRIPTIONS_FILE = join(homedir(), ".mya", "agent", "push-subscriptions.json");

// Configure VAPID once at import time. If env vars are not set, auto-generate
// ephemeral keys (J2 fix — enables push notifications out-of-the-box for dev).
// For production persistence, set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars.
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const generated = generateVapidKeys();
  if (!process.env.VAPID_PUBLIC_KEY) process.env.VAPID_PUBLIC_KEY = generated.publicKey;
  if (!process.env.VAPID_PRIVATE_KEY) process.env.VAPID_PRIVATE_KEY = generated.privateKey;
  // Warning is printed once — ephemeral keys break existing subscriptions on restart.
  if (!process.env.VAPID_SUBJECT) {
    console.warn("[push] VAPID keys auto-generated (ephemeral). Set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars for persistence.");
  }
}
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_SUBJECT ?? "noreply@mya.local"}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Persistent subscription store (C1 fix). Saves to a JSON file on every mutation.
 * Loads from file on first access (lazy).
 */
const subscriptions = new Map<string, PushSubscription>();
let loaded = false;

/** Load subscriptions from disk (once, lazy). */
function loadSubscriptions(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(SUBSCRIPTIONS_FILE)) {
      const data = JSON.parse(readFileSync(SUBSCRIPTIONS_FILE, "utf8")) as PushSubscription[];
      for (const sub of data) {
        if (sub.endpoint && sub.keys) subscriptions.set(sub.endpoint, sub);
      }
    }
  } catch {
    // Corrupt or missing file — start fresh
  }
}

/** Save subscriptions to disk (best-effort, non-blocking on failure). */
function saveSubscriptions(): void {
  try {
    mkdirSync(join(homedir(), ".mya", "agent"), { recursive: true, mode: 0o700 });
    const data = [...subscriptions.values()];
    writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch {
    // Best-effort — push still works in-memory
  }
}

/** Generate VAPID keys if not provided (P-256 ECDH). Returns base64url-encoded raw keys. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // Public key: raw uncompressed point (65 bytes: 0x04 + X + Y) → base64url
  const pub = publicKey.export({ type: "spki", format: "der" });
  const rawPub = pub.subarray(26); // skip DER header
  // Private key: raw scalar (32 bytes) → base64url (web-push format, NOT PEM)
  const priv = privateKey.export({ type: "pkcs8", format: "der" });
  const rawPriv = priv.subarray(-32); // last 32 bytes = private scalar
  return {
    publicKey: rawPub.toString("base64url"),
    privateKey: rawPriv.toString("base64url"),
  };
}

/** Get the configured VAPID public key. */
export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/** Add a subscription (persisted to disk). */
export function addSubscription(sub: PushSubscription): void {
  loadSubscriptions();
  subscriptions.set(sub.endpoint, sub);
  saveSubscriptions();
}

/** Remove a subscription by endpoint (persisted to disk). */
export function removeSubscription(endpoint: string): boolean {
  loadSubscriptions();
  const removed = subscriptions.delete(endpoint);
  if (removed) saveSubscriptions();
  return removed;
}

/** List all subscriptions (loaded from disk on first call). */
export function listSubscriptions(): PushSubscription[] {
  loadSubscriptions();
  return [...subscriptions.values()];
}

/** Send a push notification to all subscribers via RFC 8291 (C-3).
 * Returns { sent, failed } counts. Requires VAPID keys in env. */
export async function sendPushAll(
  payload: { title: string; body: string; url?: string },
): Promise<{ sent: number; failed: number }> {
  loadSubscriptions();
  if (!process.env.VAPID_PUBLIC_KEY) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let dirty = false;
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
        dirty = true;
      }
      failed++;
    }
  }
  if (dirty) saveSubscriptions();
  return { sent, failed };
}

/** Broadcast a notification when a gateway event occurs. */
export function notifyEvent(event: { kind: string; sessionId?: string; summary: string }): void {
  loadSubscriptions();
  if (subscriptions.size === 0) return;
  void sendPushAll({
    title: `mya: ${event.kind}`,
    body: event.summary.slice(0, 100),
    url: event.sessionId ? `/?session=${event.sessionId}` : "/",
  });
}

export type PushServer = Server;
