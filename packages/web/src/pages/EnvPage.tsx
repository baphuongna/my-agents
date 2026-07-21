/**
 * EnvPage — API key management (provider configuration status).
 * Shows which providers are configured + allows adding keys.
 */
import { useEffect, useState } from "react";
import { api, type StatusResponse } from "@/lib/api";
import { Card, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox, RefreshButton } from "@/components/PageBits";
import { Modal } from "@/lib/modal";
import { useToast } from "@/lib/toast";
import { KeyRound, Check, X, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProviderInfo {
  id: string;
  envKey: string;
  model: string;
  configured: boolean;
}

const PROVIDER_URLS: Record<string, string> = {
  minimax: "https://platform.minimaxi.com/",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys/",
  xai: "https://console.x.ai/",
  openrouter: "https://openrouter.ai/keys",
  together: "https://api.together.xyz/settings/api-keys",
  fireworks: "https://fireworks.ai/account/api-keys",
  moonshotai: "https://platform.moonshot.cn/console/api-keys",
};

export function EnvPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProviderInfo | null>(null);
  const { toast } = useToast();

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
  }, []);

  const providers = ((status?.providers as ProviderInfo[]) ?? []).sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  const configured = providers.filter((p) => p.configured);

  return (
    <div className="p-4 max-w-3xl w-full mx-auto space-y-3">
      <PageHeader
        title="API Keys"
        icon={KeyRound}
        actions={<RefreshButton onClick={reload} />}
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card
          hover
          className="py-2.5 px-3 text-center animate-fade-in-up"
          style={{ animationDelay: "40ms" }}
        >
          <div className="text-2xl font-bold text-success">{configured.length}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide mt-0.5">Configured</div>
        </Card>
        <Card
          hover
          className="py-2.5 px-3 text-center animate-fade-in-up"
          style={{ animationDelay: "80ms" }}
        >
          <div className="text-2xl font-bold text-fg-muted">{providers.length - configured.length}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide mt-0.5">Available</div>
        </Card>
        <Card
          hover
          className="py-2.5 px-3 text-center animate-fade-in-up"
          style={{ animationDelay: "120ms" }}
        >
          <div className="text-2xl font-bold text-accent">{providers.length}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide mt-0.5">Total</div>
        </Card>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {/* Configured providers — visually prominent success-glow section */}
      {configured.length > 0 && (
        <Card
          className="border-success/40 animate-fade-in-up"
          style={{
            boxShadow: "0 0 0 1px rgb(var(--success) / 0.25), 0 0 18px rgb(var(--success) / 0.12)",
          }}
        >
          <CardTitle>
            <span className="w-2 h-2 rounded-full bg-success animate-pulse-slow shrink-0" />
            Active Providers ({configured.length})
          </CardTitle>
          <CardContent>
            <div className="space-y-1 mt-2">
              {configured.map((p, idx) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-success/5 border-l-2 border-l-success animate-fade-in-up"
                  style={{ animationDelay: `${Math.min(idx * 40, 240)}ms` }}
                >
                  <Check size={14} className="text-success shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <code className="text-[13px] text-fg font-mono truncate min-w-0">{p.id}</code>
                      <Badge color="green">active</Badge>
                    </div>
                    <div className="text-[10px] text-fg-subtle font-mono mt-0.5">
                      {p.envKey} → {p.model}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider list */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "60ms" }}>
        <CardTitle>Providers</CardTitle>
        <CardContent>
          <div className="space-y-1 mt-2">
            {providers.map((p, idx) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-2 py-2 px-2.5 rounded-lg transition-colors border-l-2 animate-fade-in-up",
                  p.configured
                    ? "border-l-success/40 opacity-70"
                    : "border-l-transparent hover:border-l-fg-subtle hover:bg-bg-elevated/50",
                )}
                style={!p.configured ? { animationDelay: `${Math.min(idx * 30, 240)}ms` } : undefined}
              >
                {p.configured ? (
                  <Check size={14} className="text-success shrink-0" />
                ) : (
                  <X size={14} className="text-fg-subtle shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className="text-[13px] text-fg font-mono truncate min-w-0">{p.id}</code>
                    {p.configured && <Badge color="green">active</Badge>}
                  </div>
                  <div className="text-[10px] text-fg-subtle font-mono mt-0.5">
                    {p.envKey} → {p.model}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {PROVIDER_URLS[p.id] && (
                    <a
                      href={PROVIDER_URLS[p.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost p-1"
                      title="Get API key"
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                  {!p.configured && (
                    <Button size="sm" variant="secondary" onClick={() => setAdding(p)}>
                      <Plus size={11} /> Add Key
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Help card */}
      <Card className="border-accent/30 bg-accent/5 animate-fade-in-up" style={{ animationDelay: "120ms" }}>
        <div className="flex items-start gap-2">
          <KeyRound size={14} className="text-accent shrink-0 mt-0.5" />
          <div className="text-[12px] text-fg-muted">
            <p className="font-medium text-fg mb-1">How to add API keys</p>
            <p>
              Set environment variables or add to{" "}
              <code className="text-accent">~/.mya/agent/auth.json</code>:
            </p>
            <pre className="text-[10px] text-fg-subtle font-mono mt-1.5 bg-bg-input rounded p-2 overflow-x-auto">
{`{
  "minimax": { "key": "sk-..." },
  "openai": { "key": "sk-..." }
}`}
            </pre>
          </div>
        </div>
      </Card>

      {/* Add key modal */}
      <AddKeyModal
        provider={adding}
        onClose={() => setAdding(null)}
        onSaved={() => {
          setAdding(null);
          reload();
        }}
      />
    </div>
  );
}

function AddKeyModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: ProviderInfo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setKey("");
  }, [provider]);

  async function save() {
    if (!provider || !key.trim()) return;
    setSaving(true);
    try {
      // Use the gateway env endpoint
      await fetch("/providers/config", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: provider.id, envKey: provider.envKey, value: key.trim() }),
      });
      toast(`${provider.id} key saved`, "success");
      onSaved();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={provider !== null}
      onClose={onClose}
      title={`Add ${provider?.id ?? ""} API Key`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!key.trim() || saving}>
            {saving ? "Saving…" : "Save Key"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-fg-muted mb-1 block">
            {provider?.envKey ?? "API Key"}
          </label>
          <input
            type="password"
            className="input w-full font-mono"
            placeholder="sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
          />
        </div>
        <p className="text-[11px] text-fg-subtle">
          The key will be stored in <code className="text-accent">~/.mya/agent/auth.json</code>.
          Restart the gateway after adding.
        </p>
      </div>
    </Modal>
  );
}
