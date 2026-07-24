/**
 * ChannelsPage — multi-platform delivery adapters.
 *
 * Port of Hermes ChannelsPage, simplified to mya's gateway surface:
 * channels are listed via GET /status (channels array), toggled via
 * POST /channels/:id/config { enabled }, and tested via POST /channels/:id/test.
 * (mya has no QR onboarding or env-var management — those are Hermes-only.)
 */
import { useCallback, useEffect, useState } from "react";
import { api, type ChannelInfo, type ChannelTestResult } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  PageHeader,
  LoadingSpinner,
  ErrorBox,
  EmptyState,
  RefreshButton,
} from "@/components/PageBits";
import { useToast } from "@/lib/toast";
import { Radio, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const HEALTH_TONE: Record<string, "green" | "yellow" | "red" | "gray"> = {
  healthy: "green",
  ok: "green",
  connected: "green",
  degraded: "yellow",
  error: "red",
  unhealthy: "red",
  disconnected: "red",
};

export function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ChannelTestResult>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.status();
      const list = (status.channels as ChannelInfo[] | undefined) ?? [];
      setChannels(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  async function handleToggle(ch: ChannelInfo) {
    setToggling(ch.id);
    const next = !ch.enabled;
    try {
      await api.channelConfig(ch.id, { enabled: next });
      setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, enabled: next } : c)));
      toast(`${ch.label ?? ch.id} ${next ? "enabled" : "disabled"}`, "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setToggling(null);
    }
  }

  async function handleTest(ch: ChannelInfo) {
    setTesting(ch.id);
    try {
      const result = await api.channelTest(ch.id);
      setTestResults((prev) => ({ ...prev, [ch.id]: result }));
      if (result.ok) {
        toast(`${ch.label ?? ch.id}: ${result.message ?? "test sent"}`, "success");
      } else {
        toast(`${ch.label ?? ch.id}: ${result.error ?? "test failed"}`, "error");
      }
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="p-4 max-w-4xl w-full mx-auto animate-fade-in-up">
      <PageHeader
        title="Channels"
        icon={Radio}
        actions={<RefreshButton onClick={reload} />}
      />

      <p className="text-xs text-fg-muted -mt-2 mb-3">
        Multi-platform delivery adapters. Toggle delivery on/off and send a test message to verify connectivity.
      </p>

      {loading && channels.length === 0 && <LoadingSpinner label="Loading channels…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && channels.length === 0 && (
        <EmptyState
          icon={Radio}
          title="No channels registered"
          description="Configure channel adapters (Telegram, Discord, Slack, etc.) in your gateway to see them here."
        />
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {channels.map((ch) => {
          const result = testResults[ch.id];
          const healthKey = (ch.health ?? "").toLowerCase();
          return (
            <Card key={ch.id} hover>
              <CardContent className="!space-y-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-fg truncate">
                        {ch.label ?? ch.id}
                      </span>
                      <Badge color="blue">{ch.type}</Badge>
                      {ch.alias && <Badge color="gray">{ch.alias}</Badge>}
                    </div>
                    <p className="text-[11px] text-fg-subtle font-mono mt-0.5 truncate">{ch.id}</p>
                  </div>
                  <Badge color={HEALTH_TONE[healthKey] ?? "gray"}>{ch.health || "unknown"}</Badge>
                </div>

                <div className="flex items-center gap-3 mt-2 text-[11px]">
                  <span className={cn("flex items-center gap-1", ch.enabled ? "text-success" : "text-fg-subtle")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", ch.enabled ? "bg-success" : "bg-fg-subtle/40")} />
                    {ch.enabled ? "enabled" : "disabled"}
                  </span>
                  <span className={cn("flex items-center gap-1", ch.configured ? "text-fg-muted" : "text-warning")}>
                    {ch.configured ? "configured" : "not configured"}
                  </span>
                </div>

                {result && (
                  <p className={cn("text-[11px] mt-1.5", result.ok ? "text-success" : "text-danger")}>
                    {result.ok ? result.message ?? "test sent" : result.error ?? "test failed"}
                  </p>
                )}

                <div className="flex items-center gap-1.5 mt-3">
                  <Button
                    size="sm"
                    variant={ch.enabled ? "secondary" : "primary"}
                    onClick={() => handleToggle(ch)}
                    disabled={toggling === ch.id}
                  >
                    {ch.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleTest(ch)}
                    disabled={testing === ch.id || !ch.enabled}
                    title={ch.enabled ? "Send test message" : "Enable the channel first"}
                  >
                    <Zap size={13} className={cn(testing === ch.id && "animate-pulse")} />
                    Test
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
