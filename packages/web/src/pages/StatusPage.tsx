/**
 * StatusPage — comprehensive system metrics dashboard.
 * Port of Hermes SystemPage pattern: multiple stat cards, provider list, raw JSON.
 */
import { useEffect, useState } from "react";
import { api, type StatusResponse } from "@/lib/api";
import { Card, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, RefreshButton } from "@/components/PageBits";
import { RadialGauge, ProgressBar } from "@/components/Charts";
import {
  Activity,
  Server,
  Cpu,
  HardDrive,
  Clock,
  Zap,
  Check,
  X,
  Database,
  Brain,
} from "lucide-react";
import { formatDuration, formatBytes, formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ProviderInfo {
  id: string;
  envKey: string;
  model: string;
  configured: boolean;
}

interface RoleInfo {
  name: string;
  description: string;
}

export function StatusPage() {
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
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, []);

  const providers = (status?.providers as ProviderInfo[]) ?? [];
  const roles = (status?.roles as RoleInfo[]) ?? [];
  const subagents = status?.subagents as { active: number; total: number } | undefined;
  const uptime = (status?.uptime as number) ?? 0;
  const configuredCount = providers.filter((p) => p.configured).length;

  return (
    <div className="p-4 max-w-7xl w-full mx-auto space-y-4 animate-fade-in-up">
      <PageHeader
        title="System"
        icon={Activity}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading && !status && <LoadingSpinner label="Loading system status…" />}
      {error && <ErrorBox message={error} />}

      {status && (
        <>
          {/* Visual overview with gauges */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <Card className="flex flex-col items-center py-4">
              <RadialGauge value={configuredCount} max={Math.max(providers.length, 1)} size={72} label={`${configuredCount}`} sublabel="providers" color="var(--success)" />
            </Card>
            <Card className="flex flex-col items-center py-4">
              <RadialGauge value={Math.min(uptime / 3600, 100)} max={100} size={72} label={formatDuration(uptime).split(' ')[0]!} sublabel={formatDuration(uptime).split(' ')[1] ?? 'uptime'} color="var(--accent)" />
            </Card>
            <Card className="flex flex-col items-center py-4">
              <RadialGauge value={roles.length} max={Math.max(roles.length, 1)} size={72} label={String(roles.length)} sublabel="roles" color="var(--purple)" />
            </Card>
            <Card className="flex flex-col items-center py-4">
              <RadialGauge value={subagents?.active ?? 0} max={Math.max(subagents?.total ?? 1, 1)} size={72} label={String(subagents?.active ?? 0)} sublabel="subagents" color="var(--orange)" />
            </Card>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <StatCard
              icon={Server}
              label="Gateway"
              value={String(status.status ?? "unknown")}
              tone={status.status === "ok" ? "success" : "warning"}
            />
            <StatCard icon={Clock} label="Uptime" value={formatDuration(status.uptime as number)} />
            <StatCard icon={Activity} label="Sessions" value={String(status.sessions ?? 0)} />
            <StatCard icon={Cpu} label="Version" value={String(status.version ?? "—")} />
            <StatCard
              icon={Zap}
              label="Providers"
              value={`${configuredCount}/${providers.length}`}
              tone={configuredCount > 0 ? "success" : "muted"}
            />
            <StatCard
              icon={Brain}
              label="Subagents"
              value={subagents ? `${subagents.active}/${subagents.total}` : "0/0"}
            />
          </div>

          {/* Two-column layout */}
          <div className="grid md:grid-cols-2 gap-3">
            {/* Providers */}
            <Card>
              <CardTitle>
                <span className="flex items-center gap-1.5">
                  <Cpu size={14} /> Providers ({configuredCount} configured)
                </span>
              </CardTitle>
              <CardContent>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {providers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 py-1 px-2 rounded hover:bg-bg-elevated/50 text-[12px]"
                    >
                      {p.configured ? (
                        <Check size={12} className="text-success shrink-0" />
                      ) : (
                        <X size={12} className="text-fg-subtle shrink-0" />
                      )}
                      <span className={cn("font-mono", p.configured ? "text-fg" : "text-fg-subtle")}>
                        {p.id}
                      </span>
                      <span className="text-fg-subtle text-[10px] truncate ml-auto">{p.model}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Roles */}
            <Card>
              <CardTitle>
                <span className="flex items-center gap-1.5">
                  <Database size={14} /> Roles ({roles.length})
                </span>
              </CardTitle>
              <CardContent>
                <div className="space-y-1.5">
                  {roles.map((r) => (
                    <div key={r.name} className="py-1">
                      <div className="flex items-center gap-2">
                        <Badge color="blue">{r.name}</Badge>
                      </div>
                      <p className="text-[11px] text-fg-muted mt-0.5">{r.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Raw JSON */}
          <Card>
            <CardTitle>Raw Status Response</CardTitle>
            <pre className="text-[11px] text-fg-muted font-mono overflow-x-auto mt-2 max-h-64 overflow-y-auto">
              {JSON.stringify(status, null, 2)}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  const toneColor = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    muted: "text-fg-subtle",
  };
  return (
    <Card className="py-2.5 px-3">
      <div className="flex items-center gap-1.5 text-fg-subtle text-[10px] uppercase tracking-wide">
        <Icon size={11} />
        {label}
      </div>
      <div className={cn("text-base font-semibold font-mono mt-0.5", tone && toneColor[tone])}>
        {value}
      </div>
    </Card>
  );
}
