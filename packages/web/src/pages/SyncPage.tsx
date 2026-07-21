/**
 * SyncPage — cross-device state convergence visualization.
 * Uses gateway endpoints: GET /sync/state, GET /sync/pull
 */
import { useEffect, useState } from "react";
import { Card, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState, RefreshButton } from "@/components/PageBits";
import { useToast } from "@/lib/toast";
import { Database, Download, Upload, Clock, Key } from "lucide-react";

export function SyncPage() {
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [pullResult, setPullResult] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/sync/state", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function doPull() {
    try {
      const res = await fetch("/sync/pull", { credentials: "include" });
      const data = await res.json();
      setPullResult(data);
      toast(`Pulled ${Array.isArray(data) ? data.length : Object.keys(data).length} entries`, "success");
    } catch (e) {
      toast(`Pull failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  // Extract stats from state
  const entries = state as Record<string, unknown> | null;
  const keyCount = entries ? Object.keys(entries).filter((k) => !k.startsWith("_")).length : 0;
  const hlc = entries?.["_hlc" as keyof typeof entries] ?? entries?.["hlc"];
  const stateEntries = entries
    ? Object.entries(entries).filter(([k]) => !k.startsWith("_")).slice(0, 20)
    : [];

  return (
    <div className="p-4 max-w animate-fade-in-up-3xl space-y-3">
      <PageHeader
        title="Sync"
        icon={Database}
        actions={<RefreshButton onClick={reload} />}
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="py-3 px-4 text-center">
          <Key size={16} className="text-accent mx-auto mb-1" />
          <div className="text-xl font-bold text-fg">{keyCount}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide">Keys</div>
        </Card>
        <Card className="py-3 px-4 text-center">
          <Clock size={16} className="text-purple mx-auto mb-1" />
          <div className="text-xl font-bold text-fg font-mono text-[13px]">
            {hlc ? String(hlc).slice(-8) : "—"}
          </div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide">HLC Tick</div>
        </Card>
        <Card className="py-3 px-4 text-center">
          <Database size={16} className="text-success mx-auto mb-1" />
          <div className="text-xl font-bold text-fg">{state ? "✅" : "—"}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide">Replica</div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={doPull}>
          <Download size={13} /> Pull Entries
        </Button>
      </div>

      {loading && !state && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {/* State entries */}
      {!loading && !error && keyCount === 0 && (
        <EmptyState
          icon={Database}
          title="No synced state"
          description="State entries appear here when devices push data"
        />
      )}

      {stateEntries.length > 0 && (
        <Card>
          <CardTitle>Replica State ({keyCount} keys)</CardTitle>
          <CardContent>
            <div className="space-y-0.5 mt-2 max-h-64 overflow-y-auto">
              {stateEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center gap-2 py-1 px-2 rounded text-[11px] hover:bg-bg-elevated/50"
                >
                  <code className="text-accent font-mono shrink-0 truncate max-w-[40%]">{key}</code>
                  <span className="text-fg-subtle">=</span>
                  <code className="text-fg-muted font-mono flex-1 truncate">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </code>
                </div>
              ))}
              {keyCount > 20 && (
                <p className="text-center text-fg-subtle text-[10px] py-1">
                  … and {keyCount - 20} more
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pull result */}
      {pullResult && (
        <Card>
          <CardTitle>Last Pull Result</CardTitle>
          <pre className="text-[10px] text-fg-muted font-mono overflow-x-auto mt-2 max-h-40 overflow-y-auto bg-bg-input rounded p-2">
            {JSON.stringify(pullResult, null, 2).slice(0, 1000)}
          </pre>
        </Card>
      )}

      {/* Info */}
      <Card className="border-accent/30 bg-accent/5">
        <div className="text-[12px] text-fg-muted">
          <p className="font-medium text-fg mb-1">How sync works</p>
          <p className="mb-1">
            State convergence uses <strong className="text-fg">Hybrid Logical Clocks (HLC)</strong> for
            ordering and <strong className="text-fg">Last-Writer-Wins (LWW)</strong> for conflict
            resolution. Each device maintains a replica and exchanges entries via push/pull.
          </p>
        </div>
      </Card>
    </div>
  );
}
