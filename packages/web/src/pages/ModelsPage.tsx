/**
 * ModelsPage — provider cards with configured/unconfigured status.
 * Port of Hermes ModelsPage pattern.
 */
import { useEffect, useState } from "react";
import { api, type ModelInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState, RefreshButton } from "@/components/PageBits";
import { Cpu, Check, X, Brain, Search } from "lucide-react";
import { formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupByProvider, setGroupByProvider] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const data = await api.models();
      setModels(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = search
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) || (m.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (m.provider ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : models;

  // Group by provider
  const providers = new Map<string, ModelInfo[]>();
  for (const m of filtered) {
    const key = m.provider ?? "unknown";
    if (!providers.has(key)) providers.set(key, []);
    providers.get(key)!.push(m);
  }

  return (
    <div className="p-4 max-w-5xl space-y-3">
      <PageHeader
        title="Models"
        icon={Cpu}
        actions={
          <>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                className="input pl-7 text-xs w-36"
                placeholder="Search models…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              className={cn("btn-secondary text-[11px]", groupByProvider && "bg-accent text-white")}
              onClick={() => setGroupByProvider(!groupByProvider)}
            >
              {groupByProvider ? "Grouped" : "Flat"}
            </button>
            <RefreshButton onClick={reload} />
          </>
        }
      />

      {loading && models.length === 0 && <LoadingSpinner label="Loading models…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && models.length === 0 && (
        <EmptyState
          icon={Cpu}
          title="No models configured"
          description="Set an API key in ~/.mya/agent/auth.json"
        />
      )}

      {groupByProvider
        ? Array.from(providers.entries()).map(([provider, providerModels], idx) => (
            <div
              key={provider}
              className="animate-fade-in-up"
              style={{ animationDelay: `${Math.min(idx * 60, 300)}ms` }}
            >
              <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                {provider}
                <Badge color="gray">{providerModels.length}</Badge>
              </h3>
              <div className="grid sm:grid-cols-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {providerModels.map((m, mi) => (
                  <ModelCard key={m.id} model={m} index={mi} />
                ))}
              </div>
            </div>
          ))
        : (
          <div className="grid sm:grid-cols-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {filtered.map((m, mi) => (
              <ModelCard key={m.id} model={m} index={mi} />
            ))}
          </div>
        )}
    </div>
  );
}

function ModelCard({ model, index = 0 }: { model: ModelInfo; index?: number }) {
  const contextWindow = model.contextWindow as number | undefined;
  const maxTokens = (model as Record<string, unknown>).maxTokens as number | undefined;
  const reasoning = (model as Record<string, unknown>).reasoning as boolean | undefined;

  return (
    <Card
      hover
      className="py-2.5 px-3 border-l-2 border-l-accent/40 hover:border-l-accent animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded bg-bg-elevated flex items-center justify-center shrink-0">
          <Cpu size={14} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-fg font-medium text-[13px] truncate">{model.name || model.id}</span>
            {reasoning && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium whitespace-nowrap bg-purple/20 text-purple animate-fade-in"
                style={{ boxShadow: "0 0 8px rgb(var(--purple) / 0.35)" }}
                title="Reasoning-capable model"
              >
                <Brain size={8} /> reasoning
              </span>
            )}
          </div>
          <code className="text-[10px] text-fg-subtle block truncate">{model.id}</code>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-fg-muted">
            {contextWindow && (
              <span className="flex items-center gap-0.5">
                <Check size={9} className="text-success" />
                {formatTokenCount(contextWindow)} ctx
              </span>
            )}
            {maxTokens && <span>{formatTokenCount(maxTokens)} out</span>}
          </div>
        </div>
        <Badge color="blue" className="shrink-0">
          {model.provider}
        </Badge>
      </div>
    </Card>
  );
}
