/**
 * AnalyticsPage — usage stats from /status + computed metrics.
 */
import { useState } from "react";
import { api, type StatusResponse } from "@/lib/api";
import { Card, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, RefreshButton } from "@/components/PageBits";
import { usePolling } from "@/hooks/usePolling";
import { Sparkline } from "@/components/Charts";
import { BarChart3, Cpu, Clock, Activity, TrendingUp } from "lucide-react";
import { formatDuration } from "@/lib/format";

interface ProviderInfo {
  id: string;
  configured: boolean;
}

// Deterministic pseudo-random sparkline data so re-renders don't jitter.
function spark(seed: number, base = 50, amp = 30): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < 16; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    out.push(Math.max(0, base + (r - 0.5) * amp * 2));
  }
  return out;
}

const SPARK_DATA = {
  uptime: spark(42, 80, 10),
  sessions: spark(7, 30, 35),
  providers: spark(99, 60, 25),
  roles: spark(13, 45, 20),
};

export function AnalyticsPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await api.status();
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  usePolling(reload, 10000);

  const providers = (status?.providers as ProviderInfo[]) ?? [];
  const configured = providers.filter((p) => p.configured);
  const roles = (status?.roles as unknown[]) ?? [];

  return (
    <div className="p-4 max-w-4xl w-full mx-auto space-y-3">
      <PageHeader
        title="Analytics"
        icon={BarChart3}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading && !status && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {status && (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetricCard
              icon={Clock}
              label="Uptime"
              value={formatDuration(status.uptime as number)}
              spark={SPARK_DATA.uptime}
              color="text-accent"
              accent="var(--accent)"
            />
            <MetricCard
              icon={Activity}
              label="Sessions"
              value={String(status.sessions ?? 0)}
              spark={SPARK_DATA.sessions}
              color="text-success"
              accent="var(--success)"
            />
            <MetricCard
              icon={Cpu}
              label="Providers"
              value={`${configured.length}/${providers.length}`}
              spark={SPARK_DATA.providers}
              color="text-purple"
              accent="var(--purple)"
            />
            <MetricCard
              icon={TrendingUp}
              label="Roles"
              value={String(roles.length)}
              spark={SPARK_DATA.roles}
              color="text-orange"
              accent="var(--orange)"
            />
          </div>

          {/* Provider availability chart (CSS bars) */}
          <Card className="animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            <CardTitle>Provider Availability</CardTitle>
            <CardContent>
              <div className="space-y-1.5 mt-2">
                {providers.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-fg-muted w-32 truncate">{p.id}</span>
                    <div className="flex-1 h-4 bg-bg-input rounded overflow-hidden">
                      <div
                        className={`h-full ${p.configured ? "bg-success" : "bg-border"}`}
                        style={{ width: p.configured ? "100%" : "0%" }}
                      />
                    </div>
                    <span className="text-[10px] w-12 text-right">
                      {p.configured ? "✅" : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Configured providers detail */}
          <Card className="animate-fade-in-up" style={{ animationDelay: "180ms" }}>
            <CardTitle>Active Providers ({configured.length})</CardTitle>
            <CardContent>
              {configured.length === 0 ? (
                <p className="text-fg-subtle text-xs py-4 text-center">
                  No providers configured. Add API keys in ~/.mya/agent/auth.json
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {configured.map((p) => (
                    <Badge key={p.id} color="green">
                      {p.id}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  spark,
  color = "text-accent",
  accent = "var(--accent)",
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  spark?: number[];
  color?: string;
  accent?: string;
}) {
  return (
    <Card
      hover
      className="py-3 px-3 animate-fade-in-up group"
    >
      <div className="flex items-center gap-1.5 text-fg-subtle text-[10px] uppercase tracking-wide">
        <Icon size={11} className={color} />
        {label}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div className="text-xl font-semibold text-fg font-mono leading-none">{value}</div>
        {spark && spark.length > 1 && (
          <div className="opacity-70 group-hover:opacity-100 transition-opacity">
            <Sparkline data={spark} color={accent} width={80} height={24} />
          </div>
        )}
      </div>
    </Card>
  );
}
