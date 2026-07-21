/**
 * PushPage — Web Push notification management.
 * Uses gateway endpoints: GET /push/vapid-key, POST /push/subscribe, POST /push/unsubscribe
 */
import { useEffect, useState } from "react";
import { Card, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox } from "@/components/PageBits";
import { useToast } from "@/lib/toast";
import { Bell, BellRing, BellOff, Send, Check } from "lucide-react";

export function PushPage() {
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadState();
  }, []);

  async function loadState() {
    setLoading(true);
    setError(null);
    try {
      // Get VAPID key
      const res = await fetch("/push/vapid-key", { credentials: "include" });
      const data = await res.json();
      setVapidKey(data.publicKey ?? data.vapidKey ?? null);

      // Check existing subscription
      const reg = await navigator.serviceWorker?.getRegistration();
      const existing = await reg?.pushManager?.getSubscription();
      setSubscribed(!!existing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function subscribe() {
    if (!vapidKey) {
      toast("VAPID key not available", "error");
      return;
    }
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) {
        toast("Service worker not registered", "error");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // Send to gateway
      const subJson = sub.toJSON();
      await fetch("/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subJson),
      });

      setSubscribed(true);
      toast("Push notifications enabled", "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await fetch("/push/unsubscribe", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast("Push notifications disabled", "info");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  async function testNotification() {
    setTesting(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.showNotification("mya — Test Notification", {
        body: "Push notifications are working! 🎉",
        icon: "/icons/192.png",
        badge: "/icons/192.png",
        tag: "mya-test",
      });
      toast("Test notification sent", "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="p-4"><LoadingSpinner /></div>;

  return (
    <div className="p-4 max-w-2xl space-y-3">
      <PageHeader title="Push Notifications" icon={Bell} />

      {error && <ErrorBox message={error} />}

      {/* Status card */}
      <Card>
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              subscribed ? "bg-success/15" : "bg-bg-elevated"
            }`}
          >
            {subscribed ? (
              <BellRing size={22} className="text-success" />
            ) : (
              <BellOff size={22} className="text-fg-subtle" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-fg font-medium text-sm">
                {subscribed ? "Notifications Enabled" : "Not Subscribed"}
              </span>
              {subscribed && <Badge color="green"><Check size={9} /> active</Badge>}
            </div>
            <p className="text-[11px] text-fg-muted mt-0.5">
              {subscribed
                ? "You will receive push notifications for notable events"
                : "Enable push notifications to receive alerts for cron jobs, errors, and more"}
            </p>
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {subscribed ? (
          <>
            <Button variant="secondary" onClick={testNotification} disabled={testing}>
              <Send size={13} /> {testing ? "Sending…" : "Send Test"}
            </Button>
            <Button variant="danger" onClick={unsubscribe}>
              <BellOff size={13} /> Unsubscribe
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={subscribe} disabled={!vapidKey}>
            <Bell size={13} /> Enable Notifications
          </Button>
        )}
      </div>

      {/* Technical info */}
      <Card>
        <CardTitle>Technical Details</CardTitle>
        <CardContent>
          <div className="space-y-1 mt-2">
            <DetailRow label="Service Worker" value={navigator.serviceWorker ? "registered" : "not available"} />
            <DetailRow label="Push Manager" value={typeof PushManager !== "undefined" ? "supported" : "not supported"} />
            <DetailRow label="Notification API" value={typeof Notification !== "undefined" ? Notification.permission : "not available"} />
            <DetailRow label="VAPID Key" value={vapidKey ? `${vapidKey.slice(0, 20)}…` : "not available"} mono />
          </div>
        </CardContent>
      </Card>

      <p className="text-[10px] text-fg-subtle">
        VAPID keys are auto-generated for development. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
        environment variables for production persistence.
      </p>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-[12px]">
      <span className="text-fg-muted">{label}</span>
      <span className={`text-fg ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
