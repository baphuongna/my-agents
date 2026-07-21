/**
 * DashboardPage — visual overview landing page.
 * Shows key metrics, provider status, recent activity at a glance.
 */
import { useEffect, useState } from "react";
import { api, type StatusResponse, type ModelInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import {
  Activity, Cpu, Clock, Zap, Terminal, TrendingUp,
  ArrowRight, MessageSquare, Calendar, CheckCircle, AlertCircle,
} from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ProviderInfo { id: string; envKey: string; model: string; configured: boolean }
interface RoleInfo { name: string; description: string }

export function DashboardPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.status(), api.models().catch(() => [])])
      .then(([s, m]) => { setStatus(s); setModels(m); })
      .catch(() => {})
      .finally(() => setLoading(false));
    const timer = setInterval(() => {
      api.status().then(setStatus).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const providers = (status?.providers as ProviderInfo[]) ?? [];
  const roles = (status?.roles as RoleInfo[]) ?? [];
  const configured = providers.filter((p) => p.configured);
  const uptime = status?.uptime as number ?? 0;
  const sessions = status?.sessions as number ?? 0;

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Activity size={24} className="text-accent animate-spin" /></div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Hero section */}
      <div className="animate-fade-in-up">
        <h1 className="text-2xl font-bold text-fg mb-1">Welcome to mya</h1>
        <p className="text-sm text-fg-muted">Unified coding & autonomous agent dashboard</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-4 gap-3 animate-fade-in-up" style={{ animationDelay: "50ms" }}>
        <QuickAction icon={Terminal} label="New Chat" desc="Start conversation" onClick={() => navigate("/chat")} />
        <QuickAction icon={Calendar} label="Schedule" desc="Cron jobs" onClick={() => navigate("/cron")} />
        <QuickAction icon={Cpu} label="Models" desc={`${configured.length} providers`} onClick={() => navigate("/models")} />
        <QuickAction icon={Activity} label="Live Events" desc="Real-time stream" onClick={() => navigate("/events")} />
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-4 gap-3 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <MetricCard icon={Clock} label="Uptime" value={formatDuration(uptime)} color="text-accent" />
        <MetricCard icon={MessageSquare} label="Sessions" value={String(sessions)} color="text-success" />
        <MetricCard icon={Zap} label="Providers" value={`${configured.length}/${providers.length}`} color="text-purple" />
        <MetricCard icon={TrendingUp} label="Models" value={String(models.length)} color="text-orange" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 animate-fade-in-up" style={{ animationDelay: "150ms" }}>
        {/* Provider status visualization */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Cpu size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-fg">Provider Status</h3>
            <Badge color="green" className="ml-auto">{configured.length} active</Badge>
          </div>
          {/* Provider grid with visual indicators */}
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
            {providers.slice(0, 24).map((p) => (
              <div
                key={p.id}
                className={cn(
                  "aspect-square rounded-md flex items-center justify-center text-[10px] font-mono transition-all cursor-default",
                  p.configured
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-fg/5 text-fg-subtle/40 border border-transparent",
                )}
                title={`${p.id} — ${p.model}`}
              >
                {p.id.slice(0, 4)}
              </div>
            ))}
          </div>
          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-fg-subtle mb-1">
              <span>Configured</span>
              <span>{Math.round((configured.length / Math.max(providers.length, 1)) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-fg/5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(configured.length / Math.max(providers.length, 1)) * 100}%`,
                  background: "linear-gradient(90deg, rgb(var(--success)), rgb(var(--accent)))",
                }}
              />
            </div>
          </div>
        </Card>

        {/* Roles & capabilities */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-purple" />
            <h3 className="text-sm font-semibold text-fg">Roles & Capabilities</h3>
            <Badge color="purple" className="ml-auto">{roles.length} roles</Badge>
          </div>
          <div className="space-y-2">
            {roles.map((role) => (
              <div key={role.name} className="flex items-center gap-2 p-2 rounded-lg bg-fg/3">
                <div className="w-7 h-7 rounded-lg bg-purple/15 flex items-center justify-center shrink-0">
                  <span className="text-purple text-[10px] font-bold uppercase">{role.name.slice(0, 2)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <code className="text-[12px] text-fg font-mono">{role.name}</code>
                  <p className="text-[10px] text-fg-muted truncate">{role.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Model showcase */}
      {models.length > 0 && (
        <Card className="animate-fade-in-up" hover={false}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} className="text-orange" />
            <h3 className="text-sm font-semibold text-fg">Available Models</h3>
            <Badge color="gray" className="ml-auto">{models.length} total</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {models.slice(0, 30).map((m) => {
              const reasoning = (m as Record<string, unknown>).reasoning as boolean | undefined;
              const ctx = m.contextWindow as number | undefined;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-default",
                    "bg-fg/5 hover:bg-accent/10 border border-transparent hover:border-accent/30",
                  )}
                  title={`${m.provider} — ${ctx ? `${(ctx/1000).toFixed(0)}k ctx` : ""}`}
                >
                  <span className="text-fg-muted font-mono">{m.provider?.slice(0, 8)}</span>
                  <span className="text-fg">{m.name || m.id}</span>
                  {reasoning && <span className="w-1.5 h-1.5 rounded-full bg-purple" title="reasoning" />}
                </div>
              );
            })}
            {models.length > 30 && (
              <span className="text-[11px] text-fg-subtle px-2.5 py-1">+{models.length - 30} more</span>
            )}
          </div>
        </Card>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 pt-4 text-[10px] text-fg-subtle/50">
        <span>mya v{status?.version ?? "0.1.0"}</span>
        <span>·</span>
        <CheckCircle size={10} className="text-success/50" />
        <span>All systems operational</span>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, desc, onClick }: { icon: typeof Activity; label: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card card-hover p-4 text-left group"
    >
      <div className="w-9 h-9 rounded-xl bg-accent/10 group-hover:bg-accent/20 flex items-center justify-center mb-2.5 transition-colors">
        <Icon size={17} className="text-accent" />
      </div>
      <div className="text-[13px] font-medium text-fg">{label}</div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-[10px] text-fg-subtle">{desc}</span>
        <ArrowRight size={10} className="text-fg-subtle group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
      </div>
    </button>
  );
}

function MetricCard({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: string; color: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1.5">
        <Icon size={15} className={color} />
      </div>
      <div className="text-xl font-bold text-fg font-mono tabular-nums">{value}</div>
      <div className="text-[10px] text-fg-subtle uppercase tracking-wide mt-0.5">{label}</div>
    </Card>
  );
}
