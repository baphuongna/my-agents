/**
 * RichInfoPage — reusable rich placeholder for pages that need API wiring later.
 * Shows the feature description + relevant API endpoint info + what's coming.
 */
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { type LucideIcon, ExternalLink } from "lucide-react";

export function RichInfoPage({
  title,
  icon: Icon,
  description,
  endpoints,
  features,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
  endpoints?: { method: string; path: string; desc: string }[];
  features?: string[];
}) {
  return (
    <div className="p-4 max-w animate-fade-in-up-3xl space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={18} className="text-accent" />
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
      </div>

      <Card>
        <div className="text-center py-6">
          <Icon size={32} className="text-fg-subtle mx-auto mb-3" />
          <p className="text-fg-muted text-sm">{description}</p>
        </div>
      </Card>

      {endpoints && endpoints.length > 0 && (
        <Card>
          <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-2">Available API Endpoints</h3>
          <div className="space-y-1">
            {endpoints.map((ep, i) => (
              <div key={i} className="flex items-center gap-2 py-1 text-[12px]">
                <Badge color={ep.method === "GET" ? "green" : ep.method === "POST" ? "blue" : "yellow"}>
                  {ep.method}
                </Badge>
                <code className="text-accent font-mono">{ep.path}</code>
                <span className="text-fg-subtle text-[11px] truncate ml-auto">{ep.desc}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {features && features.length > 0 && (
        <Card>
          <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-2">Planned Features</h3>
          <div className="space-y-1">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-[12px] text-fg-muted">
                <span className="w-1 h-1 rounded-full bg-accent" />
                {f}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
