/**
 * SystemPage — host stats, gateway lifecycle, ops actions, and dream trigger.
 *
 * Enhanced with the Hermes M7 pattern (Action Polling with Trigger-Counter):
 * gateway start/stop/restart + ops (doctor/audit/backup) drive spawn-based
 * admin actions whose status is polled recursively. System info is loaded in
 * parallel via Promise.allSettled — each request settles independently so a
 * single failing endpoint never blocks the whole page.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type StatusResponse, type ActionStatusResponse } from "@/lib/api";
import { Card, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ActionLogViewer } from "@/components/ActionLogViewer";
import {
  PageHeader,
  LoadingSpinner,
  ErrorBox,
  RefreshButton,
} from "@/components/PageBits";
import { useToast } from "@/lib/toast";
import { useSystemActions } from "@/contexts/useSystemActions";
import type { SystemAction } from "@/contexts/system-actions-context";
import {
  Activity, Cpu, Server, Brain, Moon, Database, Cog,
  Power, Play, RotateCw, Stethoscope, ShieldCheck, X,
} from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PluginSlot } from "@/components/PluginSlot";

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

/** Backend action name for a given SystemAction (mirrors the provider). */
const ACTION_BACKEND_NAME: Record<SystemAction, string> = {
  restart: "gateway-restart",
  update: "doctor",
  backup: "backup",
  audit: "security-audit",
};

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
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dreaming, setDreaming] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState(false);

  const { toast } = useToast();
  const {
    activeAction,
    actionStatus,
    isBusy,
    isRunning,
    pendingAction,
    runAction,
    dismissLog,
  } = useSystemActions();

  // Parallel load via Promise.allSettled — each request settles independently
  // (Hermes SystemPage pattern): a single failing endpoint never blocks the
  // rest, and we only commit the values that actually fulfilled.
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      api.status(),
      api.memoryStats(),
      api.config(),
    ]);
    if (results[0].status === "fulfilled") setStatus(results[0].value);
    else setError(results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason));
    if (results[1].status === "fulfilled") setMemory(results[1].value);
    if (results[2].status === "fulfilled") setConfig(results[2].value);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  // ── Gateway lifecycle ──────────────────────────────────────────────
  // Start/Stop are quick one-shot calls (toast + reload). Restart goes
  // through useSystemActions so its spawn status is polled (M7 pattern).
  const runGatewayVerb = useCallback(
    async (verb: "start" | "stop") => {
      setGatewayBusy(true);
      try {
        if (verb === "start") await api.startGateway();
        else await api.stopGateway();
        toast(`Gateway ${verb} succeeded`, "success");
        setTimeout(() => void reload(), 2500);
      } catch (e) {
        toast(`Gateway ${verb} failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        setGatewayBusy(false);
      }
    },
    [reload, toast],
  );

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

  const gatewayRunning = status?.status === "ok";
  const activeBackendName = activeAction
    ? ACTION_BACKEND_NAME[activeAction]
    : null;

  return (
    <div className="p-4 max-w-5xl w-full mx-auto space-y-4 animate-fade-in-up">
      {/* Plugin injection seam — top of system. */}
      <PluginSlot name="system:top" />

      <PageHeader
        title="System"
        icon={Activity}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading && !status && <LoadingSpinner label="Loading system status…" />}
      {error && <ErrorBox message={error} />}

      {status && (
        <div className="grid md:grid-cols-2 gap-3">
          {/* Gateway card with lifecycle controls */}
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

              {/* Lifecycle controls */}
              <div className="flex flex-wrap items-center gap-2 pt-3">
                <Badge color={gatewayRunning ? "green" : "gray"}>
                  {gatewayRunning ? "running" : "stopped"}
                </Badge>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void runGatewayVerb("start")}
                  disabled={gatewayBusy || isBusy || gatewayRunning}
                  title="Start gateway"
                >
                  <Play size={12} /> Start
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void runAction("restart")}
                  disabled={gatewayBusy || isBusy}
                  title="Restart gateway (polled)"
                >
                  <RotateCw size={12} className={cn(isRunning && "animate-spin")} /> Restart
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void runGatewayVerb("stop")}
                  disabled={gatewayBusy || isBusy || !gatewayRunning}
                  title="Stop gateway"
                >
                  <Power size={12} /> Stop
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Action status + live log viewer */}
          <ActionPanel
            pendingAction={pendingAction}
            activeAction={activeAction}
            actionStatus={actionStatus}
            isRunning={isRunning}
            backendName={activeBackendName}
            onDismiss={dismissLog}
          />

          {/* Ops card — doctor / audit / backup (all polled via M7) */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-1.5"><Activity size={14} /> Operations</span>
            </CardTitle>
            <CardContent>
              <div className="flex flex-wrap gap-2 py-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void runAction("update")}
                  disabled={isBusy}
                >
                  <Stethoscope size={12} /> Doctor
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void runAction("audit")}
                  disabled={isBusy}
                >
                  <ShieldCheck size={12} /> Security audit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void runAction("backup")}
                  disabled={isBusy}
                >
                  <Database size={12} /> Backup
                </Button>
              </div>
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

      {config && (
        <details className="text-xs">
          <summary className="cursor-pointer text-fg-subtle">Raw config</summary>
          <pre className="mt-2 p-3 bg-bg-elevated/50 border border-border-subtle rounded-md overflow-auto max-h-64 font-mono text-[11px] text-fg-muted">
            {JSON.stringify(config, null, 2)}
          </pre>
        </details>
      )}

      {/* Plugin injection seam — bottom of system. */}
      <PluginSlot name="system:bottom" />
    </div>
  );
}

/** Renders the current action's status badge + live log tail (M7 polling). */
function ActionPanel({
  pendingAction,
  activeAction,
  actionStatus,
  isRunning,
  backendName,
  onDismiss,
}: {
  pendingAction: SystemAction | null;
  activeAction: SystemAction | null;
  actionStatus: ActionStatusResponse | null;
  isRunning: boolean;
  backendName: string | null;
  onDismiss: () => void;
}) {
  if (!activeAction && !pendingAction) return null;

  const done = activeAction !== null && actionStatus?.running === false;
  const success = done && actionStatus?.exit_code === 0;

  return (
    <Card>
      <CardTitle>
        <span className="flex items-center gap-1.5">
          <Activity size={14} /> Action
        </span>
      </CardTitle>
      <CardContent>
        <div className="flex items-center gap-2 py-1">
          {pendingAction ? (
            <>
              <Badge color="yellow">dispatching</Badge>
              <span className="text-xs text-fg-subtle font-mono">{pendingAction}</span>
            </>
          ) : (
            <>
              {isRunning ? (
                <Badge color="yellow">running</Badge>
              ) : done ? (
                <Badge color={success ? "green" : "red"}>
                  {success ? "success" : `failed (exit ${actionStatus?.exit_code ?? "?"})`}
                </Badge>
              ) : (
                <Badge color="gray">idle</Badge>
              )}
              {activeAction && (
                <span className="text-xs text-fg-subtle font-mono">{activeAction}</span>
              )}
              {actionStatus?.pid != null && (
                <span className="text-[10px] text-fg-muted">pid {actionStatus.pid}</span>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onDismiss}
                className="text-fg-muted hover:text-fg"
                aria-label="Dismiss action log"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>

        {backendName && (
          <div className="mt-1">
            <ActionLogViewer
              key={backendName}
              actionName={backendName}
              onClose={onDismiss}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
