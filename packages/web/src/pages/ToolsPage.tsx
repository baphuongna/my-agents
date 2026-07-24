/**
 * ToolsPage — tool list with permission mode color-coding + descriptions.
 */
import { useEffect, useState } from "react";
import { api, type ToolInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState, RefreshButton } from "@/components/PageBits";
import { Zap, Search } from "lucide-react";

const MODE_CONFIG: Record<
  string,
  { color: "green" | "yellow" | "red" | "blue" | "gray"; label: string; nameColor: string; dot: string }
> = {
  ReadOnly: { color: "green", label: "Read", nameColor: "text-success", dot: "bg-success" },
  WorkspaceWrite: { color: "yellow", label: "Write", nameColor: "text-warning", dot: "bg-warning" },
  DangerFullAccess: { color: "red", label: "Danger", nameColor: "text-danger", dot: "bg-danger" },
};

export function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function reload() {
    setLoading(true);
    try {
      const data = await api.tools();
      setTools(data);
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
      .tools()
      .then((data) => {
        if (!cancelled) {
          setTools(data);
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

  const filtered = search
    ? tools.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : tools;

  // Group by mode
  const byMode = new Map<string, ToolInfo[]>();
  for (const t of filtered) {
    const key = t.mode ?? "unknown";
    if (!byMode.has(key)) byMode.set(key, []);
    byMode.get(key)!.push(t);
  }

  const modeOrder = ["DangerFullAccess", "WorkspaceWrite", "ReadOnly", "__other__"];

  return (
    <div className="p-4 max-w-4xl w-full mx-auto space-y-3">
      <PageHeader
        title="Tools"
        icon={Zap}
        actions={
          <>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                className="input pl-7 text-xs w-36"
                placeholder="Search tools…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <RefreshButton onClick={reload} />
          </>
        }
      />

      {loading && tools.length === 0 && <LoadingSpinner label="Loading tools…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && tools.length === 0 && (
        <EmptyState icon={Zap} title="No tools registered" />
      )}

      {modeOrder
        .filter((m) => byMode.has(m))
        .map((mode, idx) => {
          const config = MODE_CONFIG[mode] ?? {
            color: "gray" as const,
            label: mode,
            nameColor: "text-fg",
            dot: "bg-fg-subtle",
          };
          const modeTools = byMode.get(mode)!;
          return (
            <div
              key={mode}
              className="animate-fade-in-up"
              style={{ animationDelay: `${Math.min(idx * 60, 240)}ms` }}
            >
              <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-1.5 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${config.dot} shrink-0`} />
                <Badge color={config.color}>{config.label}</Badge>
                <span className="text-fg-subtle">{modeTools.length} tools</span>
              </h3>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {modeTools.map((t, ti) => (
                  <Card
                    key={t.name}
                    hover
                    className="py-2 px-3 animate-fade-in-up"
                    style={{ animationDelay: `${Math.min(ti * 40, 320)}ms` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1 h-1 rounded-full ${config.dot} shrink-0`} />
                      <code className={`text-[13px] ${config.nameColor} font-mono`}>{t.name}</code>
                      <span className="flex-1" />
                      {t.description && (
                        <span className="text-[10px] text-fg-subtle truncate max-w-[50%]">
                          {t.description}
                        </span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
