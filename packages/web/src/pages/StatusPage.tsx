import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { Card, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox } from "./SessionsPage";
import { Activity, Server, Cpu, HardDrive, Clock, Zap } from "lucide-react";
import { useEffect, useState } from "react";

export function StatusPage() {
  const { data: status, loading, error, reload } = useAsync(
    () => api.status(),
    [],
    5000,
  );

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="System" icon={Activity} />

      {loading && !status && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {status && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard
            icon={Server}
            label="Gateway Status"
            value={String(status.status ?? "unknown")}
            badge={status.status === "ok" ? "green" : "yellow"}
          />
          <StatCard
            icon={Clock}
            label="Uptime"
            value={fmtDuration(status.uptime as number)}
          />
          <StatCard
            icon={Activity}
            label="Active Sessions"
            value={String(status.sessions ?? 0)}
          />
          <StatCard
            icon={Cpu}
            label="Version"
            value={String(status.version ?? "—")}
          />
          <StatCard
            icon={HardDrive}
            label="PID"
            value={String(status.pid ?? "—")}
          />
          <StatCard
            icon={Zap}
            label="Memory"
            value={fmtBytes(status.memoryRss as number)}
          />
        </div>
      )}

      {/* Raw JSON */}
      {status && (
        <Card>
          <CardTitle>Raw Status JSON</CardTitle>
          <pre className="text-[11px] text-fg-muted font-mono overflow-x-auto mt-2">
            {JSON.stringify(status, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  badge,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  badge?: "green" | "yellow" | "red";
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2 text-fg-muted text-[11px] uppercase tracking-wide">
          <Icon size={13} />
          {label}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-lg font-semibold text-fg font-mono">{value}</span>
          {badge && <Badge color={badge}>●</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

function fmtDuration(s?: number): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function fmtBytes(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
