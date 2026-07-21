/**
 * ConfigPage — runtime config viewer/editor.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, RefreshButton } from "@/components/PageBits";
import { Settings, Save } from "lucide-react";
import { useToast } from "@/lib/toast";

export function ConfigPage() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    reload();
  }, []);

  const entries = config ? Object.entries(config) : [];

  return (
    <div className="p-4 max-w-3xl space-y-3">
      <PageHeader
        title="Config"
        icon={Settings}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {config && (
        <>
          {entries.length === 0 ? (
            <Card>
              <p className="text-fg-muted text-sm text-center py-8">
                No runtime config keys. The gateway uses defaults.
              </p>
            </Card>
          ) : (
            <Card className="animate-fade-in-up">
              <CardTitle>Runtime Configuration ({entries.length} keys)</CardTitle>
              <div className="mt-3 bg-bg-input/60 border border-border/40 rounded-lg p-2.5 font-mono text-[12px] leading-relaxed">
                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-border/40 text-[10px] text-fg-subtle">
                  <span className="w-2 h-2 rounded-full bg-danger/70" />
                  <span className="w-2 h-2 rounded-full bg-warning/70" />
                  <span className="w-2 h-2 rounded-full bg-success/70" />
                  <span className="ml-2 uppercase tracking-wide">config.json</span>
                </div>
                <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
                  {entries.map(([key, value], idx) => {
                    const type = typeof value;
                    const display = typeof value === "object" ? JSON.stringify(value) : String(value);
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
                        <span className="text-fg-subtle select-none w-4 text-right shrink-0 text-[10px]">{idx + 1}</span>
                        <code className="text-accent font-mono shrink-0">{key}</code>
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
    </div>
  );
}
