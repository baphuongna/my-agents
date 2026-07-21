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
            <Card>
              <CardTitle>Runtime Configuration ({entries.length} keys)</CardTitle>
              <div className="space-y-1 mt-3">
                {entries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-bg-elevated/50 text-[12px]"
                  >
                    <code className="text-accent font-mono shrink-0">{key}</code>
                    <span className="text-fg-subtle">=</span>
                    <code className="text-fg-muted font-mono flex-1 truncate">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </code>
                    <Badge color="gray">{typeof value}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
