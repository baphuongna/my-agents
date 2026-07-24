/**
 * ModelPickerDialog — set active model/provider for the gateway.
 */
import { useEffect, useState } from "react";
import { api, type ModelInfo } from "@/lib/api";
import { Modal } from "@/lib/modal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/lib/toast";
import { Cpu, Check, Search, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokenCount } from "@/lib/format";

export function ModelPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect?: (provider: string, model: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ provider: string; model: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .models()
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Group by provider
  const providers = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const key = m.provider ?? "unknown";
    if (!providers.has(key)) providers.set(key, []);
    providers.get(key)!.push(m);
  }

  const filteredProviders = Array.from(providers.entries()).filter(([provider, providerModels]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      provider.toLowerCase().includes(q) ||
      providerModels.some((m) => m.id.toLowerCase().includes(q))
    );
  });

  async function apply() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch("/config", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: `${selected.provider}/${selected.model}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      toast(`Model set: ${selected.provider}/${selected.model}`, "success");
      onSelect?.(selected.provider, selected.model);
      onClose();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select Model"
      maxWidth="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} disabled={!selected || saving}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </>
      }
    >
      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input
          className="input pl-8 w-full"
          placeholder="Search providers or models…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {loading && <p className="text-center text-fg-muted text-sm py-8">Loading models…</p>}

      {!loading && filteredProviders.length === 0 && (
        <p className="text-center text-fg-subtle text-sm py-8">No models found</p>
      )}

      <div className="space-y-3 max-h-[50vh] overflow-y-auto">
        {filteredProviders.map(([provider, providerModels]) => (
          <div key={provider}>
            <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-1.5 flex items-center gap-1.5 sticky top-0 bg-bg-surface py-1">
              {provider}
              <Badge color="gray">{providerModels.length}</Badge>
            </h3>
            <div className="space-y-1">
              {providerModels.map((m) => {
                const isSelected =
                  selected?.provider === provider && selected?.model === m.id;
                const reasoning = (m as Record<string, unknown>).reasoning as boolean | undefined;
                const ctx = m.contextWindow as number | undefined;
                return (
                  <button
                    key={`${provider}:${m.id}`}
                    onClick={() => setSelected({ provider, model: m.id })}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors border",
                      isSelected
                        ? "bg-accent/10 border-accent"
                        : "border-transparent hover:bg-bg-elevated/50 hover:border-border",
                    )}
                  >
                    {isSelected ? (
                      <Check size={14} className="text-accent shrink-0" />
                    ) : (
                      <Cpu size={14} className="text-fg-subtle shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] text-fg font-medium">{m.name || m.id}</span>
                      {reasoning && (
                        <Badge color="purple" className="ml-1.5">
                          <Brain size={8} /> reasoning
                        </Badge>
                      )}
                    </div>
                    {ctx && (
                      <span className="text-[10px] text-fg-subtle font-mono shrink-0">
                        {formatTokenCount(ctx)} ctx
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
