import { useAsync } from "@/hooks/useAsync";
import { api, type ModelInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox } from "./SessionsPage";
import { Cpu } from "lucide-react";

export function ModelsPage() {
  const { data: models, loading, error } = useAsync(() => api.models(), []);

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Models" icon={Cpu} />

      {loading && !models && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {models && models.length === 0 && (
        <Card>
          <p className="text-fg-muted text-sm text-center py-8">
            No models configured. Set an API key in <code className="text-accent">~/.mya/agent/auth.json</code>
          </p>
        </Card>
      )}

      {models && models.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {models.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCard({ model }: { model: ModelInfo }) {
  return (
    <Card className="hover:border-accent transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded bg-bg-elevated flex items-center justify-center shrink-0">
          <Cpu size={16} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-fg font-medium text-sm">{model.name || model.id}</span>
            {model.provider && <Badge color="blue">{model.provider}</Badge>}
          </div>
          <div className="text-[11px] text-fg-muted font-mono">{model.id}</div>
          {model.contextWindow && (
            <div className="text-[11px] text-fg-subtle mt-1">
              {(model.contextWindow / 1000).toFixed(0)}k context
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
