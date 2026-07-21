import { useAsync } from "@/hooks/useAsync";
import { api, type ToolInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox } from "./SessionsPage";
import { Zap } from "lucide-react";

const MODE_COLORS: Record<string, "green" | "yellow" | "red" | "blue" | "gray"> = {
  ReadOnly: "green",
  WorkspaceWrite: "yellow",
  DangerFullAccess: "red",
};

export function ToolsPage() {
  const { data: tools, loading, error } = useAsync(() => api.tools(), []);

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Tools" icon={Zap} />

      {loading && !tools && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {tools && (
        <div className="grid gap-2">
          {tools.map((t) => (
            <ToolRow key={t.name} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolInfo }) {
  const color = tool.mode ? MODE_COLORS[tool.mode] ?? "gray" : "gray";
  return (
    <Card>
      <div className="flex items-center gap-3">
        <code className="text-sm text-accent font-mono">{tool.name}</code>
        {tool.mode && <Badge color={color}>{tool.mode}</Badge>}
        <span className="flex-1" />
        {tool.description && (
          <span className="text-[11px] text-fg-muted truncate max-w-[50%]">
            {tool.description}
          </span>
        )}
      </div>
    </Card>
  );
}
