/**
 * SystemPage — host stats, memory, and dream trigger.
 *
 * Simplified port of Hermes SystemPage. Hermes couples deeply to its Python
 * ops/curator/update subsystems; mya only exposes GET /status, GET /memory/stats,
 * and POST /memory/dream — so this page surfaces exactly those.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type StatusResponse } from "@/lib/api";
import { Card, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  PageHeader,
  LoadingSpinner,
  ErrorBox,
  RefreshButton,
} from "@/components/PageBits";
import { useToast } from "@/lib/toast";
import {
  Activity, Cpu, Clock, Server, Brain, Moon, Database, Cog,
} from "lucide-react";
import { formatDuration } from "@/lib/format";
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border-subtle/40 last:border-0">
      <span className="text-xs text-fg-subtle">{label}</span>
      <span className="text-xs font-mono text-fg text-right truncate ml-2">{value}</span>
    </div>
  );
}

export function SystemPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [memory, setMemory] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dreaming, setDreaming] = useState(false);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Memory stats are best-effort — the endpoint is optional in the gateway.
    const [statusP, memoryP] = [
      api.status().catch((e: unknown) => { throw e; }),
      api.memoryStats().catch(() => null),
    ];
    try {
      const [s, m] = await Promise.all([statusP, memoryP]);
      setStatus(s);
      setMemory(m);
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

  async function handleDream() {
    setDreaming(true);
    try {
      const result = await api.memoryDream();
      toast(`Dream cycle complete: ${JSON.stringify(result).slice(0, 80)}`, "success");
      reload();
    } catch (e) {
      toast(`Dream failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setDreaming(false);
    }
  }

  const providers = (status?.providers as ProviderInfo[] | undefined) ?? [];
  const roles = (status?.roles as RoleInfo[] | undefined) ?? [];
  const subagents = status?.subagents as { active: number; total: number } | undefined;
  const channels = status?.channels as unknown[] | undefined;
  const configuredProviders = providers.filter((p) => p.configured).length;
  const memoryEntries = memory ? Object.entries(memory) : [];

  return (
    <div className="p-4 max-w-5xl w-full mx-auto space-y-4 animate-fade-in-up">
      <PageHeader
        title="System"
        icon={Activity}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading && !status && <LoadingSpinner label="Loading system status…" />}
      {error && <ErrorBox message={error} />}

      {status && (
        <div className="grid md:grid-cols-2 gap-3">
          {/* Gateway card */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-1.5"><Server size={14} /> Gateway</span>
            </CardTitle>
            <CardContent>
              <StatRow label="Status" value={String(status.status ?? "unknown")} />
              <StatRow label="Model" value={String(status.model ?? "auto")} />
              <StatRow label="Uptime" value={formatDuration(status.uptime as number)} />
              <StatRow label="PID" value={String(status.pid ?? "—")} />
              <StatRow label="Version" value={String(status.version ?? "—")} />
              <StatRow label="Channels" value={String(channels?.length ?? 0)} />
              <StatRow
                label="Providers"
                value={`${configuredProviders}/${providers.length} configured`}
              />
              <StatRow label="Roles" value={String(roles.length)} />
              <StatRow
                label="Subagents"
                value={subagents ? `${subagents.active}/${subagents.total} active` : "0/0"}
              />
            </CardContent>
          </Card>

          {/* Memory card */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-1.5">
                <Database size={14} /> Memory
              </span>
            </CardTitle>
            <CardContent>
              {memoryEntries.length === 0 ? (
                <p className="text-xs text-fg-subtle py-2">
                  No memory stats available. The gateway may not have a memory backend configured.
                </p>
              ) : (
                memoryEntries.map(([k, v]) => (
                  <StatRow key={k} label={k} value={String(v)} />
                ))
              )}
              <div className="pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleDream}
                  disabled={dreaming}
                  className="w-full"
                >
                  <Moon size={13} className={cn(dreaming && "animate-pulse")} />
                  {dreaming ? "Dreaming…" : "Trigger dream cycle"}
                </Button>
                <p className="text-[10px] text-fg-subtle mt-1.5 text-center">
                  Consolidates + embeds pending memories offline.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Providers detail */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-1.5">
                <Cpu size={14} /> Providers ({configuredProviders} configured)
              </span>
            </CardTitle>
            <CardContent>
              {providers.length === 0 ? (
                <p className="text-xs text-fg-subtle py-2">No providers detected.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {providers.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-bg-elevated/50 text-[12px]">
                      <span className={cn("font-mono truncate min-w-0 flex-1", p.configured ? "text-fg" : "text-fg-subtle")}>
                        {p.id}
                      </span>
                      <span className="text-fg-subtle text-[10px] truncate max-w-[40%]">{p.model}</span>
                      <Badge color={p.configured ? "green" : "gray"}>{p.configured ? "on" : "off"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Roles detail */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-1.5">
                <Cog size={14} /> Roles ({roles.length})
              </span>
            </CardTitle>
            <CardContent>
              {roles.length === 0 ? (
                <p className="text-xs text-fg-subtle py-2">No roles configured.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {roles.map((r) => (
                    <div key={r.name} className="py-1">
                      <div className="flex items-center gap-2">
                        <Badge color="blue">{r.name}</Badge>
                      </div>
                      <p className="text-[11px] text-fg-muted mt-0.5">{r.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subagents summary */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-1.5"><Brain size={14} /> Subagents</span>
            </CardTitle>
            <CardContent>
              <div className="flex items-center gap-6 py-2">
                <div className="text-center">
                  <div className="text-2xl font-bold text-fg font-mono">{subagents?.active ?? 0}</div>
                  <div className="text-[10px] text-fg-subtle uppercase tracking-wide">Active</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-fg-muted font-mono">{subagents?.total ?? 0}</div>
                  <div className="text-[10px] text-fg-subtle uppercase tracking-wide">Total</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
