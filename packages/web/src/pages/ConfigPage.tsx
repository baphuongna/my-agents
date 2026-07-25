/**
 * ConfigPage — runtime config viewer/editor.
 *
 * Hermes port: CATEGORY_ICONS per-key icon mapping, a search filter, and a
 * scoped reset (resets only the currently filtered keys) gated by a
 * ConfirmDialog.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox, RefreshButton } from "@/components/PageBits";
import {
  Settings,
  Search,
  RotateCcw,
  Bot,
  Brain,
  Clock,
  Globe,
  Shield,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/lib/toast";
import { PluginSlot } from "@/components/PluginSlot";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ── Category icons (Hermes CATEGORY_ICONS pattern) ───────────────────
// Each config category renders with a distinct icon so the key list reads
// at a glance. Unknown categories fall back to the generic Settings icon.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  agent: Bot,
  memory: Brain,
  cron: Clock,
  web: Globe,
  security: Shield,
  performance: Zap,
};
const DEFAULT_CATEGORY_ICON: LucideIcon = Settings;

/** Resolve the config category for a key from its leading segment. */
function categoryFor(key: string): string {
  const seg = key.split(/[._\-/]/)[0]?.toLowerCase() ?? "";
  if (seg.startsWith("agent") || seg === "ai") return "agent";
  if (seg.startsWith("mem")) return "memory";
  if (seg.startsWith("cron") || seg.startsWith("sched")) return "cron";
  if (seg.startsWith("web") || seg.startsWith("http")) return "web";
  if (seg.startsWith("sec") || seg.startsWith("auth") || seg.startsWith("key")) {
    return "security";
  }
  if (seg.startsWith("perf") || seg.startsWith("cache") || seg.startsWith("tune")) {
    return "performance";
  }
  return "settings";
}

export function ConfigPage() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { toast } = useToast();

  async function reload() {
    setLoading(true);
    try {
      const data = await api.config();
      setConfig(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .config()
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => (config ? Object.entries(config) : []), [config]);
  // Scoped view: only keys matching the current filter are visible / reset-able.
  const filtered = useMemo(
    () =>
      filter.trim()
        ? entries.filter(([key]) => key.toLowerCase().includes(filter.trim().toLowerCase()))
        : entries,
    [entries, filter],
  );

  async function doReset() {
    if (filtered.length === 0) return;
    setResetting(true);
    try {
      await fetch("/config/reset", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: filtered.map(([k]) => k) }),
      });
      toast(`Reset ${filtered.length} key(s)`, "success");
      setResetOpen(false);
      reload();
    } catch (e) {
      toast(`Reset failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="p-4 max-w-3xl w-full mx-auto space-y-3">
      {/* Plugin injection seam — top of config. */}
      <PluginSlot name="config:top" />

      <PageHeader
        title="Config"
        icon={Settings}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {config && (
        <>
          {/* Filter + scoped reset toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
              />
              <input
                className="input w-full pl-7 text-xs"
                placeholder="Filter config keys…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter config keys"
              />
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setResetOpen(true)}
              disabled={filtered.length === 0}
              title="Reset only the currently filtered keys to defaults"
            >
              <RotateCcw size={11} /> Reset filtered
            </Button>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <p className="text-fg-muted text-sm text-center py-8">
                {entries.length === 0
                  ? "No runtime config keys. The gateway uses defaults."
                  : "No config keys match the current filter."}
              </p>
            </Card>
          ) : (
            <Card className="animate-fade-in-up">
              <CardTitle>
                Runtime Configuration ({filtered.length}
                {filter.trim() && entries.length !== filtered.length
                  ? `/${entries.length}`
                  : ""}{" "}
                keys)
              </CardTitle>
              <div className="mt-3 bg-bg-input/60 border border-border/40 rounded-lg p-2.5 font-mono text-[12px] leading-relaxed">
                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-border/40 text-[10px] text-fg-subtle">
                  <span className="w-2 h-2 rounded-full bg-danger/70" />
                  <span className="w-2 h-2 rounded-full bg-warning/70" />
                  <span className="w-2 h-2 rounded-full bg-success/70" />
                  <span className="ml-2 uppercase tracking-wide">config.json</span>
                </div>
                <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
                  {filtered.map(([key, value], idx) => {
                    const type = typeof value;
                    const display =
                      typeof value === "object" ? JSON.stringify(value) : String(value);
                    const cat = categoryFor(key);
                    const CatIcon = CATEGORY_ICONS[cat] ?? DEFAULT_CATEGORY_ICON;
                    const typeColor =
                      type === "string"
                        ? "badge-green"
                        : type === "number"
                          ? "badge-blue"
                          : type === "boolean"
                            ? "badge-purple"
                            : type === "object"
                              ? "badge-yellow"
                              : "badge-gray";
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-bg-elevated/50 animate-fade-in-up"
                        style={{ animationDelay: `${Math.min(idx * 30, 240)}ms` }}
                      >
                        <span className="text-fg-subtle select-none w-4 text-right shrink-0 text-[10px]">
                          {idx + 1}
                        </span>
                        <CatIcon
                          size={11}
                          className="text-fg-subtle shrink-0"
                          data-testid={`config-icon-${cat}`}
                          aria-hidden
                        />
                        <code className="text-accent font-mono shrink-0 truncate min-w-0 max-w-[8rem]">
                          {key}
                        </code>
                        <span className="text-fg-subtle">=</span>
                        <code className="text-fg-muted font-mono flex-1 truncate">{display}</code>
                        <span className={`${typeColor} !px-1.5 !py-0`}>{type}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Scoped reset confirmation — only the visible/filtered keys are reset. */}
      <ConfirmDialog
        open={resetOpen}
        title={`Reset ${filtered.length} config key(s)?`}
        description={
          "This resets only the currently filtered fields to their defaults. This cannot be undone."
        }
        confirmLabel="Reset"
        destructive
        loading={resetting}
        onConfirm={doReset}
        onCancel={() => setResetOpen(false)}
      />

      {/* Plugin injection seam — bottom of config. */}
      <PluginSlot name="config:bottom" />
    </div>
  );
}
