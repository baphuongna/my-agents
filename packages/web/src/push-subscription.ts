/**
 * @my-agent/web/push-subscription — Web Push subscribe/unsubscribe.
 *
 * Manages push notification subscription via the PushManager API + VAPID.
 */
export interface PushSubscriptionState {
  subscribed: boolean;
  endpoint?: string;
}

/** Fetch the VAPID public key from the gateway. */
export async function getVapidKey(gwUrl: string = ""): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(`${gwUrl}/push/vapid-key`);
    const data = await resp.json() as { publicKey?: string };
    if (!data.publicKey) return null;
    return base64ToUint8(data.publicKey);
  } catch {
    return null;
  }
}

/** Subscribe to push notifications. Returns true on success. */
export async function subscribeToPush(gwUrl: string = ""): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.ready;
  const key = await getVapidKey(gwUrl);
  if (!key) return false;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as BufferSource,
    });
    await fetch(`${gwUrl}/push/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub),
    });
    return true;
  } catch {
    return false;
  }
}

/** Unsubscribe from push notifications. */
export async function unsubscribeFromPush(gwUrl: string = ""): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;
  await sub.unsubscribe();
  await fetch(`${gwUrl}/push/unsubscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  return true;
}

/** Check current subscription status. */
export async function getPushState(gwUrl: string = ""): Promise<PushSubscriptionState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { subscribed: false };
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? { subscribed: true, endpoint: sub.endpoint } : { subscribed: false };
}

/** Convert base64url string to Uint8Array for VAPID key. */
function base64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
