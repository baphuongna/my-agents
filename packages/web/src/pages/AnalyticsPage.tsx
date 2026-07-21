/**
 * AnalyticsPage — usage stats from /status + computed metrics.
 */
import { useEffect, useState } from "react";
import { api, type StatusResponse } from "@/lib/api";
import { Card, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, RefreshButton } from "@/components/PageBits";
import { BarChart3, Cpu, Clock, Activity, TrendingUp } from "lucide-react";
import { formatDuration } from "@/lib/format";

interface ProviderInfo {
  id: string;
  configured: boolean;
}

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

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, []);

  const providers = (status?.providers as ProviderInfo[]) ?? [];
  const configured = providers.filter((p) => p.configured);
  const roles = (status?.roles as unknown[]) ?? [];

  return (
    <div className="p-4 max-w-4xl space-y-3">
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
            <MetricCard icon={Clock} label="Uptime" value={formatDuration(status.uptime as number)} />
            <MetricCard icon={Activity} label="Sessions" value={String(status.sessions ?? 0)} />
            <MetricCard icon={Cpu} label="Providers" value={`${configured.length}/${providers.length}`} />
            <MetricCard icon={TrendingUp} label="Roles" value={String(roles.length)} />
          </div>

          {/* Provider availability chart (CSS bars) */}
          <Card>
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
          <Card>
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
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
}) {
  return (
    <Card className="py-3 px-3">
      <div className="flex items-center gap-1.5 text-fg-subtle text-[10px] uppercase tracking-wide">
        <Icon size={11} />
        {label}
      </div>
      <div className="text-xl font-semibold text-fg font-mono mt-1">{value}</div>
    </Card>
  );
}
